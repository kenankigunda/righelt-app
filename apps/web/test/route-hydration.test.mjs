import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHydration } from '../shell/route-hydration.js';

test('same route and authority share one pending read; failures remain retryable', async () => {
  let calls = 0, reject;
  const owner = {};
  const hydrate = createRouteHydration();
  const read = () => { calls++; return new Promise((_, fail) => { reject = fail; }); };
  const first = hydrate({ generation: 1, hash: '#/', owner }, read);
  const second = hydrate({ generation: 1, hash: '#/', owner }, read);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error('offline'));
  await assert.rejects(first, /offline/);
  assert.equal(await hydrate({ generation: 1, hash: '#/', owner }, async () => 'fresh'), 'fresh');
});

test('new generation, route, and transport never reuse old authority reads', async () => {
  const hydrate = createRouteHydration();
  const owner = {};
  const held = hydrate({ generation: 1, hash: '#/', owner }, () => new Promise(() => {}));
  for (const key of [{ generation: 2, hash: '#/', owner }, { generation: 1, hash: '#/game/a', owner }, { generation: 1, hash: '#/', owner: {} }]) {
    const current = hydrate(key, async () => 'current');
    assert.notEqual(current, held);
    assert.equal(await current, 'current');
  }
});
