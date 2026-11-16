import { Controller } from '../../tools/hosted-compute/controller.mjs';
import { Providers } from '../../tools/hosted-compute/providers.mjs';
import { LedgerStorage } from '../../tools/hosted-compute/storage.mjs';
import { PrimaryControl } from '../../tools/hosted-compute/external-control.mjs';
import { primaryControlStore } from '../../tools/hosted-compute/github-control.mjs';
import { POLICY, ContractError, assert, encode, safeName, sha256 } from '../../tools/hosted-compute/policy.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
async function equalSecret(a, b) {
  if (!a || !b) return false;
  return crypto.subtle.timingSafeEqual(await crypto.subtle.digest('SHA-256',encode(a)),await crypto.subtle.digest('SHA-256',encode(b)));
}
export class ComputeController {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.transition = Promise.resolve();
    this.core = new Controller({ storage: new LedgerStorage(ctx.storage), bucket: env.ARTIFACTS, providers: new Providers(env),
      config: { enabled: env.COMPUTE_ENABLED === 'true', authorizedCents: Number(env.AUTHORIZED_PILOT_CENTS ?? 0), url: env.CONTROLLER_URL },
      externalControl: manifest => new PrimaryControl({ store: primaryControlStore(env), reference: manifest.externalControl }),
      token: (id, generation) => this.workerToken(id, generation),
    });
  }
  serialize(action) {
    const result=this.transition.then(action);
    this.transition=result.catch(()=>{});
    return result;
  }
  async arm(at) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
  }
  async workerToken(id, generation) {
    assert(this.env.WORKER_SIGNING_KEY?.length >= 32, 'worker signing key unavailable');
    const key = await crypto.subtle.importKey('raw', encode(this.env.WORKER_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encode(`${id}/${generation}`)))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async fetch(request) {
    // Serialize actor transitions without holding the platform input gate across
    // network I/O. State is persisted
    // before each irreversible call, so actor restarts cannot duplicate launches.
    return this.serialize(async () => {
      try {
        const response = await this.route(request);
        const db = await this.core.load();
        if (Object.values(db.campaigns).some(c => !['complete', 'failed', 'cancelled', 'cleared', 'staged'].includes(c.status))) await this.arm(Date.now() + POLICY.reconcileMs);
        return response;
      } catch (error) {
        if (!(error instanceof ContractError)) console.error(JSON.stringify({event:'compute-controller-unavailable',
          type:error instanceof TypeError?'type-error':error instanceof SyntaxError?'invalid-data':'infrastructure'}));
        return error instanceof ContractError
          ? json({ error: error.message }, 409)
          : json({ error: 'controller infrastructure unavailable' }, 503);
      }
    });
  }
  async route(request) {
    const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean);
    assert(parts[0] === 'v1' && safeName(parts[1]), 'invalid route');
    const [, id, action, name] = parts;
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '');
    const admin = await equalSecret(bearer, this.env.ADMIN_TOKEN);
    const generation = Number(request.headers.get('x-compute-generation'));
    const worker = !admin && Number.isSafeInteger(generation) && generation > 0 && await equalSecret(bearer, await this.workerToken(id, generation));
    assert(admin || worker, 'authentication required');
    if(worker&&request.method==='GET'&&action==='manual-ready')return json(await this.core.manualReady(id,generation));
    if (worker) {
      const db = await this.core.load(); this.core.fence(this.core.campaign(db, id), generation);
      assert(['work', 'heartbeat', 'snapshot', 'finish', 'objects', 'claim', 'counter', 'settle', 'progress'].includes(action), 'worker operation forbidden');
    }
    if (request.method === 'PUT' && action === 'manifest' && admin) {
      const m = await request.json(); assert(m.id === id, 'campaign route mismatch'); return json(await this.core.stage(m));
    }
    if (action === 'objects') {
      assert(/^[a-f0-9]{64}$/.test(name), 'invalid object hash');
      if (request.method === 'PUT') {
        const length = Number(request.headers.get('content-length'));
        assert(Number.isSafeInteger(length) && length >= 0 && length <= POLICY.maxObjectBytes, 'bounded content length required');
        const bytes = await request.arrayBuffer();
        return json(await this.core.putObject(id, { name, sha256: name, bytes: length }, bytes, worker ? generation : null));
      }
      if (request.method === 'GET') {
        const db = await this.core.load(), c = this.core.campaign(db, id);
        if(worker)assert(c.attempts.at(-1)?.placement,'approved placement required before inputs');
        assert(c.objects[name] && !c.cleared, 'object unavailable');
        const object = await this.env.ARTIFACTS.get(`${id}/${name}`); assert(object, 'object missing');
        return new Response(object.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-sha256': name } });
      }
    }
    if (request.method === 'GET' && action === 'work' && worker) return json(await this.core.work(id, generation));
    if (request.method === 'POST' && action === 'heartbeat' && worker) return json(await this.core.heartbeat(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'progress' && worker) return json(await this.core.progress(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'snapshot' && worker) return json(await this.core.snapshot(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'finish' && worker) return json(await this.core.finish(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'claim' && worker) return json(await this.core.claim(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'counter' && worker) return json(await this.core.counter(id, generation, await request.json()));
    if (request.method === 'POST' && action === 'settle' && worker) return json(await this.core.settle(id, generation, await request.json()));
    assert(admin, 'administrator operation required');
    if(request.method==='POST'&&action==='manual-prepare'){
      const result=await this.core.manualPrepare(id,await request.json());await this.arm(Date.now()+1000);return json(result);
    }
    if(request.method==='POST'&&action==='manual-attach'){
      const result=await this.core.manualAttach(id,await request.json());await this.arm(Date.now()+1000);return json(result);
    }
    if (request.method === 'POST' && action === 'reconcile') { await this.reconcile(); return json({ reconciled: true }); }
    if (request.method === 'GET' && ['status', 'logs'].includes(action)) {
      const db = await this.core.load(); return json(this.core.status(this.core.campaign(db, id)));
    }
    if (request.method === 'GET' && action === 'inventory') return json(await this.core.inventory(id));
    if (request.method === 'POST' && action === 'start') {
      const result = await this.core.start(id);
      // Queue the alarm before returning. Provisioning does not depend on the
      // CLI connection surviving, and never runs before the reservation commits.
      await this.arm(Date.now() + 1000); return json(result);
    }
    if (request.method === 'POST' && action === 'cancel') return json(await this.core.cancel(id));
    if (request.method === 'POST' && action === 'clear') return json(await this.core.clear(id, await request.json()));
    throw Error('unknown operation');
  }
  async alarm() {
    return this.serialize(async () => {
      // Schedule the successor before I/O so a provider outage cannot lose the
      // cleanup wake-up. Cron reconciliation supplements this alarm when enabled.
      await this.arm(Date.now() + POLICY.reconcileMs);
      await this.reconcile();
    });
  }
  async reconcile() {
      await this.arm(Date.now() + POLICY.reconcileMs);
      const db = await this.core.load();
      for (const c of Object.values(db.campaigns)) {
        if (c.status === 'cleanup-uncertain') {
          try { await this.core.reconcileUncertain(c.manifest.id); } catch { /* retain uncertain evidence and next alarm */ }
        }
      }
      await this.core.reconcile();
      const latest = await this.core.load();
      if (Object.values(latest.campaigns).every(c => ['complete', 'failed', 'cancelled', 'cleared', 'staged'].includes(c.status))) await this.ctx.storage.deleteAlarm();
  }
}
export default {
  async fetch(request, env) { return env.CONTROL.get(env.CONTROL.idFromName('pilot')).fetch(request); },
  async scheduled(_event, env) {
    await env.CONTROL.get(env.CONTROL.idFromName('pilot')).fetch(new Request('https://compute/v1/controller/reconcile', {
      method: 'POST', headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` },
    }));
  },
};
