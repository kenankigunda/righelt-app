import { syntheticGithubUsage } from './github-usage-fixture.mjs';
import { buildPrearm, PrimaryControl, prearmPath } from '../external-control.mjs';
import { BackupVault } from '../backup.mjs';
import { operatorAttestation } from '../operator-attestation.mjs';
import { Providers } from '../providers.mjs';
import { executionIdentity } from '../result.mjs';
import { canonical } from '../policy.mjs';
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
  async list({ prefix = '' }) { return { objects: [...this.data].filter(([k]) => k.startsWith(prefix)).map(([key]) => ({ key })), truncated: false }; }
}
export class FakeProviders {
  resources = new Map(); creates = 0; failDelete = false; failList = false; uncertainCreate = false;
  async create(host, name, env) {
    this.creates++; const record = { id: String(this.creates), name, host, env }; this.resources.set(record.id, record);
    if (this.uncertainCreate) throw Error('lost response'); return record;
  }
  async inspect(_provider,id){const r=this.resources.get(id);if(!r)return null;return {id:r.id,name:r.name,image:r.host.image,cudaVersion:r.host.minCudaVersion,dataCenterId:r.host.dataCenterId,cloud:'SECURE',gpu:{id:r.host.gpu,count:1,vcpuCount:r.host.minVcpu,memory:r.host.minRamGb},disk:r.host.diskGb,cost:r.host.hourlyCents/100};}
  qualify(...args){return Providers.prototype.qualify(...args);}
  async find(provider, name) { if (this.failList) throw Error('outage'); return [...this.resources.values()].filter(x => x.name === name && x.host.provider === provider); }
  async remove(_provider, id, name) { if (this.failDelete) throw Error('outage'); if (this.resources.get(id)?.name !== name) throw Error('unrelated'); this.resources.delete(id); }
}
export async function fixture(overrides = {}) {
  let time = Date.UTC(2026, 10, 10);
  const storage = new MemoryStorage(), bucket = new MemoryBucket(), backupBucket=new MemoryBucket(), providers = new FakeProviders();
  const config = { enabled: true, authorizedCents: 10000, url: 'https://compute.example' };
  const prearms=new Map(),control={fence:null,unavailable:false};
  const controlStore={readPrearm:async ref=>{if(control.unavailable)throw Error('control unavailable');return prearms.get(ref.sha256);},readFence:async()=>{if(control.unavailable)throw Error('control unavailable');return control.fence;}};
  const controller = () => new Controller({ storage, bucket, providers, config, externalControl:m=>new PrimaryControl({store:controlStore,reference:m.externalControl,clock:()=>time}),now: () => time, token: async () => 'private-worker-token' });
  const core = controller();
  const cp = encode('checkpoint'), corpus = encode('corpus'), recipe = encode('{"id":"baseline-v1"}');
  const inputs = [
    { name: 'checkpoint.pt', path: '.ai-runs/pilot/checkpoint.pt', sha256: await sha256(cp), bytes: cp.length },
    { name: 'corpus.json', path: '.ai-runs/pilot/corpus.json', sha256: await sha256(corpus), bytes: corpus.length },
  ];
  inputs.push({ name: 'recipe.json', path: '.ai-runs/pilot/recipe.json', sha256: await sha256(recipe), bytes: recipe.length });
  const host = { provider: 'runpod', image: `example/compute@sha256:${'b'.repeat(64)}`, gpu:'Test GPU',minCudaVersion:'13.0',minRamGb:64,minVcpu:16,dataCenterId:'US-TEST-1',quoteObservedAt:time,quoteReference:'test-quote-evidence', hourlyCents: 100, quoteExpires: time + 48 * 3600000, diskGb: 100 };
  const manifest = { schema: 1, mode:'supervised-qualification', id: 'pilot', purpose: 'reliability-pilot', authorizationReference: 'test-only-authority',
    sourceRevision: 'a'.repeat(40), dependencySha256: 'b'.repeat(64), checkpointSha256: inputs[0].sha256,
    corpusSha256: inputs[1].sha256, recipeSha256: inputs[2].sha256, executionRecipeSha256: inputs[2].sha256, seed: 107, maxCents: 10000, deadline: time + 24 * 3600000, cash:{schema:2,runpod:{cashCeilingCents:10000,purchasedCreditCents:10000,openingCreditCents:0,taxReserveCents:0},cloudflare:{cashCeilingCents:2000,subscriptionCents:100,workersCents:100,durableObjectsCents:100,activeR2Cents:100,backupR2Cents:100,taxFeesCents:100,retentionDays:30,fundedFrom:time,reviewAt:time+29*86400000,owner:'fixture-operator'},computeUsageCapCents:overrides.maxCents??10000,cloudflareUsageCapCents:100,autoTopUps:false,evidenceReference:'test-funding-plan'},
    inputs, phases: [{ id: 'rehearsal', workIds: ['fixture'], kind: 'rehearsal', device: 'cuda', seconds: 3600, argv: ['python', 'run.py'], resumeArgv: ['python', 'resume.py'],
      runDir: '.ai-runs/pilot/run', outputs: ['proof'], outputPaths: { proof: '.ai-runs/pilot/run/proof.json' }, expect: { proof: { passed: true } }, host }], ...overrides };
  async function arm(m=manifest){const record=await buildPrearm(m,{accountId:'test-account',accountEvidenceReference:'fixture-account-proof',createdAt:time,fundedCutoff:m.deadline,workflowRevision:'c'.repeat(40),controlRepository:'fixture/private-control',githubUsage:syntheticGithubUsage(time,m.deadline,{repository:'fixture/private-control'}),nonce:'f'.repeat(32)});const hash=await sha256(encode(canonical(record)));prearms.set(hash,record);m.externalControl={repository:record.controlRepository,commit:'d'.repeat(40),path:prearmPath(record.nonce),sha256:hash};return record;}
  await arm();
  async function stage() { await arm();await core.stage(manifest); await core.putObject(manifest.id, inputs[0], cp); await core.putObject(manifest.id, inputs[1], corpus); await core.putObject(manifest.id, inputs[2], recipe); }
  async function launch() { await stage(); await core.start(manifest.id); await core.reconcile(); return core.heartbeat(manifest.id, 1); }
  async function upload(raw = encode('{"passed":true}')) {
    const a = { name: 'proof', sha256: await sha256(raw), bytes: raw.length };
    const db = await core.load(); await core.putObject(manifest.id, a, raw, db.campaigns[manifest.id].generation); return a;
  }
  async function completion(generation = 1) {
    const execution = executionIdentity(manifest, await sha256(encode(canonical(manifest))), manifest.phases[0], generation);
    const model = await upload(encode('model'));
    const checkpoint = await upload(encode('checkpoint-result'));
    const proof = await upload(encode(JSON.stringify({ kind: 'pipeline-proof', execution, export: {sha256:model.sha256}, checkpointSha256:checkpoint.sha256,
      training:{updates:1,recoveryPassed:true}, recoveredUpdates:1, parity:{numericPassed:true} })));
    const artifacts = [[model,'model'],[checkpoint,'checkpoint'],[proof,'proof']].map(([a,role]) => ({...a,name:role,path:`.ai-runs/pilot/run/${role}.bin`,role}));
    const raw = encode(JSON.stringify({schema:1,passed:true,kind:'compute-result',disposition:'complete',execution,completedWorkIds:['fixture'],updates:1,parameterDelta:1,artifacts}));
    const result = await upload(raw);
    return {kind:'complete',outputs:{proof:result},files:[...artifacts,{...result,path:'.ai-runs/pilot/run/proof.json'}]};
  }
  async function protect(collection){
    const inventory=await core.inventory(manifest.id);
    const vault=new BackupVault({storage:new MemoryStorage(),bucket:backupBucket});
    const root=await vault.begin(inventory,collection,{snapshotId:null,paths:[]});
    for(const a of root.objects)await vault.copy(a.sha256,async a=>(await bucket.get(`${manifest.id}/${a.sha256}`)).body);
    await vault.seal();
    for(const a of root.objects)await vault.download(root.id,a.sha256);
    await vault.confirmRestore(root.id,{backupId:root.id,manifestSha256:root.manifestSha256,checkpointSha256:null,controlSha256:root.control.sha256,allocationResumed:false});
    collection.backup=await operatorAttestation(vault,inventory);return root;
  }
  return { core, controller, bucket, storage, backupBucket, providers, config, manifest, inputs, cp, corpus, recipe, arm, control, stage, launch, upload, completion, protect,
    advance: ms => { time += ms; }, now: () => time, state: async () => (await core.load()).campaigns[manifest.id] };
}

export function projectionMeasurements(overrides={}){return {observedHours:1,newFiles:2,newObjects:10,newBytes:1000,largestProjectedObjectBytes:100,initialObjects:1,initialClaims:0,newClaims:1,initialStoredBytes:100,newStoredBytes:1000,retryPublications:2,ledgerBytes:1000,ledgerGrowthBytes:1000,cloudReadPasses:3,cloudflareReserveCents:100, rates:{r2WritePerMillionCents:450,r2ReadPerMillionCents:36,doWritePerMillionCents:100,doReadPerMillionCents:10,storageGiBMonthCents:2,baseAndOtherCents:1,evidenceReference:'fixture-rates-proof'},bytesPerSecond:1e6,checkpointAgeMs:240000,copyMs:1,requestOverheadMs:1,...overrides};}
