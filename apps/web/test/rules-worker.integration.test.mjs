import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { RulesRuntime } from '../board/rules-runtime.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { buildPieceMoveResponse } from '../board/client-move-generation.js';
import { createInitialState, resolveToStability, listLegalActions, equivalentGameStates } from '../generated/packages/game-engine/src/index.js';

const workerFactory = () => {
  const worker = new Worker(`import {parentPort} from 'node:worker_threads';
    globalThis.self={postMessage:value=>parentPort.postMessage(value)};
    await import(${JSON.stringify(new URL('../board/rules-worker.js', import.meta.url).href)});
    parentPort.on('message',data=>self.onmessage({data}));`, { eval: true, type: 'module' });
  const bridge = { postMessage: value => worker.postMessage(value), terminate: () => { void worker.terminate(); } };
  worker.on('message', data => bridge.onmessage?.({ data }));
  worker.on('error', error => bridge.onerror?.(error));
  return bridge;
};
test('real rules worker finishes production End Turn with complete projection parity', async t => {
  const runtime = new RulesRuntime({ workerFactory }); t.after(() => runtime.cancelAll());
  const state = JSON.parse(readFileSync('packages/game-engine/test/fixtures/mobile-end-turn-rush.json', 'utf8'));
  const game = { id: 'regression', gameplayRevision: 51, board: { state }, currentSnapshot: state,
    myRole: 'Player 1', player1: { identityId: 'owner' }, player2: { identityId: 'owner' },
    turns: [{ index: 29, playerSeat: 'Player 2', moveIndexes: [0] }],
    moves: [{ index: 0, turnIndex: 29, snapshot: state }] };
  const input = { authoritativeGame: game, identityId: 'owner', queue: [{ kind: 'end-turn', clientCommandId: 'end', queuedAt: '2026-10-29T22:00:00Z' }] };
  const actual = await runtime.project('regression:51', input);
  assert.deepEqual(actual, projectOptimisticGame(input));
  assert.equal(actual.game.legalActions.length, 46);
  assert.equal(actual.game.board.state.turnIndex, 30);
  assert.equal(game.board.state.turnIndex, 29);
});
test('real preview worker preserves legal and blocked move explanations', async t => {
  const runtime = new RulesRuntime({ workerFactory }); t.after(() => runtime.cancelAll());
  const state = resolveToStability(createInitialState(), { artifactMode: 'full' });
  const input = { state, legalActions: listLegalActions(state), pieceId: 'C1' };
  assert.deepEqual(await runtime.previews('C1', input), buildPieceMoveResponse(input));
});

test('real recovery worker preserves semantic comparison for retained snapshots',async t=>{
  const runtime=new RulesRuntime({workerFactory});t.after(()=>runtime.cancelAll());
  const left=resolveToStability(createInitialState(),{artifactMode:'full'}),right=structuredClone(left);delete right.artifacts;
  assert.equal(await runtime.equivalent('retained',{left,right}),equivalentGameStates(left,right));
  right.pieces.pop();assert.equal(await runtime.equivalent('changed',{left,right}),equivalentGameStates(left,right));
});

test('real guidance worker identifies the reported supply-restoring rush', async t => {
  const runtime=new RulesRuntime({workerFactory});t.after(()=>runtime.cancelAll());
  const catalog=JSON.parse(readFileSync('apps/web/scenarios/catalog.json','utf8'));
  const state=catalog.scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;
  assert.deepEqual(await runtime.rushGuidance('supply',state),{
    obligationPieceIds:['U1-3'],actions:[{action:{type:'rush',actorId:'U1-7',from:{row:6,col:4},to:{row:7,col:5}},immediate:true}],
  });
});
