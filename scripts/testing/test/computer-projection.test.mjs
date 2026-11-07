import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readProjectedGame, waitForComputerDecision, waitForOpponentReady } from '../../../e2e/support/computer-projection.mjs';

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

for (const modelId of ['initial-1554', 'test-next-model']) test(`observation helper binds explicit model identity ${modelId}`, async () => {
 let observed;
 const page={evaluate:async(fn,options)=>{assert.equal(fn,readProjectedGame);observed=options;return 'accepted';}};
 assert.equal(await waitForComputerDecision(page,'game-1','horus',{modelId}), 'accepted');
 assert.deepEqual(observed,{id:'game-1',guest:false,expectedComputer:{modelId,profile:'horus'},wait:true});
});
test('observation helper rejects missing model identity before browser execution', async () => {
 await assert.rejects(waitForComputerDecision({evaluate:()=>{throw Error('must not run');}},'game-1','horus'),/Expected computer model identity required/);
});

// Run the actual exported browser callback with isolated DOM and monotonic clock.
// No host sleeps, actions, requests, or global clock/document replacement.
function preparationFixture(states, {stepMs = 100} = {}) {
  const observed = {now: 0, queries: 0, pauses: 0, evaluations: 0, options: null};
  const page = {evaluate(callback, options) {
    observed.evaluations++;
    observed.options = options;
    return runInNewContext(`(${callback.toString()})(options)`, {
      options,
      performance: {now: () => observed.now},
      document: {querySelector(selector) {
        assert.equal(selector, 'dialog[open].opponent-story-modal');
        const state = states[Math.min(observed.queries++, states.length - 1)];
        if (!state) return null;
        return {querySelector(selector) {
          if (selector === '[data-story-play]') return state.missingPlay ? null : {disabled: !state.ready};
          if (selector === '[data-story-readiness]') return {textContent: state.message ?? 'Preparing'};
          if (selector === '[data-story-retry]') return {hidden: !state.retry};
          assert.fail(`Unexpected leaf read: ${selector}`);
        }};
      }},
      setTimeout(resolve, ms) {
        assert.equal(ms, 100);
        observed.pauses++;
        observed.now += stepMs;
        queueMicrotask(resolve);
      },
    });
  }};
  return {page, observed};
}

test('opponent readiness waits for its first actual open within the original allowance', async () => {
  const {page, observed} = preparationFixture([null, null, {ready: true}]);
  const receipt = await waitForOpponentReady(page);
  assert.equal(receipt.elapsedMs, 200);
  assert.equal(observed.evaluations, 1);
  assert.equal(observed.options.timeoutMs, 45_000);
  assert.equal(observed.queries, 3);
  assert.equal(observed.pauses, 2);
});

test('first opening does not restart the original bounded clock', async () => {
  const {page, observed} = preparationFixture([null, null, {}]);
  await assert.rejects(waitForOpponentReady(page, {timeoutMs: 300}), /exceeded its bounded workflow allowance/);
  assert.equal(observed.now, 300);
  assert.equal(observed.queries, 3);
});

test('a dialog never opened consumes only the original default allowance', async () => {
  const {page, observed} = preparationFixture([null]);
  await assert.rejects(waitForOpponentReady(page), /exceeded its bounded workflow allowance/);
  assert.equal(observed.now, 45_000);
  assert.equal(observed.queries, 450);
  assert.equal(observed.pauses, 450);
  assert.equal(observed.evaluations, 1);
});

test('closure after observed opening fails immediately without awaiting a reopen', async () => {
  const {page, observed} = preparationFixture([{}, null, {ready: true}]);
  await assert.rejects(waitForOpponentReady(page), /dialog closed before readiness/);
  assert.equal(observed.now, 100);
  assert.equal(observed.queries, 2);
  assert.equal(observed.pauses, 1);
});

test('missing and disabled Play remain pending until actual readiness', async () => {
  const {page, observed} = preparationFixture([{missingPlay: true}, {}, {ready: true}]);
  assert.equal((await waitForOpponentReady(page)).elapsedMs, 200);
  assert.equal(observed.queries, 3);
});

for (const state of [{retry: true}, {message: 'Unsupported model'}, {message: 'Could not prepare'}]) {
  test(`terminal preparation still fails immediately: ${JSON.stringify(state)}`, async () => {
    const {page, observed} = preparationFixture([state, {ready: true}]);
    await assert.rejects(waitForOpponentReady(page), /Opponent preparation failed/);
    assert.equal(observed.pauses, 0);
    assert.equal(observed.queries, 1);
  });
}

for (const message of ['11 of 10 bytes', '0 of 0 bytes']) {
  test(`invalid byte progress remains fatal: ${message}`, async () => {
    const {page, observed} = preparationFixture([{message}]);
    await assert.rejects(waitForOpponentReady(page), /Invalid preparation byte progress/);
    assert.equal(observed.pauses, 0);
  });
}

test('same-total progress regression remains fatal', async () => {
  const {page, observed} = preparationFixture([{message: '10 of 100 bytes'}, {message: '9 of 100 bytes', ready: true}]);
  await assert.rejects(waitForOpponentReady(page), /progress moved backwards/);
  assert.equal(observed.queries, 2);
});

test('changed-total progress retains its original sampling semantics', async () => {
  const {page} = preparationFixture([{message: '10 of 100 bytes'}, {message: '5 of 200 bytes', ready: true}]);
  const receipt = await waitForOpponentReady(page);
  assert.equal(receipt.byteSamples, 2);
  assert.equal(receipt.lastBytes.received, 5);
  assert.equal(receipt.lastBytes.total, 200);
});

test('first-open latency still requires original slow-preparation detail', async () => {
  const {page, observed} = preparationFixture([null, {ready: true, message: 'Ready'}], {stepMs: 6000});
  await assert.rejects(waitForOpponentReady(page), /Slow opponent preparation did not expose detailed progress/);
  assert.equal(observed.now, 6000);
});

test('actual slow-preparation detail remains sufficient after delayed opening', async () => {
  const {page} = preparationFixture([null, {ready: true, message: 'Getting ready to play 6s'}], {stepMs: 6000});
  const receipt = await waitForOpponentReady(page);
  assert.equal(receipt.elapsedMs, 6000);
  assert.equal(receipt.detailed, true);
});

test('already-ready open dialog has no added wait', async () => {
  const {page, observed} = preparationFixture([{ready: true}]);
  assert.equal((await waitForOpponentReady(page)).elapsedMs, 0);
  assert.equal(observed.pauses, 0);
});
