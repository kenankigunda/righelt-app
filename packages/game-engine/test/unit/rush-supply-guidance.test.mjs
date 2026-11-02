import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRushSupplyGuidance, applyAction, buildContinuationSuccessorState, canCloseContinuationNow, createInitialState, getRushUnsuppliedPieceIds, listLegalActions, validateAction } from '../../src/index.ts';
import { supplyBarriers } from '../helpers/rush-guidance.mjs';

const key = a => `${a.actorId}:${a.to.row},${a.to.col}`;
test('guidance is absent outside an unsupplied rush obligation', () => {
  assert.deepEqual(analyzeRushSupplyGuidance(createInitialState()), { obligationPieceIds: [], actions: [] });
  const state = supplyBarriers(); state.continuation.rushChainPieceIds = [];
  assert.deepEqual(analyzeRushSupplyGuidance(state), { obligationPieceIds: [], actions: [] });
});

test('two barriers retain all useful first steps when two rushes are required', () => {
  const state = supplyBarriers(), before = structuredClone(state);
  const result = analyzeRushSupplyGuidance(state);
  assert.deepEqual(result.obligationPieceIds, ['X']);
  assert.deepEqual(result.actions.map(e => [key(e.action), e.immediate]), [
    ['B:5,4', false], ['B:6,4', false], ['D:5,6', false],
  ]);
  assert.deepEqual(state, before);
  const first = result.actions.find(e => key(e.action) === 'B:5,4').action;
  const next = buildContinuationSuccessorState(state, first);
  assert.equal(canCloseContinuationNow(next), false);
  const second = analyzeRushSupplyGuidance(next);
  assert.deepEqual(second.actions.map(e => [key(e.action), e.immediate]), [['D:5,6', true]]);
});

test('immediate and longer irredundant alternatives coexist without redundant prefixes', () => {
  const state = supplyBarriers({ crossing: true });
  const result = analyzeRushSupplyGuidance(state);
  assert.deepEqual(result.actions.map(e => [key(e.action), e.immediate]), [
    ['A:5,4', true], ['A:3,4', false], ['A:5,5', false], ['B:3,4', false], ['C:5,7', false],
  ]);
  for (const {action, immediate} of result.actions) {
    assert.equal(validateAction(state, action).ok, true);
    assert.equal(canCloseContinuationNow(buildContinuationSuccessorState(state, action)), immediate);
  }
  // B followed by A's immediate fix is redundant, but B remains useful on
  // the distinct B -> C route. A successful shortest route must not erase it.
  const b = result.actions.find(e => key(e.action) === 'B:3,4').action;
  const afterB = buildContinuationSuccessorState(state, b);
  const c = {type:'rush', actorId:'C', from:{row:4,col:7}, to:{row:5,col:7}};
  assert.equal(validateAction(afterB, c).ok, true);
  assert.equal(canCloseContinuationNow(buildContinuationSuccessorState(afterB, c)), true);
  assert.equal(canCloseContinuationNow(buildContinuationSuccessorState(state, c)), false);
});

test('all current blockers are named and only complete supply restoration is immediate', () => {
  const state = supplyBarriers({ crossing: true, extraBlocker: true });
  assert.deepEqual(getRushUnsuppliedPieceIds(state), ['X', 'Y']);
  const result = analyzeRushSupplyGuidance(state);
  assert.deepEqual(result.obligationPieceIds, ['X', 'Y']);
  assert.equal(result.actions.find(e => key(e.action) === 'A:5,4').immediate, true);
});

// Deliberately independent, exhaustive oracle: replay every subsequence using
// public validation/application, including combinations of omitted rushes.
test('guidance equals exhaustive proper-subsequence filtering on a bounded position', () => {
  const state = supplyBarriers({ crossing:true });
  const complete = [];
  const walk = (current, path) => {
    if (canCloseContinuationNow(current)) { complete.push(path); return; }
    for (const action of listLegalActions(current).filter(a => a.type === 'rush')) {
      walk(applyAction(current, action).state, [...path, action]);
    }
  };
  walk(state, []);
  assert.ok(complete.some(path => path.length >= 3), 'oracle must exercise combined omissions');
  const irredundant = complete.filter(path => {
    for (let mask = 1; mask < (1 << path.length) - 1; mask++) {
      let current = state, legal = true;
      for (let i = 0; i < path.length; i++) if (mask & (1 << i)) {
        if (!validateAction(current, path[i]).ok) { legal = false; break; }
        current = applyAction(current, path[i]).state;
      }
      if (legal && canCloseContinuationNow(current)) return false;
    }
    return true;
  });
  assert.deepEqual(new Set(analyzeRushSupplyGuidance(state).actions.map(e => key(e.action))), new Set(irredundant.map(path => key(path[0]))));
});
