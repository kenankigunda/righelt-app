import { Admission, FIXTURES } from './core.mjs';

const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
export class AdmissionProbe {
  constructor(ctx, env) {
    this.admission = new Admission(async body => env.HASH_WORKER.fetch('https://probe.invalid/hash', { method: 'POST', body: JSON.stringify(body) }));
  }
  async fetch(request) {
    const body = await request.json();
    const result = await this.admission.submit(body);
    return result.rejected ? json({ error: 'overloaded' }, 429, { 'Retry-After': '1' }) : result.value;
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/probe') return json({ error: 'not_found' }, 404);
    // No arbitrary password/salt/cost or object-name input can reach the hash runtime.
    if (Number(request.headers.get('content-length')) > 128) return json({ error: 'invalid_input' }, 400);
    const text = await request.text();
    if (text.length > 128) return json({ error: 'invalid_input' }, 400);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'invalid_input' }, 400); }
    if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(FIXTURES, body.fixture)) return json({ error: 'invalid_input' }, 400);
    return env.ADMISSION.get(env.ADMISSION.idFromName('synthetic-only')).fetch('https://probe.invalid/probe', { method: 'POST', body: JSON.stringify(body) });
  }
};
