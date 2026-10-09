import test from 'node:test';
import assert from 'node:assert/strict';
import { BenchmarkWorker, fetchVerifiedAsset, sha256 } from '../client.mjs';

function fixture() {
  const workers = [], timers = new Map(); let next = 0;
  const client = new BenchmarkWorker({ url: 'worker', workerFactory: () => {
    const worker = { terminated: false, postMessage(data) { this.sent = data; }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  }, timers: { setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } } });
  return { client, workers, timers };
}

test('watchdog actually terminates worker and late events cannot affect replacement', async () => {
  const { client, workers, timers } = fixture();
  const promise = client.request({ type: 'initialize' }, 10);
  const rejected = assert.rejects(promise, /watchdog/);
  [...timers.values()][0](); await rejected;
  assert.equal(workers[0].terminated, true);
  const replacement = client.request({ type: 'initialize' }, 10);
  workers[0].onerror();
  workers[0].onmessage({ data: { ...workers[0].sent, type: 'initialized' } });
  assert.equal(workers[1].terminated, false);
  workers[1].onmessage({ data: { ...workers[1].sent, type: 'initialized' } });
  assert.equal((await replacement).type, 'initialized');
});

test('progress does not finish initialization; stale identity rejects and terminates', async () => {
  const { client, workers } = fixture(); let progress = 0;
  const preparing = client.request({ type: 'initialize' }, 30, { onProgress: () => progress++ });
  workers[0].onmessage({ data: { ...workers[0].sent, type: 'progress' } });
  assert.equal(progress, 1); assert.ok(client.pending);
  workers[0].onmessage({ data: { ...workers[0].sent, type: 'initialized' } }); await preparing;
  const computing = client.request({ type: 'compute', metadata: { revision: 1 } }, 10);
  const rejected = assert.rejects(computing, /stale-result/);
  workers[0].onmessage({ data: { ...workers[0].sent, type: 'computed', metadata: { revision: 0 } } });
  await rejected; assert.equal(workers[0].terminated, true);
});

test('verified fetch rejects corrupt and partial assets', async () => {
  const bytes = new Uint8Array([1, 2, 3]), expected = { bytes: 3, sha256: await sha256(bytes) };
  const read = body => ({ fetchImpl: async () => new Response(body) });
  assert.deepEqual(await fetchVerifiedAsset('test', expected, read(bytes)), bytes);
  await assert.rejects(fetchVerifiedAsset('test', expected, read(new Uint8Array([1, 2]))), /Partial/);
  await assert.rejects(fetchVerifiedAsset('test', expected, read(new Uint8Array([1, 2, 4]))), /checksum/);
});

test('no-progress download aborts rather than waiting forever', async () => {
  const expected = { bytes: 1, sha256: 'a'.repeat(64) };
  await assert.rejects(fetchVerifiedAsset('test', expected, { noProgressMs: 5,
    fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }), /aborted/);
});
