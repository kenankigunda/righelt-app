import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fixture} from "./fixture.mjs";
import {commandFingerprint} from "../../../packages/shared-types/src/sync-protocol.ts";
import {decodeStorage} from "../src/storage-codec.ts";
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
    const response=await runtime.dispatchFetch(`https://test/${route}`,{method:"POST",headers:{"content-type":"application/json","x-game-id":"g",...headers},body:JSON.stringify({identityId:"actor",protocolVersion:2,...body})});
    return {status:response.status,body:await response.json()};
  };
  const current=async()=>{const row=await db.prepare("SELECT * FROM live_games WHERE game_id='g'").first();const payload=await db.prepare("SELECT * FROM game_payloads WHERE game_id='g'").first();return {row,game:payload?await decodeStorage(payload.state_blob,payload.state_sha256):JSON.parse(row.state_json)};};
  return {call,current,get db(){return db;},get runtime(){return runtime;},async restart(){await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database("DB");},async close(){await runtime.dispose();await rm(directory,{recursive:true,force:true});}};
}

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
    for(let tick=0;tick<80;tick++){
      const result=await h.call("_storage/tick");assert.equal(result.status,200,JSON.stringify(result));
      const job=await h.db.prepare("SELECT status FROM game_archives WHERE game_id='g'").first();if(job?.status==="archived")break;
      if(tick===4)await h.restart();
    }
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
