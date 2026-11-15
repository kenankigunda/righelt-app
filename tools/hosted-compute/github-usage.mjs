import { assert,canonical,encode,sha256,POLICY } from './policy.mjs';

const nonnegative=n=>Number.isSafeInteger(n) && n>=0;
const evidence=value=>typeof value==='string' && value.length>=8 && value.length<=1000;

// A reviewed shared-account forecast, not an exclusive reservation or a live
// billing API. observedAt is factual evidence time. expiresAt is the reviewed
// allocation's validity, not a mid-campaign screenshot-refresh appointment.
// Included credit consumption is not permission for paid overage.
export function projectGithubUsage(plan,{createdAt,cutoff,repository}) {
  assert(plan?.schema===1 && plan.repository===repository && plan.sharedAccountAcknowledged===true,'reviewed shared GitHub allowance required');
  assert(typeof plan.owner==='string' && plan.owner.length>0 && plan.owner.length<=120,'named GitHub reservation/review owner required');
  assert([plan.periodStart,plan.periodEnd,plan.observedAt,plan.expiresAt,createdAt,cutoff,plan.escalateAt,plan.autonomousUntil].every(Number.isSafeInteger),'GitHub billing/evidence/allocation times required');
  assert(plan.periodStart>0 && plan.periodStart<=plan.observedAt && plan.observedAt<=createdAt && createdAt<plan.expiresAt && plan.expiresAt<=plan.periodEnd && cutoff>createdAt,'GitHub allowance allocation is expired or outside billing period');
  assert(nonnegative(plan.cleanupMarginMs) && plan.cleanupMarginMs>=POLICY.cleanupEveryMs && Number.isSafeInteger(cutoff+plan.cleanupMarginMs) && cutoff+plan.cleanupMarginMs<=plan.periodEnd,'finite cleanup margin must fit this billing period');
  assert(plan.autonomousUntil>=cutoff+plan.cleanupMarginMs && nonnegative(plan.ownerResponseMarginMs) && plan.ownerResponseMarginMs>=POLICY.cleanupEveryMs,'GitHub autonomous allocation must cover the full campaign, cleanup and owner response margin');
  const forecastUntil=plan.autonomousUntil+plan.ownerResponseMarginMs;
  assert(Number.isSafeInteger(forecastUntil) && forecastUntil<=plan.expiresAt && forecastUntil<=plan.periodEnd && plan.escalateAt===plan.autonomousUntil,'GitHub allocation validity and funded owner response must extend beyond the autonomous window');
  const fields=['remainingComputeCents','remainingStorageBytes','otherCiReserveCents','otherCiStorageBytes','imageBuildReserveCents','imageBuildStorageBytes','cleanupReceiptStorageBytes','retryJobs'];
  assert(fields.every(key=>nonnegative(plan[key])) && plan.retryJobs>=1,'explicit GitHub headroom, other CI, image, storage and retry reservations required');
  assert(plan.storageHeadroomBasis==='conservative-effective-bytes-through-period-end','included storage must be reviewed effective capacity through billing-period end');
  assert(Number.isFinite(plan.runnerMinutePriceCents) && plan.runnerMinutePriceCents>0 && Number.isFinite(plan.storageByteHourPriceCents) && plan.storageByteHourPriceCents>=0 && evidence(plan.rateEvidenceReference) && evidence(plan.evidenceReference),'reviewed upper-bound GitHub rates and reservation evidence required');
  assert(plan.overageBlocked===true && ['user-attested','api-verified'].includes(plan.overageEvidence?.classification) && evidence(plan.overageEvidence?.reference),'verified or explicitly user-attested GitHub overage block required');
  assert(nonnegative(POLICY.cleanupEveryMs) && POLICY.cleanupEveryMs>0 && nonnegative(POLICY.cleanupJobMinutes) && POLICY.cleanupJobMinutes>0,'shared cleanup schedule/timeout policy required');
  // Include a boundary job and round each job to its whole timeout in minutes.
  // Retry reserve also covers bounded manual dispatches and delayed runs.
  const nominalJobs=Math.ceil((forecastUntil-createdAt)/POLICY.cleanupEveryMs)+1;
  const jobs=nominalJobs+plan.retryJobs,runnerMinutes=jobs*Math.ceil(POLICY.cleanupJobMinutes);
  const cleanupComputeCents=Math.ceil(runnerMinutes*plan.runnerMinutePriceCents);
  const allocatedComputeCents=plan.otherCiReserveCents+plan.imageBuildReserveCents+cleanupComputeCents;
  const allocatedStorageBytes=plan.otherCiStorageBytes+plan.imageBuildStorageBytes+plan.cleanupReceiptStorageBytes;
  // Effective capacity is derived conservatively from the remaining included
  // byte-hours, not copied from an instantaneous dashboard capacity. Reserve
  // CI/image artifacts through period end even if cleanup finishes much sooner.
  const storageByteHours=allocatedStorageBytes*(plan.periodEnd-createdAt)/3600000;
  const grossStorageCents=Math.ceil(storageByteHours*plan.storageByteHourPriceCents);
  assert([nominalJobs,jobs,runnerMinutes,cleanupComputeCents,allocatedComputeCents,allocatedStorageBytes,grossStorageCents].every(nonnegative),'GitHub forecast exceeds exact accounting range');
  assert(allocatedComputeCents<=plan.remainingComputeCents && allocatedStorageBytes<=plan.remainingStorageBytes,'shared GitHub included allowance cannot fund this launch package');
  return {nominalJobs,jobs,runnerMinutes,cleanupComputeCents,allocatedComputeCents,allocatedStorageBytes,grossStorageCents,
    autonomousUntil:plan.autonomousUntil,ownerResponseMarginMs:plan.ownerResponseMarginMs,forecastUntil,storageReservedUntil:plan.periodEnd,escalateAt:plan.escalateAt,newCashAuthorizedCents:0,indefiniteCleanupFunded:false,exclusiveAccountReservation:false};
}
export async function freezeGithubUsage(plan,context) {
  const record=structuredClone(plan),projection=projectGithubUsage(record,context);
  return {record,sha256:await sha256(encode(canonical(record))),projection};
}
export async function verifyGithubUsage(frozen,context) {
  assert(frozen?.record && frozen.sha256===await sha256(encode(canonical(frozen.record))),'frozen GitHub usage identity differs');
  const projection=projectGithubUsage(frozen.record,context);
  assert(canonical(frozen.projection)===canonical(projection),'frozen GitHub usage forecast differs');
  return projection;
}
export function githubUsageReviewRequired(frozen,now) {
  const plan=frozen.record;
  return now>=Math.min(plan.expiresAt,plan.escalateAt,frozen.projection.forecastUntil);
}
export function assertGithubUsageCurrent(frozen,now) {
  const plan=frozen.record;
  assert(Number.isSafeInteger(now) && plan.observedAt<=now && now<plan.expiresAt && now<plan.periodEnd && now<plan.escalateAt,'GitHub included-usage allocation or reservation review is overdue');
}
