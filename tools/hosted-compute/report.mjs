import { assert } from './policy.mjs';

export function recommend(reports) {
  assert(Array.isArray(reports) && reports.length === 2, 'exactly two pilot host reports required');
  const [a, b] = reports;
  for (const field of ['sourceRevision', 'checkpointSha256', 'corpusSha256', 'recipeSha256', 'workloadSha256', 'seed']) assert(a[field] === b[field], `comparison differs: ${field}`);
  for (const r of reports) {
    assert(Number.isFinite(r.elapsedSeconds) && r.elapsedSeconds > 0 && Number.isFinite(r.totalCents) && r.totalCents > 0, 'complete cost and timing required');
    assert(Number.isSafeInteger(r.usefulTargets) && r.usefulTargets >= 0 && Number.isSafeInteger(r.terminalGames) && r.terminalGames >= 0, 'verified yield required');
    assert(Number.isFinite(r.operatorSteps) && r.operatorSteps >= 0, 'operator effort required');
  }
  const eligible = reports.filter(r => r.correctnessPassed === true && r.recoveryPassed === true && r.cleanupVerified === true);
  if (!eligible.length) return { outcome: 'repair-required', winner: null, strengthEstablished: false };
  let winner = eligible[0], reason = 'only qualified configuration';
  if (eligible.length === 2) {
    const ordered = [...eligible].sort((x, y) => y.usefulTargets / y.totalCents - x.usefulTargets / x.totalCents);
    const best = ordered[0], second = ordered[1];
    const close = best.usefulTargets === 0 || (best.usefulTargets / best.totalCents) <= 1.1 * (second.usefulTargets / second.totalCents);
    winner = close ? [...eligible].sort((x, y) => x.operatorSteps - y.operatorSteps || x.elapsedSeconds - y.elapsedSeconds || x.totalCents - y.totalCents || x.provider.localeCompare(y.provider))[0] : best;
    reason = close ? 'yield within 10%; simpler operation then turnaround' : 'verified useful targets per total cent';
  }
  return { outcome: 'recommendation', winner: winner.provider, reason, strengthEstablished: false,
    measurements: reports.map(r => ({ ...r, targetsPerDollar: r.usefulTargets / r.totalCents * 100 })) };
}
