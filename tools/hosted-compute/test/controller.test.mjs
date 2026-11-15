import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { POLICY, canonical, encode, sha256, validateManifest } from '../policy.mjs';

test('manifest freezes identities, recovery command, pinned image and CPU-rich hosts', async () => {
  const f = await fixture(); assert.equal(validateManifest(f.manifest).seed, 107);
  for (const mutate of [m => m.inputs[0].path = '../secret', m => delete m.phases[0].resumeArgv, m => m.phases[0].host.image = 'latest', m => m.phases[0].device = 'auto', m => m.phases[0].host.provider = 'removed-provider', m => m.purpose = 'open-research']) {
    const m = structuredClone(f.manifest); mutate(m); assert.throws(() => validateManifest(m));
  }
});
test('staging is idempotent, rejects changed inputs and does not spend', async () => {
  const f = await fixture(); await f.stage(); await f.core.stage(f.manifest);
  assert.equal(f.providers.creates, 0);
  await assert.rejects(f.core.stage({ ...f.manifest, seed: 108 }), /already used/);
  await assert.rejects(f.core.putObject('pilot', f.inputs[0], encode('wrong')), /checksum/);
});
test('early Cloudflare review rejects paid launch before any provider reservations or work queues',async()=>{
 for(const reviewOffset of [3600000,24*3600000,25*3600000]){
  const f=await fixture();f.manifest.cash.cloudflare.reviewAt=f.now()+reviewOffset;
  await f.stage();await assert.rejects(f.core.start(f.manifest.id),/full autonomous/);
  const db=await f.core.load();assert.equal(db.campaigns.pilot.status,'staged');assert.equal(db.campaigns.pilot.attempts.length,0);
  for(const key of ['creditAllocatedCents','cloudflareAllocatedCents','pilotReservedCents'])assert.equal(db[key]??0,0);
  assert.equal(db.cashFunding,undefined);assert.equal(f.providers.creates,0);
 }
 const f=await fixture();f.manifest.cash.cloudflare.reviewAt=f.manifest.deadline+5400000;
 await f.stage();await f.core.start(f.manifest.id);
 assert.equal((await f.state()).status,'queued');assert.equal((await f.core.load()).creditAllocatedCents,f.manifest.maxCents);
});
test('disabled activation, incomplete inputs, expired quote and concurrent ownership block launch', async () => {
  const f = await fixture(); await f.core.stage(f.manifest);
  await assert.rejects(f.core.start('pilot'), /incomplete/);
  await f.stage(); f.config.enabled = false;
  await assert.rejects(f.core.start('pilot'), /not activated/);
  f.config.enabled = true; await f.core.start('pilot');
  const second = { ...f.manifest, id: 'second' }; await f.arm(second);await f.core.stage(second);
  await assert.rejects(f.core.start('second'), /owns compute/);
});
test('controller restart and repeated alarms never duplicate a machine', async () => {
  const f = await fixture(); await f.launch(); await f.controller().reconcile(); await f.controller().reconcile();
  assert.equal(f.providers.creates, 1); assert.equal((await f.state()).status, 'running');
});
test('expired leases cannot renew, claim work or finish before reconciliation', async () => {
  const f = await fixture(); await f.launch(); f.advance(POLICY.leaseMs + 1);
  await assert.rejects(f.core.heartbeat('pilot', 1), /fenced/);
  await assert.rejects(f.core.claim('pilot', 1, { key: 'e'.repeat(64) }), /fenced/);
  await assert.rejects(f.core.finish('pilot', 1, { kind: 'infrastructure' }), /fenced/);
});
test('long evaluation uses durable attempts without requiring a moving training checkpoint', async () => {
  const f = await fixture(); f.manifest.phases[0].kind = 'evaluation'; await f.launch();
  for (let i = 0; i < 20; i++) { f.advance(60000); await f.core.heartbeat('pilot', 1); }
  assert.equal((await f.state()).status, 'running');
});
test('restored training bundle resets active-work freshness after provisioning downtime', async () => {
  const f = await fixture(); f.manifest.phases[0].kind = 'training'; f.manifest.phases[0].seconds = 14400;
  await f.launch(); const a = await f.upload();
  await f.core.snapshot('pilot', 1, { id: 'retained', capturedAt: f.now(), files: [{ ...a, path: '.ai-runs/pilot/run/latest.json' }] });
  await f.core.finish('pilot', 1, { kind: 'infrastructure' });
  await f.core.reconcile(); f.advance(20 * 60000); await f.core.reconcile(); await f.core.reconcile();
  await assert.rejects(f.core.heartbeat('pilot', 2), /verification required/);
  await f.core.heartbeat('pilot', 2, { restoredSnapshotId: 'retained' });
  f.advance(60000); await f.core.heartbeat('pilot', 2);
});
test('R2 upload interrupted before its ledger commit is still collected and cleared', async () => {
  const f = await fixture(); await f.stage();
  const bytes = encode('retained-orphan'), hash = await sha256(bytes);
  const originalPut = f.storage.put.bind(f.storage); let failed = false;
  f.storage.put = async (key, db) => {
    if (!failed && db.campaigns.pilot.objects[hash]) { failed = true; throw Error('simulated actor restart'); }
    return originalPut(key, db);
  };
  await assert.rejects(f.core.putObject('pilot', { name: 'unlisted', sha256: hash, bytes: bytes.length }, bytes), /unlisted/);
  await f.core.start('pilot'); await f.core.reconcile(); await f.core.heartbeat('pilot', 1);
  await assert.rejects(f.core.putObject('pilot', { name: 'retained', sha256: hash, bytes: bytes.length }, bytes, 1), /restart/);
  await f.core.cancel('pilot'); await f.core.reconcile(); await f.core.reconcile();
  const inventory = await f.core.inventory('pilot');
  assert(inventory.objects.some(a => a.sha256 === hash));
  const receipt={verified:true,manifestSha256:inventory.manifestSha256,inventorySha256:await sha256(encode(canonical(inventory)))};
  await f.protect(receipt);await f.core.clear('pilot',receipt);
  assert.equal(f.bucket.data.size, 0);
});
test('failed uploads preserve an incomplete receipt while surviving artifacts remain collectible', async () => {
  const f = await fixture(); await f.launch();
  const bytes = encode('not-created'), hash = await sha256(bytes), put = f.bucket.put.bind(f.bucket);
  f.bucket.put = async () => { throw Error('R2 unavailable'); };
  await assert.rejects(f.core.putObject('pilot', { name: 'missing', sha256: hash, bytes: bytes.length }, bytes, 1));
  f.bucket.put = put; await f.core.cancel('pilot'); await f.core.reconcile(); await f.core.reconcile();
  const inventory = await f.core.inventory('pilot');
  assert.equal(inventory.missingUploads[hash].status, 'incomplete-upload-after-worker-cleanup');
  assert(!inventory.objects.some(a => a.sha256 === hash));
  assert(inventory.objects.some(a => a.sha256 === f.inputs[0].sha256));
});
test('worker replacement waits for verified cleanup and fences the previous generation', async () => {
  const f = await fixture(); await f.launch(); const a = await f.upload();
  await f.core.snapshot('pilot', 1, { id: 'snapshot-1', capturedAt: f.now(), files: [{ ...a, path: '.ai-runs/pilot/run/latest.json' }] });
  f.advance(POLICY.leaseMs + 1); await f.core.reconcile();
  assert.equal(f.providers.resources.size, 0); assert.equal((await f.state()).status, 'stopping');
  await assert.rejects(f.core.heartbeat('pilot', 1), /fenced/);
  await f.core.reconcile(); await f.core.reconcile();
  assert.equal(f.providers.creates, 2); await f.core.heartbeat('pilot', 2, { restoredSnapshotId: 'snapshot-1' });
  await assert.rejects(f.core.claim('pilot', 1, { key: 'a'.repeat(64) }), /fenced/);
});
test('uncertain creation is discovered and cleaned without repeating POST', async () => {
  const f = await fixture(); f.providers.uncertainCreate = true;
  await f.stage(); await f.core.start('pilot'); await f.core.reconcile();
  assert.equal(f.providers.creates, 1);
  await f.core.reconcile(); await f.core.reconcile();
  assert.equal((await f.state()).status, 'failed');
  // A successful inventory observed the resource before deletion, so resolving
  // that observation must be durable before deletion can finish.
  assert.equal(f.providers.resources.size, 0); assert.equal(f.providers.creates, 1);
});
test('delete failure keeps ownership and conservative billing open', async () => {
  const f = await fixture(); await f.launch(); await f.core.cancel('pilot'); f.providers.failDelete = true;
  await f.core.reconcile(); f.advance(60000); await f.core.reconcile();
  assert.equal(f.providers.resources.size, 1); assert.equal((await f.state()).status, 'stopping');
  await assert.rejects(f.core.inventory('pilot'), /cleanup/);
  f.providers.failDelete = false; await f.core.reconcile(); await f.core.reconcile();
  assert.equal((await f.state()).status, 'cancelled'); assert.equal((await f.state()).cleanupVerified, true);
});
test('durable claims survive rollback and counters cannot reuse checkpoint IDs', async () => {
  const f = await fixture(); await f.launch(); const key = 'd'.repeat(64);
  assert.equal((await f.core.claim('pilot', 1, { key })).created, true);
  assert.equal((await f.controller().claim('pilot', 1, { key })).created, false);
  assert.equal((await f.core.counter('pilot', 1, { key, minimum: 12 })).value, 12);
  assert.equal((await f.controller().counter('pilot', 1, { key, minimum: 0 })).value, 13);
  const result = await f.upload(); await f.core.settle('pilot', 1, { key, result });
  assert.equal((await f.core.claim('pilot', 1, { key })).record.result.sha256, result.sha256);
});
test('checkpoint overrun revokes admission even while heartbeats continue', async () => {
  const f = await fixture(); f.manifest.phases[0].kind = 'training'; await f.launch();
  for (let i = 0; i < 5; i++) { f.advance(100000); await f.core.heartbeat('pilot', 1); }
  f.advance(100001); await assert.rejects(f.core.heartbeat('pilot', 1), /checkpoint overdue/);
  await f.core.reconcile(); assert.equal(f.providers.resources.size, 0);
});
test('correctness failure stops without automatic repair', async () => {
  const f = await fixture(); await f.launch(); await f.core.finish('pilot', 1, { kind: 'correctness' });
  await f.core.reconcile(); await f.core.reconcile(); await f.core.reconcile();
  assert.equal((await f.state()).status, 'failed'); assert.equal(f.providers.creates, 1);
});
test('repair time excludes healthy operation and the phase deadline cannot reset on replacement', async () => {
  const f = await fixture(); await f.launch(); const a = await f.upload();
  await f.core.snapshot('pilot', 1, { id: 'snapshot-1', capturedAt: f.now(), files: [{ ...a, path: '.ai-runs/pilot/run/latest.json' }] });
  const originalDeadline = (await f.state()).phaseDeadline;
  await f.core.finish('pilot', 1, { kind: 'infrastructure' });
  f.advance(60000); await f.core.reconcile(); await f.core.reconcile(); await f.core.reconcile();
  const ready=await f.core.heartbeat('pilot', 2, { restoredSnapshotId: 'snapshot-1' });
  assert.equal(ready.phaseDeadline,originalDeadline);
  const recovered = await f.state();
  assert.equal(recovered.phaseDeadline, originalDeadline); assert.equal(recovered.repairSpentMs, 60000);
  assert.equal(recovered.repairStartedAt, undefined); assert.equal(recovered.recovering, false);
});
test('repair allowance stops replacement and an unobservable create remains uncertain', async () => {
  const f = await fixture(); await f.launch(); const a = await f.upload();
  await f.core.snapshot('pilot', 1, { id: 'snapshot-1', capturedAt: f.now(), files: [{ ...a, path: '.ai-runs/pilot/run/latest.json' }] });
  await f.core.finish('pilot', 1, { kind: 'infrastructure' });
  await f.core.reconcile(); await f.core.reconcile(); f.advance(POLICY.repairMs + 1); await f.core.reconcile();
  assert.equal((await f.state()).status, 'failed'); assert.equal(f.providers.creates, 1);
  const g = await fixture(); g.providers.create = async () => { throw Error('unknown provider outcome'); };
  await g.stage(); await g.core.start('pilot'); await g.core.reconcile(); await g.core.reconcile();
  assert.equal((await g.state()).status, 'cleanup-uncertain');
  await g.core.reconcile(); assert.equal((await g.state()).cleanupVerified, false);
});
test('pilot reservations are cumulative and cannot be renewed by another campaign ID', async () => {
  const f = await fixture(); await f.stage(); await f.core.start('pilot'); await f.core.cancel('pilot'); await f.core.reconcile();
  const second = { ...f.manifest, id: 'second' }; await f.arm(second);await f.core.stage(second);
  await f.core.putObject('second', f.inputs[0], f.cp); await f.core.putObject('second', f.inputs[1], f.corpus); await f.core.putObject('second', f.inputs[2], f.recipe);
  await assert.rejects(f.core.start('second'), /(authorization|credit) exhausted/);
});
test('collection requires complete outputs and clear requires an exact verified inventory', async () => {
  const f = await fixture(); await f.launch(); const a = await f.upload();
  await assert.rejects(f.core.finish('pilot', 1, { kind: 'complete', outputs: {} }), /artifact/);
  await f.core.finish('pilot', 1, await f.completion());
  await f.core.reconcile(); await f.core.reconcile();
  const inventory = await f.core.inventory('pilot');
  await assert.rejects(f.core.clear('pilot', { verified: true }), /receipt/);
  const receipt={verified:true,manifestSha256:inventory.manifestSha256,inventorySha256:await sha256(encode(canonical(inventory)))};
  await f.protect(receipt);await f.core.clear('pilot',receipt);
  assert.equal(f.bucket.data.size, 0); assert.equal((await f.state()).status, 'cleared');
});

test('committed duplicate acknowledgement saves no ledger but keeps checksum and generation fences',async()=>{
 const f=await fixture();await f.launch();const raw=encode('same-object'),a={name:'same',bytes:raw.length,sha256:await sha256(raw)};
 await f.core.putObject('pilot',a,raw,1);let writes=0;const put=f.storage.put.bind(f.storage);f.storage.put=async(...args)=>{writes++;return put(...args);};
 await f.core.putObject('pilot',a,raw,1);assert.equal(writes,0);
 await assert.rejects(f.core.putObject('pilot',a,encode('wrong'),1),/checksum/);assert.equal(writes,0);
 f.advance(POLICY.leaseMs+1);await assert.rejects(f.core.putObject('pilot',a,raw,1),/fenced/);assert.equal(writes,0);
});
test('external terminal or unavailable control record blocks every replacement without blocking cleanup',async()=>{
 for(const state of ['terminal','unavailable']){
  const f=await fixture();await f.launch();const a=await f.upload();await f.core.snapshot('pilot',1,{id:'s1',capturedAt:f.now(),files:[{...a,path:'.ai-runs/pilot/run/latest.json'}]});
  await f.core.finish('pilot',1,{kind:'infrastructure'});if(state==='terminal')f.control.fence={kind:'terminal'};else f.control.unavailable=true;
  for(let i=0;i<5;i++)await f.controller().reconcile();
  assert.equal(f.providers.resources.size,0);assert.equal(f.providers.creates,1);
 }
});
test('two replacement attempts is a finite campaign limit and never renews original deadline',async()=>{
 const f=await fixture();await f.launch();const deadline=f.manifest.deadline;
 for(let gen=1;gen<=3;gen++){
  const a=await f.upload();await f.core.snapshot('pilot',gen,{id:`s${gen}`,capturedAt:f.now(),files:[{...a,path:'.ai-runs/pilot/run/latest.json'}]});
  await f.core.finish('pilot',gen,{kind:'infrastructure'});await f.core.reconcile();await f.core.reconcile();await f.core.reconcile();
  if(gen<3)await f.core.heartbeat('pilot',gen+1,{restoredSnapshotId:`s${gen}`});
 }
 assert.equal(f.providers.creates,3);assert.equal((await f.state()).replacementAttempts,2);assert.equal((await f.state()).status,'failed');assert.equal((await f.state()).manifest.deadline,deadline);
});
test('clear accepts only exact operator backup assertion and has no backup bucket authority',async()=>{
 const f=await fixture();await f.launch();await f.core.cancel('pilot');await f.core.reconcile();await f.core.reconcile();
 const inventory=await f.core.inventory('pilot'),receipt={verified:true,manifestSha256:inventory.manifestSha256,inventorySha256:await sha256(encode(canonical(inventory)))};
 assert.equal(f.core.backups,undefined);await assert.rejects(f.core.clear('pilot',receipt),/attestation/);await f.protect(receipt);
 const stale=structuredClone(receipt);stale.backup.inventorySha256='0'.repeat(64);await assert.rejects(f.core.clear('pilot',stale),/identity/);
 const partial=structuredClone(receipt);partial.backup.roots=[];await assert.rejects(f.core.clear('pilot',partial),/roots/);
 await f.core.clear('pilot',receipt);assert.equal((await f.state()).cleared,true);assert(f.backupBucket.data.size>0);
});
test('known resource GET must be absent even if a provider inventory omits it',async()=>{
 const f=await fixture();await f.launch();await f.core.cancel('pilot');const find=f.providers.find.bind(f.providers);f.providers.find=async()=>[];
 await f.core.reconcile();assert.equal(f.providers.resources.size,0);assert.equal((await f.state()).cleanupVerified,false);
 f.providers.find=find;await f.core.reconcile();assert.equal((await f.state()).cleanupVerified,true);
});

test('claim lookup recovers settled work without consuming a missing identity',async()=>{
 const f=await fixture();await f.launch();const key='8'.repeat(64),missing='9'.repeat(64);
 assert.deepEqual(await f.core.claim('pilot',1,{key:missing,allowCreate:false}),{created:false,unclaimed:true});assert.equal((await f.state()).claims?.[missing],undefined);
 await f.core.claim('pilot',1,{key});const result=await f.upload();await f.core.settle('pilot',1,{key,result});
 const found=await f.core.claim('pilot',1,{key,allowCreate:false});assert.equal(found.created,false);assert.equal(found.record.result.sha256,result.sha256);
});

test('scientific stage cannot disguise training as final evaluation or bypass bound plan execution',async()=>{
 const f=await fixture(),m=structuredClone(f.manifest);m.purpose='scientific-comparison';m.scientific={schema:1,stage:'evaluation',evaluationScope:'final',arm:'shared',experimentSha256:m.recipeSha256,methodSha256:m.recipeSha256,familyInventorySha256:m.recipeSha256,candidateSha256:'4'.repeat(64)};
 const p=m.phases[0];p.kind='evaluation';p.planSha256=m.recipeSha256;p.expect.proof.allWorkComplete=true;
 p.argv=['tools/ai-trainer/.venv/bin/python','-m','righelt_training.hosted_science','evaluation','--plan',m.inputs[2].path,'--run-dir',p.runDir,'--seconds',String(p.seconds)];p.resumeArgv=[...p.argv,'--resume'];assert.equal(validateManifest(m).scientific.stage,'evaluation');
 for(const kind of ['training','teacher']){const wrong=structuredClone(m);wrong.phases[0].kind=kind;assert.throws(()=>validateManifest(wrong),/stage and executable phase/);}
 const unbound=structuredClone(m);unbound.phases[0].argv.push('--plan','.ai-runs/other/plan.json');assert.throws(()=>validateManifest(unbound),/frozen phase/);
 const unchecked=structuredClone(m);delete unchecked.phases[0].expect.proof.allWorkComplete;assert.throws(()=>validateManifest(unchecked),/all work complete/);
 const guarded=structuredClone(m);guarded.scientific.stage='training';guarded.inputs[0].role='protected-final';assert.throws(()=>validateManifest(guarded),/raw final material/);
});

test('create failure status survives restart but never clears uncertainty, billing, original clocks or create ownership',async()=>{
 const {Providers}=await import('../providers.mjs');
 for(const status of [400,401,403,422,500,202]){
  const f=await fixture();let creates=0,bodyReads=0;const real=new Providers({RUNPOD_API_KEY:'provider-secret'},async()=>{creates++;return {status,ok:status===202,json(){bodyReads++;throw Error('body-secret');}};});
  f.providers.create=(...args)=>real.create(...args);
  await f.stage();await f.core.start('pilot');const deadline=f.manifest.deadline;
  await f.core.reconcile();const initial=await f.state();assert.equal(initial.attempts[0].uncertain,true);
  assert.equal(initial.attempts[0].createFailure.httpStatus,status);assert.equal(initial.attempts[0].createFailure.dispatch,'response-received');
  const restarted=f.controller();f.advance(60000);await restarted.reconcile();await restarted.reconcile();
  const state=await f.state();assert.equal(state.status,'cleanup-uncertain');assert.equal(state.cleanupVerified,false);assert.equal(state.attempts[0].endedAt,undefined);assert.equal(state.manifest.deadline,deadline);assert.equal(state.generation,1);assert.equal(creates,1);assert.equal(bodyReads,0);
  const visible=restarted.status(state);assert(visible.estimatedCents>0);assert.equal(visible.events.find(e=>e.type==='create-failed').diagnostic.httpStatus,status);assert(!JSON.stringify(visible).includes('secret'));
 }
});

test('bootstrap and unknown local failure diagnostics never expose messages or infer no-create resolution',async()=>{
 const f=await fixture();f.core.token=async()=>{throw Error('private-signing-key-value');};await f.stage();await f.core.start('pilot');await f.core.reconcile();await f.core.reconcile();
 const state=await f.state();assert.equal(f.providers.creates,0);assert.equal(state.status,'cleanup-uncertain');assert.equal(state.attempts[0].createFailure.category,'worker-token');assert.equal(state.attempts[0].createFailure.dispatch,'not-dispatched');assert.equal(state.cleanupVerified,false);assert(!JSON.stringify(f.core.status(state)).includes('private-signing'));
 const g=await fixture();g.providers.create=async()=>{const e=new Error('private-env-value');e.diagnostic={httpStatus:403,body:'private'};throw e;};await g.stage();await g.core.start('pilot');await g.core.reconcile();await g.core.reconcile();
 const unknown=await g.state();assert.equal(unknown.attempts[0].createFailure.category,'unclassified');assert.equal(unknown.attempts[0].createFailure.httpStatus,null);assert.equal(unknown.status,'cleanup-uncertain');assert(!JSON.stringify(g.core.status(unknown)).includes('private'));
});

test('late create discovered after a diagnostic failure is still fenced, deleted and verified without another POST',async()=>{
 const f=await fixture();f.providers.uncertainCreate=true;await f.stage();await f.core.start('pilot');await f.core.reconcile();
 const name=(await f.state()).attempts[0].name;assert.equal(f.providers.creates,1);assert.equal((await f.state()).attempts[0].uncertain,true);
 // The original lost-response resource becomes observable. Only that exact
 // saved launch identity can settle uncertainty and pass cleanup.
 assert.equal([...f.providers.resources.values()][0].name,name);
 const restarted=f.controller();await restarted.reconcile();await restarted.reconcile();
 const state=await f.state();assert.equal(state.status,'failed');assert.equal(state.cleanupVerified,true);assert.equal(f.providers.creates,1);assert.equal(f.providers.resources.size,0);assert.equal(state.attempts[0].uncertain,false);
});

test('post-create persistence failure retains the known resource for cleanup and reports the local stage safely',async()=>{
 const f=await fixture();await f.stage();await f.core.start('pilot');
 const put=f.storage.put.bind(f.storage);let failed=false;
 f.storage.put=async(key,value)=>{
  if(!failed&&value.campaigns?.pilot.status==='provisioning'&&value.campaigns.pilot.attempts[0]?.resourceId){failed=true;throw Error('private-storage-details');}
  return put(key,value);
 };
 await f.core.reconcile();const initial=await f.state();assert.equal(failed,true);assert.equal(initial.status,'stopping');assert.equal(initial.attempts[0].resourceId,'1');assert.equal(initial.cleanupVerified,false);
 assert.deepEqual(initial.attempts[0].createFailure,{schema:1,provider:'runpod',operation:'create-pod',category:'launch-persistence',dispatch:'response-received',httpStatus:null});
 assert(!JSON.stringify(f.core.status(initial)).includes('private-storage'));
 f.providers.failDelete=true;const restarted=f.controller();await restarted.reconcile();assert.equal((await f.state()).cleanupVerified,false);assert.equal(f.providers.resources.size,1);
 f.providers.failDelete=false;await restarted.reconcile();await restarted.reconcile();
 const final=await f.state();assert.equal(final.status,'failed');assert.equal(final.cleanupVerified,true);assert.equal(f.providers.creates,1);assert.equal(f.providers.resources.size,0);assert.equal(final.manifest.deadline,f.manifest.deadline);
});
