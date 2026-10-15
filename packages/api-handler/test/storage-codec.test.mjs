import test from "node:test";
import assert from "node:assert/strict";
import { encodeStorage,decodeStorage,sha256 } from "../src/storage-codec.ts";
import { createInitialGame,applyServerAction,applyRevertToMove,applyScenarioToGame } from "../src/shell-live-core.ts";
import {readFileSync} from "node:fs";
import {listLegalActions} from "../../game-engine/src/legal.ts";
import { persistGameState,loadGameProjection } from "../src/shell-live-db.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";

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
