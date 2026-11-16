import test from 'node:test';
import assert from 'node:assert/strict';
import {capacityRecoveryFixture} from './capacity-recovery-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));
test('fresh filtered LOW capacity and fixed three-owner registry admit one frozen short while preserving original/B6 watches and consuming before credentials',async t=>{
 const f=await capacityRecoveryFixture(t),before=await f.core.load();let tokens=0;
 f.core.token=async()=>{tokens++;assert.equal((await f.core.load()).capacityRecoveryShort.campaignId,f.m.id);return 'private-worker-token';};
 await f.core.manualPrepare(f.m.id,f.intent);let db=await f.core.load();const marker=structuredClone(db.capacityRecoveryShort);
 assert.equal(marker.intentSha256,await hash(f.intent));assert.equal(marker.programAcceptedAt,before.manualProgram.acceptedAt);
 assert.deepEqual(db.campaigns.pilot,before.campaigns.pilot);assert.deepEqual(db.campaigns[f.b6.manifest.id],before.campaigns[f.b6.manifest.id]);assert.deepEqual(db.campaigns[f.failed.manifest.id],before.campaigns[f.failed.manifest.id]);assert.deepEqual(db.manualProgram,before.manualProgram);
 await f.core.manualPrepare(f.m.id,f.intent);assert.equal(tokens,2);assert.deepEqual((await f.core.load()).capacityRecoveryShort,marker);
 await f.core.cancel(f.m.id);await f.core.reconcile();await f.core.reconcile();db=await f.core.load();assert.deepEqual(db.capacityRecoveryShort,marker);
 await assert.rejects(f.f.controller().manualPrepare(f.m.id,f.intent),/bootstrap closed/);assert.equal(f.f.providers.creates,1);
});
test('ordinary short, consumed slot, stale basis, altered workload or unqualified capacity cannot bypass recovery authority',async t=>{
 const changes=[
  f=>{f.transition.kind='manual-public-timing-transition';delete f.transition.capacityRecovery;},
  async f=>{const db=await f.core.load();db.capacityRecoveryShort={campaignId:'another-campaign',intentSha256:'0'.repeat(64)};await f.core.save(db);},
  async f=>{const db=await f.core.load();db.providerRefusalResolution.appliedAt=db.actualSpendBasis.observedAt;await f.core.save(db);},
  f=>{f.transition.capacityRecovery.capacity.observation.response.availability='NONE';},
  f=>{f.transition.capacityRecovery.capacity.observation.query.cloud='COMMUNITY';},
  f=>{f.transition.capacityRecovery.capacity.observationSha256='0'.repeat(64);},
  async f=>{const db=await f.core.load();db.campaigns[f.failed.manifest.id].manifest.phases[0].seconds++;await f.core.save(db);},
  async f=>{const db=await f.core.load();db.campaigns[f.failed.manifest.id].manifest.publicTiming.profilesSha256='0'.repeat(64);await f.core.save(db);},
  async f=>{const db=await f.core.load();db.providerRefusalContradictions=[{receiptSha256:'3'.repeat(64)}];await f.core.save(db);}
 ];
 for(const change of changes){const f=await capacityRecoveryFixture(t);await change(f);await f.freeze();const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};await assert.rejects(f.core.manualPrepare(f.m.id,f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);}
});
test('effective refusal applies to both all-attempt coverage and final conflict, while original/B6 cannot be omitted',async t=>{
 const f=await capacityRecoveryFixture(t),db=await f.core.load();db.campaigns[f.failed.manifest.id].status='cleanup-uncertain';await f.core.save(db);await f.core.manualPrepare(f.m.id,f.intent);
 const bad=await capacityRecoveryFixture(t);bad.registry.references[1]=bad.m.externalControl;bad.registryRef.sha256=await hash(bad.registry);bad.f.control.records.set(`${bad.registryRef.path}@${bad.registryRef.commit}`,bad.registry);await assert.rejects(bad.core.manualPrepare(bad.m.id,bad.intent));
});
test('global short marker leaves genuinely qualified diagnostic-once and productive work available',async t=>{
 for(const options of [{long:true},{diagnostic:true}]){
  const f=await capacityRecoveryFixture(t,options),db=await f.core.load();db.capacityRecoveryShort={campaignId:'earlier-recovery',intentSha256:'0'.repeat(64)};await f.core.save(db);
  const before=structuredClone(db.capacityRecoveryShort);await f.core.manualPrepare(f.m.id,f.intent);const after=await f.core.load();assert.deepEqual(after.capacityRecoveryShort,before);assert.equal(Boolean(after.campaigns[f.m.id].manual.publicWork.diagnostic),Boolean(options.diagnostic));
 }
});
test('positive actual-resource observation latches hold through later empty accounting evidence and blocks new admission',async t=>{
 const f=await capacityRecoveryFixture(t);let n=0;
 async function observe(positive){
  f.f.advance(1);const binding=await f.core.actualSpendBinding(),resource={id:'late-owned-pod',campaignId:f.failed.manifest.id,generation:1,name:'refused-short',hourlyCents:100};
  const receipt={schema:1,kind:'operator-actual-spend-reconciliation',id:String(++n).repeat(32),priorCampaignId:'pilot',ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,authority:{kind:'user-actual-spend-basis-correction',evidenceSha256:'a'.repeat(64),repairCeilingCents:2000,runpodCeilingCents:10000},accountId:'test-account',observedAt:f.f.now(),validUntil:f.f.now()+900000,balance:{openingCreditCents:10000,currentCreditCents:9997,debitsCents:3,creditsCents:0,currentHourlyCents:positive?100:0,autoPay:false,evidenceSha256:'b'.repeat(64)},inventory:{ordinary:{complete:true,evidenceSha256:'c'.repeat(64),resourceIds:positive?[resource.id]:[]},queued:{complete:true,evidenceSha256:'d'.repeat(64),resourceIds:[]}},activeResources:positive?[resource]:[]};
  await f.core.reconcileActualSpend('pilot',await f.receipt(receipt,String(n)));
 }
 await observe(true);let db=await f.core.load();assert.equal(db.providerRefusalContradictions.length,1);assert.equal(db.campaigns[f.failed.manifest.id].cleanupVerified,false);
 await observe(false);db=await f.core.load();assert.equal(db.providerRefusalContradictions.length,1);assert.equal(db.actualSpendBasis.activeResources.length,0);assert.equal(db.creditAllocatedCents,3);await assert.rejects(f.core.manualPrepare(f.m.id,f.intent),/contradicted/);
});
