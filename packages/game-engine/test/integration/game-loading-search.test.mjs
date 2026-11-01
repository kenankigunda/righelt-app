import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listLegalActions, withEngineComputationGuard, boundedEngineOperation, normalizeState,
  buildContinuationSuccessorState, canCloseContinuationNow, validateAction } from '../../src/index.ts';
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

const catalog = JSON.parse(readFileSync('apps/web/scenarios/catalog.json', 'utf8'));
test('a spent rescue actor cannot keep an impossible branch artificially open', () => {
  const state = catalog.scenarios.find(record => record.id === '5bbc0ebf-ed20-4e12-8143-67eaa5cc8676').resultingState;
  const first = { type: 'rush', actorId: 'U1-2', from: { row: 6, col: 5 }, to: { row: 7, col: 5 } };
  const rescue = { type: 'rush', actorId: 'U1-1', from: { row: 5, col: 5 }, to: { row: 6, col: 5 } };
  const intermediate = buildContinuationSuccessorState(state, first);
  assert.equal(canCloseContinuationNow(intermediate), false);
  assert.equal(boundedEngineOperation(() => validateAction(intermediate, rescue)).ok, true);
  assert.equal(canCloseContinuationNow(buildContinuationSuccessorState(intermediate, rescue)), true);
  let expansions = 0;
  const actions = withEngineComputationGuard(expansion => {
    if (expansion && ++expansions > 1000) throw new Error('spent-actor search regressed');
  }, () => listLegalActions(state));
  assert.equal(actions.length, 52);
  assert.ok(actions.some(action => JSON.stringify(action) === JSON.stringify(first)));
  assert.deepEqual(actions, bruteLegalActions(state));
});

for (const record of catalog.scenarios) for (const key of ['initialState', 'resultingState']) {
  if (!record[key]) continue;
  test(`catalog legal enumeration stays complete within the shared budget: ${record.id}/${key}`, () => {
    const state = normalizeState(record[key]), before = structuredClone(state);
    const actions = boundedEngineOperation(() => listLegalActions(state));
    assert.ok(Array.isArray(actions));
    assert.deepEqual(state, before);
  });
}
