import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {validateManualIntent,validateRepairAllowance} from '../manual-authority.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

async function candidate(cents,authorizedCents){
  const f=await setup();f.config.authorizedCents=authorizedCents;
  f.intent.repairMaxCents=cents;f.funding.aggregate.repairCeilingCents=cents;
  f.intent.fundingReservation=await f.receipt(f.funding,'7');
  return f;
}
test('deployed twenty-dollar authority rejects larger repair intents despite otherwise valid operator receipts',async()=>{
  const current=await candidate(2000,2000);await current.core.manualPrepare('ui',current.intent);
  assert.equal((await current.ui()).status,'manual-pending');
  for(const cents of [2500,3000]){
    const f=await candidate(cents,2000),before=await f.core.load();
    validateManualIntent(f.intent);
    await assert.rejects(f.core.manualPrepare('ui',f.intent),/repair allowance exceeds deployed authorization/);
    assert.deepEqual(await f.core.load(),before);assert.equal(f.providers.creates,1);
    assert.equal((await f.ui()).manual,undefined);
  }
});
test('an explicit matching deployed allowance admits the same receipt without changing old funding, clocks or ownership',async()=>{
  const f=await candidate(2500,2500),before=await f.state();
  await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();await f.core.work('ui',1);
  assert.deepEqual(await f.state(),before);assert.equal(f.providers.creates,1);
  const db=await f.core.load();assert.equal(db.pilotReservedCents,2000);assert.equal(db.creditAllocatedCents,2000);
  assert.equal(db.manualProgram.acceptedAt,f.intent.createdAt);assert.equal(db.manualProgram.deadline,f.intent.createdAt+86400000);
});
test('a later deployed reduction fences pending admission, attached readiness, work and heartbeat',async()=>{
  for(const attached of [false,true]){
    const f=await candidate(3000,3000);await f.core.manualPrepare('ui',f.intent);f.addPod();
    if(attached)await f.attach();f.config.authorizedCents=2000;
    if(!attached)await assert.rejects(f.attach(),/repair allowance exceeds deployed authorization/);
    await assert.rejects(f.core.work('ui',1));
    if(attached){await assert.rejects(f.core.manualReady('ui',1));await assert.rejects(f.core.heartbeat('ui',1));}
    else assert.equal((await f.core.manualReady('ui',1)).ready,false);
    assert.equal(f.providers.creates,1);assert.equal(f.config.authorizedCents,2000);
  }
});
test('the existing absolute provider ceiling cannot be exceeded by a larger deployed setting',async()=>{
  const f=await candidate(10001,20000);
  assert.throws(()=>validateManualIntent(f.intent),/repair authorization exceeded/);
  assert.throws(()=>validateRepairAllowance(f.intent,20000),/deployed authorization/);
  const before=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(f.providers.creates,1);
});

async function secondManual({cancelled=false}={}){
  const f=await setup({manualCapCents:208,liabilityMs:7800000,manualWindowMs:600000});f.config.authorizedCents=2000;
  await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();await f.core.work('ui',1);
  f.advance(1000);if(cancelled)await f.core.cancel('ui');else await f.core.finish('ui',1,{kind:'correctness'});await f.core.reconcile();await f.core.reconcile();
  const ended=await f.ui();assert.equal(ended.status,cancelled?'cancelled':'failed');assert.equal(ended.cleanupVerified,true);assert(ended.attempts[0].endedAt);
  assert.equal((await f.core.load()).pilotReservedCents,1908);
  const anchor=structuredClone((await f.core.load()).manualProgram),old=await f.state();
  const m=structuredClone(f.m);m.id='ui-next';m.maxCents=300;m.cash.computeUsageCapCents=300;m.deadline=f.now()+900000;
  const prearm=await f.arm(m,'2'.repeat(32));await f.core.stage(m);
  for(const [input,bytes] of [[f.inputs[0],f.cp],[f.inputs[1],f.corpus],[f.inputs[2],f.recipe]])await f.core.putObject(m.id,input,bytes);
  const registry={...f.registry,references:[f.manifest.externalControl,m.externalControl]};
  const registryRef={...f.intent.registry,path:`control/prearms/${'9'.repeat(32)}.json`,sha256:await hash(registry)};
  f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
  const intent={...f.intent,id:'2'.repeat(32),campaignId:m.id,manifestSha256:await hash(m),name:prearm.launches[0].name,registry:registryRef,
    createdAt:f.now(),expiresAt:f.now()+300000,liabilityUntil:f.now()+8100000,repairMaxCents:3000,priorRiskReserveCents:1400,fundingSha256:await hash(m.cash)};
  const ready={...f.ready,registry:registryRef,observedAt:f.now(),run:{...f.ready.run,results:registry.references.map(r=>({prearmSha256:r.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}};
  intent.cleanupReady=await f.receipt(ready,'8');
  const funding=structuredClone(f.funding);funding.oldAttempt.supplementalRiskHoldCents=1400;
  Object.assign(funding.newIntent,{computeAllocationCents:300,protectedShutdownReserveCents:60,latestAdmission:new Date(f.now()+900000).toISOString(),latestWorkCutoff:new Date(m.deadline).toISOString(),responseUntil:new Date(intent.liabilityUntil).toISOString()});
  Object.assign(funding.aggregate,{runpodEncumberedCents:2908,repairEncumberedCents:2908,repairCeilingCents:3000,cloudflareEncumberedCents:200});
  const freeze=async()=>{intent.fundingReservation=await f.receipt(funding,'9');};await freeze();
  return {...f,nextManifest:m,nextIntent:intent,nextFunding:funding,freeze,ended,anchor,old};
}
test('a second manual attempt retains the ended first allocation in both funding envelopes and never resets ownership or clocks',async()=>{
  for(const cancelled of [false,true]){
    const f=await secondManual({cancelled});f.config.authorizedCents=3000;
    await f.core.manualPrepare('ui-next',f.nextIntent);
    // Idempotent prepare excludes its own already-reserved allocation.
    await f.core.manualPrepare('ui-next',f.nextIntent);assert.equal((await f.core.load()).pilotReservedCents,2908);
    f.providers.resources.set('second',{id:'second',name:f.nextIntent.name,host:f.nextManifest.phases[0].host});
    await f.core.manualAttach('ui-next',{intentSha256:await hash(f.nextIntent),podId:'second',acceptedAt:f.nextIntent.createdAt,accountId:f.nextIntent.accountId});
    await f.core.work('ui-next',1);
    const db=await f.core.load();assert.equal(db.pilotReservedCents,2908);assert.equal(db.creditAllocatedCents,2908);assert.equal(db.manualRiskHolds.pilot,1400);
    assert.deepEqual(db.campaigns.ui,f.ended);assert.deepEqual(db.campaigns.pilot,f.old);assert.deepEqual(db.manualProgram,f.anchor);assert.deepEqual(db.campaigns['ui-next'].programAnchor,f.anchor);assert.equal(f.providers.creates,1);
  }
});
test('omitting an ended committed allocation from either envelope rejects before token or ledger writes',async()=>{
  for(const omitted of ['runpodEncumberedCents','repairEncumberedCents','both']){
    const f=await secondManual();f.config.authorizedCents=3000;
    if(omitted==='both')Object.assign(f.nextFunding.aggregate,{runpodEncumberedCents:2700,repairEncumberedCents:2700});
    else f.nextFunding.aggregate[omitted]=2700;
    await f.freeze();const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'must-not-issue';};
    await assert.rejects(f.core.manualPrepare('ui-next',f.nextIntent),/aggregate funding/);assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);assert.equal(f.providers.creates,1);
  }
});
test('a truthful second-attempt envelope still cannot exceed the current deployed twenty-dollar authority',async()=>{
  const f=await secondManual(),before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'must-not-issue';};
  await assert.rejects(f.core.manualPrepare('ui-next',f.nextIntent),/deployed authorization/);assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);assert.equal(f.config.authorizedCents,2000);
});
