import test from 'node:test';
import assert from 'node:assert/strict';
import {actualFixture} from './actual-spend-fixture.mjs';
import {includeRetainedOwner} from './finite-cleanup-fixture.mjs';
import {readCleanupRegistry} from '../manual-authority.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

async function fixture(){const f=await actualFixture({elapsedAfterFirstMs:0});return {...f,retained:await includeRetainedOwner(f)};}
async function reconcile(f){await f.core.reconcileActualSpend('pilot',f.retained.basis);}
async function rejectWithoutMutation(f,pattern){const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};await assert.rejects(f.core.manualPrepare('actual-next',f.intent),pattern);assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);}

test('three-owner admission preserves original and cancelled uncertain owner without phantom historical debits',async()=>{
 const f=await fixture();await reconcile(f);const before=await f.core.load();
 await f.core.manualPrepare('actual-next',f.intent);const after=await f.core.load();
 assert.deepEqual(after.campaigns.pilot,before.campaigns.pilot);assert.deepEqual(after.campaigns.ui,before.campaigns.ui);
 assert.equal(after.actualSpendBasis.observedDebitCents,3);assert.equal(after.pilotReservedCents,3);assert.equal(after.actualSpendBasis.admissions['actual-next'].forecastCents,227);
 assert.equal(after.campaigns.ui.attempts[0].uncertain,true);assert.equal(f.providers.creates,1);
});
test('legacy dual registry cannot omit a cancelled uncertain historical owner',async()=>{
 const f=await fixture();await reconcile(f);f.retained.registry.kind='runpod-dual-cleanup-registry';f.retained.registry.references.splice(1,1);f.retained.ready.kind='dual-cleanup-readiness';f.retained.ready.run.results.splice(1,1);await f.retained.freezeRegistry();
 await rejectWithoutMutation(f,/unresolved ownership coverage/);
});
test('all historical attempts count even when a later attempt and campaign claim cleanup',async()=>{
 const f=await fixture(),db=await f.core.load(),owner=db.campaigns.ui;
 owner.cleanupVerified=true;owner.status='cancelled';owner.attempts.push({...owner.attempts[0],uncertain:false,endedAt:f.now()});await f.core.save(db);
 const binding=await f.core.actualSpendBinding();f.observation.ledgerSha256=binding.ledgerSha256;const basis=await f.freeze();f.intent.actualSpendBasisSha256=basis.sha256;f.funding.basisSha256=basis.sha256;await f.freezeFunding();f.retained.basis=basis;await reconcile(f);
 f.retained.registry.kind='runpod-dual-cleanup-registry';f.retained.registry.references.splice(1,1);await f.retained.freezeRegistry();await rejectWithoutMutation(f,/unresolved ownership coverage/);
});
test('retained attempt prearm/name mismatch and missing or changed terminal fence fail closed',async()=>{
 for(const mutate of [f=>{f.control.fences.delete(f.retained.record.nonce);},f=>{f.control.fences.set(f.retained.record.nonce,{kind:'terminal',prearmSha256:'0'.repeat(64)});},async f=>{const db=await f.core.load();db.campaigns.ui.attempts[0].prearmSha256='0'.repeat(64);await f.core.save(db);},async f=>{const db=await f.core.load();db.campaigns.ui.attempts[0].name='unrelated';await f.core.save(db); }]){
  const f=await fixture();await mutate(f);const binding=await f.core.actualSpendBinding();f.observation.ledgerSha256=binding.ledgerSha256;const basis=await f.freeze();f.intent.actualSpendBasisSha256=basis.sha256;f.funding.basisSha256=basis.sha256;await f.freezeFunding();f.retained.basis=basis;await reconcile(f);await rejectWithoutMutation(f,/terminal fence|prearm identity/);
 }
});
test('three-owner readiness requires exact hashes/cardinality and every operational success',async()=>{
 for(const mutate of [r=>r.run.results.pop(),r=>r.run.results.push({...r.run.results[0]}),r=>r.run.results[1].prearmSha256=r.run.results[0].prearmSha256,r=>r.run.results[1].prearmSha256='0'.repeat(64),r=>r.run.results[1].failures=1,r=>r.run.results[1].durableReceiptConfirmed=false,r=>r.run.results[1].cleanupObservedAbsent=false,r=>r.kind='dual-cleanup-readiness']){
  const f=await fixture();await reconcile(f);mutate(f.retained.ready);await f.retained.freezeRegistry();await rejectWithoutMutation(f,/cleanup|runner/);
 }
});
test('only actual failure from retained terminal usage warnings is tolerated, never new warning or operational failure',async()=>{
 const f=await fixture();await reconcile(f);f.retained.ready.run.conclusion='failure';f.retained.ready.run.usageReviewRequired=true;
 f.retained.ready.run.results[0].usageReviewRequired=true;f.retained.ready.run.results[1].usageReviewRequired=true;await f.retained.freezeRegistry();await f.core.manualPrepare('actual-next',f.intent);
 for(const mutate of [r=>r.run.results[1].failures=1,r=>r.run.results[2].usageReviewRequired=true,r=>r.run.results[1].state='waiting',r=>r.run.results.forEach(x=>x.usageReviewRequired=false),r=>r.run.conclusion='success',r=>r.run.usageReviewRequired=false]){
  const g=await fixture();await reconcile(g);g.retained.ready.run.conclusion='failure';g.retained.ready.run.usageReviewRequired=true;g.retained.ready.run.results[0].usageReviewRequired=true;g.retained.ready.run.results[1].usageReviewRequired=true;mutate(g.retained.ready);await g.retained.freezeRegistry();await rejectWithoutMutation(g,/cleanup/);
 }
});
test('registry rejects fourth owner, duplicate refs, cross-account third record, and third-owner name overlap',async()=>{
 for(const change of [r=>r.references.push(r.references[0]),r=>r.references[2]=r.references[1],r=>r.kind='runpod-dual-cleanup-registry',r=>r.references.pop()]){
  const f=await fixture();change(f.retained.registry);await f.retained.freezeRegistry();await assert.rejects(readCleanupRegistry(f.core.externalControl(f.m).store,f.retained.ref),/finite distinct/);
 }
 for(const overlap of [false,true]){
  const f=await fixture(),original=f.core.externalControl(f.m).store;
  const records=await Promise.all(f.retained.registry.references.map(async ref=>structuredClone(await original.readPrearm(ref))));
  const references=structuredClone(f.retained.registry.references);
  if(overlap){records[2]=structuredClone(records[0]);references[2]={...references[0],commit:'6'.repeat(40)};}
  else{records[2].accountId='other-account';references[2].sha256=await hash(records[2]);}
  const registry={...f.retained.registry,references},ref={...f.retained.ref,sha256:await hash(registry)};
  const byHash=new Map(references.map((r,i)=>[r.sha256,records[i]]));
  const store={repository:ref.repository,read:async()=>registry,readPrearm:async r=>byHash.get(r.sha256)};
  await assert.rejects(readCleanupRegistry(store,ref),/account|overlap/);
 }
});

test('a fourth unresolved ownership set stops admission instead of evicting a prior watch',async()=>{
 const f=await fixture(),m=structuredClone(f.m);m.id='fourth';const record=await f.arm(m,'7'.repeat(32));await f.core.stage(m);
 const db=await f.core.load(),owner=db.campaigns.fourth;owner.status='cancelled';owner.cleanupVerified=false;
 owner.attempts=[{provider:'runpod',name:record.launches[0].name,prearmSha256:m.externalControl.sha256,startedAt:f.now(),hourlyCents:74,uncertain:true}];await f.core.save(db);
 const binding=await f.core.actualSpendBinding();f.observation.ledgerSha256=binding.ledgerSha256;const basis=await f.freeze();f.intent.actualSpendBasisSha256=basis.sha256;f.funding.basisSha256=basis.sha256;await f.freezeFunding();f.retained.basis=basis;await reconcile(f);
 await rejectWithoutMutation(f,/cleanup registry capacity/);
});
test('three-owner admission never falls back to the legacy additive funding path',async()=>{
 const f=await fixture();delete f.intent.actualSpendBasisSha256;await rejectWithoutMutation(f,/three-owner admission requires fresh actual-spend/);
});
