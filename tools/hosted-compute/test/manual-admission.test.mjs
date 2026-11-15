import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {readCleanupRegistry,registryAuthorizes} from '../manual-authority.mjs';
const hash=v=>sha256(encode(canonical(v)));
test('manual prepare reserves old + supplemental risk + new cap, fences bootstrap, and never POSTs',async()=>{
 const f=await setup(),before=await f.core.load();const out=await f.core.manualPrepare('ui',f.intent);
 assert.equal(out.generation,1);assert.equal(f.providers.creates,1);assert.equal((await f.ui()).status,'manual-pending');
 await assert.rejects(f.core.work('ui',1),/fenced/);await assert.rejects(f.core.heartbeat('ui',1),/fenced/);
 const db=await f.core.load();assert.equal(db.creditAllocatedCents,before.creditAllocatedCents+1000);assert.equal(db.pilotReservedCents,2000);assert.deepEqual(db.campaigns.pilot.attempts[0],f.old);
 await f.core.manualPrepare('ui',f.intent);assert.equal((await f.core.load()).creditAllocatedCents,db.creditAllocatedCents);
 await assert.rejects(f.core.manualPrepare('ui',{...f.intent,priorRiskReserveCents:699}),/already bound/);
});
test('exact observed attach qualifies before access, freezes overall 24h once, and collects only its own resource',async()=>{
 const f=await setup();await f.core.manualPrepare('ui',f.intent);f.addPod();
 const bad=structuredClone(f.providers.resources.get('manual'));bad.name='unrelated';f.providers.resources.set('manual',bad);
 await assert.rejects(f.attach(),/placement/);assert.equal((await f.ui()).status,'manual-pending');f.addPod();
 await f.attach();const first=await f.ui();assert.equal(first.programAnchor.deadline,f.intent.createdAt+86400000);assert.equal(first.manual.campaignDeadline,f.m.deadline);
 await f.attach();assert.deepEqual((await f.ui()).programAnchor,first.programAnchor);
 await assert.rejects(f.core.manualAttach('ui',{intentSha256:first.manual.intentSha256,podId:'other',acceptedAt:f.intent.createdAt,accountId:f.intent.accountId}),/already bound/);
 const work=await f.core.work('ui',1);assert.equal(work.manifestSha256,f.intent.manifestSha256);
 await f.core.heartbeat('ui',1);assert((await f.ui()).phaseDeadline<=f.m.deadline);
 const db=await f.core.load();assert.deepEqual(db.campaigns.pilot.attempts[0],f.old);assert.equal(f.providers.creates,1);
 await f.core.cancel('ui');await f.core.reconcile();await f.core.reconcile();
 assert.equal((await f.ui()).cleanupVerified,true);assert.equal(f.providers.resources.size,0);assert.equal((await f.state()).status,'cleanup-uncertain');assert.equal((await f.state()).attempts[0].endedAt,undefined);assert.equal(f.providers.creates,1);
 const later=structuredClone(f.manifest);later.id='late';later.deadline=first.programAnchor.deadline+1;await f.core.stage(later);
 await assert.rejects(f.core.start('late'),/overall actual program/);
});
test('manual authority rejects absent old fence, wrong registry/account, stale clocks and insufficient additive credit',async()=>{
 for(const mutate of [f=>f.control.fences.clear(),f=>{f.intent.accountId='other';},f=>{f.intent.repairDeadline=Date.UTC(2026,10,16,18)+1;},f=>{f.intent.runtimeWindowMs=900000;},f=>{f.intent.repairStartedAt++;},f=>{f.intent.priorRiskReserveCents=10000;},f=>f.advance(900001)]){
  const f=await setup();mutate(f);const before=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(f.providers.creates,1);
 }
});
test('expired manual admission cannot create or grant work and retains exact-name cleanup responsibility',async()=>{
 const f=await setup();await f.core.manualPrepare('ui',f.intent);f.addPod();f.advance(900001);
 await assert.rejects(f.attach(),/expired/);await f.core.reconcile();await f.core.reconcile();
 assert.equal(f.providers.resources.size,0);assert.equal(f.providers.creates,1);assert.equal((await f.ui()).status,'failed');assert.equal((await f.state()).attempts[0].uncertain,true);
});
test('registry migration authority requires pinned bytes, disjoint names, account equality and runtime match',async()=>{
 const f=await setup(),control=f.core.externalControl(f.m),a=await readCleanupRegistry(control.store,f.intent.registry);
 assert.equal(registryAuthorizes(a,f.manifest.externalControl,'c'.repeat(40)),true);
 assert.equal(registryAuthorizes({...a},f.manifest.externalControl,'c'.repeat(40)),false);
 assert.equal(registryAuthorizes(a,f.manifest.externalControl,'d'.repeat(40)),false);
 f.registry.references[1]=f.registry.references[0];await assert.rejects(readCleanupRegistry(control.store,f.intent.registry),/bytes differ/);
});

test('disabling or reducing authorization after prepare or attach immediately fences manual readiness and work',async()=>{
 for(const setting of ['enabled','authorizedCents']){
  const f=await setup();await f.core.manualPrepare('ui',f.intent);f.addPod();
  const prior=f.config[setting];f.config[setting]=setting==='enabled'?false:1999;
  await assert.rejects(f.attach());assert.equal((await f.ui()).status,'manual-pending');
  assert.equal((await f.core.manualReady('ui',1)).ready,false);await assert.rejects(f.core.work('ui',1));
  f.config[setting]=prior;await f.attach();f.config[setting]=setting==='enabled'?false:1999;
  await assert.rejects(f.core.manualReady('ui',1));await assert.rejects(f.core.work('ui',1));await assert.rejects(f.core.heartbeat('ui',1));assert.equal(f.providers.creates,1);
 }
});
