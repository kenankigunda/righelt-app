import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fixture } from './helpers.mjs';
import { runWorker } from '../worker.mjs';
import { canonical, encode, sha256 } from '../policy.mjs';

test('a failed subprocess retains diagnostic logs before its host is deleted', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-failed-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const f = await fixture();
  f.manifest.phases[0].argv = [process.execPath, '-e', "console.error('specific trainer failure');process.exit(1)"];
  await f.launch();
  await fs.writeFile(path.join(root, '.compute-source.json'), JSON.stringify({ sourceRevision: f.manifest.sourceRevision, dependencySha256: f.manifest.dependencySha256 }));
  const client = {
    json: async (action, body) => {
      if (action === 'work') return f.core.work('pilot', 1);
      if (action === 'heartbeat') return f.core.heartbeat('pilot', 1, body);
      if (action === 'progress') return f.core.progress('pilot', 1, body);
      if (action === 'finish') return f.core.finish('pilot', 1, body);
      throw Error('unexpected action');
    },
    upload: async raw => {
      const hash = await sha256(raw); return f.core.putObject('pilot', { name: hash, sha256: hash, bytes: raw.length }, raw, 1);
    },
    download: async a => new Uint8Array(await (await f.bucket.get(`pilot/${a.sha256}`)).arrayBuffer()),
  };
  const result = await runWorker({ env: process.env, root, client, clock: f.now, cleanup: async () => {} });
  assert.equal(result.kind, 'correctness');
  await f.core.reconcile(); await f.core.reconcile();
  assert.equal(f.providers.resources.size, 0);
  const inventory = await f.core.inventory('pilot');
  assert.equal(inventory.status.status, 'failed');
  assert.match(new TextDecoder().decode(await client.download(inventory.status.latestLog)), /specific trainer failure/);
  assert(inventory.files.some(a => a.path.endsWith('.log')));
  await f.core.clear('pilot', { verified: true, manifestSha256: inventory.manifestSha256, inventorySha256: await sha256(encode(canonical(inventory))) });
  assert.equal((await f.state()).latestLog, null);
});
