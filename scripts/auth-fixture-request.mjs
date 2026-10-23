// Private test diagnostics: never log SQL, credentials, URLs or arbitrary response text.
export async function executeFixtureRequest({url, token, sql, operation}, {request = fetch, report = console.error} = {}) {
  const detail = {operation, timestamp: new Date().toISOString(), kind: 'transport'};
  try {
    const response = await request(url, {method: 'POST', headers: {'x-righelt-fixture': token}, body: sql});
    if (response.ok) return;
    detail.kind = 'http';
    detail.status = response.status;
    const id = response.headers.get('x-request-id');
    if (/^[a-f0-9-]{36}$/i.test(id ?? '')) detail.requestId = id;
    let body;
    try { body = await response.json(); } catch { detail.response = 'non-json'; }
    if (['local_api_unavailable', 'internal_error', 'storage_reset'].includes(body?.error)) detail.error = body.error;
  } catch { /* Raw transport exceptions may contain credentials or request URLs. */ }
  report(`[fixture-request-failure] ${JSON.stringify(detail)}`);
  throw new Error(`Local fixture operation failed: ${detail.kind}${detail.status ? ` ${detail.status}` : ''}`);
}
