import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { RulesRuntime } from '../board/rules-runtime.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { buildPieceMoveResponse } from '../board/client-move-generation.js';
import { createInitialState, resolveToStability, listLegalActions, equivalentGameStates, analyzeRushSupplyGuidance, deterministicStateHash, serializeState } from '../generated/packages/game-engine/src/index.js';
import { createComputerControl } from '../generated/packages/shared-types/src/computer-play.js';
import { readRetreatCapture, FOLLOW_ACTION } from '../../../e2e/support/retreat-completion-fixture.mjs';

const entries = [new URL('../board/rules-worker.js', import.meta.url), new URL('../generated/rules-worker.js', import.meta.url)];
function runtimeFor(t, entry) {
  const runtime = new RulesRuntime({ workerFactory() {
    const worker = new Worker(`import {parentPort} from 'node:worker_threads';
      globalThis.self={postMessage:value=>parentPort.postMessage(value)};
      await import(${JSON.stringify(entry.href)});
      parentPort.on('message',data=>self.onmessage({data}));`, { eval: true, type: 'module' });
    t.after(async () => { await worker.terminate(); });
    const bridge = { postMessage: value => worker.postMessage(value), terminate: () => { void worker.terminate(); } };
    worker.on('message', data => bridge.onmessage?.({ data }));
    worker.on('error', error => bridge.onerror?.(error));
    return bridge;
  } });
  t.after(() => runtime.cancelAll());
  return runtime;
}
const gameFor = state => ({ id: 'worker-parity', gameplayRevision: 51, board: { state }, currentSnapshot: state,
  myRole: 'Player 1', player1: { identityId: 'owner' }, player2: { identityId: 'owner' },
  turns: [{ index: state.turnIndex, playerSeat: 'Player 1', moveIndexes: [] }], moves: [] });

test('source and bundled worker preserve complete End Turn results and command Maps', async t => {
  const state = JSON.parse(readFileSync('packages/game-engine/test/fixtures/mobile-end-turn-rush.json', 'utf8'));
  const game = { ...gameFor(state), turns: [{ index: 29, playerSeat: 'Player 2', moveIndexes: [0] }], moves: [{ index: 0, turnIndex: 29, snapshot: state }] };
  const input = { authoritativeGame: game, identityId: 'owner', queue: [{ kind: 'end-turn', clientCommandId: 'end', queuedAt: '2026-10-29T22:00:00Z' }] };
  const original = structuredClone(input), expected = projectOptimisticGame(input);
  for (const entry of entries) {
    const actual = await runtimeFor(t, entry).project('end-turn', input);
    assert.deepEqual(actual, expected); assert(actual.commandResults instanceof Map);
    assert.equal(actual.game.legalActions.length, 46); assert.equal(actual.game.board.state.turnIndex, 30);
  }
  assert.deepEqual(input, original);
});

test('source and bundled worker preserve the captured single completion-preserving retreat', async t => {
  const capture = readRetreatCapture(), safe = capture.alternatives.find(row => row.completable);
  const input = { authoritativeGame: gameFor(capture.states.afterPush), identityId: 'owner', queue: [] };
  const original = structuredClone(input), expected = projectOptimisticGame(input);
  assert.deepEqual(expected.game.legalActions, [safe.action]);
  for (const entry of entries) assert.deepEqual(await runtimeFor(t, entry).project('retreat', input), expected);
  assert.deepEqual(input, original);
});

test('source and bundled admission workers apply the captured safe retreat and retain only Follow', async t => {
  const capture = readRetreatCapture(), safe = capture.alternatives.find(row => row.completable);
  const state = structuredClone(capture.states.afterPush), commandId = 'v2:captured-safe-retreat';
  // The attacker P2 owns turn85 while the defender P1 temporarily controls its
  // retreat. Imported computer games assign both seats to their actual owner.
  const game = { ...gameFor(state), selfPlayMode: true, myRole: 'Player 2',
    computer: createComputerControl('owner', { p1: 'babs', p2: null }, 'initial-1554'),
    turns: [{ index: state.turnIndex, playerSeat: 'Player 2', status: 'active', moveIndexes: [0] }],
    moves: [{ index: 0, turnIndex: state.turnIndex, turnMoveIndex: 0, actorSide: 'P2',
      action: structuredClone(capture.push.action), selectionSnapshot: structuredClone(capture.states.prePush), snapshot: structuredClone(state) }] };
  const command = { kind: 'apply', clientCommandId: commandId, action: structuredClone(safe.action),
    state: structuredClone(state), notation: 'RETREAT', queuedAt: '2026-10-29T22:00:00Z' };
  const input = { authoritativeGame: game, identityId: 'owner', queue: [command] }, original = structuredClone(input);
  assert.equal(state.sideToMove, 'P1'); assert.equal(state.continuation.attackerOwner, 'P2');
  assert.equal(state.continuation.phase, 'retreat'); assert.equal(game.turns[0].playerSeat, 'Player 2');
  const expected = projectOptimisticGame(input);
  assert.equal(expected.ok, true);
  for (const entry of entries) {
    const actual = await runtimeFor(t, entry).project('admit:captured-safe-retreat', input);
    assert.deepEqual(actual, expected);
    assert(actual.commandResults instanceof Map); assert.equal(actual.commandResults.get(commandId).accepted, true);
    assert.deepEqual(actual.game.legalActions, [FOLLOW_ACTION]);
    assert.deepEqual(actual.commandResults.get(commandId).legalActions, [FOLLOW_ACTION]);
    assert.equal(actual.game.pendingMoves[0].actorSide, 'P1');
    assert.equal(actual.game.currentTurn.playerSeat, 'Player 2');
    const result = actual.commandResults.get(commandId).state;
    const minimal = resolveToStability(structuredClone(result), { artifactMode: 'minimal' });
    const fullCore = JSON.parse(serializeState(result)), minimalCore = JSON.parse(serializeState(minimal));
    delete fullCore.artifacts; delete minimalCore.artifacts;
    assert.deepEqual(minimalCore, fullCore, 'Capture hash normalization cannot change authority');
    assert.equal(deterministicStateHash(minimal), safe.stateHash);
  }
  assert.deepEqual(input, original);
});

test('source and bundled worker preserve full legal and blocked preview explanations', async t => {
  const state = resolveToStability(createInitialState(), { artifactMode: 'full' });
  const input = { state, legalActions: listLegalActions(state), pieceId: 'C1' }, original = structuredClone(input);
  const expected = buildPieceMoveResponse(input);
  for (const entry of entries) assert.deepEqual(await runtimeFor(t, entry).previews('piece', input), expected);
  assert.deepEqual(input, original);
});

test('source and bundled worker preserve true and false retained state comparisons', async t => {
  const left = resolveToStability(createInitialState(), { artifactMode: 'full' }), right = structuredClone(left); delete right.artifacts;
  for (const entry of entries) {
    assert.equal(await runtimeFor(t, entry).equivalent('retained', { left, right }), equivalentGameStates(left, right));
    const changed = structuredClone(right); changed.pieces.pop();
    assert.equal(await runtimeFor(t, entry).equivalent('changed', { left, right: changed }), false);
  }
});

test('source and bundled worker preserve the exact supply-restoring rush result', async t => {
  const catalog = JSON.parse(readFileSync('apps/web/scenarios/catalog.json', 'utf8'));
  const state = catalog.scenarios.find(row => row.id === 'bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;
  const expected = { obligationPieceIds: ['U1-3'], actions: [{ action: { type: 'rush', actorId: 'U1-7', from: { row: 6, col: 4 }, to: { row: 7, col: 5 } }, immediate: true }] };
  assert.deepEqual(analyzeRushSupplyGuidance(state), expected);
  for (const entry of entries) assert.deepEqual(await runtimeFor(t, entry).rushGuidance('supply', state), expected);
});

test('source and bundled worker preserve structured operation errors', async t => {
  for (const entry of entries) await assert.rejects(runtimeFor(t, entry).request('unknown', 'unknown', {}), { message: 'unknown_rules_operation' });
});
