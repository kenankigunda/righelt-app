import { RECOVERY_DIAGNOSTICS, RECOVERY_DIAGNOSTIC_ENUMS, sanitizeRecoveryDiagnosticEvent } from '../generated/packages/shared-types/src/recovery-diagnostics.js';

export const RECOVERY_TELEMETRY_LIMITS = Object.freeze({ queue: 64, batchesPerHour: 20, windowMs: 3_600_000, batchDelayMs: 1_000, requestMs: 5_000 });
export const RECOVERY_TIMELINE_LIMIT = 128;
const timelineEnums = Object.freeze({
  owner: new Set(['connection', 'repair', 'recovery', 'request']),
  ownerAction: new Set(['acquired', 'transferred', 'released']),
  result: new Set(['started', 'blocked', 'succeeded', 'failed', 'resolved', 'terminal_failure', 'superseded']),
  activeEpisodeRelation: new Set(['active', 'unrelated', 'none']),
});
const timelineFlags = new Set(['closeClean', 'polling', 'manualRetry', 'terminalFailure']);
const timelineCounters = new Set(['closeCode', 'connectionGeneration']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;

const projectTimelineEvent = input => {
  try {
    const common = sanitizeRecoveryDiagnosticEvent(input);
    if (!common) return null;
    const event = { ...common };
    // The local timeline is deliberately narrower than the remote recovery
    // intake: command identity belongs to durable command evidence, not to
    // copied recovery support details.
    delete event.commandId;
    for (const [key, values] of Object.entries(timelineEnums)) if (values.has(input[key])) event[key] = input[key];
    for (const key of timelineFlags) if (typeof input[key] === 'boolean') event[key] = input[key];
    for (const key of timelineCounters) if (safeInteger(input[key]) && input[key] <= 65535) event[key] = input[key];
    if (input.reason === 'http_poll') event.polling = true;
    if (input.reason === 'manual_reconnect') event.manualRetry = true;
    return Object.freeze(event);
  } catch { return null; }
};

const projectRequestEvidence = input => {
  if (!input || !UUID.test(input.requestId ?? '')) return null;
  return Object.freeze(Object.fromEntries(Object.entries({
    requestId: input.requestId,
    requestKind: RECOVERY_DIAGNOSTIC_ENUMS.requestKind.includes(input.requestKind) ? input.requestKind : undefined,
    requestPhase: RECOVERY_DIAGNOSTIC_ENUMS.requestPhase.includes(input.requestPhase) ? input.requestPhase : undefined,
    requestRelationship: RECOVERY_DIAGNOSTIC_ENUMS.requestRelationship.includes(input.requestRelationship) ? input.requestRelationship : undefined,
    activeEpisodeRelation: timelineEnums.activeEpisodeRelation.has(input.activeEpisodeRelation) ? input.activeEpisodeRelation : undefined,
    result: input.requestRelationship === 'failure' || input.stage === 'request_failed' ? 'failed'
      : input.stage === 'response_received' && Number.isInteger(input.status) && input.status >= 200 && input.status <= 299 ? 'succeeded' : undefined,
    status: Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : undefined,
    durationMs: safeInteger(input.durationMs) ? input.durationMs : undefined,
    deadlineMs: safeInteger(input.deadlineMs) ? input.deadlineMs : undefined,
    serverBuild: input.serverBuild === 'unavailable' || UUID.test(input.serverBuild ?? '') ? input.serverBuild : undefined,
    stage: RECOVERY_DIAGNOSTIC_ENUMS.stage.includes(input.stage) ? input.stage : undefined,
    retry: safeInteger(input.retry) ? input.retry : undefined,
    generation: safeInteger(input.generation) ? input.generation : undefined,
    recoveryEpisodeId: UUID.test(input.recoveryEpisodeId ?? '') ? input.recoveryEpisodeId : undefined,
  }).filter(([, value]) => value !== undefined)));
};

export function projectRecoveryCopyDetails(report, timeline = []) {
  try {
    const attempts = [report?.initial, ...(Array.isArray(report?.events) ? report.events : [])].filter(Boolean);
    const failure = attempts.findLast(event => event.requestRelationship === 'failure' && UUID.test(event.requestId ?? '')) ?? null;
    const failedRecoveryRequest = projectRequestEvidence(failure);
    const requestTimeline = Object.freeze(attempts.map(projectRequestEvidence).filter(Boolean).slice(-RECOVERY_TIMELINE_LIMIT));
    const recoveryTimeline = Object.freeze(timeline.map(projectTimelineEvent).filter(Boolean));
    return Object.freeze({ schemaVersion: 1,
      incident: Object.freeze({
        ...(UUID.test(report?.id ?? '') ? { id: report.id } : {}),
        ...(safeInteger(report?.startedAt) ? { startedAt: report.startedAt } : {}),
        ...(safeInteger(report?.resolvedAt) ? { resolvedAt: report.resolvedAt } : {}),
        ...(report?.truncated === true ? { truncated: true } : {}),
      }),
      failedRecoveryRequest,
      requestTimeline,
      recoveryTimeline,
    });
  } catch { return Object.freeze({ schemaVersion: 1, incident: Object.freeze({}), failedRecoveryRequest: null,
    requestTimeline: Object.freeze([]), recoveryTimeline: Object.freeze([]) }); }
}

export function createRecoveryTimeline({ limit = RECOVERY_TIMELINE_LIMIT } = {}) {
  const maximum = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, RECOVERY_TIMELINE_LIMIT) : RECOVERY_TIMELINE_LIMIT;
  let events = [];
  return Object.freeze({
    record(input) {
      try {
        const frozen = projectTimelineEvent({ ...input,
          eventId: typeof input?.eventId === 'string' ? input.eventId : crypto.randomUUID() });
        if (!frozen) return null;
        events = [...events, frozen].slice(-maximum);
        return frozen;
      } catch { return null; }
    },
    snapshot() { return Object.freeze([...events]); },
  });
}
const pageTimeline = createRecoveryTimeline();
export const recoveryTimelineSnapshot = () => pageTimeline.snapshot();
// Shared across account/transport replacements in this page, without retaining
// any identity or event. Reloading the document starts a fresh page allowance.
const pageBudget = { windowStarted: null, batches: 0 };

// A separate, memory-only observer. It never uses the command journal, account
// fetcher, gameplay retries or durable storage. Failed batches are dropped.
export function createRecoveryTelemetry({ fetcher = globalThis.fetch, clock = Date.now,
  schedule = setTimeout, cancel = clearTimeout, uuid = () => crypto.randomUUID(),
  budget = pageBudget,
  timeline = pageTimeline,
  environment = () => ({ online: globalThis.navigator?.onLine,
    visibility: globalThis.document?.visibilityState,
    observedDeploymentSha: globalThis.__righeltObservedDeploymentSha, loadedBuild: globalThis.__righeltClientBuild }),
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
        const candidate = { ...environment(), ...input, at: clock(), eventId: uuid() };
        timeline.record(candidate);
        const event = sanitizeRecoveryDiagnosticEvent(candidate);
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
