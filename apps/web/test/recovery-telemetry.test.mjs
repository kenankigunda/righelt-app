import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryTelemetry, RECOVERY_TELEMETRY_LIMITS } from '../shell/recovery-telemetry.js';
import { validateRecoveryDiagnosticBatch, RECOVERY_DIAGNOSTICS } from '../../../packages/shared-types/src/recovery-diagnostics.js';

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const fixture = (options = {}) => {
  let at = 1000, id = 0;
  const jobs = new Map(), calls = [];
  const telemetry = createRecoveryTelemetry({ clock: () => at,
    budget: { windowStarted: null, batches: 0 },
    schedule: (job, delay) => { jobs.set(++id, { job, delay }); return id; }, cancel: key => jobs.delete(key),
    environment: () => ({ online: true, visibility: 'visible', observedDeploymentSha: 'a'.repeat(40), loadedBuild: 'unavailable', identityId: 'secret' }),
    fetcher: async (path, init) => { calls.push({ path, init }); return new Response(null, { status: 202 }); }, ...options });
  return { telemetry, jobs, calls, advance: ms => { at += ms; },
    run: delay => { const entry = [...jobs].find(([, value]) => value.delay === delay); assert.ok(entry, `missing timer ${delay}`); jobs.delete(entry[0]); entry[1].job(); } };
};
const event = { type: 'recovery_blocked', gameId: `game-${'1'.repeat(36)}`, reason: 'behind_server', pendingCount: 0 };

test('uploads only validated scalar evidence with credentials omitted and no mutation headers', async () => {
  const f = fixture();
  f.telemetry.record({ ...event, identityId: 'secret', cookie: 'secret', authContextId: 'secret',
    authoritativeState: { private: 'secret' }, action: { private: 'secret' }, gameLink: 'https://secret',
    reason: 'secret error', requestId: 'secret' });
  await f.telemetry.flush();
  assert.equal(f.calls.length, 1);
  const { path, init } = f.calls[0], body = JSON.parse(init.body);
  assert.equal(path, RECOVERY_DIAGNOSTICS.path);
  assert.equal(validateRecoveryDiagnosticBatch(body), true);
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, { 'content-type': 'application/json' });
  assert.equal(body.events[0].reason, 'unknown');
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(body.events[0].observedDeploymentSha, 'a'.repeat(40));
  assert.equal(body.events[0].loadedBuild, 'unavailable');
});

test('event bursts retain a bounded queue and explicitly report dropped history', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.telemetry.record({ ...event, retry: i });
  assert.equal(f.jobs.size, 1);
  await f.telemetry.flush();
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.events.length, RECOVERY_DIAGNOSTICS.maximumEvents);
  assert.equal(body.events[0].retry, 36); assert.equal(body.events[0].droppedEvents, 36);
  assert.equal(body.events[0].truncated, true);
  assert.ok(new TextEncoder().encode(f.calls[0].init.body).length <= RECOVERY_DIAGNOSTICS.maximumBytes);
  f.telemetry.retire(); assert.equal(f.jobs.size, 0);
});

test('rejected or throwing uploads are dropped without retrying the same event', async () => {
  for (const fetcher of [() => { throw Error('offline'); }, async () => new Response(null, { status: 503 })]) {
    const sent = [];
    const f = fixture({ fetcher: (...args) => { sent.push(args); return fetcher(...args); } });
    f.telemetry.record(event); await assert.doesNotReject(f.telemetry.flush());
    await f.telemetry.flush(); assert.equal(sent.length, 1); assert.equal(f.jobs.size, 0);
  }
});

test('an ignored abort still releases diagnostic ownership at its deadline', async () => {
  let init, calls = 0;
  const f = fixture({ fetcher: (_path, options) => { calls++; init = options; return new Promise(() => {}); } });
  f.telemetry.record(event); const pending = f.telemetry.flush(); await tick();
  await f.telemetry.flush(); assert.equal(calls, 1, 'inflight flushes coalesce');
  f.run(RECOVERY_TELEMETRY_LIMITS.requestMs); await pending;
  assert.equal(init.signal.aborted, true); assert.equal(f.jobs.size, 0);
  f.telemetry.retire();
});

test('retirement releases a stuck flush, aborts its request and discards queued evidence', async () => {
  let signal;
  const f = fixture({ fetcher: (_path, options) => { signal = options.signal; return new Promise(() => {}); } });
  f.telemetry.record(event); const pending = f.telemetry.flush(); await tick();
  f.telemetry.record(event); f.telemetry.retire(); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.jobs.size, 0);
  f.telemetry.record(event); await f.telemetry.flush(); assert.equal(f.jobs.size, 0);
});

test('retirement before fetch dispatch sends no old-scope report', async () => {
  const f = fixture(); f.telemetry.record(event);
  const pending = f.telemetry.flush(); f.telemetry.retire(); await pending;
  assert.equal(f.calls.length, 0);
});

test('upload rate is bounded across invented episodes and backwards clocks do not replenish it', async () => {
  const f = fixture();
  for (let i = 0; i < RECOVERY_TELEMETRY_LIMITS.batchesPerHour + 2; i++) {
    f.telemetry.record({ ...event, episodeId: crypto.randomUUID() }); await f.telemetry.flush();
  }
  assert.equal(f.calls.length, RECOVERY_TELEMETRY_LIMITS.batchesPerHour);
  f.advance(-1_000); f.telemetry.record(event); await f.telemetry.flush();
  assert.equal(f.calls.length, RECOVERY_TELEMETRY_LIMITS.batchesPerHour);
  f.advance(RECOVERY_TELEMETRY_LIMITS.windowMs + 1_000); f.telemetry.record(event); await f.telemetry.flush();
  assert.equal(f.calls.length, RECOVERY_TELEMETRY_LIMITS.batchesPerHour + 1);
});

test('hostile diagnostic getters and unavailable environment never escape to gameplay', async () => {
  const f = fixture();
  assert.doesNotThrow(() => f.telemetry.record({ get type() { throw Error('hostile'); } }));
  assert.doesNotThrow(() => fixture({ environment: () => { throw Error('unavailable'); } }).telemetry.record(event));
  await f.telemetry.flush(); assert.equal(f.calls.length, 0);
});

test('replacing an uploader cannot replenish the shared page upload allowance', async () => {
  const budget = { windowStarted: null, batches: 0 };
  const first = fixture({ budget });
  for (let i = 0; i < RECOVERY_TELEMETRY_LIMITS.batchesPerHour; i++) {
    first.telemetry.record(event); await first.telemetry.flush();
  }
  first.telemetry.retire();
  const replacement = fixture({ budget }); replacement.telemetry.record(event); await replacement.telemetry.flush();
  assert.equal(replacement.calls.length, 0);
});
