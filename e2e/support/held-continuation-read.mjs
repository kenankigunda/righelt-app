// Fixture transport substitution: one real backend GET overlaps the held native
// UI assertion. This does not assert native browser-to-backend transport parity.
export async function fulfillHeldContinuationRead(route, { request, released }) {
  if (route.request() !== request) throw new Error('Foreign continuation retry request');
  const url = new URL(request.url());
  if (request.method() !== 'GET' || url.pathname !== '/api/shell/games' || url.searchParams.get('section') !== 'other') {
    throw new Error('Unsupported continuation retry request');
  }
  // Own rejection immediately, including while the caller still holds delivery.
  const backend = route.fetch({ maxRedirects: 0, maxRetries: 0 })
    .then(response => ({ response }), error => ({ error }));
  let response, primary, failed = false;
  try {
    await released;
    const outcome = await backend;
    if ('error' in outcome) throw outcome.error;
    response = outcome.response;
    if (response.url() !== request.url() || response.status() !== 200) throw new Error('Unexpected continuation retry response');
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true || body.section !== 'other' || !Array.isArray(body.games)) {
      throw new Error('Malformed continuation retry response');
    }
    await route.fulfill({ response });
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    // The fetch is owned even if the release gate rejects; never send a second GET.
    const outcome = await backend;
    if (outcome.response) {
      try { await outcome.response.dispose(); }
      catch (cleanupError) {
        if (failed) throw new AggregateError([primary, cleanupError], 'Continuation retry failed and response disposal failed', { cause: primary });
        throw cleanupError;
      }
    }
  }
}

export async function controlledContinuationReadCompleted(response, request) {
  if (!request || response.request() !== request || response.status() !== 200) return false;
  if (await response.finished()) return false;
  const body = await response.json();
  return !!body && typeof body === 'object' && !Array.isArray(body) && body.ok === true
    && body.section === 'other' && Array.isArray(body.games);
}
