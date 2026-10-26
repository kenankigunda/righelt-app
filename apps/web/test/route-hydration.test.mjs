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

test('only the current hydration flight can publish after navigating away and back to the same route', async () => {
  const hydrate=createRouteHydration(), owner={};
  let firstActive, releaseFirst;
  const key={generation:1,hash:'#/invite/a',owner};
  const first=hydrate(key, isActive=>{firstActive=isActive;return new Promise(resolve=>{releaseFirst=resolve;});});
  await Promise.resolve();assert.equal(firstActive(),true);
  await hydrate({...key,hash:'#/invite/b'},async isActive=>assert.equal(isActive(),true));
  assert.equal(firstActive(),false);
  const current=hydrate(key,async isActive=>{assert.equal(isActive(),true);assert.equal(firstActive(),false);return 'new-a';});
  assert.equal(await current,'new-a');releaseFirst('old-a');assert.equal(await first,'old-a');assert.equal(firstActive(),false);
});


test('observing a cached route invalidates a pending flight without starting another read',async()=>{
  const hydrate=createRouteHydration(),owner={};let active,release;
  const firstKey={generation:1,hash:'#/invite/a',owner};
  const first=hydrate(firstKey,isActive=>{active=isActive;return new Promise(resolve=>{release=resolve;});});
  await Promise.resolve();const oldEpoch=hydrate.currentEpoch();
  hydrate.observe({...firstKey,hash:'#/game/cached'});assert.equal(active(),false);assert.notEqual(hydrate.currentEpoch(),oldEpoch);
  const fresh=hydrate(firstKey,async()=> 'fresh');assert.notEqual(fresh,first);assert.equal(await fresh,'fresh');release();await first;
});

test('utility-only URLs share the canonical flight while stale captured epochs cannot retire current work',async()=>{
  const hydrate=createRouteHydration(),owner={};let release;
  const key={generation:1,hash:'#/invite/a',routeKey:'#/invite/a',owner};key.epoch=hydrate.observe(key);
  const first=hydrate(key,()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
  assert.equal(hydrate({...key,hash:'#/invite/a?scenarios=1'},()=>assert.fail('duplicate lookup')),first);
  const next={...key,routeKey:'#/invite/b'};next.epoch=hydrate.observe(next);
  const second=hydrate(next,async()=> 'b');await assert.rejects(hydrate(key,()=>assert.fail('stale lookup')),/session_changed/);
  assert.equal(await second,'b');release();await first;
});
