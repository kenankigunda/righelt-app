import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {runtimeUpgradeEndpoint} from '../runtime-upgrade.mjs';
import policy from '../../ai-trainer/righelt_training/arithmetic-policy-v1.json' with {type:'json'};
const before={schema:1,kind:'execution-recipe',settings:{mode:'closed-loop-fixture',optimizer:{kind:'AdamW',lr:0.001},sourceFiles:{'model.py':'1'.repeat(64),'runner.py':'2'.repeat(64)}},incumbent:{checkpointSha256:'3'.repeat(64)},dataSha256:'4'.repeat(64)};
const after={...before,settings:{...before.settings,arithmeticPolicy:policy,sourceFiles:{...before.settings.sourceFiles,'runner.py':'3'.repeat(64),'arithmetic.py':'4'.repeat(64)}}};
async function fixture(change=()=>{}){
 const recipes={before:structuredClone(before),after:structuredClone(after)};change(recipes);
 const f=await setup({upgradeRecipes:recipes});
 const receipt={schema:1,kind:'manual-runtime-upgrade',scope:'public-canary-runtime-qualification',createdAt:f.now(),expiresAt:f.now()+600000,
  prior:runtimeUpgradeEndpoint(await f.state()),next:runtimeUpgradeEndpoint(await f.ui()),
  publicInputs:Object.fromEntries(['checkpointSha256','corpusSha256','recipeSha256','seed'].map(k=>[k,f.m[k]])),arithmeticPolicy:policy,
  review:{sourceRevision:f.m.sourceRevision,proofInventorySha256:'5'.repeat(64),localEvidenceSha256:'6'.repeat(64),independentReviewSha256:'7'.repeat(64)},
  numericTolerance:{atol:1e-5,rtol:1e-4},historicalFailureDisposition:'preserved-failed-cause-unknown'};
 const freeze=async()=>{f.intent.runtimeUpgrade=await f.receipt(receipt,'6');};await freeze();
 return {...f,receipt,freeze};
}
test('explicit reviewed runtime upgrade admits only a new public canary and preserves clocks, funding and old ownership',async()=>{
 const f=await fixture(),old=await f.state();await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();
 const work=await f.core.work('ui',1);assert.equal(work.manifest.sourceRevision,'e'.repeat(40));assert.equal(work.manifest.executionRecipeSha256,f.m.executionRecipeSha256);
 assert.deepEqual(await f.state(),old);assert.equal(f.providers.creates,1);assert.equal((await f.ui()).programAnchor.acceptedAt,f.intent.createdAt);assert.equal((await f.core.load()).pilotReservedCents,2000);
 await f.core.cancel('ui');await f.core.reconcile();await f.core.reconcile();assert.equal((await f.ui()).cleanupVerified,true);assert.equal((await f.state()).attempts[0].endedAt,undefined);
});
test('upgrade is optional authority, never a silent relaxation of same-runtime admission',async()=>{
 const f=await fixture();delete f.intent.runtimeUpgrade;const old=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent),/frozen source/);assert.deepEqual(await f.core.load(),old);assert.equal(f.providers.creates,1);
});
test('pinned upgrade rejects changed endpoint, review, tolerance, policy, public inputs or historical disposition before allocation',async()=>{
 for(const change of [r=>{r.next.image='other';},r=>{r.prior.sourceRevision='f'.repeat(40);},r=>{r.review.sourceRevision='f'.repeat(40);},r=>{r.review.independentReviewSha256='missing';},r=>{r.numericTolerance.atol=1e-3;},r=>{r.arithmeticPolicy={...policy,cudaMatmul:'tf32'};},r=>{r.publicInputs.seed++;},r=>{r.historicalFailureDisposition='passed';},r=>{r.expiresAt=r.createdAt;},r=>{r.extra=true;}]){
  const f=await fixture();change(f.receipt);await f.freeze();const old=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent));assert.deepEqual(await f.core.load(),old);assert.equal(f.providers.creates,1);
 }
 const f=await fixture();f.intent.runtimeUpgrade.sha256='0'.repeat(64);await assert.rejects(f.core.manualPrepare('ui',f.intent),/bytes differ/);
});
test('actual recipe bytes cannot change optimizer, model, incumbent or unrelated sources under an upgrade receipt',async()=>{
 for(const change of [r=>{r.after.settings.optimizer.lr=0.1;},r=>{r.after.incumbent={checkpointSha256:'8'.repeat(64)};},r=>{r.after.settings.sourceFiles['model.py']='8'.repeat(64);},r=>{delete r.after.settings.arithmeticPolicy;}]){
  const f=await fixture(change);const old=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent));assert.deepEqual(await f.core.load(),old);assert.equal(f.providers.creates,1);
 }
});
