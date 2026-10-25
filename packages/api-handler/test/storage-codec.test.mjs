import test from "node:test";
import assert from "node:assert/strict";
import { encodeStorage,decodeStorage,sha256,stateWriteLimits,storageWriterEnabled } from "../src/storage-codec.ts";
import { createInitialGame,applyServerAction,applyRevertToMove,applyScenarioToGame } from "../src/shell-live-core.ts";
import {readFileSync} from "node:fs";
import {listLegalActions} from "../../game-engine/src/legal.ts";
import { persistGameState,loadGameProjection } from "../src/shell-live-db.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { GameRoomDO } from "../src/game-room-do.ts";
import { commandFingerprint } from "../../shared-types/src/sync-protocol.ts";

test("expanded history can exceed the database row limit while its compressed payload stays bounded",async()=>{
  const value={history:"recorded board and continuation\n".repeat(100000)};
  const encoded=await encodeStorage(value);
  assert.ok(encoded.rawBytes>2_000_000);
  assert.ok(encoded.blob.byteLength<1_900_000);
  assert.deepEqual(await decodeStorage(encoded.blob,encoded.checksum),value);
  await assert.rejects(encodeStorage(value,{rawBytes:4_000_000,storedBytes:20}),/storage_payload_too_large/);
  await assert.rejects(decodeStorage(encoded.blob,encoded.checksum,{rawBytes:100,storedBytes:1_900_000}),/storage_payload_too_large/);
});

test("larger writes require explicit activation while upgraded readers preserve saved games",async()=>{
  const game=createInitialGame({gameId:"long-history",identityId:"actor",selfPlayMode:true});
  for(let i=0;i<150;i++){
    assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
    game.moves.at(-1).notation="Retained decision ".repeat(800);
  }
  const DB=createFakeD1();
  await assert.rejects(persistGameState({DB,STORAGE_COMPRESSION:"true"},game,1),/storage_payload_too_large/);
  assert.equal(DB.getGameState(game.id),null);
  await persistGameState({DB,STORAGE_COMPRESSION:"true",STORAGE_LARGE_STATES_ENABLED:"true"},game,1);
  const loaded=await loadGameProjection({DB},game.id);
  assert.equal(loaded.kind,"ok");
  assert.deepEqual(loaded.game,game);
});

for(const rollback of [false,true])test(`an uncommitted size failure durably rejects without rewriting the ${rollback?"activated large":"legacy"} save`,async()=>{
  const game=createInitialGame({gameId:"capacity",identityId:"actor",selfPlayMode:true});
  for(let i=0;i<5;i++)assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
  game.archiveStartRevision=0;
  const move=game.moves.at(-1);move.notation="";
  move.notation="x".repeat((rollback?2_100_000:1_999_900)-new TextEncoder().encode(JSON.stringify(game)).length);
  const DB=createFakeD1(),env={DB,STORAGE_COMPRESSION:"true"};
  await persistGameState({...env,STORAGE_LARGE_STATES_ENABLED:rollback?"true":"false"},game,1);
  const room=new GameRoomDO({id:{name:game.id}},env);
  const command={protocolVersion:2,gameId:game.id,identityId:"actor",clientCommandId:"v2:capacity",kind:"action",payload:{action:{type:"pass"}},expectedState:game.board.state,expectedGameplayRevision:game.gameplayRevision};
  command.fingerprint=await commandFingerprint(command);
  const call=async()=>{
    const response=await room.fetch(new Request("https://test/apply",{method:"POST",headers:{"x-game-id":game.id},body:JSON.stringify(command)}));
    assert.equal(response.status,200);return response.json();
  };
  const result=await call();
  assert.equal(result.commandOutcomes[0].outcome,"rejected");
  assert.equal(result.commandOutcomes[0].reason,"state_capacity_exceeded");
  assert.deepEqual(result.game.board,game.board);
  assert.equal(result.game.moves.length,5);
  const retry=await call();
  assert.deepEqual(retry.commandOutcomes,result.commandOutcomes);
});

test("lossless gzip preserves snapshots, undo lineage and history beyond the rolling window",async()=>{
  const game=createInitialGame({gameId:"codec",identityId:"actor",selfPlayMode:true});
  for(let i=0;i<205;i++)assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
  assert.equal(applyRevertToMove(game,game.moves.at(-1).moveId,"actor").ok,true);
  const encoded=await encodeStorage(game);
  assert.deepEqual(await decodeStorage(encoded.blob,encoded.checksum),game);
  assert.ok(encoded.blob.byteLength<encoded.rawBytes/2);
  const DB=createFakeD1(),env={DB,STORAGE_COMPRESSION:"true"};
  await persistGameState(env,game,1);
  assert.equal(DB.getGameState(game.id).moves.length,0,"card storage contains no move snapshots");
  const loaded=await loadGameProjection(env,game.id);
  assert.equal(loaded.kind,"ok");
  assert.deepEqual(loaded.game.moves,game.moves);
  assert.deepEqual(loaded.game.turns,game.turns);
  assert.deepEqual(loaded.game.board,game.board);
  // Rollback release still reads the compact copy, then atomically replaces it.
  const reader=await loadGameProjection({DB},game.id);
  assert.deepEqual(reader.game.moves,game.moves);
  await persistGameState({DB},loaded.game,2);
  assert.deepEqual((await loadGameProjection({DB},game.id)).game.moves,game.moves);
});

test("checksum, gzip corruption and decompression limits never produce substitute state",async()=>{
  const encoded=await encodeStorage({value:"x".repeat(1000)});
  await assert.rejects(decodeStorage(encoded.blob,"0".repeat(64)),/checksum/);
  const damaged=Uint8Array.from(encoded.blob);damaged[damaged.length-1]^=1;
  await assert.rejects(decodeStorage(damaged,await sha256(damaged)));
  await assert.rejects(decodeStorage(encoded.blob,encoded.checksum,100),/too_large/);
  await assert.rejects(encodeStorage({value:"x".repeat(1000)},100),/too_large/);
});

for(const title of ["Retreat after push","Follow after push + retreat","Rush continuation only includes pieces commanded at start of rush","Push vs. project strategy endgame"])test(`lossless storage preserves catalog continuation and legal actions: ${title}`,async()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const record=catalog.scenarios.find(r=>r.title===title);assert.ok(record);
  const game=createInitialGame({gameId:record.id,identityId:"actor",selfPlayMode:true});
  applyScenarioToGame(game,record);
  const encoded=await encodeStorage(game),loaded=await decodeStorage(encoded.blob,encoded.checksum);
  assert.deepEqual(loaded,game);
  if(title!=="Push vs. project strategy endgame")assert.deepEqual(listLegalActions(loaded.board.state),listLegalActions(game.board.state));
  assert.deepEqual(loaded.moves.map(move=>[move.selectionSnapshot,move.snapshot]),game.moves.map(move=>[move.selectionSnapshot,move.snapshot]));
});

test("metadata commits preserve history bytes, survive restart and return to full writes on rollback",async()=>{
  const DB=createFakeD1(),env={DB,STORAGE_COMPRESSION:"true",STORAGE_METADATA_WRITES_ENABLED:"true"};
  const game=createInitialGame({gameId:"metadata",identityId:"actor",selfPlayMode:true});
  for(let i=0;i<10;i++)assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
  await persistGameState(env,game,1);
  const payload=()=>DB.prepare("SELECT format_version,state_blob,state_sha256 FROM game_payloads WHERE game_id=?1").bind(game.id).first();
  const before=await payload();
  game.notifications.push("Metadata is current");
  await persistGameState(env,game,2,null,{metadataOnly:true});
  const after=await payload();
  assert.equal(after.format_version,2);
  assert.deepEqual(after.state_blob,before.state_blob);
  assert.equal(after.state_sha256,before.state_sha256);
  assert.deepEqual((await loadGameProjection({DB},game.id)).game,game);
  await persistGameState({DB,STORAGE_COMPRESSION:"true"},game,3);
  assert.equal((await payload()).format_version,1);
  assert.deepEqual((await loadGameProjection({DB},game.id)).game,game);
});

test("negotiated live history omits old snapshots and snapshot reads preserve durable state",async()=>{
  const game=createInitialGame({gameId:"history-projection",identityId:"actor",selfPlayMode:true});
  for(let i=0;i<97;i++)assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
  const DB=createFakeD1(),env={DB,STORAGE_COMPRESSION:"true"};
  await persistGameState(env,game,1);
  const room=new GameRoomDO({id:{name:game.id}},env);
  const call=async(path,body,headers={})=>{
    const response=await room.fetch(new Request(`https://test/${path}`,{method:"POST",headers:{"x-game-id":game.id,...headers},body:JSON.stringify({protocolVersion:2,identityId:"actor",...body})}));
    return {status:response.status,body:await response.json()};
  };
  const request={knownSnapshotEventSeq:0,commands:[]};
  const full=await call("reconcile",request);
  const compact=await call("reconcile",request,{"X-Righelt-Projection":"history-v1"});
  assert.equal(full.status,200);assert.equal(compact.status,200);
  assert.equal(compact.body.game.historyProjection,"summary-v1");
  assert.equal(compact.body.game.moves.length,full.body.game.moves.length);
  assert.equal(compact.body.game.moves[0].snapshot,undefined);
  assert.deepEqual(compact.body.game.moves.at(-1),full.body.game.moves.at(-1));
  assert.ok(JSON.stringify(compact.body).length<JSON.stringify(full.body).length*0.2,`projection ratio ${JSON.stringify(compact.body).length/JSON.stringify(full.body).length}`);
  const selected=await call("decision-snapshot",{decisionId:game.moves[0].moveId,gameplayRevision:game.gameplayRevision});
  assert.deepEqual(selected.body.move,game.moves[0]);
  assert.equal((await loadGameProjection(env,game.id)).eventSeq,1,"personal reads never commit shared state");
  assert.equal((await call("decision-snapshot",{decisionId:game.moves[0].moveId,gameplayRevision:99})).status,409);
});


test("writer canaries isolate new writes while every game retains upgraded readers",async()=>{
  const env={DB:createFakeD1(),STORAGE_COMPRESSION:"true",STORAGE_LARGE_STATES_ENABLED:"true",STORAGE_METADATA_WRITES_ENABLED:"true",STORAGE_WRITER_CANARY_GAME_ID:"game-"+"a".repeat(32)};
  for(const id of [env.STORAGE_WRITER_CANARY_GAME_ID,"game-"+"b".repeat(32)]){
    const game=createInitialGame({gameId:id,identityId:"actor",selfPlayMode:true});game.initialSelectionAction=null;
    await persistGameState(env,game,1);
    const payload=()=>env.DB.prepare("SELECT format_version,state_blob,state_sha256 FROM game_payloads WHERE game_id=?1").bind(id).first();
    const before=await payload();game.notifications.push("Metadata changed");
    await persistGameState(env,game,2,null,{metadataOnly:true});
    const after=await payload(),selected=id===env.STORAGE_WRITER_CANARY_GAME_ID;
    assert.equal(after.format_version,selected?2:1);
    assert.equal(after.state_sha256===before.state_sha256,selected);
    assert.deepEqual((await loadGameProjection({DB:env.DB},id)).game,game);
    assert.equal(applyServerAction(game,{type:"pass"}).ok,true);
    game.moves.at(-1).notation="x".repeat(2_100_000);
    if(selected){
      await persistGameState(env,game,3);
      assert.deepEqual((await loadGameProjection({DB:env.DB},id)).game,game);
      await assert.rejects(persistGameState({...env,STORAGE_LARGE_STATES_ENABLED:"false"},game,4),/storage_payload_too_large/);
      assert.deepEqual((await loadGameProjection({DB:env.DB},id)).game,game,"rollback retains the prior large save");
    }else await assert.rejects(persistGameState(env,game,3),/storage_payload_too_large/);
  }
});

test("writer promotion, rollback and omitted game scope fail safely",()=>{
 const scoped={STORAGE_LARGE_STATES_ENABLED:"true",STORAGE_WRITER_CANARY_GAME_ID:"game-"+"a".repeat(32)};
 assert.equal(stateWriteLimits(scoped).rawBytes,2_000_000);
 assert.equal(stateWriteLimits(scoped,scoped.STORAGE_WRITER_CANARY_GAME_ID).rawBytes,16*1024*1024);
 assert.equal(storageWriterEnabled(scoped,"false",scoped.STORAGE_WRITER_CANARY_GAME_ID),false);
 assert.equal(storageWriterEnabled(scoped,"invalid",scoped.STORAGE_WRITER_CANARY_GAME_ID),false);
 assert.equal(stateWriteLimits({...scoped,STORAGE_WRITER_CANARY_GAME_ID:""},"another-game").rawBytes,16*1024*1024);
});
