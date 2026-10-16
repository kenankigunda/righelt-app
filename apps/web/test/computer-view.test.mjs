import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDecisionDebug } from '../shell/computer-view.js';

test('client-reported search diagnostics cannot inject markup or break date rendering', () => {
 const state = { drafts: new Map(), notes: [], attempts: new Map(), open: new Set(), items: [], attemptPages: {
  computer: { items: [{ attemptId: 'reported', attempt: { startedAt: 'invalid date', result: { actions: [{ index: '<img src=x onerror=alert(1)>', visits: '<script>bad</script>', prior: 1, value: 0 }] } } }], cursor: null },
 }};
 const html = renderDecisionDebug({ game: null, status: {}, state, signedIn: true });
 assert.doesNotMatch(html, /<img|<script>/);
 assert.match(html, /&lt;img/); assert.match(html, /Unavailable/);
 state.attemptPages.computer.items[0].attempt.result.actions = { unexpected: 'shape' };
 assert.doesNotThrow(() => renderDecisionDebug({ game: null, status: {}, state, signedIn: true }));
 const nonPrimitive = JSON.parse('{"toString":null,"valueOf":null}');
 state.attemptPages.computer.items[0].attempt = { startedAt: nonPrimitive, outcome: nonPrimitive, result: { action: {type: nonPrimitive, actorId: nonPrimitive, from: {row: nonPrimitive, col: nonPrimitive}}, value: nonPrimitive, actions: [{index: nonPrimitive, visits: nonPrimitive, prior: nonPrimitive, value: nonPrimitive, immediate: nonPrimitive, tactical: nonPrimitive}] } };
 assert.doesNotThrow(() => renderDecisionDebug({ game: null, status: {}, state, signedIn: true }));
 assert.match(renderDecisionDebug({ game: null, status: {}, state, signedIn: true }), /Unavailable/);
});
