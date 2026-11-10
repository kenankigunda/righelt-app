import { Controller } from '../controller.mjs';
import { sha256, encode } from '../policy.mjs';
export class MemoryStorage {
  data = new Map();
  async get(k) { return structuredClone(this.data.get(k)); }
  async put(k, v) { this.data.set(k, structuredClone(v)); }
}
export class MemoryBucket {
  data = new Map();
  async put(k, v) { this.data.set(k, new Uint8Array(v)); }
  async get(k) { const bytes = this.data.get(k); return bytes ? { body: bytes, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null; }
  async delete(k) { this.data.delete(k); }
  async list({ prefix }) { return { objects: [...this.data].filter(([k]) => k.startsWith(prefix)).map(([key]) => ({ key })), truncated: false }; }
}
export class FakeProviders {
  resources = new Map(); creates = 0; failDelete = false; failList = false; uncertainCreate = false;
  async create(host, name, env) {
    this.creates++; const record = { id: String(this.creates), name, host, env }; this.resources.set(record.id, record);
    if (this.uncertainCreate) throw Error('lost response'); return record;
  }
  async find(provider, name) { if (this.failList) throw Error('outage'); return [...this.resources.values()].filter(x => x.name === name && x.host.provider === provider); }
  async remove(_provider, id, name) { if (this.failDelete) throw Error('outage'); if (this.resources.get(id)?.name !== name) throw Error('unrelated'); this.resources.delete(id); }
}
export async function fixture(overrides = {}) {
  let time = Date.UTC(2026, 10, 10);
  const storage = new MemoryStorage(), bucket = new MemoryBucket(), providers = new FakeProviders();
  const config = { enabled: true, authorizedCents: 10000, url: 'https://compute.example' };
  const controller = () => new Controller({ storage, bucket, providers, config, now: () => time, token: async () => 'private-worker-token' });
  const core = controller();
  const cp = encode('checkpoint'), corpus = encode('corpus'), recipe = encode('{"id":"baseline-v1"}');
  const inputs = [
    { name: 'checkpoint.pt', path: '.ai-runs/pilot/checkpoint.pt', sha256: await sha256(cp), bytes: cp.length },
    { name: 'corpus.json', path: '.ai-runs/pilot/corpus.json', sha256: await sha256(corpus), bytes: corpus.length },
  ];
  inputs.push({ name: 'recipe.json', path: '.ai-runs/pilot/recipe.json', sha256: await sha256(recipe), bytes: recipe.length });
  const host = { provider: 'hetzner', image: `example/compute@sha256:${'b'.repeat(64)}`, serverType: 'ccx23', location: 'ash', hourlyCents: 100, quoteExpires: time + 48 * 3600000, diskGb: 100 };
  const manifest = { schema: 1, id: 'pilot', purpose: 'reliability-pilot', authorizationReference: 'test-only-authority',
    sourceRevision: 'a'.repeat(40), dependencySha256: 'b'.repeat(64), checkpointSha256: inputs[0].sha256,
    corpusSha256: inputs[1].sha256, recipeSha256: inputs[2].sha256, seed: 107, maxCents: 10000, deadline: time + 48 * 3600000,
    inputs, phases: [{ id: 'rehearsal', kind: 'rehearsal', device: 'cpu', seconds: 3600, argv: ['python', 'run.py'], resumeArgv: ['python', 'resume.py'],
      runDir: '.ai-runs/pilot/run', outputs: ['proof'], outputPaths: { proof: '.ai-runs/pilot/run/proof.json' }, expect: { proof: { passed: true } }, host }], ...overrides };
  async function stage() { await core.stage(manifest); await core.putObject(manifest.id, inputs[0], cp); await core.putObject(manifest.id, inputs[1], corpus); await core.putObject(manifest.id, inputs[2], recipe); }
  async function launch() { await stage(); await core.start(manifest.id); await core.reconcile(); return core.heartbeat(manifest.id, 1); }
  async function upload(raw = encode('{"passed":true}')) {
    const a = { name: 'proof', sha256: await sha256(raw), bytes: raw.length };
    const db = await core.load(); await core.putObject(manifest.id, a, raw, db.campaigns[manifest.id].generation); return a;
  }
  return { core, controller, storage, bucket, providers, config, manifest, inputs, cp, corpus, recipe, stage, launch, upload,
    advance: ms => { time += ms; }, now: () => time, state: async () => (await core.load()).campaigns[manifest.id] };
}
