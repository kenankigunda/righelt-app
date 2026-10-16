import { authFixtureSql } from './auth-fixture-control.mjs';

// Generated only in the private temporary local stack, never in app sources or
// deployed configuration. Reuse the live D1 binding instead of opening SQLite
// from a second workerd process while requests are still using it.
export function authFixtureWorkerSource(apiModule, token) {
  if (!token || token.length < 32) throw new Error('A private fixture token is required');
  return `import worker from ${JSON.stringify(apiModule)};
export * from ${JSON.stringify(apiModule)};
const allowed = new Set(${JSON.stringify(authFixtureSql())});
export default { ...worker, async fetch(request, env, context) {
  const url = new URL(request.url);
  if (url.pathname !== '/__righelt_fixture') return worker.fetch(request, env, context);
  if (request.method !== 'POST' || request.headers.has('origin') ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.search ||
      request.headers.get('x-righelt-fixture') !== ${JSON.stringify(token)}) return new Response(null, {status:404});
  const sql = await request.text();
  if (!allowed.has(sql)) return new Response(null, {status:404});
  await env.DB.prepare(sql).run();
  return new Response('done');
}};
`;
}
