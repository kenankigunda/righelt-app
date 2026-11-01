import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSyncClient } from '../shell/sync-store.js';
import { socketEnvironment } from './support/socket-environment.mjs';

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const snapshot = gameId => ({
  protocolVersion: 2, gameId, type: 'state_sync', eventSeq: 1,
  game: { id: gameId, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    gameplayRevision: 0, board: { state: { sideToMove: 'P1', turnIndex: 0, pieces: [] } }, moves: [], turns: [] },
});

const heldPoll = async (t, options = {}) => {
  const env = socketEnvironment(t), recoveries = [], errors = [], metrics = [];
  let reads = 0, rejectPoll, resolvePoll, ready = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = env.own(createLiveSyncClient({
    identityId: 'recovery-owner-test', getLastEventSeq: () => 1,
    reconnectBaseMs: 1, reconnectMaxMs: 1, degradedPollMs: 10,
    onEvent: () => true,
    onRecovery: event => recoveries.push(event), onError: error => errors.push(error),
    onMetric: metric => metrics.push(metric),
    onReady: async context => { ready++; return options.onReady?.(context); },
    onReconcile: async () => {
      if (++reads === 2) await new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject; });
      else await options.onReconcile?.(reads);
    },
  }));
  client.connectGame('g'); env.sockets[0].close(); await settle();
  t.mock.timers.tick(1); await settle();
  env.sockets[1].close(); await settle();
  t.mock.timers.tick(10); await settle();
  assert.equal(reads, 2, 'hold the degraded HTTP poll after the first successful recovery');
  const replacement = env.sockets.at(-1);
  return { ...env, client, recoveries, errors, metrics, replacement,
    rejectPoll: () => rejectPoll(new Error('old HTTP request failed')), resolvePoll: () => resolvePoll(),
    ready: () => ready,
    receive: () => { replacement.emit('open'); replacement.emit('message', { data: JSON.stringify(snapshot('g')) }); },
  };
};

test('a failed old HTTP poll cannot reopen recovery after a replacement socket restores authority', async t => {
  const f = await heldPoll(t); f.receive(); await settle(); assert.equal(f.ready(), 1);
  const count = f.recoveries.length;
  f.rejectPoll(); await settle();
  assert.equal(f.recoveries.length, count, 'a healthy authoritative socket must not be blocked by its obsolete fallback');
  assert.equal(f.errors.length, 0, 'obsolete fallback errors must not become current recovery failures');
  assert.equal(f.replacement.readyState, 1);
});

test('a successful old HTTP poll cannot reclaim recovery after socket readiness', async t => {
  const f = await heldPoll(t); f.receive(); await settle();
  const count = f.metrics.filter(metric => metric.type === 'recovery_reconciled').length;
  f.resolvePoll(); await settle();
  assert.equal(f.metrics.filter(metric => metric.type === 'recovery_reconciled').length, count);
  assert.equal(f.errors.length, 0);
});

test('incomplete socket readiness keeps the existing HTTP recovery owner', async t => {
  const f = await heldPoll(t, { onReady: async () => false });
  f.receive(); await settle(); f.rejectPoll(); await settle();
  assert.equal(f.recoveries.at(-1).reason, 'reconciliation_failed');
  assert.equal(f.errors.at(-1).message, 'old HTTP request failed');
});

test('rejected readiness starts a current foreground repair instead of accepting socket authority', async t => {
  let rejectCurrent;
  const f = await heldPoll(t, {
    onReady: async () => { throw new Error('pending command could not be reconciled'); },
    onReconcile: count => count === 3 ? new Promise((_, reject) => { rejectCurrent = reject; }) : undefined,
  });
  f.receive(); await settle();
  assert.equal(f.recoveries.at(-1).reason, 'reconciliation_failed');
  assert.equal(f.recoveries.at(-1).background, false);
  f.rejectPoll(); await settle(); assert.equal(f.errors.length, 0);
  rejectCurrent(new Error('required current reconciliation failed')); await settle();
  assert.equal(f.errors.at(-1).message, 'required current reconciliation failed');
});

test('late readiness cannot retire the repair that owns a subsequently disconnected socket', async t => {
  let finishReady, rejectCurrent;
  const f = await heldPoll(t, {
    onReady: () => new Promise(resolve => { finishReady = resolve; }),
    onReconcile: count => count === 3 ? new Promise((_, reject) => { rejectCurrent = reject; }) : undefined,
  });
  f.receive(); await settle(); f.replacement.close(); await settle();
  finishReady(); await settle(); f.rejectPoll(); await settle();
  assert.equal(f.errors.length, 0, 'the old poll already lost ownership to the disconnect repair');
  rejectCurrent(new Error('current HTTP request failed')); await settle();
  assert.equal(f.errors.at(-1).message, 'current HTTP request failed', 'late readiness must preserve the newer repair');
});

test('the synchronous readiness commit retires its captured repair at most once', async t => {
  const results = [];
  const f = await heldPoll(t, { onReady: async ({ retirePreviousRepair }) => {
    results.push(retirePreviousRepair(), retirePreviousRepair());
  } });
  f.receive(); await settle(); f.rejectPoll(); await settle();
  assert.deepEqual(results, [true, false]);
  assert.equal(f.errors.length, 0);
});

for (const outcome of ['success', 'failure']) {
  test(`a poll that settles with ${outcome} during readiness does not strand the healthy socket`, async t => {
    let finishReady, commit, accepted;
    const f = await heldPoll(t, { onReady: ({ retirePreviousRepair }) => {
      commit = retirePreviousRepair;
      return new Promise(resolve => { finishReady = resolve; });
    } });
    f.receive(); await settle();
    if (outcome === 'success') f.resolvePoll(); else f.rejectPoll();
    await settle();
    accepted = commit(); finishReady(accepted); await settle();
    assert.equal(accepted, true, 'settlement without a newer owner still permits the current socket to complete readiness');
    assert.equal(f.replacement.readyState, 1);
  });
}
