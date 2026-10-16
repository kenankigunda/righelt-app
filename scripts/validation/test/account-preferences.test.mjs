import test from 'node:test';
import assert from 'node:assert/strict';
import { patchAccountPreferences } from '../account-preferences.mjs';
import { STORAGE_GENERATION_HEADER } from '../../../packages/shared-types/src/storage-policy.js';

for (const generation of ['reset-current', null]) test(`preference fixture forwards current session and generation: ${generation}`, async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url === '/api/auth/session') return Response.json({ contextId: 'current-context' }, { headers: generation ? { [STORAGE_GENERATION_HEADER]: generation } : {} });
    return Response.json({ account: { preferences: { view: 'explanatory' } } });
  };
  try {
    const result = await patchAccountPreferences({ evaluate: (fn, arg) => fn(arg) }, { view: 'explanatory' });
    assert.equal(result.status, 200);
    assert.equal(requests.length, 2);
    const { url, init } = requests[1];
    assert.equal(url, '/api/account');
    assert.equal(init.method, 'PATCH');
    assert.equal(init.headers['X-Righelt-Session'], 'current-context');
    assert.equal(init.headers[STORAGE_GENERATION_HEADER] ?? null, generation);
    assert.deepEqual(JSON.parse(init.body), { preferences: { view: 'explanatory' } });
  } finally { globalThis.fetch = original; }
});

test('preference fixture does not mutate after a failed session read', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 503 }); };
  try {
    await assert.rejects(patchAccountPreferences({ evaluate: (fn, arg) => fn(arg) }, {}), /Session read failed: 503/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

// The results/rematch proof also sends raw authenticated mutations.
test('results fixture forwards the generation for creation and import', async () => {
  const { request } = await import('../results-proof.mjs');
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({url, init});
    return url === '/api/auth/session'
      ? Response.json({contextId:'current',account:{id:'account'}},{headers:{[STORAGE_GENERATION_HEADER]:'current-generation'}})
      : Response.json({game:{id:'created'}});
  };
  try {
    for (const route of ['/api/shell/games','/api/shell/scenarios/import']) {
      const result = await request({evaluate:(fn,arg)=>fn(arg)},route,{fixture:true},2);
      assert.equal(result.status,200);
      assert.equal(result.accountId,'account');
      assert.equal(requests.at(-1).init.headers[STORAGE_GENERATION_HEADER],'current-generation');
      assert.equal(requests.at(-1).init.headers['X-Righelt-Auth-Version'],'2');
    }
  } finally { globalThis.fetch = original; }
});


for (const generation of ['reset-current', null]) test(`computer fixture preserves protocol and current generation: ${generation}`, async () => {
  const { request } = await import('../computer-proof.mjs');
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({url, init});
    return url === '/api/auth/session'
      ? Response.json({contextId:'current'},{headers:generation ? {[STORAGE_GENERATION_HEADER]:generation} : {}})
      : Response.json({game:{id:'created'}});
  };
  try {
    await request({evaluate:(fn,arg)=>fn(arg)},'/api/shell/games',{computer:{p1:'babs'}});
    const sent = requests.at(-1).init;
    assert.equal(sent.headers[STORAGE_GENERATION_HEADER] ?? null,generation);
    assert.equal(sent.headers['X-Righelt-Auth-Version'],'2');
    assert.deepEqual(JSON.parse(sent.body),{computer:{p1:'babs'},protocolVersion:2});
    assert.equal(requests.length,2);
  } finally {globalThis.fetch=original;}
});

test('computer fixture preserves reset denial without replaying mutation', async () => {
  const { request } = await import('../computer-proof.mjs');
  const original = globalThis.fetch; let calls=0;
  globalThis.fetch=async url=>{calls++;return url==='/api/auth/session'?Response.json({contextId:'current'}):Response.json({error:'storage_reset'},{status:409});};
  try {
    await assert.rejects(request({evaluate:(fn,arg)=>fn(arg)},'/api/shell/games',{}),/409/);
    assert.equal(calls,2);
  } finally {globalThis.fetch=original;}
});
