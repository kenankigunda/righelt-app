import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listLegalActions, withEngineComputationGuard } from '../../src/index.ts';
import { bruteLegalActions } from '../helpers/brute-legal-actions.mjs';

test('the saved game loads with complete exact legality without a combinatorial trapped rush', () => {
  const state = JSON.parse(readFileSync('packages/game-engine/test/fixtures/game-loading-rush.json', 'utf8'));
  let expansions = 0;
  const actions = withEngineComputationGuard(expansion => {
    if (expansion && ++expansions > 1000) throw new Error('saved-game continuation search regressed');
  }, () => listLegalActions(state));
  assert.equal(actions.length, 34);
  const baseline = JSON.parse(readFileSync("packages/game-engine/test/fixtures/game-loading-actions.json", "utf8"));
  assert.deepEqual(actions, baseline);
  assert.ok(!actions.some(a => a.type === 'rush' && a.actorId === 'U2-2' && a.to.row === 5 && a.to.col === 6));
  assert.deepEqual(actions, bruteLegalActions(state));
});
