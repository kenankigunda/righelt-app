import test from 'node:test';
import assert from 'node:assert/strict';
import { beginScenarioCapture, scenarioCapturePosition, canLoadScenarioInPlace } from '../shell/scenario-capture.js';
import { activeDecisionLineage } from '../shell/decision-history.js';
const game = () => ({ id: 'game', currentSnapshot: { turnIndex: 0 }, board: { state: { turnIndex: 0 } }, moves: [], selfPlayMode: true, player1: { identityId: 'me' }, player2: { identityId: 'me' } });
test('capture waits for a pending historical position instead of freezing the live fallback', () => {
  assert.throws(() => beginScenarioCapture({ ...game(), historyLoading: true }, 'me'), /loading/i);
  assert.equal(beginScenarioCapture({ ...game(), historyLoading: false }, 'me').mode, 'live');
});
test('manual capture follows authoritative play but history inspection never changes its source', () => {
  const g = game(), capture = beginScenarioCapture(g, 'me');
  assert.equal(capture.mode, 'live'); g.currentSnapshot = { turnIndex: 99 }; g.board.state = { turnIndex: 2 };
  assert.deepEqual(scenarioCapturePosition(capture, g), { turnIndex: 2 });
});
test('friend, computer, watch and historical captures stay frozen', () => {
  for (const extra of [{ player2: { identityId: 'friend' } }, { computer: {} }, { inHistoryMode: true }, { selfPlayMode: false }]) {
    const g = { ...game(), ...extra }, capture = beginScenarioCapture(g, 'me');
    g.currentSnapshot.turnIndex = 99; g.board.state.turnIndex = 22;
    assert.equal(capture.mode, 'frozen'); assert.deepEqual(scenarioCapturePosition(capture, g), { turnIndex: 0 });
  }
});
test('in-place scenario load requires empty and solely owned, never a computer game', () => {
  assert.equal(canLoadScenarioInPlace(game(), 'me'), true);
  for (const extra of [{ player2: { identityId: 'friend' } }, { computer: {} }, { moves: [{}] }]) assert.equal(canLoadScenarioInPlace({ ...game(), ...extra }, 'me'), false);
  assert.equal(canLoadScenarioInPlace(game(), 'stranger'), false);
});
test('restorations preserve decisions but active ancestry excludes prior undone computer replies', () => {
  const decision = (id, computer = false) => ({ id, move: { moveId: id, ...(computer ? { computerProof: {} } : {}) } });
  const entries = [decision('human1'), decision('computer1', true), decision('human2'), decision('computer2', true), { kind: 'restoration', targetDecisionId: 'human2' }, decision('human3')];
  assert.deepEqual(activeDecisionLineage(entries).map(move => move.moveId), ['human1', 'computer1', 'human3']);
  assert.equal(entries.length, 6);
});

test('historical capture keeps the pre-decision position and selected action after later navigation', () => {
  const g = { ...game(), inHistoryMode: true };
  const context = { currentSnapshot: { turnIndex: 7 }, savedSelection: { source: { row: 3, col: 4 }, target: { row: 5, col: 4 }, actorSide: 'P1', turnIndex: 7 } };
  const capture = beginScenarioCapture(g, 'me', context);
  context.currentSnapshot.turnIndex = 99; context.savedSelection.source.row = 0;
  g.currentSnapshot = { turnIndex: 22 };
  assert.equal(scenarioCapturePosition(capture, g).turnIndex, 7);
  assert.equal(capture.selection.source.row, 3);
  assert.equal(capture.mode, 'frozen');
});
