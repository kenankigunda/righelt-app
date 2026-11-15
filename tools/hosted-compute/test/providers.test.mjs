import test from 'node:test';
import assert from 'node:assert/strict';
import { Providers } from '../providers.mjs';
import { fixture } from './helpers.mjs';

test('Runpod uses API v2, digest-pinned image and one noninterruptible CPU-rich GPU', async () => {
  const calls = [], provider = new Providers({ RUNPOD_API_KEY: 'private' }, async (url, options) => {
    calls.push({ url, ...options }); return Response.json({ id: 'pod', name: 'owned' }, { status: 201 });
  });
  const { manifest } = await fixture();
  await provider.create({ ...manifest.phases[0].host, provider: 'runpod', gpu: 'NVIDIA GeForce RTX 3090', minRamGb: 64, minVcpu: 16 }, 'owned', { COMPUTE_ID: 'pilot' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.runpod.io/v2/pods');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.gpu.count, 1); assert.equal(body.gpu.minVcpuCountPerGpu, 16);
  assert.deepEqual(body.dataCenterIds,['US-TEST-1']);assert.equal(body.gpu.minCudaVersion,'13.0');
  assert.equal(body.cloud, 'SECURE'); assert.equal(body.interruptible, undefined); assert.deepEqual(body.ports, []);
});
test('inventory follows every opaque cursor and deletion requires matching ownership', async () => {
  const calls = [];
  const p = new Providers({ RUNPOD_API_KEY: 'private' }, async (url, options) => {
    calls.push(url);
    if (url.endsWith('limit=100')) return Response.json({ pods: [{ id: 'other', name: 'unrelated' }], pagination: { hasNextPage: true, nextCursor: 'opaque/+=' } });
    if (url.includes('cursor=')) return Response.json({ pods: [{ id: 'wanted', name: 'owned' }], pagination: { hasNextPage: false, nextCursor: null } });
    return Response.json({ id: 'wanted', name: 'unrelated' });
  });
  assert.deepEqual(await p.find('runpod', 'owned'), [{ id: 'wanted', name: 'owned' }]);
  assert(calls[1].includes('opaque%2F%2B%3D'));
  await assert.rejects(p.remove('runpod', 'wanted', 'owned'), /unrelated/);
});
test('provider errors redact response bodies and never repeat create calls', async () => {
  let calls = 0; const p = new Providers({ RUNPOD_API_KEY: 'private' }, async () => { calls++; return new Response('secret echoed by provider', { status: 500 }); });
  await assert.rejects(p.request('runpod', '/pods', 'POST', {}), e => !e.message.includes('secret') && /500/.test(e.message));
  assert.equal(calls, 1);
});

test('actual placement and quote must match before input access',async()=>{
 const p=new Providers({RUNPOD_API_KEY:'test'}),f=await fixture(),h=f.manifest.phases[0].host;
 const r={id:'owned',name:'owned',image:h.image,cudaVersion:h.minCudaVersion,dataCenterId:h.dataCenterId,cloud:'SECURE',gpu:{id:h.gpu,count:1,vcpuCount:16,memory:64},disk:h.diskGb,cost:1};
 assert.equal(p.qualify(r,h,'owned').dataCenterId,h.dataCenterId);
 for(const bad of [{cudaVersion:'12.8'},{cudaVersion:null},{dataCenterId:'EU-OTHER-1'},{image:'unapproved'},{cost:2},{gpu:{...r.gpu,count:0}}])assert.throws(()=>p.qualify({...r,...bad},h,'owned'),/differs/);
 await assert.rejects(p.request('hetzner','/servers'),/only Runpod/);
});

test('safe failure diagnostics preserve HTTP status without reading provider bodies or arbitrary error fields',async()=>{
 const {providerFailureDiagnostic}=await import('../providers.mjs');
 const diagnostics=[];
 for(const status of [400,401,402,403,404,409,422,429,500,503]){
  let calls=0,bodyReads=0;
  const p=new Providers({RUNPOD_API_KEY:'secret-key'},async()=>{calls++;return {ok:false,status,json(){bodyReads++;throw Error('secret-body');},text(){bodyReads++;throw Error('secret-body');}};});
  let captured;try{await p.request('runpod','/pods','POST',{env:{token:'secret-worker'}});}catch(error){captured=error;}
  assert(captured);const d=providerFailureDiagnostic(captured);assert.deepEqual(d,{schema:1,provider:'runpod',operation:'create-pod',category:'http',dispatch:'response-received',httpStatus:status});
  assert.equal(calls,1);assert.equal(bodyReads,0);diagnostics.push(d);
 }
 const arbitrary=new Error('secret-env');Object.defineProperty(arbitrary,'httpStatus',{get(){throw Error('secret-getter');}});arbitrary.diagnostic={httpStatus:401,secret:'secret'};
 assert.deepEqual(providerFailureDiagnostic(arbitrary),{schema:1,provider:'runpod',operation:'unknown',category:'unclassified',dispatch:'unknown',httpStatus:null});
 assert(!JSON.stringify(diagnostics).includes('secret'));
});

test('transport, parse, credentials, preparation and unexpected accepted responses remain distinct and single-shot',async()=>{
 const {providerFailureDiagnostic}=await import('../providers.mjs');
 const cases=[
  {fetcher:async()=>{throw Error('private network detail');},category:'transport',dispatch:'possibly-dispatched',status:null},
  {fetcher:async()=>new Response('private malformed body',{status:201}),category:'response-json',dispatch:'response-received',status:201},
  {fetcher:async()=>Response.json({id:'queued-id',name:'owned',status:'QUEUED'},{status:202}),category:'unexpected-status',dispatch:'response-received',status:202},
  {fetcher:async()=>new Response(null,{status:204}),category:'unexpected-status',dispatch:'response-received',status:204},
  {fetcher:async()=>({status:'private not a status',ok:false}),category:'response-status',dispatch:'response-received',status:null},
 ];
 for(const c of cases){let calls=0;const p=new Providers({RUNPOD_API_KEY:'private'},async(...a)=>{calls++;return c.fetcher(...a);});
  await assert.rejects(p.request('runpod','/pods','POST',{}),error=>{const d=providerFailureDiagnostic(error);assert.equal(d.category,c.category);assert.equal(d.dispatch,c.dispatch);assert.equal(d.httpStatus,c.status);assert(!error.message.includes('private'));return true;});assert.equal(calls,1);
 }
 for(const [env,body,category] of [[{},{} ,'credentials-unavailable'],[{RUNPOD_API_KEY:'private'},{unserializable:1n},'request-preparation']]){
  let calls=0;const p=new Providers(env,async()=>{calls++;throw Error('must not dispatch');});
  await assert.rejects(p.request('runpod','/pods','POST',body),error=>{assert.equal(providerFailureDiagnostic(error).category,category);assert.equal(providerFailureDiagnostic(error).dispatch,'not-dispatched');return true;});assert.equal(calls,0);
 }
});

test('a successful HTTP response with wrong create identity is redacted without treating it as no-create',async()=>{
 const {providerFailureDiagnostic}=await import('../providers.mjs');const f=await fixture();let calls=0;
 const p=new Providers({RUNPOD_API_KEY:'private'},async()=>{calls++;return Response.json({id:'wrong',name:'foreign',env:{secret:'provider-body-secret'}},{status:201});});
 await assert.rejects(p.create(f.manifest.phases[0].host,'owned',{}),error=>{assert.deepEqual(providerFailureDiagnostic(error),{schema:1,provider:'runpod',operation:'create-pod',category:'response-identity',dispatch:'response-received',httpStatus:201});assert(!error.message.includes('foreign'));return true;});assert.equal(calls,1);
});
