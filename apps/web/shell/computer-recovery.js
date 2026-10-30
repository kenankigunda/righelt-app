// Only failures known to precede gameplay admission may use this policy.
// Durable gameplay commands retain their journal's exclusive retry owner.
export function computerRetryDisposition(error) {
  if (['invalid_credentials', 'session_changed', 'upgrade_required', 'storage_reset', 'storage_blocked', 'invalid_response', 'invalid_attempt', 'attempt_id_conflict', 'computer_owner_required', 'invalid_device'].includes(error?.code)) return 'terminal';
  if (['rules_cancelled', 'stale_state', 'sync_recovering'].includes(error?.code)) return 'discard';
  const status = Number(error?.status);
  if ([408, 429].includes(status) || status >= 500 && status <= 599
    || ['request_timeout', 'recovery_timeout', 'computer_network_error', 'computer_network_timeout', 'computer_transfer_incomplete'].includes(error?.code)
    || error?.diagnosticEvidence?.stage === 'request_failed' && error.diagnosticEvidence.status === null) return 'retry';
  return 'terminal';
}

export function computerNetworkError(error, signal) {
  if (signal?.aborted) return Object.assign(new Error(String(signal.reason)), { code: signal.reason === 'no-progress' ? 'computer_network_timeout' : 'computer_cancelled', cause: error });
  return Object.assign(new Error('Computer resources could not be reached'), { code: 'computer_network_error', cause: error });
}

export async function fetchComputerResource(url, { fetchImpl = fetch, ...options } = {}) {
  let response;
  try { response = await fetchImpl(url, options); }
  catch (error) { throw computerNetworkError(error, options.signal); }
  if (!response.ok) {
    const value = response.headers?.get?.('Retry-After');
    const seconds = Number(value), milliseconds = value ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now() : 0;
    throw Object.assign(new Error(`Computer resource request failed: ${response.status}`), { status: response.status, code: `HTTP_${response.status}`, retryAfterMs: Math.max(0, milliseconds || 0) });
  }
  return response;
}
