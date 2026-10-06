export const POLICY = Object.freeze({ sampleMs: 15_000, sustainedMs: 60_000, recoverySamples: 4, graceMs: 5_000, ownershipSampleMs: 500, diagnosticBytes: 6000, auditMax: 100, auditAgeMs: 7 * 86400_000 });

export function pressureState() { return { blocked: false, level: 'unknown', since: null, normalSamples: 0, recovered: false, releaseIdle: false, cancel: false }; }
export function advancePressure(previous, sample, now, policy = POLICY) {
  const level = sample.level;
  const state = { ...previous, level, recovered: false, releaseIdle: false, cancel: false };
  if (level === 'unknown') { state.normalSamples = 0; state.since = null; return state; }
  if (level === 'normal') {
    state.since = null;
    state.normalSamples++;
    if (state.normalSamples >= policy.recoverySamples) { state.recovered = previous.blocked; state.blocked = false; }
    return state;
  }
  state.normalSamples = 0;
  state.blocked = true;
  state.since = previous.level === level && previous.since !== null ? previous.since : now;
  state.releaseIdle = now - state.since >= policy.sustainedMs;
  state.cancel = level === 'critical' && state.releaseIdle;
  return state;
}
