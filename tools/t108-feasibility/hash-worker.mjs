import { derive, equal, FIXTURES, SALT } from './core.mjs';
const json = body => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
export class HashProbe {
  async fetch(request) {
    const { fixture } = await request.json();
    if (!Object.hasOwn(FIXTURES, fixture)) return new Response(null, {status:400});
    const started = performance.now();
    const hash = derive(fixture);
    const wrong = derive(fixture, SALT, true);
    // This interval includes two hashes and is never described as CPU time.
    return json({ fixture, salt: SALT, hash: hash.toString('hex'), incorrectRejected: !equal(hash, wrong), elapsedWallMs: performance.now() - started });
  }
}
export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/hash') return new Response(null, {status:404});
    return env.HASH.get(env.HASH.idFromName('synthetic-only')).fetch(request);
  }
};
