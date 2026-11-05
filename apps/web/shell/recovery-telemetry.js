import { RECOVERY_DIAGNOSTICS, sanitizeRecoveryDiagnosticEvent } from '../generated/packages/shared-types/src/recovery-diagnostics.js';

export const RECOVERY_TELEMETRY_LIMITS = Object.freeze({ queue: 64, batchesPerHour: 20, windowMs: 3_600_000, batchDelayMs: 1_000, requestMs: 5_000 });
// Shared across account/transport replacements in this page, without retaining
// any identity or event. Reloading the document starts a fresh page allowance.
const pageBudget = { windowStarted: null, batches: 0 };

// A separate, memory-only observer. It never uses the command journal, account
// fetcher, gameplay retries or durable storage. Failed batches are dropped.
export function createRecoveryTelemetry({ fetcher = globalThis.fetch, clock = Date.now,
  schedule = setTimeout, cancel = clearTimeout, uuid = () => crypto.randomUUID(),
  budget = pageBudget,
  environment = () => ({ online: globalThis.navigator?.onLine,
    visibility: globalThis.document?.visibilityState,
    observedDeploymentSha: globalThis.__righeltObservedDeploymentSha, loadedBuild: 'unavailable' }),
} = {}) {
  let retired = false, queue = [], dropped = 0, timer = null, inflight = null;
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const scheduleFlush = () => {
    if (retired || timer !== null || inflight || !queue.length) return;
    timer = schedule(() => { timer = null; void flush(); }, RECOVERY_TELEMETRY_LIMITS.batchDelayMs);
    timer?.unref?.();
  };
  const flush = async ({ keepalive = false } = {}) => {
    try {
      if (retired || inflight || !queue.length) return;
      clearTimer();
      const now = clock();
      // A backwards wall clock cannot replenish the upload allowance.
      if (budget.windowStarted === null || now - budget.windowStarted >= RECOVERY_TELEMETRY_LIMITS.windowMs) { budget.windowStarted = now; budget.batches = 0; }
      if (budget.batches >= RECOVERY_TELEMETRY_LIMITS.batchesPerHour) { dropped += queue.length; queue = []; return; }
      const events = queue.splice(0, RECOVERY_DIAGNOSTICS.maximumEvents);
      if (dropped) { events[0] = { ...events[0], droppedEvents: dropped, truncated: true }; dropped = 0; }
      const body = JSON.stringify({ schemaVersion: RECOVERY_DIAGNOSTICS.schemaVersion, events });
      if (new TextEncoder().encode(body).byteLength > RECOVERY_DIAGNOSTICS.maximumBytes) { dropped += events.length; scheduleFlush(); return; }
      budget.batches++;
      const owner = { controller: new AbortController(), timeout: null, release: null };
      inflight = owner;
      // Race independently: a noncompliant/custom fetcher may ignore abort.
      const deadline = new Promise(resolve => { owner.release = resolve; owner.timeout = schedule(() => {
        owner.controller.abort(); resolve();
      }, RECOVERY_TELEMETRY_LIMITS.requestMs); owner.timeout?.unref?.(); });
      const request = Promise.resolve().then(() => {
        if (retired || inflight !== owner) return;
        return fetcher(RECOVERY_DIAGNOSTICS.path, { method: 'POST', credentials: 'omit', cache: 'no-store',
          redirect: 'error', keepalive, signal: owner.controller.signal,
          headers: { 'content-type': 'application/json' }, body });
      }).then(response => { void response?.body?.cancel?.().catch(() => {}); }).catch(() => {});
      try { await Promise.race([request, deadline]); }
      finally {
        cancel(owner.timeout);
        if (inflight === owner) { inflight = null; scheduleFlush(); }
      }
    } catch { /* Diagnostic failure has no gameplay effects. */ }
  };
  return {
    record(input) {
      try {
        if (retired) return;
        const event = sanitizeRecoveryDiagnosticEvent({ ...environment(), ...input, at: clock(), eventId: uuid() });
        if (!event) return;
        if (queue.length >= RECOVERY_TELEMETRY_LIMITS.queue) { queue.shift(); dropped++; }
        queue.push(event); scheduleFlush();
      } catch { /* Environment, getters and sinks are untrusted diagnostics. */ }
    },
    flush,
    retire() {
      retired = true; clearTimer(); queue = [];
      if (inflight) { cancel(inflight.timeout); inflight.controller.abort(); inflight.release(); }
    },
  };
}
