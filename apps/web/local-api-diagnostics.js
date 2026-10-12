// Local forwarding diagnostics contain fixed categories and a validated attempt
// ID. Never log request bodies, headers, query strings or arbitrary error text.
export function localApiFailure(error, request, stage) {
  const member = (value, key) => {
    try { return typeof value?.[key] === 'string' ? value[key] : ''; } catch { return ''; }
  };
  const allowed = (value, values) => values.includes(value) ? value : 'other';
  const codes = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'];
  let cause;
  try { cause = error?.cause; } catch {}
  const message = member(error, 'message').toLowerCase();
  const requestId = request.headers.get('X-Righelt-Request-Id') || '';
  return {
    stage: allowed(stage, ['request', 'fetch']),
    requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ? requestId : null,
    method: allowed(request.method, ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']),
    name: allowed(member(error, 'name'), ['Error', 'TypeError', 'AbortError', 'TimeoutError']),
    code: allowed(member(error, 'code'), codes),
    causeCode: allowed(member(cause, 'code'), codes),
    message: message.includes('network connection lost') ? 'network_connection_lost'
      : message.includes('connection refused') ? 'connection_refused'
      : message.includes('connection reset') ? 'connection_reset'
      : message.includes('abort') ? 'aborted'
      : message.includes('timeout') || message.includes('timed out') ? 'timeout' : 'other',
  };
}
