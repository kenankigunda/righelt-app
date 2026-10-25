import assert from 'node:assert/strict';
import test from 'node:test';
import { readProjectedGame, waitForComputerDecision } from '../../../e2e/support/computer-projection.mjs';

const expectedComputer = { modelId: 'initial-1554', profile: 'horus' };
function fixture(t, { sessionStatus = 200, session = { contextId: 'account-context' }, projectionStatus = 200, game = { id: 'game-1', moves: [] } } = {}) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return url === '/api/auth/session'
      ? new Response(JSON.stringify(session), { status: sessionStatus })
      : new Response(JSON.stringify({ game }), { status: projectionStatus });
  });
  return { requests, game };
}

test('computer evidence is read from the requested authenticated server projection', async t => {
  const { requests, game } = fixture(t, { game: { id: 'game-1', moves: [{ moveId: 'accepted-1', computerProof: expectedComputer }] } });
  assert.deepEqual(await readProjectedGame({ id: 'game-1', expectedComputer }), game);
  assert.deepEqual(requests, [
    { url: '/api/auth/session', options: undefined },
    { url: '/api/shell/games/game-1', options: { headers: { 'X-Righelt-Auth-Version': '2', 'X-Righelt-Session': 'account-context' } } },
  ]);
});

for (const proof of [null, { modelId: 'old-model', profile: 'horus' }, { modelId: 'initial-1554', profile: 'tau' }]) {
  test(`missing or mismatched accepted computer evidence remains pending: ${JSON.stringify(proof)}`, async t => {
    const { game } = fixture(t, { game: { id: 'game-1', moves: proof ? [{ computerProof: proof }] : [] } });
    assert.equal(await readProjectedGame({ id: 'game-1', expectedComputer }), false);
    assert.deepEqual(await readProjectedGame({ id: 'game-1' }), game);
  });
}

for (const [options, message] of [
  [{ sessionStatus: 503 }, /Session failed: 503/],
  [{ session: {} }, /Session context missing/],
  [{ projectionStatus: 503 }, /Projection failed: 503/],
  [{ game: { id: 'another-game', moves: [{ computerProof: expectedComputer }] } }, /requested game history/],
  [{ game: { id: 'game-1' } }, /requested game history/],
]) {
  test(`invalid authoritative evidence fails without treating it as pending: ${JSON.stringify(options)}`, async t => {
    const { requests } = fixture(t, options);
    await assert.rejects(readProjectedGame({ id: 'game-1', expectedComputer }), message);
    assert.equal(requests.length, options.sessionStatus || options.session ? 1 : 2);
  });
}

test('an observation waits for matching server evidence with sequential reads and no mutation', async t => {
  const games = [
    { id: 'game-1', moves: [] },
    { id: 'game-1', moves: [{ computerProof: { ...expectedComputer, profile: 'tau' } }] },
    { id: 'game-1', moves: [{ moveId: 'accepted-1', computerProof: expectedComputer }] },
  ];
  let requests = 0, inFlight = 0, peakInFlight = 0, pauses = 0;
  const savedDocument = globalThis.document;
  globalThis.document = { querySelector: () => null };
  t.after(() => { if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument; });
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { assert.equal(ms, 1000); pauses++; queueMicrotask(callback); });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options?.method, undefined);
    requests++; inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
    await Promise.resolve();
    inFlight--;
    return new Response(JSON.stringify(url === '/api/auth/session' ? { contextId: 'account-context' } : { game: games.shift() }));
  });
  const result = await readProjectedGame({ id: 'game-1', expectedComputer, wait: true });
  assert.equal(result.moves[0].moveId, 'accepted-1');
  assert.equal(requests, 6); assert.equal(peakInFlight, 1); assert.equal(pauses, 2);
});

test('recovery stops an unfinished observation without retrying the computer', async t => {
  const { requests } = fixture(t);
  const savedDocument = globalThis.document;
  globalThis.document = { querySelector: () => ({ getAttribute: () => 'game-1', querySelector: () => ({}) }) };
  t.after(() => { if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument; });
  await assert.rejects(readProjectedGame({ id: 'game-1', expectedComputer, wait: true }), /Computer entered recovery/);
  assert.equal(requests.length, 2);
});

test('guest projection uses the persisted guest identity without an account request',async t=>{
 const saved=globalThis.window;globalThis.window={localStorage:{getItem:key=>{assert.equal(key,'righelt.identity.id.v1');return 'guest id';}}};
 t.after(()=>{if(saved===undefined)delete globalThis.window;else globalThis.window=saved;});
 const {requests,game}=fixture(t);
 assert.deepEqual(await readProjectedGame({id:'game-1',guest:true}),game);
 assert.deepEqual(requests,[{url:'/api/shell/games/game-1?identityId=guest%20id',options:{headers:{}}}]);
});

for (const modelId of ['initial-1554', 'production-20261025-99']) test(`observation helper binds explicit model identity ${modelId}`, async () => {
 let observed;
 const page={evaluate:async(fn,options)=>{assert.equal(fn,readProjectedGame);observed=options;return 'accepted';}};
 assert.equal(await waitForComputerDecision(page,'game-1','horus',{modelId}), 'accepted');
 assert.deepEqual(observed,{id:'game-1',guest:false,expectedComputer:{modelId,profile:'horus'},wait:true});
});
test('observation helper rejects missing model identity before browser execution', async () => {
 await assert.rejects(waitForComputerDecision({evaluate:()=>{throw Error('must not run');}},'game-1','horus'),/Expected computer model identity required/);
});
