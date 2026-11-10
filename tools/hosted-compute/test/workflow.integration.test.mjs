import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fixture } from './helpers.mjs';
import { Client } from '../client.mjs';
import { collect, verifyCollection } from '../cli.mjs';
import { runWorker, publishSnapshot } from '../worker.mjs';
const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));

test('real Worker/DO/R2 and child process complete without an attached submitter, then collect and clear', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'righelt-compute-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await build({ entryPoints: ['apps/compute-controller/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const resources = new Map(); let creates = 0;
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-09',
    durableObjects: { CONTROL: { className: 'ComputeController', useSQLite: true } }, r2Buckets: ['ARTIFACTS'],
    bindings: { ADMIN_TOKEN: 'admin-secret', HETZNER_API_TOKEN: 'provider-test-secret', WORKER_SIGNING_KEY: 'signing-key-'.repeat(4), COMPUTE_ENABLED: 'true', AUTHORIZED_PILOT_CENTS: '10000', CONTROLLER_URL: 'https://compute.example' },
    outboundService: async request => {
      const url = new URL(request.url); assert.equal(url.hostname, 'api.hetzner.cloud');
      if (request.method === 'POST') {
        const body = await request.json(); const resource = { id: ++creates, name: body.name };
        const config = JSON.parse(body.user_data.slice('#cloud-config\n'.length));
        resource.workerEnv = JSON.parse(config.write_files[0].content); resources.set(String(resource.id), resource);
        return Response.json({ server: resource }, { status: 201 });
      }
      const id = url.pathname.split('/').at(-1);
      if (request.method === 'DELETE') { resources.delete(id); return Response.json({ action: { status: 'success' } }); }
      if (url.pathname.endsWith('/servers')) return Response.json({ servers: [...resources.values()], meta: { pagination: { next_page: null } } });
      const resource = resources.get(id);
      return resource ? Response.json({ server: resource }) : new Response(null, { status: 404 });
    },
  });
  t.after(() => mf.dispose());
  const fetcher = (url, options) => mf.dispatchFetch(url, options);
  const admin = new Client({ url: 'https://compute.example', token: 'admin-secret', id: 'pilot', fetcher });
  const f = await fixture(), manifest = f.manifest;
  manifest.deadline = Date.now() + 3600000; manifest.phases[0].host.quoteExpires = Date.now() + 3600000;
  const script = `console.log('worker diagnostic log'); const fs=require('node:fs'); const crypto=require('node:crypto'); const p='.ai-runs/pilot/run'; fs.mkdirSync(p,{recursive:true}); const cp=Buffer.from('new-trained-state');fs.writeFileSync(p+'/trained.pt',cp);fs.writeFileSync(p+'/latest.json',JSON.stringify({checkpoint:process.cwd()+'/'+p+'/trained.pt',sha256:crypto.createHash('sha256').update(cp).digest('hex')}));fs.writeFileSync(p+'/proof.json',JSON.stringify({passed:true}));`;
  manifest.phases[0].argv = [process.execPath, '-e', script]; manifest.phases[0].resumeArgv = manifest.phases[0].argv;
  await fs.writeFile(path.join(root, '.compute-source.json'), JSON.stringify({ sourceRevision: manifest.sourceRevision, dependencySha256: manifest.dependencySha256 }));
  await admin.request('manifest', 'PUT', manifest); await admin.upload(f.cp); await admin.upload(f.corpus); await admin.upload(f.recipe);
  await admin.json('start', {});
  // The remaining calls stand in for durable wake-ups, not a Mac process loop.
  await new Client({ url: 'https://compute.example', id: 'controller', token: 'admin-secret', fetcher }).json('reconcile', {});
  assert.equal(creates, 1, JSON.stringify(await admin.json('status')));
  const env = [...resources.values()][0].workerEnv;
  const worker = new Client({ url: env.COMPUTE_URL, token: env.COMPUTE_WORKER_TOKEN, id: env.COMPUTE_ID, generation: Number(env.COMPUTE_GENERATION), fetcher });
  const result = await runWorker({ env: { ...process.env, ...env }, root, client: worker, cleanup: async () => {}, snapshotter: publishSnapshot });
  assert.equal(result.kind, 'complete', JSON.stringify(result));
  const logged = (await admin.json('logs')).latestLog; assert(logged);
  assert.match(new TextDecoder().decode(await admin.download(logged)), /worker diagnostic log/);
  const reconciler = new Client({ url: 'https://compute.example', id: 'controller', token: 'admin-secret', fetcher });
  await reconciler.json('reconcile', {}); await reconciler.json('reconcile', {});
  assert.equal(resources.size, 0); assert.equal((await admin.json('status')).status, 'complete');
  const out = path.join(root, 'collected'); await collect(admin, out);
  const receipt = await verifyCollection(out); await admin.json('clear', receipt);
  assert.equal((await admin.json('status')).status, 'cleared');
  await assert.rejects(worker.json('heartbeat', {}), /rejected/);
  await assert.rejects(admin.download({ sha256: f.inputs[0].sha256, bytes: f.cp.length }), /rejected/);
});
