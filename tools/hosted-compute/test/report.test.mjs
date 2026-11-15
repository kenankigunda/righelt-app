import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyPilot } from '../report.mjs';
import { qualificationIdentity, QUALIFICATION_CHECKS } from '../qualification.mjs';
import { canonical, encode, sha256 } from '../policy.mjs';
import { fixture, projectionMeasurements } from './helpers.mjs';

export async function qualifyingReport(f) {
  const runtimeSha256='e'.repeat(64), host=f.manifest.phases[0].host;
  const report={provider:'runpod',sourceRevision:f.manifest.sourceRevision,dependencySha256:f.manifest.dependencySha256,host,runtimeSha256,cash:f.manifest.cash,elapsedSeconds:600,
    bundleProjection:{files:[{bytes:100}],measurements:projectionMeasurements()},workload:{workIds:['a','b']},attemptedWorkIds:['a','b'],completedWorkIds:['a','b'],verifiedWorkIds:['a','b'],failedWorkIds:[],unfinishedWorkIds:[],
    correctnessPassed:true,recoveryPassed:true,cleanupVerified:true,cudaPassed:true,macDisconnectedPassed:true,hostLossPassed:true,backupRestorePassed:true,
    actualCash:{creditPurchasedCents:10000,runpodTaxPaidCents:0,providerUsageCents:100,unusedCreditCents:9900,cloudflare:{subscriptionCents:0,workersCents:0,durableObjectsCents:0,activeR2Cents:0,backupR2Cents:0,taxFeesCents:0}}};
  report.receipts=await Promise.all(QUALIFICATION_CHECKS.map(async check=>{
    const raw=canonical({schema:1,kind:'qualification-drill',check,passed:true,fixtureOnly:false,environment:'runpod-secure-cuda',qualification:qualificationIdentity(report,host,runtimeSha256),campaign:'physical-proof',manifestSha256:'a'.repeat(64),startedAt:f.now()-1000,completedAt:f.now(),evidenceSha256:['b'.repeat(64)]});
    return {raw,sha256:await sha256(encode(raw))};
  }));
  return report;
}
test('one Runpod report requires raw bound drill evidence without a winner or strength claim',async()=>{
 const f=await fixture(),report=await qualifyingReport(f),result=await qualifyPilot(report);
 assert.equal(result.qualified,true);assert.equal(result.cashOutlayCents,10000);assert.equal(result.strengthEstablished,false);assert.equal(result.winner,undefined);
 for(const changed of [{bundleProjection:undefined},{receipts:undefined},{backupRestorePassed:false},{verifiedWorkIds:['a']}])assert.equal((await qualifyPilot({...report,...changed})).qualified,false);
 const tampered=structuredClone(report);tampered.receipts[0].raw+=' ';assert.equal((await qualifyPilot(tampered)).qualified,false);
 const wrongRuntime=structuredClone(report);wrongRuntime.runtimeSha256='f'.repeat(64);assert.equal((await qualifyPilot(wrongRuntime)).qualified,false);
 const fixtureOnly=structuredClone(report),raw=JSON.parse(fixtureOnly.receipts[0].raw);raw.fixtureOnly=true;fixtureOnly.receipts[0].raw=canonical(raw);fixtureOnly.receipts[0].sha256=await sha256(encode(fixtureOnly.receipts[0].raw));assert.equal((await qualifyPilot(fixtureOnly)).qualified,false);
 const overspent=structuredClone(report);overspent.actualCash.cloudflare.workersCents=101;assert.equal((await qualifyPilot(overspent)).withinBudget,false);
});
test('fresh quote timestamps and price do not change hardware/runtime qualification identity',async()=>{
 const f=await fixture(),h=f.manifest.phases[0].host;
 assert.deepEqual(qualificationIdentity(f.manifest,h,'e'.repeat(64)),qualificationIdentity(f.manifest,{...h,quoteObservedAt:h.quoteObservedAt+1000,quoteExpires:h.quoteExpires+1000,hourlyCents:99},'e'.repeat(64)));
 assert.notDeepEqual(qualificationIdentity(f.manifest,h,'e'.repeat(64)),qualificationIdentity(f.manifest,{...h,gpu:'different'},'e'.repeat(64)));
});
