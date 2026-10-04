import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTerminalScenario, assertFriendRematch } from '../results-proof.mjs';
test('terminal fixture must come from the explicitly selected candidate catalog scenario', () => {
  const expected = { title: 'Capture supply point to win by unsupplying the commander', id: 'real-catalog-id' };
  assert.equal(selectTerminalScenario({ scenarios: [{ title: 'Unrelated' }, expected] }), expected);
  assert.throws(() => selectTerminalScenario({ scenarios: [] }), /lacks the catalog/);
});
test('friend rematch rejects reused game, wrong side, auto-seated peer and terminal state', () => {
  const good = { id: 'new', ownershipMode: 'account_v1', selfPlayMode: false, player1: { identityId: 'account' }, player2: null, board: { state: { outcome: { status: 'ongoing' } } } };
  assertFriendRematch(good, 'old', 'account');
  for (const patch of [{ id: 'old' }, { selfPlayMode: true }, { player1: { identityId: 'other' } }, { player2: { identityId: 'peer' } }, { board: { state: { outcome: { status: 'p1_win' } } } }]) assert.throws(() => assertFriendRematch({ ...good, ...patch }, 'old', 'account'));
});
