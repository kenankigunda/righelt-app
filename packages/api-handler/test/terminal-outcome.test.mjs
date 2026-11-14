import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../game-engine/test/fixtures/destruction-turn-end.json' with { type: 'json' };
import { GameRoomDO } from '../src/game-room-do.ts';
import { activeActionEvidence, applyAcceptedAutomaticEnding, applyRevertToMove, applyScenarioToGame, applyServerAction, createInitialGame, resolveServerMoveAction } from '../src/shell-live-core.ts';
import { loadGameProjection, loadPositionProjection, persistGameState } from '../src/shell-live-db.ts';
import { ACTION_CONTRACT_VERSION, commandFingerprint } from '../../shared-types/src/sync-protocol.ts';
import { createFakeD1 } from './support/fake-d1.mjs';
import { resolveToStability } from '../../game-engine/src/resolve.ts';
import { commander, makeState, unit } from '../../game-engine/test/helpers/state-builders.mjs';
import { MAX_HISTORY } from '../../shared-types/src/history.ts';

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

const harness = async (installer = installTerminalFixture) => {
  const DB = createFakeD1(), env = { DB }, state = { id: { name: 'terminal-game' } };
  let room = new GameRoomDO(state, env);
  const call = async (route, body = {}) => {
    const response = await room.fetch(new Request(`https://test/${route}`, { method: 'POST', headers: { 'x-game-id': 'terminal-game' },
      body: JSON.stringify({ protocolVersion: 2, identityId: 'owner', ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  await call('create', { gameId: 'terminal-game', selfPlayMode: true });
  DB.overwriteGameState('terminal-game', installer);
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

const installSolePassFixture = (game, mode = 'existing') => {
  const state = packedState('P2', 4);
  game.board.state = structuredClone(state);
  game.moves = [];
  game.turns = [{ index: 4, startedAt: game.createdAt, endedAt: null,
    playerSeat: 'Player 2', status: 'active', moveIndexes: [], lastMoveAt: null }];
  if (mode === 'branch') {
    const imported = { moveId: 'imported-pass', index: 0, turnIndex: 3, turnMoveIndex: 0, displayMoveNumber: 1,
      actorSide: 'P1', at: game.createdAt, notation: 'Pass', action: { type: 'pass' },
      selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [],
      importedFrom: { gameId: 'source-game', decisionId: 'source-pass', gameplayRevision: 7 } };
    game.moves = [imported];
    game.importedHistory = { version: 1, complete: true, moveCount: 1,
      sources: [{ gameId: 'source-game', gameplayRevision: 7, moveCount: 1 }] };
    game.historyBranchCreationKey = 'branch-key';
  } else if (mode === 'undo') {
    const after = structuredClone(state);
    after.sideToMove = 'P1';
    const target = { moveId: 'undo-target', index: 0, turnIndex: 4, turnMoveIndex: 0, displayMoveNumber: 1,
      actorSide: 'P2', at: game.createdAt, notation: 'Pass', action: { type: 'pass' },
      selectionSnapshot: structuredClone(state), snapshot: after, destroyedPieces: [], clientCommandId: 'v2:old-pass' };
    game.moves = [target];
    game.board.state = after;
    assert.equal(applyRevertToMove(game, target.moveId, 'owner').ok, true);
  }
  return game;
};

for (const mode of ['existing', 'branch', 'undo']) {
  test(`${mode} sole-Pass position terminalizes inside the next accepted mutation without recording an unplayed Pass`, async () => {
    const h = await harness(game => installSolePassFixture(game, mode));
    const before = structuredClone(h.DB.getGameState('terminal-game'));
    const sent = await h.command({ payload: { action: { type: 'pass' } } });
    const accepted = await h.call('apply', sent);
    assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
    const game = h.DB.getGameState('terminal-game'), record = game.terminalOutcome;
    assert.equal(game.board.state.outcome.status, 'p1_win');
    assert.equal(game.moves.length, before.moves.length, 'the triggering Pass is not appended as a played decision');
    assert.equal(record.decisive.decisionId, null);
    assert.deepEqual(record.decisive.action, { type: 'pass' });
    assert.equal(record.decisive.actorSide, 'P2');
    assert.equal(record.activeActionCount, mode === 'branch' ? 1 : 0);
    assert.equal(record.activeActionCountComplete, true);
    assert.deepEqual(record.commit, { clientCommandId: sent.clientCommandId,
      eventSeq: accepted.eventSeq, gameplayRevision: accepted.gameplayRevision });
    assert.deepEqual(JSON.parse(h.DB.getReceipt(game.id, sent.clientCommandId).result_json).terminalOutcome,
      accepted.terminalOutcome);
    h.restart();
    const read = await h.call('reconcile', { commands: [], knownSnapshotEventSeq: 0 });
    assert.deepEqual(read.game.terminalOutcome, record);
  });
}

test('legacy move route resolves its real sole-Pass intent before automatic ending', async () => {
  const h = await harness(game => installSolePassFixture(game));
  const before = structuredClone(h.DB.getGameState('terminal-game'));
  const sent = await h.command({ kind: 'move', payload: {} });
  const accepted = await h.call('moves', sent);
  assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
  const game = h.DB.getGameState('terminal-game');
  assert.equal(game.board.state.outcome.status, 'p1_win');
  assert.equal(game.moves.length, before.moves.length);
  assert.deepEqual(game.terminalOutcome.decisive.action, { type: 'pass' });
  assert.equal(game.terminalOutcome.decisive.decisionId, null);
  assert.equal(game.terminalOutcome.commit.clientCommandId, sent.clientCommandId);
});

test('accepted sparse commander actions round-trip with actorId or from as the actor locator', async () => {
  const actions = [
    { type: 'move', actorId: 'C1', to: { row: 2, col: 6 } },
    { type: 'move', from: { row: 3, col: 6 }, to: { row: 2, col: 6 } },
  ];
  for (const action of actions) {
    const h = await harness(game => game), sent = await h.command({ payload: { action } });
    const accepted = await h.call('apply', sent);
    assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
    assert.deepEqual(h.DB.getGameState('terminal-game').moves[0].action, action);
    const loaded = await loadGameProjection(h.env, 'terminal-game');
    assert.equal(loaded.kind, 'ok');
    assert.deepEqual(loaded.game.moves[0].action, action);
  }
});

const installUndoEndingFixture = (game, consent = false) => {
  const state = packedState('P2', 4);
  const target = { moveId: 'undo-ending-target', index: 0, turnIndex: 4, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P2', at: game.createdAt, notation: 'Pass', action: { type: 'pass' }, clientCommandId: 'v2:old',
    selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [] };
  game.board.state = structuredClone(state);
  game.moves = [target];
  game.turns = [{ index: 4, startedAt: game.createdAt, endedAt: null,
    playerSeat: 'Player 2', status: 'active', moveIndexes: [0], lastMoveAt: game.createdAt }];
  if (consent) {
    game.selfPlayMode = false;
    game.player2 = { ...structuredClone(game.player1), identityId: 'bob' };
  }
  return game;
};

test('direct accepted Undo evaluates and persists the restored current-rules ending atomically', async () => {
  const h = await harness(game => installUndoEndingFixture(game));
  const accepted = await h.call('revert-request', { targetMoveId: 'undo-ending-target', requestId: 'direct-undo' });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.autoApproved, true);
  const game = h.DB.getGameState('terminal-game');
  assert.equal(game.moves[0].undone, true);
  assert.equal(game.board.state.outcome.status, 'p1_win');
  assert.deepEqual(game.terminalOutcome.decisive.action, { type: 'pass' });
  assert.equal(game.terminalOutcome.decisive.decisionId, null);
  assert.equal(game.terminalOutcome.commit.clientCommandId, 'direct-undo');
  assert.equal(game.terminalOutcome.commit.gameplayRevision, game.gameplayRevision);
});

test('consented accepted Undo applies current ending rules only on approval', async () => {
  const h = await harness(game => installUndoEndingFixture(game, true));
  const requested = await h.call('revert-request', { targetMoveId: 'undo-ending-target', requestId: 'consented-undo' });
  assert.equal(requested.pendingApproval, true);
  assert.equal(h.DB.getGameState('terminal-game').terminalOutcome, undefined);
  const approved = await h.call('revert-approve', { identityId: 'bob', requestId: 'consented-undo' });
  assert.equal(approved.ok, true);
  const game = h.DB.getGameState('terminal-game');
  assert.equal(game.moves[0].undone, true);
  assert.equal(game.board.state.outcome.status, 'p1_win');
  assert.equal(game.terminalOutcome.commit.clientCommandId, 'consented-undo');
  assert.equal(game.terminalOutcome.commit.gameplayRevision, game.gameplayRevision);
});

test('shared accepted Undo rolls back atomically and duplicate delivery reuses one terminal record', async () => {
  const makeCommand = async h => h.command({ clientCommandId: 'v2:undo-ending', kind: 'shared',
    payload: { operation: 'revert-request', values: { targetMoveId: 'undo-ending-target', requestId: 'undo-ending' } } });
  const probe = await harness(game => installUndoEndingFixture(game));
  await probe.call('shared', await makeCommand(probe));
  const h = await harness(game => installUndoEndingFixture(game)), sent = await makeCommand(h);
  const before = structuredClone(h.DB.getGameState('terminal-game'));
  h.DB.failNextBatchAt(probe.DB.getLastBatchSize() - 1);
  await assert.rejects(h.call('shared', sent), /Injected/);
  assert.deepEqual(h.DB.getGameState('terminal-game'), before);
  assert.equal(h.DB.getReceipt('terminal-game', sent.clientCommandId), null);
  h.restart();
  const accepted = await h.call('shared', sent);
  const terminal = structuredClone(h.DB.getGameState('terminal-game').terminalOutcome);
  const duplicate = await h.call('shared', sent);
  assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(h.DB.getGameState('terminal-game').terminalOutcome, terminal);
});

test('pending sole-Pass terminalization rolls back its board, provenance and receipt as one fenced operation', async () => {
  const probe = await harness(game => installSolePassFixture(game));
  await probe.call('apply', await probe.command({ payload: { action: { type: 'pass' } } }));
  const h = await harness(game => installSolePassFixture(game));
  const sent = await h.command({ payload: { action: { type: 'pass' } } });
  const before = structuredClone(h.DB.getGameState('terminal-game'));
  h.DB.failNextBatchAt(probe.DB.getLastBatchSize() - 1);
  await assert.rejects(h.call('apply', sent), /Injected/);
  assert.deepEqual(h.DB.getGameState('terminal-game'), before);
  assert.equal(h.DB.getReceipt('terminal-game', sent.clientCommandId), null);
  h.restart();
  assert.equal((await h.call('apply', sent)).commandOutcomes[0].outcome, 'accepted');
});

test('pending sole-Pass ending cannot bypass the expected-state fence', async () => {
  const h = await harness(game => installSolePassFixture(game));
  const sent = await h.command({ payload: { action: { type: 'pass' } } });
  sent.expectedState = structuredClone(sent.expectedState);
  sent.expectedState.turnIndex += 1;
  sent.fingerprint = await commandFingerprint(sent);
  const rejected = await h.call('apply', sent);
  assert.equal(rejected.commandOutcomes[0].outcome, 'rejected');
  assert.equal(rejected.commandOutcomes[0].reason, 'stale_state');
  assert.equal(h.DB.getGameState('terminal-game').terminalOutcome, undefined);
});

test('accepted post-retreat frame records the defender actor while finality remains fenced to the original attacker', () => {
  const pieces = [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 3, 6),
    unit('V0', 'P1', 0, 4), unit('V2', 'P1', 2, 4), unit('H1', 'P1', 5, 4),
    unit('H9', 'P1', 5, 9), unit('V8', 'P1', 8, 4), unit('V9', 'P1', 9, 4), unit('bait', 'P2', 1, 5)];
  const state = makeState({ pieces, sideToMove: 'P1', turnIndex: 4,
    continuation: { type: 'push', owner: 'P1', attackerOwner: 'P1', phase: 'follow',
      followPoint: { row: 1, col: 4 }, followGroupPieceIds: ['H1'], chainLength: 1 } });
  const game = createInitialGame({ gameId: 'post-retreat', identityId: 'owner', selfPlayMode: true });
  game.board.state = state;
  game.turns = [{ index: 4, startedAt: game.createdAt, endedAt: null,
    playerSeat: 'Player 1', status: 'active', moveIndexes: [0], lastMoveAt: game.createdAt }];
  const action = { type: 'retreat', actorId: 'C2', from: { row: 1, col: 5 }, to: { row: 1, col: 6 } };
  const move = { moveId: 'accepted-retreat', index: 0, turnIndex: 4, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P2', at: game.createdAt, notation: 'Retreat', action, clientCommandId: 'v2:retreat',
    selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [] };
  game.moves = [move];
  const record = applyAcceptedAutomaticEnding(game, action, { move, destroyedPieces: [] },
    { clientCommandId: 'v2:retreat', eventSeq: 2, gameplayRevision: 1,
      actorSide: 'P2', turnOwnerSide: 'P1', turnIndex: 4 });
  assert.equal(record.cause.kind, 'relevant-continuation-finality');
  assert.equal(record.result.status, 'p1_win');
  assert.equal(record.decisive.actorSide, 'P2', 'provenance records the defender who actually retreated');
  assert.deepEqual(record.decisive.action, action);
  assert.equal(record.decisive.decisionId, move.moveId);
});

test('accepted decisive action atomically persists strict terminal provenance and read paths stay read-only', async () => {
  const h = await harness(), sent = await h.command(), accepted = await h.call('apply', sent);
  assert.equal(accepted.commandOutcomes[0].outcome, 'accepted');
  const game = h.DB.getGameState('terminal-game'), record = game.terminalOutcome;
  assert.equal(game.board.state.outcome.status, 'p2_win');
  assert.deepEqual(record.board, game.board.state);
  assert.deepEqual(record.result, game.board.state.outcome);
  assert.deepEqual(record.decisive.action, { type: 'end_turn' });
  assert.equal(record.decisive.decisionId, null, 'End turn is explicitly represented without a fabricated move decision');
  assert.equal(record.decisive.clientCommandId, sent.clientCommandId);
  assert.deepEqual(record.commit, { clientCommandId: sent.clientCommandId,
    eventSeq: accepted.eventSeq, gameplayRevision: accepted.gameplayRevision });
  assert.equal(record.cause.kind, 'commander-settlement');
  assert.equal(record.effect.kind, 'end-turn');
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
  const decisive = { ...structuredClone(imported), moveId: 'local-final', index: 1, turnMoveIndex: 1,
    displayMoveNumber: 2, clientCommandId: 'v2:lineage' };
  delete decisive.importedFrom;
  game.moves = [imported, decisive];
  game.turns[0].moveIndexes = [0, 1];
  if (metadata) game.importedHistory = { version: 1, complete, moveCount: 1,
    sources: [{ gameId: 'source', gameplayRevision: 7, moveCount: 1 }] };
  game.gameplayRevision = 1;
  const record = applyAcceptedAutomaticEnding(game, { type: 'pass' }, { move: decisive, destroyedPieces: [] },
    { clientCommandId: 'v2:lineage', eventSeq: 1, gameplayRevision: 1, actorSide: 'P1', turnOwnerSide: 'P1', turnIndex: 0 });
  return { game, record };
};

test('terminal count consumes T-143 completeness without fabricating missing or older lineage', async () => {
  const completeCase = terminalRecordFor({ complete: true }), complete = completeCase.record;
  assert.deepEqual({ count: complete.activeActionCount, complete: complete.activeActionCountComplete,
    lineage: complete.lineage }, { count: 2, complete: true, lineage: { version: 1, complete: true,
    importedMoveCount: 1, sources: [{ gameId: 'source', gameplayRevision: 7, moveCount: 1 }] } });
  assert.equal(terminalRecordFor({ complete: false }).record.activeActionCountComplete, false);
  const olderCase = terminalRecordFor({ complete: false, metadata: false }), older = olderCase.record;
  assert.equal(older.activeActionCount, 2);
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

for (const compressed of [false, true]) test(`${compressed ? 'compressed' : 'JSON'} position reads defer terminal and lineage proof until authoritative history loads`, async () => {
  const { game, record } = terminalRecordFor({ complete: true });
  const env = { DB: createFakeD1(), STORAGE_COMPRESSION: String(compressed) };
  await persistGameState(env, game, 1);

  const full = await loadGameProjection(env, game.id);
  assert.equal(full.kind, 'ok');
  assert.deepEqual(full.game.terminalOutcome, record);
  assert.deepEqual(full.game.importedHistory, game.importedHistory);

  const position = await loadPositionProjection(env, game.id);
  assert.equal(position.kind, 'ok');
  assert.equal(position.game.positionHistoryPending, compressed);
  assert.equal(position.game.terminalOutcome, undefined);
  assert.equal(position.game.importedHistory, undefined);
  assert.equal(position.game.moves.some(move => move.importedFrom !== undefined), false);
});

test('active action evidence deduplicates origins and local IDs, counts Pass, and excludes End turn and Undo', () => {
  const state = packedState('P1', 0);
  const move = (moveId, action, patch = {}) => ({ moveId, index: 0, turnIndex: 0, turnMoveIndex: 0,
    displayMoveNumber: 1, actorSide: 'P1', at: 'now', notation: action.type, action,
    selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [], ...patch });
  const imported = move('imported-a', { type: 'pass' },
    { importedFrom: { gameId: 'source', decisionId: 'origin-a', gameplayRevision: 3 } });
  const duplicateImported = move('imported-b', { type: 'pass' },
    { importedFrom: { gameId: 'source', decisionId: 'origin-a', gameplayRevision: 3 } });
  const localPass = move('local-pass', { type: 'pass' });
  const duplicateLocal = move('local-pass', { type: 'pass' });
  const ended = move('local-end', { type: 'end_turn' });
  const undone = move('local-undone', { type: 'pass' }, { undone: true });
  const evidence = activeActionEvidence({ moves: [imported, duplicateImported, localPass, duplicateLocal, ended, undone],
    importedHistory: { version: 1, complete: true, moveCount: 2,
      sources: [{ gameId: 'source', gameplayRevision: 3, moveCount: 2 }] } });
  assert.equal(evidence.activeActionCount, 2, 'one imported origin and one local Pass are counted once');
  assert.equal(evidence.lineage.importedMoveCount, 1);
  assert.equal(evidence.lineage.complete, false, 'duplicate imported provenance cannot be complete');
  assert.equal(evidence.activeActionCountComplete, false, 'duplicate local IDs independently make the total incomplete');
});

test('a saturated retained local window never claims a complete total without an authoritative total archive', () => {
  const state = packedState('P1', 0);
  const moves = Array.from({ length: MAX_HISTORY + 1 }, (_, index) => ({ moveId: `local-${index}`, index,
    turnIndex: index, turnMoveIndex: 0, displayMoveNumber: index + 1, actorSide: index % 2 ? 'P2' : 'P1',
    at: 'now', notation: 'Pass', action: { type: 'pass' }, selectionSnapshot: structuredClone(state),
    snapshot: structuredClone(state), destroyedPieces: [] }));
  const evidence = activeActionEvidence({ moves });
  assert.equal(evidence.activeActionCount, MAX_HISTORY + 1);
  assert.equal(evidence.lineage.complete, true, 'imported-lineage completeness remains an independent fact');
  assert.equal(evidence.activeActionCountComplete, false);
});

test('a complete 203-move imported lineage remains count-complete because it is not prunable local history', () => {
  const state = makeState({ pieces: [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 9, 0)] });
  const moves = Array.from({ length: 203 }, (_, index) => ({ moveId: `imported-${index}`, index,
    turnIndex: index, turnMoveIndex: 0, displayMoveNumber: index + 1, actorSide: index % 2 ? 'P2' : 'P1',
    at: 'now', notation: 'Pass', action: { type: 'pass' }, selectionSnapshot: state, snapshot: state, destroyedPieces: [],
    importedFrom: { gameId: 'source', decisionId: `decision-${index}`, gameplayRevision: 203 } }));
  const evidence = activeActionEvidence({ moves, importedHistory: { version: 1, complete: true, moveCount: 203,
    sources: [{ gameId: 'source', gameplayRevision: 203, moveCount: 203 }] } });
  assert.equal(evidence.activeActionCount, 203);
  assert.equal(evidence.lineage.complete, true);
  assert.equal(evidence.activeActionCountComplete, true);
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
    { clientCommandId: 'v2:early', eventSeq: 2, gameplayRevision: 1, actorSide: 'P1', turnOwnerSide: 'P1', turnIndex: 0 });
  assert.equal(record.cause.kind, 'relevant-continuation-finality');
  assert.equal(record.result.status, 'p1_win');
  assert.equal(game.board.state.continuation, null);
  assert.deepEqual(move.snapshot, game.board.state);
});

test('compressed decisive rush finality remains strict-readable after persistence', async () => {
  const pieces = [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 3, 6),
    unit('V0', 'P1', 0, 4), unit('V2', 'P1', 2, 4), unit('H1', 'P1', 5, 4),
    unit('H9', 'P1', 5, 9), unit('V8', 'P1', 8, 4), unit('V9', 'P1', 9, 4), unit('bait', 'P2', 1, 5)];
  const state = makeState({ pieces, continuation: { type: 'rush', owner: 'P1', frozenOwner: 'P1',
    frozenPieceStatesById: Object.fromEntries(pieces.filter(piece => piece.owner === 'P1')
      .map(piece => [piece.id, { supplied: true, commanded: true }])),
    rushedPieceIds: pieces.filter(piece => piece.owner === 'P1' && piece.id !== 'V0').map(piece => piece.id),
    rushChainPieceIds: ['C1'], chainLength: 1 } });
  const game = createInitialGame({ gameId: 'compressed-early-finality', identityId: 'owner', selfPlayMode: true });
  game.board.state = state;
  const canonicalAction = resolveServerMoveAction(game);
  const action = { ...canonicalAction, targetId: 'legacy-unused-target' };
  assert.equal(action?.type, 'rush');
  const move = { moveId: 'decisive-rush', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
    actorSide: 'P1', at: game.createdAt, notation: 'Rush', action, clientCommandId: 'v2:early',
    selectionSnapshot: structuredClone(state), snapshot: structuredClone(state), destroyedPieces: [] };
  game.moves = [move];
  game.turns[0].moveIndexes = [0];
  game.gameplayRevision = 1;
  const record = applyAcceptedAutomaticEnding(game, action, { move, destroyedPieces: [] },
    { clientCommandId: 'v2:early', eventSeq: 2, gameplayRevision: 1, actorSide: 'P1', turnOwnerSide: 'P1', turnIndex: 0 });
  assert.equal(record?.cause.kind, 'relevant-continuation-finality');
  // Pre-T-144 Action was a broad durable shape. Recreate a record accepted by
  // the engine before the per-type closed decoder was introduced.
  game.moves[0].action = structuredClone(action);
  game.terminalOutcome.decisive.action = structuredClone(action);

  const env = { DB: createFakeD1(), STORAGE_COMPRESSION: 'true' };
  await persistGameState(env, createInitialGame({ gameId: game.id, identityId: 'owner', selfPlayMode: true }), 1);
  await persistGameState(env, game, 2);
  game.player1.connected = false;
  game.player1.sessionCount = 0;
  await persistGameState(env, game, 3, null, { metadataOnly: true });
  const loaded = await loadGameProjection(env, game.id);
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.game.moves[0].action, canonicalAction);
  assert.deepEqual(loaded.game.terminalOutcome.decisive.action, canonicalAction);
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
    { clientCommandId: 'v2:incoming', eventSeq: 3, gameplayRevision: 2, actorSide: 'P1', turnOwnerSide: 'P1', turnIndex: 0 });
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
    { clientCommandId: 'v2:terminal', eventSeq: 2, gameplayRevision: 1, actorSide: 'P1', turnOwnerSide: 'P1', turnIndex: 0 });
  assert.ok(game.terminalOutcome);
  assert.equal(applyRevertToMove(game, move.moveId, 'owner').ok, true);
  assert.equal(game.terminalOutcome, undefined);
  assert.deepEqual(game.board.state, selectionSnapshot);
  assert.equal(game.board.state.outcome.status, 'ongoing');
});

test('persisted terminal provenance binds every frozen field family to authoritative history', async () => {
  const mutations = [
    ['board', game => { game.terminalOutcome.board.turnIndex += 1; }],
    ['action', game => { game.terminalOutcome.decisive.action = { type: 'end_turn' }; }],
    ['unknown action', game => { game.terminalOutcome.decisive.action = { type: 'teleport' }; }],
    ['unknown action field', game => { game.terminalOutcome.decisive.action = {
      ...game.terminalOutcome.decisive.action, unknownField: 'unexpected',
    }; }],
    ['malformed legacy action field', game => { game.terminalOutcome.decisive.action = {
      ...game.terminalOutcome.decisive.action, targetId: 42,
    }; }],
    ['malformed action', game => { game.terminalOutcome.decisive.action = { type: 'move', actorId: 'C1' }; }],
    ['decision', game => { game.terminalOutcome.decisive.decisionId = 'missing-decision'; }],
    ['decisive command', game => { game.terminalOutcome.decisive.clientCommandId = 'v2:other'; }],
    ['actor', game => { game.terminalOutcome.decisive.actorSide = 'P2'; }],
    ['turn', game => { game.terminalOutcome.decisive.turnIndex += 1; }],
    ['removals', game => { game.terminalOutcome.removals.push({ pieceId: 'fabricated', ownerSeat: 'p2',
      kind: 'unit', position: { row: 1, col: 1 }, supplied: false, commanded: false, reason: 'loss_of_supply' }); }],
    ['result', game => { game.terminalOutcome.result.reason = 'fabricated'; }],
    ['cause', game => { game.terminalOutcome.cause.reason = 'fabricated'; }],
    ['lineage', game => { game.terminalOutcome.lineage.complete = false; }],
    ['count', game => { game.terminalOutcome.activeActionCount += 1; }],
    ['count completeness', game => { game.terminalOutcome.activeActionCountComplete = false; }],
    ['commit command', game => { game.terminalOutcome.commit.clientCommandId = 'v2:other'; }],
    ['commit revision', game => { game.terminalOutcome.commit.gameplayRevision += 1; }],
  ];
  for (const [family, mutate] of mutations) {
    const { game } = terminalRecordFor({ complete: true }), env = { DB: createFakeD1() };
    await persistGameState(env, game, 1);
    env.DB.overwriteGameState(game.id, value => { mutate(value); return value; });
    const loaded = await loadGameProjection(env, game.id);
    assert.equal(loaded.kind, 'invalid', family);
    assert.ok(loaded.mismatches.some(entry => entry.field === 'terminalOutcome'));
  }
});

test('null-decision End turn and pending Pass records reject corrupted effects and removals', async () => {
  const cases = [
    { make: () => harness(), route: 'apply', command: h => h.command(),
      mutate: game => { game.terminalOutcome.effect.before.turnIndex += 1; } },
    { make: () => harness(), route: 'apply', command: h => h.command(),
      mutate: game => { game.terminalOutcome.removals.push({ pieceId: 'fabricated', ownerSeat: 'p1', kind: 'unit',
        position: { row: 1, col: 1 }, supplied: false, commanded: false, reason: 'loss_of_supply' }); } },
    { make: () => harness(game => installSolePassFixture(game)), route: 'apply',
      command: h => h.command({ payload: { action: { type: 'pass' } } }),
      mutate: game => { game.terminalOutcome.effect.kind = 'end-turn'; } },
    { make: () => harness(game => installSolePassFixture(game)), route: 'apply',
      command: h => h.command({ payload: { action: { type: 'pass' } } }),
      mutate: game => { game.terminalOutcome.removals.push({ pieceId: 'fabricated', ownerSeat: 'p2', kind: 'unit',
        position: { row: 1, col: 1 }, supplied: false, commanded: false, reason: 'loss_of_supply' }); } },
  ];
  for (const entry of cases) {
    const h = await entry.make(), sent = await entry.command(h);
    assert.equal((await h.call(entry.route, sent)).commandOutcomes[0].outcome, 'accepted');
    h.DB.overwriteGameState('terminal-game', game => { entry.mutate(game); return game; });
    assert.equal((await loadGameProjection(h.env, 'terminal-game')).kind, 'invalid');
  }
});

test('terminal commit gameplay revision rejects both lower and higher values than the authoritative row', async () => {
  for (const revision of [1, 3]) {
    const { game } = terminalRecordFor({ complete: true }), env = { DB: createFakeD1() };
    game.gameplayRevision = 2;
    game.terminalOutcome.commit.gameplayRevision = revision;
    await persistGameState(env, game, 1);
    assert.equal((await loadGameProjection(env, game.id)).kind, 'invalid');
  }
});

test('persisted move actions reject unknown and malformed per-type shapes', async () => {
  for (const action of [
    { type: 'teleport' },
    { type: 'move', actorId: 'C1' },
    { type: 'move', to: { row: 2, col: 6 } },
    { type: 'move', actorId: 'C1', to: { row: 2, col: 6 }, unknownField: 'unexpected' },
    { type: 'push', actorId: 'C1', to: { row: 3, col: 5 }, targetId: '' },
  ]) {
    const env = { DB: createFakeD1() }, game = createInitialGame({ gameId: `bad-${action.type}-${Object.keys(action).length}`,
      identityId: 'owner', selfPlayMode: true });
    game.moves = [{ moveId: 'bad-action', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
      actorSide: 'P1', at: game.createdAt, notation: 'Bad', action, selectionSnapshot: structuredClone(game.board.state),
      snapshot: structuredClone(game.board.state), destroyedPieces: [] }];
    await persistGameState(env, game, 1);
    assert.equal((await loadGameProjection(env, game.id)).kind, 'invalid');
  }
});

test('accepted broad Action input is canonicalized before the current writer persists it', () => {
  const game = createInitialGame({ gameId: 'canonical-write', identityId: 'owner', selfPlayMode: true });
  const result = applyServerAction(game, {
    type: 'pass', actorId: 'legacy-actor', from: { row: 0, col: 0 }, to: { row: 0, col: 0 }, targetId: 'legacy-target',
  }, undefined, 'v2:canonical-write');
  assert.equal(result.ok, true);
  assert.deepEqual(game.moves[0].action, { type: 'pass' });
});

test('retained sparse push actions round-trip with optional targetId', async () => {
  for (const action of [
    { type: 'push', actorId: 'C1', to: { row: 3, col: 5 } },
    { type: 'push', from: { row: 3, col: 6 }, to: { row: 3, col: 5 }, targetId: 'U2' },
  ]) {
    const env = { DB: createFakeD1() }, game = createInitialGame({ gameId: `push-${Object.keys(action).length}`,
      identityId: 'owner', selfPlayMode: true });
    game.moves = [{ moveId: 'retained-push', index: 0, turnIndex: 0, turnMoveIndex: 0, displayMoveNumber: 1,
      actorSide: 'P1', at: game.createdAt, notation: 'Push', action,
      selectionSnapshot: structuredClone(game.board.state), snapshot: structuredClone(game.board.state), destroyedPieces: [] }];
    await persistGameState(env, game, 1);
    const loaded = await loadGameProjection(env, game.id);
    assert.equal(loaded.kind, 'ok');
    assert.deepEqual(loaded.game.moves[0].action, action);
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
