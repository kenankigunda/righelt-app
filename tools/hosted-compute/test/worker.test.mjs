import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComputeController } from '../../../apps/compute-controller/index.mjs';
import { Client, InfrastructureError } from '../client.mjs';
import { containedFile } from '../worker.mjs';
import { canonical } from '../policy.mjs';
import { LedgerStorage } from '../storage.mjs';

test('heartbeats and polling preserve an earlier cleanup or launch alarm', async () => {
  let alarm = 1000, writes = 0;
  const actor = new ComputeController({ storage: { getAlarm: async () => alarm, setAlarm: async at => { alarm = at; writes++; } } }, {});
  await actor.arm(60000); assert.equal(alarm, 1000); assert.equal(writes, 0);
  await actor.arm(500); assert.equal(alarm, 500); assert.equal(writes, 1);
});
test('artifact path validation rejects parent symlinks before creating descendants', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, '.ai-runs'));
  await assert.rejects(containedFile(root, '.ai-runs/escape/file.json', { createParents: true }), /symlink/);
  await assert.rejects(fs.stat(path.join(outside, 'escape')), { code: 'ENOENT' });
});
test('controller transport and throttling failures retain infrastructure classification', async () => {
  for (const fetcher of [async () => { throw Error('socket failed'); }, async () => new Response('', { status: 503 }), async () => new Response('', { status: 429 })]) {
    const client = new Client({ id: 'pilot', url: 'https://compute.example', token: 'test', fetcher });
    await assert.rejects(client.json('heartbeat', {}), InfrastructureError);
  }
  const streamClient = new Client({ id: 'pilot', url: 'https://compute.example', token: 'test', fetcher: async () => ({ ok: true, status: 200, json: async () => { throw Error('stream reset'); } }) });
  await assert.rejects(streamClient.json('status'), InfrastructureError);
});
test('canonical inventory hashes survive omission of undefined JSON fields', () => {
  const value = { a: 1, missing: undefined, nested: [undefined, 'data'] };
  assert.equal(canonical(value), canonical(JSON.parse(JSON.stringify(value))));
});
test('large controller ledgers are committed in bounded chunks atomically', async () => {
  const data = new Map(); let max = 0;
  const tx = {
    get: async k => Array.isArray(k) ? new Map(k.filter(x => data.has(x)).map(x => [x, data.get(x)])) : data.get(k),
    put: async values => { for (const [k, v] of Object.entries(values)) { if (v instanceof Uint8Array) max = Math.max(max, v.length); data.set(k, v); } },
    delete: async keys => { for (const key of keys) data.delete(key); },
  };
  const storage = new LedgerStorage({ ...tx, transaction: async fn => fn(tx) });
  const ledger = { objects: 'evidence'.repeat(50000) }; await storage.put('ledger', ledger);
  assert.deepEqual(await storage.get('ledger'), ledger); assert(max <= 48 * 1024);
  await storage.put('ledger', { done: true }); assert.equal(data.size, 2);
});
