import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGithubUsage,freezeGithubUsage,verifyGithubUsage,assertGithubUsageCurrent,githubUsageReviewRequired } from '../github-usage.mjs';
import { syntheticGithubUsage } from './github-usage-fixture.mjs';

const now=Date.UTC(2026,10,15),cutoff=now+3600000,repository='owner/private-compute-control';
const context={createdAt:now,cutoff,repository};
test('GitHub forecast reserves whole timeout minutes, other CI, image work, storage and delayed/retry jobs',()=>{
  const plan={...syntheticGithubUsage(now,cutoff),runnerMinutePriceCents:1.25,storageByteHourPriceCents:0.000001,remainingComputeCents:513,remainingStorageBytes:4096};
  const forecast=projectGithubUsage(plan,context);
  // One hour work, one hour cleanup, half-hour owner response, boundary+retries.
  assert.equal(forecast.nominalJobs,31);assert.equal(forecast.jobs,34);assert.equal(forecast.runnerMinutes,170);
  assert.equal(forecast.cleanupComputeCents,213);assert.equal(forecast.allocatedComputeCents,513);assert.equal(forecast.allocatedStorageBytes,4096);
  assert.equal(forecast.storageReservedUntil,plan.periodEnd);assert.equal(forecast.grossStorageCents,3);
  assert.equal(forecast.newCashAuthorizedCents,0);assert.equal(forecast.indefiniteCleanupFunded,false);assert.equal(forecast.exclusiveAccountReservation,false);
  assert.throws(()=>projectGithubUsage({...plan,remainingComputeCents:512},context),/included allowance/);
  assert.throws(()=>projectGithubUsage({...plan,remainingComputeCents:475},context),/included allowance/); // Old forecast omitted owner response.
  assert.throws(()=>projectGithubUsage({...plan,remainingStorageBytes:4095},context),/included allowance/);
});
test('GitHub admission requires classified overage blocking, shared usage evidence and finite current billing coverage',()=>{
  const plan=syntheticGithubUsage(now,cutoff);
  for(const bad of [{overageBlocked:false},{overageEvidence:{classification:'unknown',reference:'synthetic-reference'}},{sharedAccountAcknowledged:false},
    {observedAt:now+1},{expiresAt:now},{periodEnd:cutoff+1},{escalateAt:cutoff-1},{expiresAt:cutoff-1},{autonomousUntil:cutoff-1},{ownerResponseMarginMs:299999},{retryJobs:0},{runnerMinutePriceCents:NaN},{rateEvidenceReference:''},{storageHeadroomBasis:'instantaneous-dashboard'}])
    assert.throws(()=>projectGithubUsage({...plan,...bad},context));
  assert.equal(projectGithubUsage({...plan,overageEvidence:{classification:'api-verified',reference:'synthetic-api-proof'}},context).newCashAuthorizedCents,0);
  assert.equal(projectGithubUsage({...plan,imageBuildReserveCents:0,imageBuildStorageBytes:0},context).allocatedComputeCents,270);
});
test('frozen usage bytes and projection cannot change, and overdue review blocks new launches without disabling cleanup',async()=>{
  const plan=syntheticGithubUsage(now,cutoff);
  const frozen=await freezeGithubUsage(plan,context);
  assert.equal((await verifyGithubUsage(frozen,context)).forecastUntil,cutoff+5400000);
  await assert.rejects(verifyGithubUsage({...frozen,record:{...plan,remainingComputeCents:1}},context),/identity differs/);
  await assert.rejects(verifyGithubUsage({...frozen,projection:{...frozen.projection,jobs:1}},context),/forecast differs/);
  assertGithubUsageCurrent(frozen,now+1);
  assertGithubUsageCurrent(frozen,cutoff-1);
  assert.equal(githubUsageReviewRequired(frozen,plan.autonomousUntil-1),false);
  assert.throws(()=>assertGithubUsageCurrent(frozen,plan.autonomousUntil),/review is overdue/);
  assert.equal(githubUsageReviewRequired(frozen,cutoff+86400000),true);
});
