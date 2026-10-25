import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fixture} from "./fixture.mjs";
import {commandFingerprint} from "../../../packages/shared-types/src/sync-protocol.ts";
import {decodeStorage,encodeStorage} from "../src/storage-codec.ts";
import {applyServerAction} from "../src/shell-live-core.ts";
import {reserveArchiveOperation,reserveRestore} from "../src/storage-budget.ts";

const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve("wrangler/package.json"));
const {Miniflare}=wranglerRequire("miniflare"),{build}=wranglerRequire("esbuild");
const root=path.resolve(import.meta.dirname,"../../..");
async function harness(bindings={},migrationLimit=Infinity){
  const directory=await mkdtemp(path.join(tmpdir(),"righelt-storage-lifecycle-"));
  const bundle=await build({stdin:{contents:fixture,resolveDir:root,sourcefile:"storage-runtime.ts"},bundle:true,format:"esm",platform:"browser",write:false});
  const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-03-12",bindings:{STORAGE_COMPRESSION:"true",STORAGE_ARCHIVES_ENABLED:"true",...bindings},d1Databases:["DB"],r2Buckets:["ARCHIVES"],durableObjects:{GAME_ROOMS:{className:"GameRoomDO",useSQLite:true}},d1Persist:path.join(directory,"d1"),r2Persist:path.join(directory,"r2"),durableObjectsPersist:path.join(directory,"do")};
  let runtime=new Miniflare(options),db=await runtime.getD1Database("DB");
  for(const name of (await readdir(path.join(root,"db/migrations"))).filter(n=>n.endsWith(".sql")&&Number(n.slice(0,4))<=migrationLimit).sort())await db.exec((await readFile(path.join(root,"db/migrations",name),"utf8")).replace(/--[^\n]*/g,"").replace(/\s+/g," "));
  if(migrationLimit>=16)await db.prepare("UPDATE storage_budget SET healthy=1,observed_at=datetime('now') WHERE singleton=1").run();
  const call=async(route,body={},headers={})=>{
    const response=await runtime.dispatchFetch(`https://test/${route}`,{method:"POST",headers:{"content-type":"application/json","x-game-id":"g",...(options.bindings.STORAGE_GENERATION?{"X-Righelt-Storage-Generation":options.bindings.STORAGE_GENERATION}:{}),...headers},body:JSON.stringify({identityId:"actor",protocolVersion:2,...body})});
    return {status:response.status,body:await response.json()};
  };
  const current=async()=>{const row=await db.prepare("SELECT * FROM live_games WHERE game_id='g'").first();const payload=await db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();return {row,game:payload?await decodeStorage(payload.state_blob,payload.state_sha256):JSON.parse(row.state_json)};};
  return {call,current,get db(){return db;},get runtime(){return runtime;},async restart(bindings={}){await runtime.dispose();Object.assign(options.bindings,bindings);runtime=new Miniflare(options);db=await runtime.getD1Database("DB");},async close(){await runtime.dispose();await rm(directory,{recursive:true,force:true});}};
}

test("expanded history survives an accepted move, lost reply, restart, archive and restore",{timeout:120000},async()=>{
  const h=await harness({STORAGE_LARGE_STATES_ENABLED:"true"});
  try{
    await h.call("create",{gameId:"g",selfPlayMode:true});
    const {game,row}=await h.current();
    for(let i=0;i<100;i++){
      assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
      game.moves.at(-1).notation="Recorded decision ".repeat(1100);
    }
    game.archiveStartRevision=0;
    const encoded=await encodeStorage(game);
    assert.ok(encoded.rawBytes>2_000_000);
    await h.db.prepare("UPDATE game_payloads SET state_blob=?1,state_sha256=?2 WHERE game_id='g'").bind(encoded.blob,encoded.checksum).run();
    await h.restart();
    const command={protocolVersion:2,gameId:"g",identityId:"actor",clientCommandId:"v2:large-history",kind:"action",payload:{action:{type:"pass"}},expectedState:game.board.state,expectedGameplayRevision:row.gameplay_revision};
    command.fingerprint=await commandFingerprint(command);
    const lost=await h.call("apply",command,{"x-harness-lose-response":"1"});
    assert.equal(lost.status,500);
    await h.restart();
    const duplicate=await h.call("apply",command);
    assert.equal(duplicate.body.accepted,true,JSON.stringify(duplicate));
    assert.equal(duplicate.body.duplicate,true);
    assert.equal(duplicate.body.game.moves.length,101);
    const before=await h.current();
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    for(let i=0;i<12;i++){
      const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));
      if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;
    }
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    await h.restart({STORAGE_LARGE_STATES_ENABLED:"false"});
    const historical=await h.call("history",{moveIndex:0});
    assert.equal(historical.status,200,JSON.stringify(historical));
    assert.deepEqual(historical.body.game.moves,before.game.moves);
    // Begin the bounded restore, then drain its remaining receipt chunks. The
    // disabled writer must not prevent restoring an already durable payload.
    const restoring=await h.call("join",{identityId:"viewer",mode:"viewer"});
    assert.equal(restoring.body.error,"storage_restoring",JSON.stringify(restoring));
    for(let i=0;i<12;i++){
      if(!await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first())break;
      assert.equal((await h.call("_storage/tick")).status,200);
    }
    assert.equal(await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first(),null);
    assert.deepEqual((await h.current()).game.moves,before.game.moves);
  }finally{await h.close();}
});

test("archive, read-only history, receipt recovery and staged restore preserve play across restarts",{timeout:120000},async()=>{
  const h=await harness();
  try{
    assert.equal((await h.call("create",{gameId:"g",selfPlayMode:true})).status,200);
    let firstCommand;
    for(let i=0;i<205;i++){
      const {row,game}=await h.current();
      const command={protocolVersion:2,gameId:"g",identityId:"actor",clientCommandId:`v2:archive-${String(i).padStart(4,"0")}`,kind:"action",payload:{action:{type:"pass"}},expectedState:game.board.state,expectedGameplayRevision:row.gameplay_revision};
      command.fingerprint=await commandFingerprint(command);
      const result=await h.call("apply",command);
      assert.equal(result.body.accepted,true,JSON.stringify(result));
      firstCommand??=command;
    }
    const before=await h.current(),invite=before.game.inviteTokens.viewer;
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    // A deliberately small continuation allowance stops with a durable cursor.
    assert.equal((await h.call("_storage/tick",{}, {"x-storage-archive-steps":"1"})).status,200);
    await new Promise(resolve=>setTimeout(resolve,100));
    const stopped=await h.db.prepare("SELECT next_chunk FROM game_archives WHERE game_id='g'").first();
    assert.equal(stopped.next_chunk,2);
    await h.restart();
    // One discovery sweep drains >200 receipts without a second scheduled run.
    assert.equal((await h.call("_maintenance")).status,200);
    const deadline=Date.now()+10000;
    while((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status!=="archived" && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
    assert.equal((await h.db.prepare("SELECT game_id FROM live_invites WHERE token=?").bind(invite).first()).game_id,"g");
    for(let i=0;i<4;i++)await h.call("_storage/tick");
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM live_command_receipts WHERE game_id='g'").first()).n,0);
    const duplicate=await h.call("apply",firstCommand);
    assert.equal(duplicate.body.duplicate,true,JSON.stringify(duplicate));
    assert.equal(duplicate.body.game.moves.length,200);
    assert.deepEqual(duplicate.body.game.board,before.game.board);
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived","duplicate receipt does not restore or replay");
    const history=await h.call("history",{moveIndex:0});
    assert.equal(history.status,200,JSON.stringify(history));
    assert.equal(history.body.game.inHistoryMode,true);
    assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null,"history browsing remains archived");
    const back=await h.call("live");assert.equal(back.status,200);assert.equal(back.body.game.inHistoryMode,false);
    const command={...firstCommand,clientCommandId:"v2:restored-new",expectedState:before.game.board.state,expectedGameplayRevision:before.row.gameplay_revision};command.fingerprint=await commandFingerprint(command);
    const pending=await h.call("apply",command);
    assert.equal(pending.status,503);assert.equal(pending.body.error,"storage_restoring");
    assert.equal(await h.db.prepare("SELECT * FROM live_command_receipts WHERE client_command_id=?").bind(command.clientCommandId).first(),null);
    await h.restart();
    for(let tick=0;tick<80;tick++){if(!await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first())break;const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));if(!await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first())break;}
    const accepted=await h.call("apply",command);assert.equal(accepted.body.accepted,true,JSON.stringify(accepted));
    assert.equal(accepted.body.game.gameplayRevision,before.row.gameplay_revision+1);
    assert.equal(accepted.body.game.moves.length,200);
    assert.equal((await h.call("apply",firstCommand)).body.duplicate,true);
    assert.equal((await h.call("apply",command)).body.duplicate,true);
  }finally{await h.close();}
});

test("cutover preservation permits cannot grant gameplay or delete before a verified archive",{timeout:120000},async()=>{
  const h=await harness();
  try{
    await h.call("create",{gameId:"g",selfPlayMode:true});
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    await h.db.prepare("INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash) VALUES('canary-account-1234','canary','canary','Canary',0,'test-only')").run();
    await h.db.prepare("UPDATE account_cutover SET activated_at=1,canary_account_id='canary-account-1234' WHERE singleton=1").run();
    for(let i=0;i<8;i++){const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    await assert.rejects(h.db.prepare("UPDATE live_games SET gameplay_revision=gameplay_revision+1 WHERE game_id='g'").run());
    await assert.rejects(h.db.prepare("DELETE FROM live_games WHERE game_id='g'").run(),/account_cutover_write_denied/);
    const row=await h.db.prepare("SELECT event_seq FROM live_games WHERE game_id='g'").first();
    await h.db.prepare("INSERT INTO storage_lifecycle_permits VALUES('g','restore',?,1)").bind(row.event_seq).run();
    await assert.rejects(h.db.prepare("UPDATE live_games SET gameplay_revision=gameplay_revision+1 WHERE game_id='g'").run(),/account_cutover_write_denied/);
    await h.db.prepare("DELETE FROM storage_lifecycle_permits WHERE game_id='g'").run();
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM account_game_write_permits").first()).n,0);
  }finally{await h.close();}
});

for(const fault of ["put","put_lost","missing","corrupt"])test(`archive ${fault} failure preserves the complete live copy and resumes`,{timeout:120000},async()=>{
  const h=await harness();
  try{
    await h.call("create",{gameId:"g",selfPlayMode:true});
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    const before=await h.current();
    const failed=await h.call("_storage/tick",{}, {"x-harness-r2-fault":fault});
    assert.ok(failed.status>=400,JSON.stringify(failed));
    assert.deepEqual((await h.current()).game,before.game);
    assert.ok(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first());
    await h.restart();
    for(let i=0;i<8;i++){const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
  }finally{await h.close();}
});

test("lost archive publication response recovers accurate presence before restart",{timeout:120000},async()=>{
  const h=await harness();let socket;
  try{
    await h.call("create",{gameId:"g",selfPlayMode:true});
    const opened=await h.runtime.dispatchFetch("https://test/ws?identityId=actor&sessionId=lost&lastEventSeq=0",{headers:{upgrade:"websocket","x-game-id":"g"}});
    assert.equal(opened.status,101);socket=opened.webSocket;socket.accept();
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    const before=(await h.current()).row.event_seq;
    await h.call("_storage/tick",{}, {"x-harness-lose-on":"SET status='archived'"});
    assert.equal((await h.call("presence",{sessionId:"lost",status:"disconnecting",lastEventSeq:before})).status,200);socket.close();
    let lost=false;
    for(let i=0;i<8;i++){const result=await h.call("_storage/tick");if(result.status>=400){lost=true;break;}}
    assert.equal(lost,true);
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
    const immediate=await h.call("live");assert.equal(immediate.status,200);assert.equal(immediate.body.game.player1.connected,false);
    assert.ok((await h.current()).row.event_seq>before,"committed publication advances the reconciliation cursor");
    await h.restart();
    const recovered=await h.call("live");assert.equal(recovered.status,200);assert.equal(recovered.body.game.player1.connected,false);
  }finally{try{socket?.close();}catch{}await h.close();}
});

test("concurrent quota reservations cannot exceed the free-operation budget",{timeout:120000},async()=>{
  const h=await harness();
  try{
    await h.db.prepare("UPDATE storage_operation_days SET class_a=799999 WHERE day=date('now')").run();
    const results=await Promise.allSettled(Array.from({length:6},(_,i)=>reserveArchiveOperation({DB:h.db},"a",`reserved-${i}`,1)));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await h.db.prepare("SELECT class_a FROM storage_budget").first()).class_a,800000);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM storage_objects").first()).n,1);
    await h.db.prepare("UPDATE storage_budget SET healthy=0 WHERE singleton=1").run();
    await assert.rejects(reserveArchiveOperation({DB:h.db},"b"),/storage_capacity/);
  }finally{await h.close();}
});

async function archiveSmall(h){
  await h.call("create",{gameId:"g",selfPlayMode:true});
  await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
  for(let i=0;i<12;i++){assert.equal((await h.call("_storage/tick")).status,200);if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")return;}
  assert.fail("archive failed to publish");
}

test("restored cold games can rearchive before bounded garbage collection",{timeout:120000},async()=>{
  const h=await harness();
  try{
    await archiveSmall(h);
    // A viewer join restores without meaningful player activity.
    assert.equal((await h.call("join",{identityId:"viewer",mode:"viewer"})).status,200);
    assert.equal(await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first(),null);
    assert.ok(await h.db.prepare("SELECT * FROM storage_archive_chunks WHERE game_id='g' LIMIT 1").first());
    for(let i=0;i<12;i++){const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
    assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
    assert.equal((await h.call("live",{identityId:"viewer"})).status,200);
  }finally{await h.close();}
});

test("restore admission preserves the archive at D1 capacity and unhealthy metrics",{timeout:120000},async()=>{
  const h=await harness({STORAGE_BUDGET_ENABLED:"true"});
  try{
    await archiveSmall(h);
    for(const health of [1,0]){
      await h.db.prepare("UPDATE storage_budget SET d1_bytes=400000000,healthy=?1 WHERE singleton=1").bind(health).run();
      const result=await h.call("join",{identityId:"viewer",mode:"viewer"});
      assert.equal(result.status,503,JSON.stringify(result));
      assert.equal(result.body.error,"storage_capacity");
      assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
      assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
      assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM storage_restore_reservations").first()).n,0);
      assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM game_restore_receipts").first()).n,0);
    }
  }finally{await h.close();}
});

for(const activated of [false,true])test(`retained migration preserves cutover authority (${activated?"activated":"maintenance"})`,{timeout:120000},async()=>{
  const h=await harness({},15);
  try{
    // The old room requires the new schema, so seed only the retained SQL row.
    await h.db.prepare("INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,state_json,ownership_mode,event_seq,commit_base_event_seq) VALUES('g','2026-01-01','2026-01-02','2026-01-03','{}',?1,1,0)").bind(activated?"account_v1":"legacy_guest").run();
    if(activated){
      await h.db.prepare("INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash) VALUES('canary-account-1234','canary','canary','Canary',0,'test-only')").run();
      await h.db.prepare("UPDATE account_cutover SET activated_at=1,canary_account_id='canary-account-1234' WHERE singleton=1").run();
    }else await h.db.prepare("UPDATE account_cutover SET maintenance=1 WHERE singleton=1").run();
    const before=await h.db.prepare("SELECT * FROM account_cutover").first();
    for(const name of (await readdir(path.join(root,"db/migrations"))).filter(n=>Number(n.slice(0,4))>=16).sort())await h.db.exec((await readFile(path.join(root,"db/migrations",name),"utf8")).replace(/--[^\n]*/g,"").replace(/\s+/g," "));
    assert.equal((await h.db.prepare("SELECT retention_activity_at FROM live_games WHERE game_id='g'").first()).retention_activity_at,"2026-01-03");
    assert.deepEqual(await h.db.prepare("SELECT * FROM account_cutover").first(),before);
    await assert.rejects(h.db.prepare("UPDATE live_games SET state_json='bad' WHERE game_id='g'").run(),/account_cutover_write_denied/);
    await assert.rejects(h.db.prepare("UPDATE live_games SET gameplay_revision=1 WHERE game_id='g'").run(),/account_cutover_write_denied/);
  }finally{await h.close();}
});

test("claiming the second seat renews meaningful retention independently of home timestamps",{timeout:120000},async()=>{
  const h=await harness();
  try{
    await h.call("create",{gameId:"g",selfPlayMode:false});
    await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
    const old=(await h.current()).row.updated_at;
    const result=await h.call("play-as-both");assert.equal(result.status,200,JSON.stringify(result));
    const current=(await h.current()).row;
    assert.equal(current.updated_at,old);
    assert.ok(Date.parse(current.retention_activity_at)>Date.now()-60000);
    assert.equal((await h.call("_storage/tick")).status,200);
    assert.equal(await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first(),null);
  }finally{await h.close();}
});

test("resumed reservations account for remaining growth near capacity",{timeout:120000},async()=>{
 const h=await harness();
 try{
  const env={DB:h.db,STORAGE_BUDGET_ENABLED:"true"};
  await h.db.prepare("UPDATE storage_budget SET d1_bytes=390000000 WHERE singleton=1").run();
  await reserveRestore(env,"reserved-game",8000000);
  // Committed chunks have consumed six MB of the original reservation.
  await h.db.prepare("UPDATE storage_budget SET d1_bytes=396000000 WHERE singleton=1").run();
  await h.restart();
  await reserveRestore({DB:h.db,STORAGE_BUDGET_ENABLED:"true"},"reserved-game",2000000);
  assert.equal((await h.db.prepare("SELECT bytes FROM storage_restore_reservations WHERE game_id='reserved-game'").first()).bytes,2000000);
  await assert.rejects(reserveRestore({DB:h.db,STORAGE_BUDGET_ENABLED:"true"},"another-game",3000000),/storage_capacity/);
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM storage_restore_reservations").first()).n,1);
 }finally{await h.close();}
});

test("compression rollback JSON can rearchive a previously restored game",{timeout:120000},async()=>{
 const h=await harness();
 try{
  await archiveSmall(h);await h.call("join",{identityId:"viewer",mode:"viewer"});
  const {row,game}=await h.current();
  const {persistGameState}=await import("../src/shell-live-db.ts");
  await persistGameState({DB:h.db,STORAGE_COMPRESSION:"false"},game,row.event_seq+1,null,{baseEventSeq:row.event_seq,activityChanged:false});
  assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
  await h.restart();
  for(let i=0;i<12;i++){const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
  assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
 }finally{await h.close();}
});

test("maintenance retains archive readers and cleanup when new archives are paused",{timeout:120000},async()=>{
 const h=await harness();
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});
  await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
  const maintain=async(enabled)=>{const result=await h.call("_maintenance",{}, {"x-harness-archive-flag":String(enabled)});assert.equal(result.status,200,JSON.stringify(result));};
  await maintain(false);
  assert.equal(await h.db.prepare("SELECT * FROM game_archives WHERE game_id='g'").first(),null);
  for(let i=0;i<12;i++){await maintain(true);if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
  assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
  await maintain(false);
  assert.equal((await h.call("live")).status,200);
 }finally{await h.close();}
});

test("archived socket presence stays accurate without restoring or renewing retention",{timeout:120000},async()=>{
 const h=await harness(),sockets=[];
 const eventually=async(check)=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail("presence deadline");};
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});await h.call("join",{identityId:"observer",mode:"viewer"});
  await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
  for(let i=0;i<12;i++){await h.call("_storage/tick");if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
  const retention=(await h.current()).row.retention_activity_at;
  const connect=async(identity)=>{
    const response=await h.runtime.dispatchFetch(`https://test/ws?identityId=${identity}&sessionId=${identity}&lastEventSeq=0`,{headers:{upgrade:"websocket","x-game-id":"g"}});
    assert.equal(response.status,101);const socket=response.webSocket,messages=[];
    socket.addEventListener("message",event=>messages.push(JSON.parse(event.data)));socket.accept();sockets.push(socket);await eventually(()=>messages.some(m=>m.game));return {socket,messages};
  };
  const actor=await connect("actor");assert.equal(actor.messages[0].game.player1.connected,true);
  const observer=await connect("observer");
  await eventually(()=>actor.messages.some(m=>m.type==="presence_changed"&&m.game?.viewers.some(v=>v.identityId==="observer"&&v.connected)));
  assert.equal((await h.call("live")).body.game.player1.connected,true);
  observer.socket.close();
  await eventually(()=>actor.messages.some(m=>m.type==="presence_changed"&&m.game?.viewers.some(v=>v.identityId==="observer"&&!v.connected)));
  assert.equal((await h.current()).row.retention_activity_at,retention);
  assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
  assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archived");
 }finally{for(const s of sockets)try{s.close();}catch{}await h.close();}
});

test("disconnect during capture publishes accurate offline presence",{timeout:120000},async()=>{
 const h=await harness();let socket;
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});
  const response=await h.runtime.dispatchFetch("https://test/ws?identityId=actor&sessionId=capture&lastEventSeq=0",{headers:{upgrade:"websocket","x-game-id":"g"}});
  assert.equal(response.status,101);socket=response.webSocket;socket.accept();
  await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='g'").run();
  const retention=(await h.current()).row.retention_activity_at;
  await h.call("_storage/tick");assert.equal((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first()).status,"archiving");
  assert.equal((await h.call("presence",{sessionId:"capture",status:"disconnecting",lastEventSeq:(await h.current()).row.event_seq})).status,200);
  socket.close();
  for(let i=0;i<12;i++){await h.call("_storage/tick");if((await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first())?.status==="archived")break;}
  await h.restart();
  const live=await h.call("live");assert.equal(live.status,200);assert.equal(live.body.game.player1.connected,false);assert.equal(live.body.game.player2.connected,false);
  assert.equal((await h.current()).row.retention_activity_at,retention);assert.equal(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),null);
 }finally{try{socket?.close();}catch{}await h.close();}
});

test("operation caps survive calendar rollover and expire only outside the rolling window",{timeout:120000},async()=>{
 const h=await harness();
 try{
  await h.db.prepare("UPDATE storage_operation_days SET class_a=799999 WHERE day=date('now')").run();
  await h.db.prepare("INSERT INTO storage_operation_days(day,class_a,class_b) VALUES(date('now','-1 day'),1,0)").run();
  await h.db.prepare("UPDATE storage_budget SET period='2000-01',class_a=0 WHERE singleton=1").run();
  await assert.rejects(reserveArchiveOperation({DB:h.db},"a","rollover-key",1),/storage_capacity/);
  await h.db.prepare("DELETE FROM storage_operation_days").run();
  await h.db.prepare("INSERT INTO storage_operation_days(day,class_a,class_b) VALUES(date('now','-32 days'),800000,8000000)").run();
  await reserveArchiveOperation({DB:h.db},"a","rollover-key",1);
  assert.equal((await h.db.prepare("SELECT class_a FROM storage_budget").first()).class_a,1);
 }finally{await h.close();}
});

test("canary sweep isolates its game and skips unrelated cleanup",{timeout:120000},async()=>{
 const id='game-'+'a'.repeat(32),other='game-'+'b'.repeat(32);
 const h=await harness({STORAGE_ARCHIVE_MODE:'canary',STORAGE_ARCHIVE_CANARY_GAME_ID:id,STORAGE_BUDGET_ENABLED:'true',STORAGE_EXCLUSIVE_R2:'true'});
 try{
  for(const gameId of [id,other])assert.equal((await h.call('create',{gameId,selfPlayMode:true},{'x-game-id':gameId})).status,200);
  await h.db.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')").run();
  await h.db.prepare("INSERT INTO account_rate_limits(bucket_key,attempts,expires_at) VALUES('keep-canary-cleanup',1,0)").run();
  assert.equal((await h.call('_maintenance')).status,200);
  const deadline=Date.now()+10000;
  while((await h.db.prepare('SELECT status FROM game_archives WHERE game_id=?').bind(id).first())?.status!=='archived'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal((await h.db.prepare('SELECT status FROM game_archives WHERE game_id=?').bind(id).first())?.status,'archived');
  assert.equal(await h.db.prepare('SELECT * FROM game_archives WHERE game_id=?').bind(other).first(),null);
  assert.ok(await h.db.prepare("SELECT * FROM account_rate_limits WHERE bucket_key='keep-canary-cleanup'").first());
  assert.equal((await h.call('_storage/tick',{}, {'x-game-id':other,'x-storage-archive-steps':'64'})).status,403);
 }finally{await h.close();}
});

test("metadata format migration preserves saves and commits presence without rewriting history",{timeout:120000},async()=>{
 const h=await harness({STORAGE_METADATA_WRITES_ENABLED:"true"},21);
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});
  const before=await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();
  const migration=await readFile(path.join(root,"db/migrations/0022_history_metadata_representation.sql"),"utf8");
  await h.db.exec(migration.replace(/--[^\n]*/g,"").replace(/\s+/g," "));
  assert.deepEqual(await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first(),before);
  const joined=await h.call("join",{identityId:"viewer",mode:"viewer"});
  assert.equal(joined.status,200,JSON.stringify(joined));
  const after=await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();
  assert.equal(after.format_version,2);
  assert.equal(after.state_sha256,before.state_sha256);
  assert.deepEqual(after.state_blob,before.state_blob);
  await h.restart({STORAGE_METADATA_WRITES_ENABLED:"false"});
  const loaded=await h.call("reconcile",{knownSnapshotEventSeq:0,commands:[]});
  assert.equal(loaded.status,200,JSON.stringify(loaded));
  assert.equal(loaded.body.game.viewers.some(viewer=>viewer.identityId==="viewer"),true);
  await h.db.prepare("UPDATE account_cutover SET maintenance=1 WHERE singleton=1").run();
  await assert.rejects(h.db.prepare("UPDATE game_payloads SET format_version=1 WHERE game_id='g'").run(),/account_cutover_write_denied/);
 }finally{await h.close();}
});

for(const operation of ["revert-request","computer-control"])test(`shared ${operation} receipt is atomic across a lost commit response and restart`,{timeout:120000},async()=>{
 const h=await harness({STORAGE_METADATA_WRITES_ENABLED:"true",STORAGE_GENERATION:"retained-generation"});
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true,...(operation==="computer-control"?{computer:{p1:"babs",p2:null}}:{})});
  if(operation==="revert-request"){
   const {game,row}=await h.current();
   const move={protocolVersion:2,gameId:"g",identityId:"actor",clientCommandId:"v2:before-undo",kind:"action",payload:{action:{type:"pass"}},expectedState:game.board.state,expectedGameplayRevision:row.gameplay_revision};
   move.fingerprint=await commandFingerprint(move);assert.equal((await h.call("apply",move)).body.accepted,true);
  }
  const {game,row}=await h.current();
  const values=operation==="revert-request"?{targetMoveId:game.moves.at(-1).moveId,requestId:"immutable-undo"}:{deviceId:"test-device",generation:game.computer.generation,action:"acquire"};
  const command={protocolVersion:2,gameId:"g",identityId:"actor",clientCommandId:`v2:shared-${operation}`,kind:"shared",payload:{operation,values},expectedState:game.board.state,expectedGameplayRevision:row.gameplay_revision};
  command.fingerprint=await commandFingerprint(command);
  assert.equal((await h.call("shared",command,{"x-harness-lose-response":"1"})).status,500);
  const committed=await h.current();
  await h.restart();
  const duplicate=await h.call("shared",command);
  assert.equal(duplicate.body.accepted,true,JSON.stringify(duplicate));assert.equal(duplicate.body.duplicate,true);
  assert.deepEqual(await h.current(),committed);
  const reconciled=await h.call("reconcile",{knownSnapshotEventSeq:0,commands:[command]});
  assert.equal(reconciled.body.commandOutcomes[0].outcome,"accepted");
  const conflicting=structuredClone(command);conflicting.payload.values={...values,action:"switch"};conflicting.fingerprint=await commandFingerprint(conflicting);
  assert.equal((await h.call("shared",conflicting)).body.commandOutcomes[0].reason,"command_id_conflict");
 }finally{await h.close();}
});


test("large legacy replies and compact reads traverse outer API with both new writers disabled",{timeout:120000},async()=>{
 const h=await harness({STORAGE_LARGE_STATES_ENABLED:"false",STORAGE_METADATA_WRITES_ENABLED:"false"});
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});
  const {game}=await h.current();
  for(let i=0;i<80;i++){
   assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
   game.moves.at(-1).notation="Recorded decision ".repeat(900);
  }
  const encoded=await encodeStorage(game);
  assert.ok(encoded.rawBytes>1_500_000 && encoded.rawBytes<2_000_000);
  await h.db.prepare("UPDATE game_payloads SET state_blob=?1,state_sha256=?2 WHERE game_id='g'").bind(encoded.blob,encoded.checksum).run();
  await h.restart();
  const get=async(compact)=>{
   const response=await h.runtime.dispatchFetch("https://test/api/shell/games/g?identityId=actor",{headers:compact?{"X-Righelt-Projection":"history-v1"}:{}});
   assert.equal(response.status,200);
   return response.json();
  };
  const full=await get(false),compact=await get(true);
  assert.deepEqual(full.game.moves,game.moves);
  assert.equal(compact.game.moves.length,game.moves.length);
  assert.equal(compact.game.moves[1].snapshot,undefined);
  assert.deepEqual(compact.game.board,full.game.board);
  const control=await h.call("api/shell/games/g/computer-control",{action:"claim",deviceId:"test-device",tabId:"test-tab"});
  // A game without computer seats rejects this operation definitively. It must
  // still traverse the CPU-bounded outer path, without loading history there.
  assert.equal(control.status,409,JSON.stringify(control));
  assert.equal(control.body.error,"not_computer_game");
  const invite=await h.runtime.dispatchFetch(`https://test/api/shell/invites/${game.inviteTokens.viewer}`);
  assert.equal(invite.status,200);
  assert.equal((await invite.json()).gameId,"g");
  const selected=game.moves.at(-1);
  const branch=await h.call("api/shell/history/branch",{sourceGameId:"g",sourceDecisionId:selected.moveId,gameId:"large-branch"});
  assert.equal(branch.status,200,JSON.stringify(branch));
  assert.deepEqual(branch.body.game.board.state,selected.selectionSnapshot);
  const state=game.moves[0].selectionSnapshot;
  const scenario={formatVersion:2,id:crypto.randomUUID(),title:"Large source import",description:"Bounded metadata",incorrect:false,initialState:state,resultingState:state,moves:[],savedSelection:null,expectedFinalStateHash:"placeholder",expectedOutcome:state.outcome.status};
  const imported=await h.call("api/shell/scenarios/import",{sourceGameId:"g",gameId:"large-import",scenario});
  assert.equal(imported.status,200,JSON.stringify(imported));
  assert.equal(imported.body.game.selfPlayMode,true);
  const projected=await get(false);
  assert.deepEqual(projected.game.moves,game.moves);
 }finally{await h.close();}
});


test("scoped writers retain metadata bytes and large-command receipts when the canary scope changes",{timeout:120000},async()=>{
 const h=await harness({STORAGE_LARGE_STATES_ENABLED:"true",STORAGE_METADATA_WRITES_ENABLED:"true",STORAGE_WRITER_CANARY_GAME_ID:"g"});
 try{
  await h.call("create",{gameId:"g",selfPlayMode:true});
  const original=await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();
  assert.equal((await h.call("join",{identityId:"viewer",mode:"viewer"})).status,200);
  const metadata=await h.db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();
  assert.equal(metadata.format_version,2);assert.equal(metadata.state_sha256,original.state_sha256);
  await h.restart({STORAGE_WRITER_CANARY_GAME_ID:"another-game"});
  const outside=await h.call("join",{identityId:"other-viewer",mode:"viewer"});assert.equal(outside.status,200);
  assert.equal((await h.db.prepare("SELECT format_version FROM game_payloads WHERE game_id='g'").first()).format_version,1);
  const {game,row}=await h.current();
  for(let i=0;i<100;i++){assert.equal(applyServerAction(game,{type:"pass"}).ok,true);game.moves.at(-1).notation="Recorded decision ".repeat(1100);}
  game.archiveStartRevision=0;const encoded=await encodeStorage(game);assert.ok(encoded.rawBytes>2_000_000);
  await h.db.prepare("UPDATE game_payloads SET state_blob=?1,state_sha256=?2 WHERE game_id='g'").bind(encoded.blob,encoded.checksum).run();
  await h.restart({STORAGE_WRITER_CANARY_GAME_ID:"g"});
  const command={protocolVersion:2,gameId:"g",identityId:"actor",clientCommandId:"v2:scoped-large",kind:"action",payload:{action:{type:"pass"}},expectedState:game.board.state,expectedGameplayRevision:row.gameplay_revision};command.fingerprint=await commandFingerprint(command);
  assert.equal((await h.call("apply",command,{"x-harness-lose-response":"1"})).status,500);
  await h.restart({STORAGE_WRITER_CANARY_GAME_ID:"another-game"});
  const duplicate=await h.call("apply",command);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.game.moves.length,101);
  const retained=(await h.call("reconcile",{commands:[],knownSnapshotEventSeq:0})).body.game;
  const next={...command,clientCommandId:"v2:outside-large",expectedState:retained.board.state,expectedGameplayRevision:retained.gameplayRevision};next.fingerprint=await commandFingerprint(next);
  const rejected=await h.call("apply",next);assert.equal(rejected.body.commandOutcomes[0].reason,"state_capacity_exceeded");
  const after=(await h.call("reconcile",{commands:[],knownSnapshotEventSeq:0})).body.game;
  assert.deepEqual(after.board,retained.board);assert.deepEqual(after.moves,retained.moves);
 }finally{await h.close();}
});
