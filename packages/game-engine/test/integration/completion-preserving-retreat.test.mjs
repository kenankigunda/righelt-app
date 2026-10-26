import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CURRENT_RETREAT_SEMANTICS, LEGACY_RETREAT_SEMANTICS, archivedRetreatSemantics,
  applyAction, buildPushRetreatSuccessorActions, deterministicStateHash,
  isContinuationCompletable, listLegalActions, resolveToStability, validateAction,
  DecisionRuleCache, withDecisionRuleCache, replayActions,
} from '../../src/index.ts';
import { transition } from '../../../computer-player/src/transition.ts';
import { legalActionMap } from '../../../computer-player/src/representation.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/completion-preserving-retreat.json', import.meta.url), 'utf8'));
const legacy = { retreatSemantics: LEGACY_RETREAT_SEMANTICS };
const good = fixture.alternatives.find(row => row.completable);
const bad = fixture.alternatives.find(row => !row.completable);

test('recorded Push remains legal while only its completion-preserving retreat is offered', () => {
  const before = structuredClone(fixture.states.prePush);
  assert.equal(deterministicStateHash(before), fixture.push.beforeHash);
  assert.equal(validateAction(before, fixture.push.action).ok, true);
  const pushed = transition(before, fixture.push.action);
  assert.equal(deterministicStateHash(pushed), fixture.push.afterHash);
  assert.equal(buildPushRetreatSuccessorActions(pushed).length, 2);
  assert.deepEqual(listLegalActions(pushed), [good.action]);
  assert.equal(validateAction(pushed, bad.action).ok, false);
  assert.throws(() => applyAction(pushed, bad.action));
  assert.deepEqual(before, fixture.states.prePush);
});

test('allowed retreat preserves the original state hash and a legal Follow', () => {
  const next = transition(fixture.states.afterPush, good.action);
  assert.equal(deterministicStateHash(next), good.stateHash);
  assert.equal(isContinuationCompletable(next), true);
  const actions = listLegalActions(next);
  assert.deepEqual(actions, [{type:'follow', actorId:'U2-15', from:{row:3,col:1}, to:{row:4,col:1}}]);
  assert.equal(legalActionMap(next).has(890), true);
  assert.equal(actions.some(action => action.type === 'pass' || action.type === 'end_turn'), false);
  const followed = transition(next, actions[0]);
  assert.equal(followed.outcome.status, 'ongoing');
  assert.ok(listLegalActions(followed).length > 0);
});

test('explicit historical replay keeps the formerly legal retreat and exact stranded state', () => {
  const before = fixture.states.afterPush;
  assert.equal(validateAction(before, bad.action, legacy).ok, true);
  assert.equal(legalActionMap(before, legacy).has(fixture.retreat.index), true);
  assert.equal(legalActionMap(before).has(fixture.retreat.index), false);
  const retained = transition(before, bad.action, legacy);
  assert.equal(deterministicStateHash(retained), fixture.retreat.afterHash);
  assert.equal(retained.outcome.status, 'ongoing');
  assert.equal(retained.continuation.phase, 'follow');
  assert.deepEqual(listLegalActions(retained), []);
  assert.equal(deterministicStateHash(resolveToStability(retained, {artifactMode:'minimal'})), fixture.retreat.afterHash);
});

test('completion filtering never reclassifies geometric retreat failure as capture', () => {
  // Deliberately retained/inconsistent position: block the only safe square.
  // It is not claimed to be an admissible new Push.
  const retained = structuredClone(fixture.states.afterPush);
  retained.pieces.push({...retained.pieces.find(piece => piece.id === 'U1-28'), id:'retained-blocker', position:{row:3,col:0}, pushed:false});
  assert.equal(buildPushRetreatSuccessorActions(retained).length, 1);
  assert.equal(listLegalActions(retained).length, 0);
  const resolved = resolveToStability(retained, {artifactMode:'minimal'});
  assert.equal(resolved.outcome.status, 'ongoing');
  assert.equal(resolved.continuation.phase, 'retreat');
  assert.equal(resolved.pieces.some(piece => piece.id === 'U1-28'), true);
});

test('historical interpretation is explicit, fail-closed and cannot contaminate live cached masks', () => {
  assert.equal(archivedRetreatSemantics(undefined), LEGACY_RETREAT_SEMANTICS);
  assert.equal(archivedRetreatSemantics(CURRENT_RETREAT_SEMANTICS), CURRENT_RETREAT_SEMANTICS);
  for (const value of [null, '', 'unknown']) {
    assert.throws(() => archivedRetreatSemantics(value));
    assert.throws(() => listLegalActions(fixture.states.afterPush, {retreatSemantics:value}));
  }
  withDecisionRuleCache(new DecisionRuleCache(), () => {
    assert.deepEqual(listLegalActions(fixture.states.afterPush), [good.action]);
    assert.equal(listLegalActions(fixture.states.afterPush, legacy).length, 2);
    assert.deepEqual(listLegalActions(fixture.states.afterPush), [good.action]);
  });
});


test('empty replay rejects invalid semantics before accepting a state', () => {
  for (const retreatSemantics of [null, 'unknown'])
    assert.throws(() => replayActions(fixture.states.afterPush, [], {retreatSemantics}), /Unknown retreat semantics/);
});
