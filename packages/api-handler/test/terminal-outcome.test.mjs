import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../game-engine/test/fixtures/destruction-turn-end.json' with { type: 'json' };
import { GameRoomDO } from '../src/game-room-do.ts';
import { applyAcceptedAutomaticEnding, applyRevertToMove, applyScenarioToGame, createInitialGame } from '../src/shell-live-core.ts';
import { loadGameProjection, persistGameState } from '../src/shell-live-db.ts';
import { ACTION_CONTRACT_VERSION, commandFingerprint } from '../../shared-types/src/sync-protocol.ts';
import { createFakeD1 } from './support/fake-d1.mjs';
import { resolveToStability } from '../../game-engine/src/resolve.ts';
import { commander, makeState, unit } from '../../game-engine/test/helpers/state-builders.mjs';

const installTerminalFixture = game => {
  const state = structuredClone(fixture.initialState);
  state.pieces = state.pieces.filter(piece => piece.id !== 'C1');
  const exposed = state.pieces.find(piece => piece.id === 'U1-2');
  exposed.id = 'C1';
  exposed.kind = 'commander';
  game.board.state = state;
  game.turns = [{ index: state.turnIndex, startedAt: game.createdAt, endedAt: null,
    playerSeat: 'Player 2', status: 'active', moveIndexes: [], lastMoveAt: null }];
  return game;
};

const packedState = (side = 'P2', turnIndex = 1) => {
  const pieces = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    const owner = col >= 5 ? 'P1' : 'P2';
    pieces.push(row === 0 && col === 9 ? commander('C1', 'P1', row, col)
      : row === 9 && col === 0 ? commander('C2', 'P2', row, col)
      : unit(`${owner}-${row}-${col}`, owner, row, col));
  }
  return resolveToStability(makeState({ sideToMove: side, turnIndex, pieces }));
};

const harness = async () => {
  const DB = createFakeD1(), env = { DB }, state = { id: { name: 'terminal-game' } };
  let room = new GameRoomDO(state, env);
  const call = async (route, body = {}) => {
    const response = await room.fetch(new Request(`https://test/${route}`, { method: 'POST', headers: { 'x-game-id': 'terminal-game' },
      body: JSON.stringify({ protocolVersion: 2, identityId: 'owner', ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  await call('create', { gameId: 'terminal-game', selfPlayMode: true });
  DB.overwriteGameState('terminal-game', installTerminalFixture);
  room = new GameRoomDO(state, env);
  const command = async (patch = {}) => {
    const game = DB.getGameState('terminal-game');
    const value = { protocolVersion: 2, actionContractVersion: ACTION_CONTRACT_VERSION,
      gameId: game.id, identityId: 'owner', clientCommandId: `v2:${crypto.randomUUID()}`,
      kind: 'action', payload: { action: { type: 'end_turn' } }, expectedState: game.board.state,
      expectedGameplayRevision: game.gameplayRevision, ...patch };
    return { ...value, fingerprint: await commandFingerprint(value) };
  };
  return { DB, env, call, command, restart: () => { room = new GameRoomDO(state, env); } };
};

test('accepted decisive action atomically persists strict terminal provenance and read paths stay read-only', async () => {
  const h = await harness(), sent = await h.command(), accepted = await h.call('apply', sent);
  assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
  const game = h.DB.getGameState('terminal-game'), record = game.terminalOutcome;
  assert.equal(game.board.state.outcome.status, 'p2_win');
  assert.deepEqual(record.board, game.board.state);
  assert.deepEqual(record.result, game.board.state.outcome);
  assert.deepEqual(record.decisive.action, { type: 'end_turn' });
  assert.equal(record.decisive.clientCommandId, sent.clientCommandId);
  assert.deepEqual(record.commit, { clientCommandId: sent.clientCommandId,
    eventSeq: accepted.eventSeq, gameplayRevision: accepted.gameplayRevision });
  assert.equal(record.cause.kind, 'commander-settlement');
  assert.deepEqual(record.removals.map(entry => entry.pieceId), ['U1-3']);
  assert.equal(record.removals.some(entry => entry.pieceId === 'C1'), false,
    'an unsupplied commander remains on the terminal board and is not fabricated as a removal');
  assert.equal(record.activeActionCount, 0);
  assert.equal(record.activeActionCountComplete, true);
  assert.deepEqual(JSON.parse(h.DB.getReceipt(game.id, sent.clientCommandId).result_json).terminalOutcome,
    accepted.terminalOutcome);

  const before = structuredClone(game), writes = h.DB.getWrites().length;
  h.restart();
  const read = await h.call('reconcile', { commands: [], knownSnapshotEventSeq: 0 });
  assert.deepEqual(read.game.terminalOutcome, record);
  assert.deepEqual(h.DB.getGameState(game.id), before);
  assert.equal(h.DB.getWrites().length, writes);
});

test('duplicates, stale intent and dependent commands converge on one terminal record', async () => {
  const h = await harness(), sent = await h.command(), accepted = await h.call('apply', sent);
  const terminal = structuredClone(h.DB.getGameState('terminal-game').terminalOutcome), eventSeq = accepted.eventSeq;
  h.restart();
  const duplicate = await h.call('apply', sent);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(h.DB.getGameState('terminal-game').terminalOutcome, terminal);
  assert.equal(duplicate.eventSeq, eventSeq);

  const stale = await h.command({ expectedGameplayRevision: 0 });
  const staleResult = await h.call('apply', stale);
  assert.equal(staleResult.commandOutcomes[0].outcome, 'rejected');
  assert.equal(staleResult.commandOutcomes[0].reason, 'stale_state');
  const dependent = await h.command({ predecessor: { clientCommandId: stale.clientCommandId, fingerprint: stale.fingerprint } });
  const dependentResult = await h.call('apply', dependent);
  assert.equal(dependentResult.commandOutcomes[0].reason, 'predecessor_rejected');
  assert.deepEqual(h.DB.getGameState('terminal-game').terminalOutcome, terminal);
});

test('batch failure rolls back terminal board, event, provenance and receipt together', async () => {
  const probe = await harness(), probeCommand = await probe.command();
  await probe.call('apply', probeCommand);
  const h = await harness(), sent = await h.command(), before = structuredClone(h.DB.getGameState('terminal-game'));
  h.DB.failNextBatchAt(probe.DB.getLastBatchSize() - 1);
  await assert.rejects(h.call('apply', sent), /Injected/);
  assert.deepEqual(h.DB.getGameState('terminal-game'), before);
  assert.equal(h.DB.getReceipt('terminal-game', sent.clientCommandId), null);
  assert.equal(h.DB.getEvents('terminal-game').length, 0);
  h.restart();
  assert.equal((await h.call('apply', sent)).commandOutcomes[0].outcome, 'accepted');
});

const terminalRecordFor = ({ complete, metadata = true }) => {
  const game = createInitialGame({ gameId: 'lineage-terminal', identityId: 'owner', selfPlayMode: true });
  game.board.state.pieces = game.board.state.pieces.filter(piece => piece.id !== 'C2');
  game.board.state.outcome = { status: 'p1_win', reason: 'p2_commander_destroyed' };
  const imported = { moveId: 'imported-one', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P1', at: game.createdAt, notation: 'Pass', action: { type: 'pass' }, selectionSnapshot: structuredClone(game.board.state),
    snapshot: structuredClone(game.board.state), destroyedPieces: [], importedFrom: { gameId: 'source', decisionId: 'decision', gameplayRevision: 7 } };
  game.moves = [imported];
  if (metadata) game.importedHistory = { version: 1, complete, moveCount: 1,
    sources: [{ gameId: 'source', gameplayRevision: 7, moveCount: 1 }] };
  game.gameplayRevision = 1;
  const record = applyAcceptedAutomaticEnding(game, { type: 'pass' }, { move: imported, destroyedPieces: [] },
    { clientCommandId: 'v2:lineage', eventSeq: 1, gameplayRevision: 1, actorSide: 'P1', turnIndex: 0 });
  return { game, record };
};

test('terminal count consumes T-143 completeness without fabricating missing or older lineage', async () => {
  const completeCase = terminalRecordFor({ complete: true }), complete = completeCase.record;
  assert.deepEqual({ count: complete.activeActionCount, complete: complete.activeActionCountComplete,
    lineage: complete.lineage }, { count: 1, complete: true, lineage: { version: 1, complete: true,
    importedMoveCount: 1, sources: [{ gameId: 'source', gameplayRevision: 7, moveCount: 1 }] } });
  assert.equal(terminalRecordFor({ complete: false }).record.activeActionCountComplete, false);
  const olderCase = terminalRecordFor({ complete: false, metadata: false }), older = olderCase.record;
  assert.equal(older.activeActionCount, 1);
  assert.equal(older.activeActionCountComplete, false);
  assert.equal(older.lineage.version, null);
  for (const candidate of [completeCase, terminalRecordFor({ complete: false })]) {
    const env = { DB: createFakeD1() };
    await persistGameState(env, candidate.game, 1);
    const loaded = await loadGameProjection(env, candidate.game.id);
    assert.equal(loaded.kind, 'ok');
    assert.deepEqual(loaded.game.terminalOutcome, candidate.record);
  }
});

test('accepted-action integration applies proven continuation finality but not an optional defender-only escape', () => {
  const pieces = [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 3, 6),
    unit('V0', 'P1', 0, 4), unit('V2', 'P1', 2, 4), unit('H1', 'P1', 5, 4),
    unit('H9', 'P1', 5, 9), unit('V8', 'P1', 8, 4), unit('V9', 'P1', 9, 4), unit('bait', 'P2', 1, 5)];
  const state = makeState({ pieces, continuation: { type: 'rush', owner: 'P1', frozenOwner: 'P1',
    frozenPieceStatesById: Object.fromEntries(pieces.filter(piece => piece.owner === 'P1')
      .map(piece => [piece.id, { supplied: true, commanded: true }])),
    rushedPieceIds: pieces.filter(piece => piece.owner === 'P1' && piece.id !== 'V0').map(piece => piece.id),
    rushChainPieceIds: ['C1'], chainLength: 1 } });
  const game = createInitialGame({ gameId: 'early-finality', identityId: 'owner', selfPlayMode: true });
  game.board.state = state;
  const move = { moveId: 'decisive-rush', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P1', at: game.createdAt, notation: 'Rush', action: { type: 'rush', actorId: 'C1' },
    selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [] };
  game.moves = [move];
  const record = applyAcceptedAutomaticEnding(game, move.action, { move, destroyedPieces: [] },
    { clientCommandId: 'v2:early', eventSeq: 2, gameplayRevision: 1, actorSide: 'P1', turnIndex: 0 });
  assert.equal(record.cause.kind, 'relevant-continuation-finality');
  assert.equal(record.result.status, 'p1_win');
  assert.equal(game.board.state.continuation, null);
  assert.deepEqual(move.snapshot, game.board.state);
});

test('accepted turn settlement applies exhaustive sole-Pass incoming loss and freezes Pass in the action count', () => {
  const game = createInitialGame({ gameId: 'incoming-immobile', identityId: 'owner', selfPlayMode: true });
  game.board.state = packedState();
  game.turns = [{ index: 1, startedAt: game.createdAt, endedAt: null, playerSeat: 'Player 2', status: 'active', moveIndexes: [], lastMoveAt: null }];
  const move = { moveId: 'decisive-pass', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P1', at: game.createdAt, notation: 'Pass', action: { type: 'pass' },
    selectionSnapshot: structuredClone(game.board.state), snapshot: structuredClone(game.board.state), destroyedPieces: [] };
  game.moves = [move];
  const record = applyAcceptedAutomaticEnding(game, move.action, { move, destroyedPieces: [], turnSettled: true },
    { clientCommandId: 'v2:incoming', eventSeq: 3, gameplayRevision: 2, actorSide: 'P1', turnIndex: 0 });
  assert.deepEqual(record.cause, { kind: 'incoming-turn-immobility', incomingSide: 'P2' });
  assert.deepEqual(record.result, { status: 'p1_win', reason: 'p2_incoming_turn_immobility' });
  assert.equal(record.activeActionCount, 1);
  assert.equal(record.activeActionCountComplete, true);
});

test('branch preparation preserves a sole-Pass unfinished position without evaluating current ending rules', () => {
  const game = createInitialGame({ gameId: 'prepared-branch', identityId: 'owner', selfPlayMode: true });
  const initialState = packedState('P2', 4);
  applyScenarioToGame(game, { formatVersion: 2, id: 'packed-source', title: 'Packed source', description: 'read-only preparation',
    incorrect: false, initialState, moves: [], resultingState: initialState, expectedFinalStateHash: '',
    expectedOutcome: 'ongoing', savedSelection: null });
  assert.equal(game.board.state.outcome.status, 'ongoing');
  assert.equal(game.terminalOutcome, undefined);
  assert.equal(game.board.state.sideToMove, 'P2');
  assert.equal(game.board.state.turnIndex, 4);
});

test('Undo clears terminal provenance and restores only the recorded pre-action position', () => {
  const game = createInitialGame({ gameId: 'undo-terminal', identityId: 'owner', selfPlayMode: true });
  const selectionSnapshot = structuredClone(game.board.state);
  const terminalBoard = structuredClone(selectionSnapshot);
  terminalBoard.pieces = terminalBoard.pieces.filter(piece => piece.id !== 'C2');
  terminalBoard.outcome = { status: 'p1_win', reason: 'p2_commander_destroyed' };
  const move = { moveId: 'terminal-decision', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P1', at: game.createdAt, notation: 'Pass', action: { type: 'pass' }, selectionSnapshot,
    snapshot: terminalBoard, destroyedPieces: [] };
  game.moves = [move];
  game.board.state = terminalBoard;
  applyAcceptedAutomaticEnding(game, move.action, { move, destroyedPieces: [] },
    { clientCommandId: 'v2:terminal', eventSeq: 2, gameplayRevision: 1, actorSide: 'P1', turnIndex: 0 });
  assert.ok(game.terminalOutcome);
  assert.equal(applyRevertToMove(game, move.moveId, 'owner').ok, true);
  assert.equal(game.terminalOutcome, undefined);
  assert.deepEqual(game.board.state, selectionSnapshot);
  assert.equal(game.board.state.outcome.status, 'ongoing');
});

test('persisted terminal provenance fails closed when its board or commit fence is changed', async () => {
  for (const mutate of [
    game => { game.terminalOutcome.board.turnIndex += 1; },
    game => { game.terminalOutcome.commit.gameplayRevision += 1; },
    game => { game.terminalOutcome.result.reason = 'fabricated'; },
    game => { game.terminalOutcome.removals.push({ reason: 'fabricated' }); },
  ]) {
    const { game } = terminalRecordFor({ complete: true }), env = { DB: createFakeD1() };
    await persistGameState(env, game, 1);
    env.DB.overwriteGameState(game.id, value => { mutate(value); return value; });
    const loaded = await loadGameProjection(env, game.id);
    assert.equal(loaded.kind, 'invalid');
    assert.ok(loaded.mismatches.some(entry => entry.field === 'terminalOutcome'));
  }
});

test('retained completed games remain readable without a fabricated terminal record or rewrite', async () => {
  const env = { DB: createFakeD1() }, game = createInitialGame({ gameId: 'legacy-complete', identityId: 'owner', selfPlayMode: true });
  game.board.state.pieces = game.board.state.pieces.filter(piece => piece.id !== 'C2');
  game.board.state.outcome = { status: 'p1_win', reason: 'p2_commander_destroyed' };
  await persistGameState(env, game, 1);
  const writes = env.DB.getWrites().length, loaded = await loadGameProjection(env, game.id);
  assert.equal(loaded.kind, 'ok');
  assert.equal(loaded.game.board.state.outcome.status, 'p1_win');
  assert.equal(loaded.game.terminalOutcome, undefined);
  assert.equal(env.DB.getWrites().length, writes);
});
