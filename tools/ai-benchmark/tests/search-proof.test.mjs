import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSearchParity } from '../search-proof.mjs';
function fixture() {
  const row = { id: 'held-out', seed: 7, result: { status: 'ready', stopped: 'complete', simulations: 8, actionIndex: 1,
    actions: [{ index: 1, visits: 4, value: .1, immediate: 'eligible', tactical: 'horizon' },
      { index: 2, visits: 4, value: .100001, immediate: 'eligible', tactical: 'horizon' }] } };
  return [{ complete: true, modelSha256: 'model', referenceDevice: 'mps', states: [row] },
    { modelVersion: 'model', results: [structuredClone(row)] }];
}
test('ready moves from deadline-censored work cannot establish parity', () => {
  const [reference, actual] = fixture();
  reference.states[0].result.stopped = 'deadline';
  assert.throws(() => compareSearchParity(reference, actual), /deadline-censored/);
});
test('bounded visited ties are distinct from unvisited or materially different choices', () => {
  const [reference, actual] = fixture(); actual.results[0].result.actionIndex = 2;
  assert.equal(compareSearchParity(reference, actual).nearTies, 1);
  reference.states[0].result.actions[1].visits = 0;
  assert.throws(() => compareSearchParity(reference, actual), /unvisited/);
  reference.states[0].result.actions[1].visits = 4;reference.states[0].result.actions[1].value = .3;
  assert.throws(() => compareSearchParity(reference, actual), /numerical bound/);
});
