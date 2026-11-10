import test from 'node:test';
import assert from 'node:assert/strict';
import { Providers } from '../providers.mjs';
import { fixture } from './helpers.mjs';

test('Runpod uses API v2, digest-pinned image and one noninterruptible CPU-rich GPU', async () => {
  const calls = [], provider = new Providers({ RUNPOD_API_KEY: 'private' }, async (url, options) => {
    calls.push({ url, ...options }); return Response.json({ id: 'pod', name: 'owned' }, { status: 201 });
  });
  const { manifest } = await fixture();
  await provider.create({ ...manifest.phases[0].host, provider: 'runpod', gpu: 'NVIDIA GeForce RTX 3090', minRamGb: 64, minVcpu: 16 }, 'owned', { COMPUTE_ID: 'pilot' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.runpod.io/v2/pods');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.gpu.count, 1); assert.equal(body.gpu.minVcpuCountPerGpu, 16);
  assert.equal(body.cloud, 'SECURE'); assert.equal(body.interruptible, undefined); assert.deepEqual(body.ports, []);
});
test('Hetzner bootstrap uses valid JSON cloud-config and keeps worker secrets out of shell code', async () => {
  let body;
  const p = new Providers({ HETZNER_API_TOKEN: 'private' }, async (_url, options) => { body = JSON.parse(options.body); return Response.json({ server: { id: 1, name: 'owned' } }); });
  const f = await fixture(); await p.create(f.manifest.phases[0].host, 'owned', { COMPUTE_WORKER_TOKEN: 'sensitive-123' });
  const config = JSON.parse(body.user_data.slice('#cloud-config\n'.length));
  assert.equal(config.write_files[0].permissions, '0600');
  assert.equal(config.write_files[0].content, '{"COMPUTE_WORKER_TOKEN":"sensitive-123"}');
  assert(!JSON.stringify(config.runcmd).includes('sensitive-123'));
  assert(!config.runcmd.flat().includes('sh')); assert.equal(body.server_type, 'ccx23');
});
test('inventory follows every opaque cursor and deletion requires matching ownership', async () => {
  const calls = [];
  const p = new Providers({ RUNPOD_API_KEY: 'private' }, async (url, options) => {
    calls.push(url);
    if (url.endsWith('limit=100')) return Response.json({ pods: [{ id: 'other', name: 'unrelated' }], pagination: { hasNextPage: true, nextCursor: 'opaque/+=' } });
    if (url.includes('cursor=')) return Response.json({ pods: [{ id: 'wanted', name: 'owned' }], pagination: { hasNextPage: false, nextCursor: null } });
    return Response.json({ id: 'wanted', name: 'unrelated' });
  });
  assert.deepEqual(await p.find('runpod', 'owned'), [{ id: 'wanted', name: 'owned' }]);
  assert(calls[1].includes('opaque%2F%2B%3D'));
  await assert.rejects(p.remove('runpod', 'wanted', 'owned'), /unrelated/);
});
test('provider errors redact response bodies and never repeat create calls', async () => {
  let calls = 0; const p = new Providers({ RUNPOD_API_KEY: 'private' }, async () => { calls++; return new Response('secret echoed by provider', { status: 500 }); });
  await assert.rejects(p.request('runpod', '/pods', 'POST', {}), e => !e.message.includes('secret') && /500/.test(e.message));
  assert.equal(calls, 1);
});
