// Synthetic test evidence only. Never use these amounts or rates for a launch.
export function syntheticGithubUsage(now,cutoff,{repository='owner/private-compute-control'}={}) {
  return {schema:1,repository,sharedAccountAcknowledged:true,periodStart:now-86400000,periodEnd:now+30*86400000,
    observedAt:now,expiresAt:now+2*86400000,remainingComputeCents:1000000,remainingStorageBytes:1073741824,storageHeadroomBasis:'conservative-effective-bytes-through-period-end',
    otherCiReserveCents:100,otherCiStorageBytes:1024,imageBuildReserveCents:200,imageBuildStorageBytes:2048,
    cleanupMarginMs:3600000,autonomousUntil:cutoff+3600000,ownerResponseMarginMs:1800000,retryJobs:3,runnerMinutePriceCents:1,storageByteHourPriceCents:0.000000001,
    cleanupReceiptStorageBytes:1024,overageBlocked:true,overageEvidence:{classification:'user-attested',reference:'synthetic-overage-block-proof'},
    evidenceReference:'synthetic-shared-reservation-only',rateEvidenceReference:'synthetic-rates-not-a-quote',owner:'fixture-owner',escalateAt:cutoff+3600000};
}
