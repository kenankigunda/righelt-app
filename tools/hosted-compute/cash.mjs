import { assert, POLICY } from './policy.mjs';

export const CLOUDFLARE_COSTS = Object.freeze(['subscriptionCents', 'workersCents', 'durableObjectsCents', 'activeR2Cents', 'backupR2Cents', 'taxFeesCents']);
const cents = (n) => Number.isSafeInteger(n) && n >= 0;

// Purchased credit is cash once. Allocating/consuming it never buys it again.
export function cashPlan(plan, computeCap) {
  assert(plan?.schema === 2 && plan.autoTopUps === false, 'separate provider cash plan with automatic top-ups off required');
  const rp = plan.runpod, cf = plan.cloudflare;
  assert(rp && ['cashCeilingCents', 'purchasedCreditCents', 'openingCreditCents', 'taxReserveCents'].every(k => cents(rp[k])), 'invalid Runpod funding');
  assert(rp.cashCeilingCents > 0 && rp.cashCeilingCents <= POLICY.pilotCents, 'Runpod cash ceiling exceeds authorization');
  const runpodCashCents = rp.purchasedCreditCents + rp.taxReserveCents;
  assert(runpodCashCents <= rp.cashCeilingCents, 'Runpod purchases and taxes exceed Runpod cash ceiling');
  assert(cf && cents(cf.cashCeilingCents) && cf.cashCeilingCents > 0 && cf.cashCeilingCents <= POLICY.cloudflareCents && CLOUDFLARE_COSTS.every(k => cents(cf[k])), 'invalid Cloudflare funding');
  const cloudflareReservedCents = CLOUDFLARE_COSTS.reduce((sum, k) => sum + cf[k], 0);
  assert(cloudflareReservedCents > 0 && cloudflareReservedCents <= cf.cashCeilingCents, 'Cloudflare thirty-day reserve exceeds its separate ceiling or is missing');
  assert(cf.retentionDays === 30 && Number.isSafeInteger(cf.fundedFrom) && cf.fundedFrom > 0 && Number.isSafeInteger(cf.reviewAt) && cf.reviewAt > cf.fundedFrom && cf.reviewAt <= cf.fundedFrom + cf.retentionDays * 86400000 && typeof cf.owner === 'string' && cf.owner.length > 0, 'dated thirty-day retention owner/review required');
  assert(Number.isSafeInteger(plan.computeUsageCapCents) && plan.computeUsageCapCents === computeCap && computeCap > 0 && computeCap <= rp.openingCreditCents + rp.purchasedCreditCents, 'compute allowance exceeds allocated funded credit');
  assert(Number.isSafeInteger(plan.cloudflareUsageCapCents) && plan.cloudflareUsageCapCents > 0 && plan.cloudflareUsageCapCents <= cloudflareReservedCents, 'Cloudflare campaign allocation exceeds reserved funding');
  assert(typeof plan.evidenceReference === 'string' && plan.evidenceReference.length >= 8, 'funding/headroom evidence required');
  return { runpodCashCents, cloudflareReservedCents, cashCommittedCents: runpodCashCents + cloudflareReservedCents,
    computeUsageCapCents: computeCap, cloudflareUsageCapCents:plan.cloudflareUsageCapCents, fundedCreditCents: rp.openingCreditCents + rp.purchasedCreditCents };
}

export function actualCash(plan, actual) {
  const funding = cashPlan(plan, plan.computeUsageCapCents);
  assert(actual && ['creditPurchasedCents', 'runpodTaxPaidCents', 'providerUsageCents', 'unusedCreditCents'].every(k => cents(actual[k])) && actual.cloudflare && CLOUDFLARE_COSTS.every(k => cents(actual.cloudflare[k])), 'complete separate cash and usage ledger required');
  const cloudflarePaidCents = CLOUDFLARE_COSTS.reduce((sum, k) => sum + actual.cloudflare[k], 0);
  const runpodPaidCents = actual.creditPurchasedCents + actual.runpodTaxPaidCents;
  const withinBudget = actual.creditPurchasedCents <= plan.runpod.purchasedCreditCents && actual.runpodTaxPaidCents <= plan.runpod.taxReserveCents &&
    runpodPaidCents <= plan.runpod.cashCeilingCents && cloudflarePaidCents <= plan.cloudflare.cashCeilingCents &&
    CLOUDFLARE_COSTS.every(k => actual.cloudflare[k] <= plan.cloudflare[k]) && actual.providerUsageCents <= plan.computeUsageCapCents &&
    actual.providerUsageCents + actual.unusedCreditCents <= funding.fundedCreditCents;
  return { withinBudget, runpodPaidCents, cloudflarePaidCents, cashOutlayCents: runpodPaidCents + cloudflarePaidCents };
}
