// Remote diagnostics have a separate, much narrower contract than local issue
// reports. Never pass game models, account data or arbitrary error strings here.
export const RECOVERY_DIAGNOSTICS = Object.freeze({
  schemaVersion: 1,
  path: '/api/diagnostics/recovery',
  maximumBytes: 16 * 1024,
  maximumEvents: 16,
  maximumAgeMs: 24 * 60 * 60 * 1000,
  intakeWindowMs: 60 * 1000,
  intakePerWindow: 120,
});

export const RECOVERY_DIAGNOSTIC_ENUMS = Object.freeze(Object.fromEntries(Object.entries({
  type: ['recovery_started', 'recovery_blocked', 'recovery_completed', 'socket', 'lifecycle', 'admission_blocked', 'request_failed', 'health', 'readiness'],
  reason: ['manual_reconnect', 'pageshow', 'pagehide', 'visibility_resumed', 'visibility_hidden', 'network_online', 'network_hint', 'behind_server', 'inbound_timeout', 'socket_closed', 'socket_error', 'initial_snapshot_timeout', 'websocket_unavailable', 'websocket_constructor_failed', 'reconciliation_failed', 'invalid_socket_event', 'http_poll', 'initial_load_fallback', 'sync_recovering', 'rules_checking', 'storage_blocked', 'upgrade_required', 'session_changed', 'invalid_credentials', 'pending_command', 'unknown'],
  gate: ['unknown', 'stale_connection', 'admission_changed', 'recovery_changed', 'storage', 'session', 'upgrade', 'pending_command', 'snapshot_required', 'command_inflight', 'repair_changed', 'ready'],
  stage: ['journal', 'journal_cleanup', 'confirmation_overdue', 'command_confirmation', 'reconciliation', 'actionable_recovery', 'request_started', 'request_failed', 'response_received', 'unknown'],
  syncStatus: ['ready', 'confirming', 'applying-update', 'storage-blocked', 'unknown'],
  requestKind: ['read', 'apply', 'end-turn', 'reconcile', 'shared', 'computer-control', 'decision-attempt', 'resource', 'other', 'unknown'],
  requestPhase: ['headers', 'body', 'complete', 'unknown'],
  requestRelationship: ['latest_observed', 'failure', 'unknown'],
  visibility: ['visible', 'hidden', 'unknown'],
  mode: ['computer', 'play_both', 'multiplayer', 'unknown'],
}).map(([key, values]) => [key, Object.freeze(values)])));

export const RECOVERY_DIAGNOSTIC_FLAGS = Object.freeze([
  'online', 'rulesChecking', 'storageBlocked', 'upgradeRequired', 'forceSnapshot',
  'connectionRecovering', 'sharedPending', 'recovering', 'sharedMutationsBlocked',
  'gameplayMutationsBlocked', 'confirmationOverdue', 'truncated',
]);
export const RECOVERY_DIAGNOSTIC_COUNTERS = Object.freeze([
  'pendingCount', 'appliedEventSeq', 'advertisedEventSeq', 'gameplayRevision', 'retry',
  'socketGeneration', 'generation', 'recoveryGeneration', 'droppedEvents',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const uuid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const sha = value => typeof value === 'string' && value.length === 40 && SHA.test(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validators = {
  eventId: uuid,
  episodeId: uuid,
  requestId: uuid,
  commandId: value => typeof value === 'string' && value.startsWith('v2:') && uuid(value.slice(3)),
  gameId: value => typeof value === 'string' && value.length === 41 && /^game-[a-f0-9]{36}$/.test(value),
  observedDeploymentSha: sha,
  loadedBuild: value => value === 'unavailable' || sha(value),
  serverBuild: value => value === 'unavailable' || uuid(value),
  at: nonnegativeInteger,
  ageMs: value => nonnegativeInteger(value) && value <= RECOVERY_DIAGNOSTICS.maximumAgeMs,
  durationMs: value => nonnegativeInteger(value) && value <= RECOVERY_DIAGNOSTICS.maximumAgeMs,
  status: value => Number.isInteger(value) && value >= 100 && value <= 599,
  ...Object.fromEntries(RECOVERY_DIAGNOSTIC_COUNTERS.map(key => [key, nonnegativeInteger])),
  ...Object.fromEntries(RECOVERY_DIAGNOSTIC_FLAGS.map(key => [key, value => typeof value === 'boolean'])),
  ...Object.fromEntries(Object.entries(RECOVERY_DIAGNOSTIC_ENUMS).map(([key, values]) => [key, value => values.includes(value)])),
};
const required = ['eventId', 'type', 'at'];

/** Nonthrowing client projection. Unknown categorical values become unknown;
 * arbitrary fields and malformed optional values never leave the client. */
export function sanitizeRecoveryDiagnosticEvent(input) {
  try {
    if (!record(input) || required.some(key => !validators[key](input[key]))) return null;
    const result = {};
    for (const [key, validate] of Object.entries(validators)) {
      const value = input[key];
      if (value === undefined) continue;
      if (validate(value)) result[key] = value;
      else if (key !== 'type' && RECOVERY_DIAGNOSTIC_ENUMS[key]) result[key] = 'unknown';
    }
    return result;
  } catch { return null; }
}

/** The server rejects unknown fields rather than trusting client sanitization. */
export function validateRecoveryDiagnosticEvent(input) {
  try {
    return record(input) && required.every(key => Object.hasOwn(input, key))
      && Object.keys(input).every(key => Object.hasOwn(validators, key) && validators[key](input[key]));
  } catch { return false; }
}

export function validateRecoveryDiagnosticBatch(input) {
  try {
    return record(input) && Object.keys(input).length === 2
      && Object.hasOwn(input, 'schemaVersion') && Object.hasOwn(input, 'events')
      && input.schemaVersion === RECOVERY_DIAGNOSTICS.schemaVersion
      && Array.isArray(input.events) && input.events.length > 0
      && input.events.length <= RECOVERY_DIAGNOSTICS.maximumEvents
      && input.events.every(validateRecoveryDiagnosticEvent);
  } catch { return false; }
}
