// Loopback-only development bridge. Hashing runs in the deployed private services.
export default {
  fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/probe') return new Response(null, {status:404});
    return env.PROBE.fetch(request);
  }
};
