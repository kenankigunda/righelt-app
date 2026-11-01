import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameRoomDO } from '../src/game-room-do.ts';
import { asScenarioRecord, applyScenarioToGame, createInitialGame, withViewModel } from '../src/shell-live-core.ts';
import { createFakeD1 } from './support/fake-d1.mjs';
import { commandFingerprint } from '../../shared-types/src/sync-protocol.ts';
import { boundedEngineOperation } from '../../game-engine/src/index.ts';
import { projectOptimisticGame } from '../../../apps/web/shell/optimistic-live.js';

const { state, action } = JSON.parse(readFileSync('packages/game-engine/test/fixtures/game-loading-follow.json', 'utf8'));
const scenario = { formatVersion: 2, id: '85241980-65fc-4b88-b978-c42726181041', title: 'Retained follow', initialState: state, resultingState: state, moves: [] };

test('the native position-first recorded-move fixture satisfies the actual scenario parser', () => {
  const initialState = JSON.parse(readFileSync('packages/game-engine/test/fixtures/game-loading-rush.json', 'utf8'));
  const action = JSON.parse(readFileSync('packages/game-engine/test/fixtures/game-loading-actions.json', 'utf8')).find(action => action.type === 'move');
  const record = { ...scenario, initialState, resultingState: initialState, moves: [{ turnIndex: initialState.turnIndex, turnMoveIndex: 0, actorSide: initialState.sideToMove, action, notation: 'Saved move' }] };
  assert.ok(asScenarioRecord(record));
  const game = createInitialGame({ gameId: 'fixture', identityId: 'actor', selfPlayMode: true });
  applyScenarioToGame(game, record);
  assert.equal(game.moves.length, 1);
  assert.equal(game.moves[0].actorSide, initialState.sideToMove);
  assert.equal(game.moves[0].turnMoveIndex, 0);
});

test('the seven-push follow projects, commits once and reconciles after a lost response and room restart', async () => {
  const DB = createFakeD1(), env = { DB }, roomState = { id: { name: 'follow' } };
  let room = new GameRoomDO(roomState, env);
  const call = async (path, body = {}) => {
    const response = await room.fetch(new Request(`https://test/${path}`, { method: 'POST', headers: { 'x-game-id': 'follow' }, body: JSON.stringify({ identityId: 'actor', protocolVersion: 2, ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  assert.equal((await call('create', { gameId: 'follow', selfPlayMode: true })).status, 200);
  assert.equal((await call('load-scenario', { scenario })).status, 200);
  const before = DB.getGameState('follow');
  const projected = projectOptimisticGame({ authoritativeGame: boundedEngineOperation(() => withViewModel(before, 'actor')), identityId: 'actor', queue: [{ kind: 'apply', action, notation: 'FOLLOW', queuedAt: new Date().toISOString(), clientCommandId: 'v2:follow-once' }] });
  assert.equal(projected.ok, true);
  assert.equal(projected.game.legalActions.length, 45);
  assert.equal(projected.game.pendingMoves.length, 1);
  const command = { protocolVersion: 2, gameId: 'follow', identityId: 'actor', clientCommandId: 'v2:follow-once', kind: 'action', payload: { action, notation: 'FOLLOW' }, expectedState: before.board.state, expectedGameplayRevision: before.gameplayRevision };
  command.fingerprint = await commandFingerprint(command);
  DB.loseNextBatchResponse();
  await assert.rejects(call('moves', command), /Lost batch/);
  room = new GameRoomDO(roomState, env);
  const recovered = await call('reconcile', { commands: [command], knownSnapshotEventSeq: 0 });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.commandOutcomes[0].outcome, 'accepted');
  assert.equal(recovered.game.legalActions.length, 45);
  const persisted = DB.getGameState('follow');
  assert.equal(persisted.moves.filter(move => move.clientCommandId === command.clientCommandId).length, 1);
  assert.deepEqual(persisted.board.state, projected.game.board.state);
  const receipt = DB.getReceipt('follow', command.clientCommandId);
  assert.equal(receipt.outcome, 'accepted');
  const duplicate = await call('moves', command);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(DB.getReceipt('follow', command.clientCommandId), receipt);
  assert.deepEqual(DB.getGameState('follow'), persisted);
});
