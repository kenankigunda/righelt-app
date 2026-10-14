import { STORAGE_POLICY } from "../../shared-types/src/storage-policy";
import type { D1DatabaseLike,D1Statement,LiveGameEnv } from "./shell-live-db";
import type { LiveGame } from "./shell-live-core";
import { encodeStorage,decodeStorage,sha256,collectBounded } from "./storage-codec";
import { reserveArchiveOperation,growthGuard,reserveRestore,observeRestore } from "./storage-budget";
import { AuthProblem } from "./auth-controls";

export type ArchiveBucket = {
  put:(key:string,value:Uint8Array,options?:{onlyIf:{etagDoesNotMatch:string}})=>Promise<unknown>;
  get:(key:string)=>Promise<{body:ReadableStream<Uint8Array>}|null>;
  delete:(key:string)=>Promise<void>;
};
export type ArchiveEnv = LiveGameEnv & { ARCHIVES?:ArchiveBucket; STORAGE_ARCHIVES_ENABLED?:string };
export type ArchiveRow = {game_id:string;status:"archiving"|"archived"|"restoring";generation:string;event_seq:number;gameplay_revision:number;manifest_key:string;manifest_sha256:string|null;cursor:string;next_chunk:number;activity_at:string};
type Part={chunk_index:number;object_key:string;sha256:string;bytes:number;raw_bytes:number;kind:"state"|"receipt"|"tombstone";first_id:string|null;last_id:string|null;row_count:number};
type Manifest={version:1;gameId:string;generation:string;capturedEventSeq:number;gameplayRevision:number;parts:Part[]};
type Evidence={game_id:string;client_command_id:string;[key:string]:unknown};

export const archiveRow = async(env:LiveGameEnv,gameId:string)=>env.DB.prepare("SELECT * FROM game_archives WHERE game_id=?1").bind(gameId).first<ArchiveRow>();
const rootKey=(row:ArchiveRow)=>row.manifest_key.slice(0,-"manifest.gz".length);
const cardJson=(game:LiveGame)=>JSON.stringify({...game,moves:[],turns:game.turns.slice(-1),moveCount:game.moves.length});
const guard=(db:D1DatabaseLike,id:string,sql:string,...args:unknown[])=>db.prepare(`INSERT INTO account_transaction_guards(guard_id,valid) VALUES(?1,COALESCE((${sql}),0))`).bind(id,...args);
const clearGuard=(db:D1DatabaseLike,id:string)=>db.prepare("DELETE FROM account_transaction_guards WHERE guard_id=?1").bind(id);
const permit=(env:ArchiveEnv,row:ArchiveRow,operation:"archive"|"restore"|"view")=>env.DB.prepare("INSERT INTO storage_lifecycle_permits(game_id,operation,event_seq,valid) VALUES(?1,?2,?3,COALESCE((SELECT 1 FROM live_games g JOIN game_archives a USING(game_id) WHERE g.game_id=?1 AND g.event_seq=?3 AND a.event_seq=?3 AND a.manifest_sha256 IS NOT NULL AND (SELECT maintenance FROM account_cutover WHERE singleton=1)=0),0))").bind(row.game_id,operation,row.event_seq);
const clearPermit=(env:ArchiveEnv,row:ArchiveRow)=>env.DB.prepare("DELETE FROM storage_lifecycle_permits WHERE game_id=?1").bind(row.game_id);

async function readObject(env:ArchiveEnv,key:string,checksum:string,maximum:number=STORAGE_POLICY.maximumChunkBytes):Promise<unknown> {
  if(!env.ARCHIVES)throw new AuthProblem("archive_unavailable",503);
  await reserveArchiveOperation(env,"b");
  const object=await env.ARCHIVES.get(key);
  if(!object)throw new AuthProblem("archive_unavailable",503);
  const bytes=await collectBounded(object.body,maximum);
  return decodeStorage(bytes,checksum,maximum);
}
async function writeObject(env:ArchiveEnv,key:string,value:unknown,maximum:number=STORAGE_POLICY.maximumChunkBytes) {
  if(!env.ARCHIVES)throw new AuthProblem("archive_unavailable",503);
  const encoded=await encodeStorage(value,maximum);
  await reserveArchiveOperation(env,"a",key,encoded.blob.byteLength);
  await env.ARCHIVES.put(key,encoded.blob,{onlyIf:{etagDoesNotMatch:"*"}});
  await readObject(env,key,encoded.checksum,maximum);
  return {checksum:encoded.checksum,bytes:encoded.blob.byteLength,raw_bytes:encoded.rawBytes};
}
const manifestCache=new WeakMap<object,Map<string,Manifest>>();
async function manifestFor(env:ArchiveEnv,row:ArchiveRow):Promise<Manifest> {
  if(!row.manifest_sha256)throw new AuthProblem("archive_unavailable",503);
  let cache=manifestCache.get(env.DB);
  if(!cache){cache=new Map();manifestCache.set(env.DB,cache);}
  const key=`${row.manifest_key}:${row.manifest_sha256}`;
  let raw=cache.get(key);
  if(!raw){raw=await readObject(env,row.manifest_key,row.manifest_sha256) as Manifest;cache.set(key,raw);if(cache.size>8)cache.delete(cache.keys().next().value!);}
  if(raw?.version!==1 || raw.gameId!==row.game_id || raw.generation!==row.generation || raw.capturedEventSeq>row.event_seq || raw.gameplayRevision!==row.gameplay_revision || !Array.isArray(raw.parts) || raw.parts.filter(p=>p.kind==="state").length!==1)throw new Error("invalid_archive_manifest");
  return raw;
}
export async function readArchivedGame(env:ArchiveEnv,row:ArchiveRow):Promise<LiveGame> {
  const manifest=await manifestFor(env,row),part=manifest.parts.find(p=>p.kind==="state")!;
  const game=await readObject(env,part.object_key,part.sha256,STORAGE_POLICY.maximumStateBytes) as LiveGame;
  if(game?.id!==row.game_id || game.gameplayRevision!==row.gameplay_revision)throw new Error("invalid_archive_state");
  const views=await env.DB.prepare("SELECT identity_id,history_index FROM game_archive_views WHERE game_id=?1").bind(row.game_id).all<{identity_id:string;history_index:number|null}>();
  for(const view of views.results??[]){if(view.history_index===null)delete game.historyIndexByIdentity[view.identity_id];else game.historyIndexByIdentity[view.identity_id]=view.history_index;}
  const catalog=await env.DB.prepare("SELECT state_json FROM live_games WHERE game_id=?1").bind(row.game_id).first<{state_json:string}>();
  const card=catalog?JSON.parse(catalog.state_json):null;
  const presence=[card?.player1,card?.player2,...(card?.viewers??[])];
  for(const participant of [game.player1,game.player2,...game.viewers])if(participant){
    const current=presence.find(p=>p?.identityId===participant.identityId);
    participant.connected=current?.connected===true;
    participant.sessionCount=Number.isSafeInteger(current?.sessionCount)&&current.sessionCount>=0?current.sessionCount:0;
    if(typeof current?.lastHeartbeatAt==="string")participant.lastHeartbeatAt=current.lastHeartbeatAt;
  }
  return game;
}
export async function readArchivedEvidence(env:ArchiveEnv,row:ArchiveRow,kind:"receipt"|"tombstone",commandId:string):Promise<Evidence|null> {
  const manifest=await manifestFor(env,row);
  const part=manifest.parts.find(p=>p.kind===kind && p.first_id!==null && p.last_id!==null && p.first_id<=commandId && p.last_id>=commandId);
  if(!part)return null;
  const records=await readObject(env,part.object_key,part.sha256) as Evidence[];
  if(!Array.isArray(records) || records.length!==part.row_count || records.some(r=>r.game_id!==row.game_id))throw new Error("invalid_archive_evidence");
  return records.find(r=>r.client_command_id===commandId)??null;
}

/** Called only by the room queue, so new activity cannot race archive capture. */
export async function beginArchive(env:ArchiveEnv,game:LiveGame,eventSeq:number):Promise<boolean> {
  if(env.STORAGE_ARCHIVES_ENABLED!=="true" || !env.ARCHIVES)return false;
  const id=crypto.randomUUID(),key=`games/${env.STORAGE_GENERATION??"legacy"}/${game.id}/${eventSeq}/${id}/manifest.gz`;
  const eligible="SELECT 1 FROM live_games WHERE game_id=?2 AND event_seq=?3 AND retention_activity_at<strftime('%Y-%m-%dT%H:%M:%fZ','now',?4) AND NOT EXISTS(SELECT 1 FROM game_archives WHERE game_id=?2) AND (SELECT maintenance FROM account_cutover WHERE singleton=1)=0";
  const before=await env.DB.prepare("SELECT retention_activity_at FROM live_games WHERE game_id=?1").bind(game.id).first<{retention_activity_at:string}>();
  if(!before?.retention_activity_at || Date.parse(before.retention_activity_at)>Date.now()-STORAGE_POLICY.coldDays*86400000)return false;
  // A restored game may be cold again before the bounded garbage collector runs.
  // Verify its new durable copy before releasing prior archive references.
  const payload=await env.DB.prepare("SELECT state_blob,state_sha256 FROM game_payloads WHERE game_id=?1").bind(game.id).first<{state_blob:ArrayBuffer;state_sha256:string}>();
  if(payload)await decodeStorage(payload.state_blob,payload.state_sha256);
  else {
    const live=await env.DB.prepare("SELECT state_json,move_count FROM live_games WHERE game_id=?1 AND event_seq=?2").bind(game.id,eventSeq).first<{state_json:string;move_count:number}>();
    // Disabling compression writes leaves exact JSON as the durable authority.
    // A small archived card can never satisfy equality with the loaded full game.
    const raw=live?JSON.parse(live.state_json):null;
    if(!raw || raw.id!==game.id || !Array.isArray(raw.moves) || raw.moves.length!==live!.move_count || JSON.stringify([raw.board,raw.moves,raw.turns])!==JSON.stringify([game.board,game.moves,game.turns]))return false;
  }
  await env.DB.batch([
    guard(env.DB,id,eligible,game.id,eventSeq,`-${STORAGE_POLICY.coldDays} days`),
    env.DB.prepare("DELETE FROM storage_archive_chunks WHERE game_id=?1").bind(game.id),
    env.DB.prepare("DELETE FROM storage_restore_reservations WHERE game_id=?1").bind(game.id),
    env.DB.prepare("INSERT INTO game_archives(game_id,status,generation,event_seq,gameplay_revision,manifest_key,activity_at,updated_at) VALUES(?1,'archiving',?2,?3,?4,?5,?6,datetime('now'))").bind(game.id,env.STORAGE_GENERATION??"legacy",eventSeq,game.gameplayRevision,key,before.retention_activity_at),
    clearGuard(env.DB,id),
  ]);
  return true;
}
export async function cancelArchiveCapture(env:ArchiveEnv,row:ArchiveRow):Promise<void> {
  if(row.status!=="archiving")return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM storage_archive_chunks WHERE game_id=?1").bind(row.game_id),
    env.DB.prepare("DELETE FROM game_archives WHERE game_id=?1 AND status='archiving'").bind(row.game_id),
  ]);
}
async function recordPart(env:ArchiveEnv,row:ArchiveRow,part:Part,cursor:string) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO storage_archive_chunks(game_id,chunk_index,object_key,sha256,bytes,kind,first_id,last_id,row_count,raw_bytes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)").bind(row.game_id,part.chunk_index,part.object_key,part.sha256,part.bytes,part.kind,part.first_id,part.last_id,part.row_count,part.raw_bytes),
    env.DB.prepare("UPDATE game_archives SET next_chunk=next_chunk+1,cursor=?2,archive_bytes=archive_bytes+?3,updated_at=datetime('now') WHERE game_id=?1 AND status='archiving'").bind(row.game_id,cursor,part.bytes),
  ]);
}
export async function captureArchiveStep(env:ArchiveEnv,row:ArchiveRow,game:LiveGame,cardGame:LiveGame=game):Promise<boolean> {
  if(row.status!=="archiving")return false;
  if(row.next_chunk===0){
    const key=rootKey(row)+"state.gz",stored=await writeObject(env,key,game,STORAGE_POLICY.maximumStateBytes);
    await recordPart(env,row,{chunk_index:0,object_key:key,sha256:stored.checksum,bytes:stored.bytes,raw_bytes:stored.raw_bytes,kind:"state",first_id:null,last_id:null,row_count:1},JSON.stringify({kind:"receipt",last:""}));return false;
  }
  const cursor=JSON.parse(row.cursor) as {kind:"receipt"|"tombstone";last:string};
  const table=cursor.kind==="receipt"?"live_command_receipts":"live_legacy_command_tombstones";
  const records=(await env.DB.prepare(`SELECT * FROM ${table} WHERE game_id=?1 AND client_command_id>?2 ORDER BY client_command_id LIMIT ?3`).bind(row.game_id,cursor.last,STORAGE_POLICY.chunkRows).all<Evidence>()).results??[];
  if(records.length){
    const key=rootKey(row)+`${row.next_chunk}.gz`,stored=await writeObject(env,key,records);
    await recordPart(env,row,{chunk_index:row.next_chunk,object_key:key,sha256:stored.checksum,bytes:stored.bytes,raw_bytes:stored.raw_bytes,kind:cursor.kind,first_id:records[0].client_command_id,last_id:records.at(-1)!.client_command_id,row_count:records.length},JSON.stringify({kind:cursor.kind,last:records.at(-1)!.client_command_id}));return false;
  }
  if(cursor.kind==="receipt"){await env.DB.prepare("UPDATE game_archives SET cursor=?2,updated_at=datetime('now') WHERE game_id=?1").bind(row.game_id,JSON.stringify({kind:"tombstone",last:""})).run();return false;}
  const parts=(await env.DB.prepare("SELECT chunk_index,object_key,sha256,bytes,raw_bytes,kind,first_id,last_id,row_count FROM storage_archive_chunks WHERE game_id=?1 ORDER BY chunk_index").bind(row.game_id).all<Part>()).results??[];
  const manifest:Manifest={version:1,gameId:row.game_id,generation:row.generation,capturedEventSeq:row.event_seq,gameplayRevision:row.gameplay_revision,parts};
  const stored=await writeObject(env,row.manifest_key,manifest);
  // Manifest publication precedes removal of the authoritative live payload.
  await env.DB.batch([
    env.DB.prepare("UPDATE game_archives SET status='archived',manifest_sha256=?2,next_chunk=0,cursor='',updated_at=datetime('now') WHERE game_id=?1 AND status='archiving'").bind(row.game_id,stored.checksum),
    permit(env,row,"archive"),
    env.DB.prepare("UPDATE live_games SET state_json=?2,event_seq=event_seq+1,commit_base_event_seq=event_seq WHERE game_id=?1 AND event_seq=?3").bind(row.game_id,cardJson(cardGame),row.event_seq),
    env.DB.prepare("DELETE FROM game_payloads WHERE game_id=?1").bind(row.game_id),
    env.DB.prepare("UPDATE game_archives SET event_seq=event_seq+1 WHERE game_id=?1").bind(row.game_id),
    clearPermit(env,row),
  ]);
  return true;
}

/** Bounded cleanup after publication. Reads/retries now use the verified archive. */
export async function pruneArchivedEvidence(env:ArchiveEnv,row:ArchiveRow):Promise<void> {
  if(row.status!=="archived")return;
  await env.DB.batch([permit(env,row,"archive"),
    ...["live_command_receipts","live_legacy_command_tombstones","live_events"].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE game_id=?1 AND rowid IN (SELECT rowid FROM ${table} WHERE game_id=?1 LIMIT ?2)`).bind(row.game_id,STORAGE_POLICY.cleanupRows)),
    clearPermit(env,row)]);
}

export async function saveArchivedView(env:ArchiveEnv,row:ArchiveRow,game:LiveGame,identityId:string,authority:{before:D1Statement[];after:D1Statement[]}={before:[],after:[]}):Promise<number> {
  const id=crypto.randomUUID();
  const budget=growthGuard(env);
  await env.DB.batch([
    ...budget.before,
    ...authority.before,
    permit(env,row,"view"),
    guard(env.DB,id,"SELECT 1 FROM live_games WHERE game_id=?2 AND event_seq=?3",row.game_id,row.event_seq),
    env.DB.prepare("INSERT INTO game_archive_views(game_id,identity_id,history_index) VALUES(?1,?2,?3) ON CONFLICT(game_id,identity_id) DO UPDATE SET history_index=excluded.history_index").bind(row.game_id,identityId,game.historyIndexByIdentity[identityId]??null),
    env.DB.prepare("UPDATE live_games SET state_json=?2,event_seq=event_seq+1,commit_base_event_seq=event_seq WHERE game_id=?1").bind(row.game_id,cardJson(game)),
    env.DB.prepare("UPDATE game_archives SET event_seq=event_seq+1 WHERE game_id=?1").bind(row.game_id),
    clearGuard(env.DB,id),clearPermit(env,row),...authority.after,...budget.after,
  ]);
  return row.event_seq+1;
}

export async function restoreArchiveStep(env:ArchiveEnv,row:ArchiveRow):Promise<boolean> {
  if(row.status==="archiving"){await cancelArchiveCapture(env,row);return true;}
  const manifest=await manifestFor(env,row);
  // Reserve against verified uncompressed sizes, with conservative allowance
  // for SQLite pages, indices and staging. Compressed R2 sizes understate growth.
  if(manifest.parts.some(p=>!Number.isSafeInteger(p.raw_bytes)||p.raw_bytes<=0||p.raw_bytes>(p.kind==="state"?STORAGE_POLICY.maximumStateBytes:STORAGE_POLICY.maximumChunkBytes)))throw new Error("invalid_archive_size");
  const completed=row.status==="restoring"?row.next_chunk:0;
  const remaining=manifest.parts.filter(p=>p.kind!=="state").slice(completed);
  remaining.push(manifest.parts.find(p=>p.kind==="state")!);
  await reserveRestore(env,row.game_id,65536+remaining.reduce((sum,p)=>sum+p.raw_bytes*4+p.row_count*16384,0));
  const budget=growthGuard(env);
  if(row.status==="archived"){
    await env.DB.batch([...budget.before,env.DB.prepare("UPDATE game_archives SET status='restoring',next_chunk=0,updated_at=datetime('now') WHERE game_id=?1 AND status='archived'").bind(row.game_id),...budget.after]);row={...row,status:"restoring",next_chunk:0};
  }
  const evidenceParts=manifest.parts.filter(p=>p.kind!=="state");
  const part=evidenceParts[row.next_chunk];
  if(part){
    const records=await readObject(env,part.object_key,part.sha256) as Evidence[];
    if(!Array.isArray(records)||records.length!==part.row_count||records.some(r=>r.game_id!==row.game_id))throw new Error("invalid_archive_evidence");
    const table=part.kind==="receipt"?"live_command_receipts":"live_legacy_command_tombstones";
    const columns=part.kind==="receipt"?["game_id","client_command_id","actor_identity_id","fingerprint","outcome","reason","event_seq","gameplay_revision","result_json"]:["game_id","client_command_id","evidence_json"];
    const id=crypto.randomUUID();
    const staging=records.map(record=>env.DB.prepare("INSERT INTO game_restore_receipts(game_id,command_id,kind,payload_json) VALUES(?1,?2,?3,?4) ON CONFLICT(game_id,command_id,kind) DO UPDATE SET payload_json=excluded.payload_json").bind(row.game_id,record.client_command_id,part.kind,JSON.stringify(record)));
    const differences=columns.map(column=>`r.${column} IS NOT json_extract(s.payload_json,'$.${column}')`).join(" OR ");
    const results=await env.DB.batch([
      ...budget.before,permit(env,row,"restore"),...staging,
      guard(env.DB,id,`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM game_restore_receipts s JOIN ${table} r ON r.game_id=s.game_id AND r.client_command_id=s.command_id WHERE s.game_id=?2 AND s.kind=?3 AND (${differences})) THEN 1 ELSE 0 END`,row.game_id,part.kind),
      env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) SELECT ${columns.map(column=>`json_extract(payload_json,'$.${column}')`).join(",")} FROM game_restore_receipts WHERE game_id=?1 AND kind=?2`).bind(row.game_id,part.kind),
      env.DB.prepare("DELETE FROM game_restore_receipts WHERE game_id=?1").bind(row.game_id),
      env.DB.prepare("UPDATE game_archives SET next_chunk=next_chunk+1,updated_at=datetime('now') WHERE game_id=?1").bind(row.game_id),
      clearGuard(env.DB,id),clearPermit(env,row),...budget.after,
    ]);return false;
  }
  const game=await readArchivedGame(env,row),encoded=await encodeStorage(game);
  const results=await env.DB.batch([...budget.before,permit(env,row,"restore"),
    env.DB.prepare("INSERT INTO game_payloads(game_id,format_version,state_blob,state_sha256) VALUES(?1,1,?2,?3) ON CONFLICT(game_id) DO UPDATE SET state_blob=excluded.state_blob,state_sha256=excluded.state_sha256").bind(row.game_id,encoded.blob,encoded.checksum),
    env.DB.prepare("UPDATE live_games SET state_json=?2,commit_base_event_seq=NULL WHERE game_id=?1").bind(row.game_id,cardJson(game)),
    env.DB.prepare("DELETE FROM game_archives WHERE game_id=?1 AND status='restoring'").bind(row.game_id),
    env.DB.prepare("DELETE FROM game_archive_views WHERE game_id=?1").bind(row.game_id),
    clearPermit(env,row),...budget.after,
  ]);
  // Metrics failure cannot turn the already committed restore into a rejection.
  try{await observeRestore(env,row.game_id,results,true);}catch{console.warn(JSON.stringify({event:"storage_restore_observation_deferred"}));}
  // Keep R2 objects referenced until a later verified live read frees the chunks.
  return true;
}
