import { assert } from './policy.mjs';
import { projectCampaign } from './bundle.mjs';
import { cashPlan, actualCash } from './cash.mjs';
import { verifyQualificationReceipts } from './qualification.mjs';

export async function qualifyPilot(report){
 assert(report?.provider==='runpod','one Runpod configuration required');
 cashPlan(report.cash,report.cash?.computeUsageCapCents);
 assert(Number.isFinite(report.elapsedSeconds)&&report.elapsedSeconds>0&&report.elapsedSeconds<=86400,'bounded campaign elapsed time required');
 const w=report.workload;
 assert(w&&Array.isArray(w.workIds)&&w.workIds.length&&new Set(w.workIds).size===w.workIds.length,'frozen short workload required');
 const identical=ids=>Array.isArray(ids)&&new Set(ids).size===ids.length&&JSON.stringify([...ids].sort())===JSON.stringify([...w.workIds].sort());
 const complete=['attemptedWorkIds','completedWorkIds','verifiedWorkIds'].every(k=>identical(report[k]))&&report.failedWorkIds?.length===0&&report.unfinishedWorkIds?.length===0;
 const required=['correctnessPassed','recoveryPassed','cleanupVerified','cudaPassed','macDisconnectedPassed','hostLossPassed','backupRestorePassed'];
 let projectionPassed=false;
 try{const projected=projectCampaign(report.bundleProjection?.files,report.bundleProjection?.measurements);projectionPassed=projected.qualified===true && report.bundleProjection.measurements.cloudflareReserveCents<=report.cash.cloudflareUsageCapCents && projected.cloudflareProjectedCents<=report.cash.cloudflareUsageCapCents;}catch{}
 let receiptIdentity=null;
 try{receiptIdentity=await verifyQualificationReceipts(report);}catch{}
 const qualified=projectionPassed&&!!receiptIdentity&&complete&&required.every(k=>report[k]===true);
 const actual=report.actualCash;
 const {withinBudget,cashOutlayCents,runpodPaidCents,cloudflarePaidCents}=actualCash(report.cash,actual);
 return {outcome:qualified&&withinBudget?'operationally-qualified':'insufficient-evidence',qualified:qualified&&withinBudget,
   cashOutlayCents,runpodPaidCents,cloudflarePaidCents,qualification:receiptIdentity,providerUsageCents:actual.providerUsageCents,unusedPrepaidCreditCents:actual.unusedCreditCents,
   missing:[...required.filter(k=>report[k]!==true),...(projectionPassed?[]:['measured24HourBundleProjection']),...(receiptIdentity?[]:['rawQualificationDrillReceipts'])],workloadComplete:complete,withinBudget,strengthEstablished:false};
}
