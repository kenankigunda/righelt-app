import { assert, canonical } from './policy.mjs';

// Requirements come from the preregistered short workload, not observed winners.
export function evidenceComplete(r) {
  const w = r.workload;
  if (!w || !Array.isArray(w.workIds) || !w.workIds.length || new Set(w.workIds).size !== w.workIds.length) return false;
  for (const key of ['attemptedWorkIds', 'completedWorkIds', 'verifiedWorkIds']) {
    if (!Array.isArray(r[key]) || new Set(r[key]).size !== r[key].length || canonical([...r[key]].sort()) !== canonical([...w.workIds].sort())) return false;
  }
  for (const key of ['policyUsablePositions', 'terminalValuePositions', 'distinctOutcomeTrajectories', 'distinctFamilies', 'sampledPositions']) {
    if (!Number.isSafeInteger(r[key]) || r[key] < 0 || !Number.isSafeInteger(w.minimum?.[key]) || w.minimum[key] < 0 || r[key] < w.minimum[key]) return false;
  }
  return r.policyUsablePositions > 0 && r.distinctOutcomeTrajectories > 0 &&
    r.failedWorkIds?.length === 0 && r.unfinishedWorkIds?.length === 0;
}
export function recommend(reports) {
  assert(Array.isArray(reports) && reports.length === 2, 'exactly two pilot host reports required');
  const [a, b] = reports;
  for (const field of ['sourceRevision', 'checkpointSha256', 'corpusSha256', 'recipeSha256', 'executionRecipeSha256', 'workloadSha256', 'seed', 'workload']) assert(a[field] !== undefined && canonical(a[field]) === canonical(b[field]), `comparison differs: ${field}`);
  for (const r of reports) {
    assert(Number.isFinite(r.elapsedSeconds) && r.elapsedSeconds > 0 && Number.isFinite(r.totalCents) && r.totalCents > 0, 'complete cost and timing required');
    assert(Number.isFinite(r.operatorSteps) && r.operatorSteps >= 0, 'operator effort required');
  }
  const mechanicallyQualified = reports.filter(r => r.correctnessPassed === true && r.recoveryPassed === true && r.cleanupVerified === true);
  const eligible = mechanicallyQualified.filter(evidenceComplete);
  const measurements = reports.map(r => ({ ...r, evidenceComplete: evidenceComplete(r), policyPositionsPerDollar: evidenceComplete(r) ? r.policyUsablePositions / r.totalCents * 100 : null }));
  if (!eligible.length) return { outcome: mechanicallyQualified.length ? 'insufficient-evidence' : 'repair-required', winner: null, strengthEstablished: false, measurements };
  let winner = eligible[0], reason = 'only configuration completed the frozen workload and qualification';
  if (eligible.length === 2) {
    const ordered = [...eligible].sort((x, y) => y.policyUsablePositions / y.totalCents - x.policyUsablePositions / x.totalCents);
    const best = ordered[0], second = ordered[1];
    const close = (best.policyUsablePositions / best.totalCents) <= 1.1 * (second.policyUsablePositions / second.totalCents);
    winner = close ? [...eligible].sort((x, y) => x.operatorSteps - y.operatorSteps || x.elapsedSeconds - y.elapsedSeconds || x.totalCents - y.totalCents || x.provider.localeCompare(y.provider))[0] : best;
    reason = close ? 'yield within 10%; simpler operation then turnaround' : 'verified policy-usable positions per total cent';
  }
  return { outcome: 'recommendation', winner: winner.provider, reason, strengthEstablished: false, measurements };
}
