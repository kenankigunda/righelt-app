import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpponentMoveTracker, isOpponentAction } from '../shell/opponent-move-sound.js';

const move = (moveId, actorSide = 'P2') => ({ moveId, actorSide });
const game = (revision, moves) => ({ id: 'g', gameplayRevision: revision, moves, myRoles: ['Player 1'], board: { state: { outcome: { status: 'ongoing' } } } });

test('initial history is silent and each authoritative move survives duplicate delivery, trimming and renumbering', () => {
  const tracker = createOpponentMoveTracker();
  assert.deepEqual(tracker.update(game(1, [move('old')]), { sequence: 1 }).moves, []);
  const next = game(2, [move('old'), move('new'), move('new')]);
  assert.deepEqual(tracker.update(next, { sequence: 2 }).moves.map(move => move.moveId), ['new']);
  assert.deepEqual(tracker.update(next, { sequence: 2 }).moves, []);
  assert.deepEqual(tracker.update(game(3, [move('new'), { ...move('third'), index: 0 }]), { sequence: 3 }).moves.map(move => move.moveId), ['third']);
  assert.deepEqual(tracker.update(game(2, [move('stale')]), { sequence: 2 }).moves, []);
});

test('older archive expansion and undone moves remain silent while a batched catch-up reports every new move', () => {
  const tracker = createOpponentMoveTracker(); tracker.update(game(5, [move('known')]));
  assert.deepEqual(tracker.update(game(5, [move('older'), move('known')])).moves, []);
  assert.deepEqual(tracker.update(game(8, [move('older'), move('known'), move('a'), { ...move('undone'), undone: true }, move('b')])).moves.map(move => move.moveId), ['a', 'b']);
  assert.deepEqual(tracker.update(game(9, [move('a'), move('b'), move('c')]), { baseline: true }).moves, []);
  assert.deepEqual(tracker.update(game(9, [move('a'), move('b'), move('c')])).moves, []);
});

test('new account scope baselines independently and terminal finalization is observed once without a new move', () => {
  const tracker = createOpponentMoveTracker(), current = game(1, [move('a')]);
  tracker.update(current, { scope: 'account-a' });
  const finished = { ...current, gameplayRevision: 2, board: { state: { outcome: { status: 'p2_win' } } } };
  assert.equal(tracker.update(finished, { scope: 'account-a' }).finished, true);
  assert.equal(tracker.update(finished, { scope: 'account-a' }).finished, false);
  assert.equal(tracker.update(finished, { scope: 'account-b' }).finished, false);
});

test('computer proof identifies an opponent even when the owner holds both seats', () => {
  const current = game(1, []);
  assert.equal(isOpponentAction(current, move('opponent')), true);
  assert.equal(isOpponentAction(current, move('human', 'P1')), false);
  assert.equal(isOpponentAction({ ...current, myRoles: ['Viewer'] }, move('opponent')), false);
  const both = { ...current, myRoles: ['Player 1', 'Player 2'], computer: {} };
  assert.equal(isOpponentAction(both, { ...move('computer'), computerProof: { profile: 'babs' } }), true);
  assert.equal(isOpponentAction(both, move('manual')), false);
  const raw = { ...current, myRoles: undefined, player1: { identityId: 'human' }, player2: { identityId: 'friend' } };
  assert.equal(isOpponentAction(raw, move('raw-opponent'), 'human'), true);
  assert.equal(isOpponentAction(raw, move('raw-opponent'), 'viewer'), false);
});
