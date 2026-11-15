import test from 'node:test';
import assert from 'node:assert/strict';
import {cashPlan,actualCash,cloudflareCoverage} from '../cash.mjs';
import {projectCampaign} from '../bundle.mjs';
import {fixture,projectionMeasurements} from './helpers.mjs';
import {snapshotLeaseRenewal} from '../worker.mjs';

test('provider ceilings cannot transfer and prepaid usage never adds cash twice',async()=>{
 const f=await fixture(),p=f.manifest.cash;
 assert.equal(cashPlan(p,10000).cashCommittedCents,10600);
 const noCloud=structuredClone(p);noCloud.cloudflare.workersCents=2001;assert.throws(()=>cashPlan(noCloud,10000),/separate ceiling/);
 const extraRP=structuredClone(p);extraRP.runpod.taxReserveCents=1;assert.throws(()=>cashPlan(extraRP,10000),/Runpod cash ceiling/);
 const renewal=structuredClone(p);renewal.cloudflare.reviewAt=renewal.cloudflare.fundedFrom+31*86400000;assert.throws(()=>cashPlan(renewal,10000),/thirty-day/);
 assert.throws(()=>cashPlan({...p,autoTopUps:true},10000),/top-ups/);
 const c={creditPurchasedCents:10000,runpodTaxPaidCents:0,providerUsageCents:1000,unusedCreditCents:9000,cloudflare:{subscriptionCents:0,workersCents:0,durableObjectsCents:0,activeR2Cents:0,backupR2Cents:0,taxFeesCents:0}};
 assert.equal(actualCash(p,c).cashOutlayCents,10000);assert.equal(actualCash(p,c).withinBudget,true);
 assert.equal(actualCash(p,{...c,unusedCreditCents:10000}).withinBudget,false);
});
test('twenty-four-hour projection counts publication, claim, ledger and thirty-day storage work',()=>{
 const m=projectionMeasurements(),r=projectCampaign([{bytes:100}],m);
 assert.equal(r.publicationPasses,722);assert.equal(r.projectedClaims,24);assert.equal(r.repeatedTransferBytes,24100*722);assert(r.doWriteOperations>r.ledgerSaves);assert(r.cloudflareProjectedCents>0);
 assert.throws(()=>projectCampaign([{bytes:100}],{...m,newObjects:100}),/object count/);
 assert.throws(()=>projectCampaign([{bytes:100}],{...m,newClaims:100}),/claim count/);
 assert.throws(()=>projectCampaign([{bytes:100}],{...m,largestProjectedObjectBytes:67108865}),/64 MiB/);
 assert.throws(()=>projectCampaign([{bytes:100}],{...m,rates:{...m.rates,doWritePerMillionCents:1e9}}),/reserved funding/);
 assert.throws(()=>projectCampaign([{bytes:100}],{...m,bytesPerSecond:1}),/durability window/);
});
test('snapshot renewal stays immediate and periodic across many files without per-file ledger saves',async()=>{
 let now=0,calls=0;const renew=snapshotLeaseRenewal(async()=>{calls++;},()=>now);
 for(let i=0;i<1000;i++)await renew();assert.equal(calls,1);
 now=19999;await renew();assert.equal(calls,1);now=20000;await renew();assert.equal(calls,2);
 now=40000;await renew();assert.equal(calls,3);
});
test('Cloudflare allocation covers the original deadline and funded autonomous cleanup/response window',async()=>{
 const f=await fixture(),now=f.now(),deadline=f.manifest.deadline,forecastUntil=deadline+5400000;
 assert.equal(cloudflareCoverage(f.manifest.cash,{now,deadline,forecastUntil}).requiredUntil,forecastUntil);
 const early=structuredClone(f.manifest.cash);early.cloudflare.reviewAt=now+3600000;
 assert.throws(()=>cloudflareCoverage(early,{now,deadline,forecastUntil}),/full autonomous/);
 const noResponse=structuredClone(f.manifest.cash);noResponse.cloudflare.reviewAt=deadline+3600000;
 assert.throws(()=>cloudflareCoverage(noResponse,{now,deadline,forecastUntil}),/full autonomous/);
 assert.throws(()=>cloudflareCoverage(f.manifest.cash,{now,deadline,forecastUntil:now+31*86400000}),/full autonomous/);
 assert.throws(()=>cloudflareCoverage(f.manifest.cash,{now,deadline,forecastUntil:undefined}),/validated campaign/);
 const exact=structuredClone(f.manifest.cash);exact.cloudflare.reviewAt=forecastUntil;
 assert.equal(cloudflareCoverage(exact,{now,deadline,forecastUntil}).reviewAt,forecastUntil);
 assert.equal(cloudflareCoverage(f.manifest.cash,{now,deadline,forecastUntil:now+3600000}).requiredUntil,deadline);
});
