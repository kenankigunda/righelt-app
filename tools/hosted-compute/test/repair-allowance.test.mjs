import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {validateManualIntent,validateRepairAllowance} from '../manual-authority.mjs';

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
