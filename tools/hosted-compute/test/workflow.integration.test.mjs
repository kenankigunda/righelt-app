import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canaryManifest } from '../canary-manifest.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fixture,MemoryBucket,MemoryStorage } from './helpers.mjs';
import {BackupVault} from '../backup.mjs';
import {canonical,encode} from '../policy.mjs';
import { Client } from '../client.mjs';
import { backupCollection,restoreBackup } from '../backup-client.mjs';
import { collect, verifyCollection } from '../cli.mjs';
import { runWorker, publishSnapshot } from '../worker.mjs';
const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));
const nativeRequired=process.env.RIGHELT_REQUIRE_NATIVE_HOSTED_PROOF==='1';

test('real Worker/DO/R2 keeps staged inputs private and collectable after cancellation without provisioning',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-staged-worker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bundle=await build({entryPoints:['apps/compute-controller/index.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  let outbound=0;
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-09',
    durableObjects:{CONTROL:{className:'ComputeController',useSQLite:true}},r2Buckets:['ARTIFACTS'],
    bindings:{ADMIN_TOKEN:'staging-admin',WORKER_SIGNING_KEY:'staging-signing-'.repeat(4),COMPUTE_ENABLED:'false',AUTHORIZED_PILOT_CENTS:'0'},
    outboundService:async()=>{outbound++;throw Error('staged campaign must not contact a provider');}});
  t.after(()=>mf.dispose());
  const fetcher=(url,options)=>mf.dispatchFetch(url,options),admin=new Client({url:'https://compute.example',id:'pilot',token:'staging-admin',fetcher});
  const f=await fixture(),raw=[f.cp,f.corpus,f.recipe];
  await admin.request('manifest','PUT',f.manifest);for(const bytes of raw)await admin.upload(bytes);
  assert.equal((await admin.json('status')).status,'staged');
  const unauthorized=new Client({url:'https://compute.example',id:'pilot',token:'wrong-token',fetcher});
  await assert.rejects(unauthorized.download(f.inputs[0]),/rejected/);
  const bucket=await mf.getR2Bucket('ARTIFACTS');assert.deepEqual(new Uint8Array(await (await bucket.get(`pilot/${f.inputs[0].sha256}`)).arrayBuffer()),f.cp);
  const cancelled=await admin.json('cancel',{});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cleanupVerified,true);
  const directory=path.join(root,'collection');await collect(admin,directory);assert.equal((await verifyCollection(directory)).verified,true);
  const inventory=JSON.parse(await fs.readFile(path.join(directory,'inventory.json')));assert.equal(inventory.attempts.length,0);assert.equal(inventory.objects.length,3);assert.equal(outbound,0);
});

test('mandatory native lane fails instead of skipping when its trainer environment is absent',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-missing-trainer-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={...process.env,RIGHELT_REQUIRE_NATIVE_HOSTED_PROOF:'1'};delete env.NODE_TEST_CONTEXT;
  let failure;
  try{await promisify(execFile)(process.execPath,['--import',require.resolve('tsx'),'--test','--test-name-pattern=^real Worker/DO/R2 and child process',fileURLToPath(import.meta.url)],
    {cwd:root,env,timeout:30000,maxBuffer:1024*1024});}
  catch(error){failure=error;}
  assert(failure,'missing native environment must fail the dedicated lane');assert.equal(failure.code,1);
  assert.match(failure.stdout,/Mandatory hosted native proof requires trainer venv/);
});

test('real Worker/DO/R2 and child process complete without an attached submitter, then collect and clear', { timeout: 180000, skip: !nativeRequired&&!existsSync('tools/ai-trainer/.venv/bin/python') && 'Requires trainer venv. Mandatory in trained-play CI model job.' }, async t => {
  assert(existsSync('tools/ai-trainer/.venv/bin/python'),'Mandatory hosted native proof requires trainer venv');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'righelt-compute-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await build({ entryPoints: ['apps/compute-controller/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const resources = new Map(); let creates = 0,controlRecord;
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-09',
    durableObjects: { CONTROL: { className: 'ComputeController', useSQLite: true } }, r2Buckets: ['ARTIFACTS'],
    bindings: { COMPUTE_CONTROL_REPOSITORY:'fixture/private-control',COMPUTE_CONTROL_READ_TOKEN:'test-control-read',ADMIN_TOKEN: 'admin-secret', RUNPOD_API_KEY: 'provider-test-secret', WORKER_SIGNING_KEY: 'signing-key-'.repeat(4), COMPUTE_ENABLED: 'true', AUTHORIZED_PILOT_CENTS: '10000', CONTROLLER_URL: 'https://compute.example' },
    outboundService: async request => {
      const url = new URL(request.url);
      if(url.hostname==='api.github.com'){
        if(url.pathname==='/repos/fixture/private-control')return Response.json({private:true,full_name:'fixture/private-control',default_branch:'main'});
        if(url.pathname.includes('/contents/control/fences/'))return new Response(null,{status:404});
        if(url.pathname.includes('/contents/control/prearms/')){const bytes=encode(canonical(controlRecord));return Response.json({type:'file',encoding:'base64',size:bytes.length,content:Buffer.from(bytes).toString('base64')});}
        throw Error('unexpected GitHub test route');
      }
      assert.equal(url.hostname, 'api.runpod.io');
      if (request.method === 'POST') {
        const body = await request.json(); const resource = { id: String(++creates), name: body.name,image:body.image,cudaVersion:body.gpu.minCudaVersion,cloud:body.cloud,disk:body.disk,dataCenterId:body.dataCenterIds[0],gpu:{id:body.gpu.id,count:1,vcpuCount:16,memory:64},cost:1 };
        resource.workerEnv = body.env; resources.set(String(resource.id), resource);
        return Response.json(resource, { status: 201 });
      }
      const id = url.pathname.split('/').at(-1);
      if (request.method === 'DELETE') { resources.delete(id); return Response.json({ action: { status: 'success' } }); }
      if (url.pathname.endsWith('/pods')) return Response.json({ pods: [...resources.values()], pagination:{hasNextPage:false,nextCursor:null} });
      const resource = resources.get(id);
      return resource ? Response.json(resource) : new Response(null, { status: 404 });
    },
  });
  t.after(() => mf.dispose());
  const fetcher = (url, options) => mf.dispatchFetch(url, options);
  const admin = new Client({ url: 'https://compute.example', token: 'admin-secret', id: 'pilot', fetcher });
  const f = await fixture();
  f.advance(Date.now()-f.now());
  const sourceRoot = process.cwd();
  await fs.symlink(path.join(sourceRoot,'tools'), path.join(root,'tools'));
  const {stdout} = await promisify(execFile)(path.join(sourceRoot,'tools/ai-trainer/.venv/bin/python'),
    ['-m','righelt_training.hosted_canary','--prepare','.ai-runs/pilot/input'],
    {cwd:root,env:{...process.env,PYTHONPATH:path.join(sourceRoot,'tools/ai-trainer')},timeout:30000});
  const prepared = JSON.parse(stdout);
  const manifest = canaryManifest({prepared,id:'pilot',sourceRevision:f.manifest.sourceRevision,
    dependencySha256:f.manifest.dependencySha256,authorizationReference:'fixture-no-spend',
    deadline:Date.now()+3600000,maxCents:10000,cash:f.manifest.cash,device:'cpu',host:{...f.manifest.phases[0].host,quoteExpires:Date.now()+3600000}});
  controlRecord=await f.arm(manifest);
  await fs.writeFile(path.join(root, '.compute-source.json'), JSON.stringify({ sourceRevision: manifest.sourceRevision, dependencySha256: manifest.dependencySha256 }));
  await admin.request('manifest', 'PUT', manifest);
  for (const a of manifest.inputs) await admin.upload(await fs.readFile(path.join(root,a.path)));
  await admin.json('start', {});
  // The remaining calls stand in for durable wake-ups, not a Mac process loop.
  await new Client({ url: 'https://compute.example', id: 'controller', token: 'admin-secret', fetcher }).json('reconcile', {});
  assert.equal(creates, 1, JSON.stringify(await admin.json('status')));
  const env = [...resources.values()][0].workerEnv;
  const worker = new Client({ url: env.COMPUTE_URL, token: env.COMPUTE_WORKER_TOKEN, id: env.COMPUTE_ID, generation: Number(env.COMPUTE_GENERATION), fetcher });
  await assert.rejects(worker.json('backup-status'),/rejected/);
  const originalJson=worker.json.bind(worker);
  worker.json=(action,body)=>originalJson(action,action==='finish' && body?.kind==='complete' ? {kind:'infrastructure',files:body.files} : body);
  const result = await runWorker({ env: { ...process.env, ...env }, root, client: worker, cleanup: async () => {}, snapshotter: publishSnapshot });
  assert.equal(result.kind, 'complete', JSON.stringify(result));
  const executionContext=JSON.parse(await fs.readFile(path.join(root,manifest.phases[0].runDir,'execution-context.json')));
  assert(Number.isFinite(executionContext.phaseDeadline));assert.equal(executionContext.phaseSeconds,manifest.phases[0].seconds);
  const logged = (await admin.json('logs')).latestLog; assert(logged);
  assert.match(new TextDecoder().decode(await admin.download(logged)), /compute-result/);
  const resultReceipt=JSON.parse(await fs.readFile(path.join(root,'.ai-runs/pilot/run/result.json')));
  const proof=JSON.parse(await fs.readFile(path.join(root,'.ai-runs/pilot/run/pipeline-proof.json')));
  assert.equal(proof.fixtureOnly,true); assert.equal(proof.replayChecks,2);
  assert.notEqual(proof.initialWeightsSha256,proof.resultWeightsSha256);
  assert.equal(proof.recoveredUpdates,resultReceipt.updates);
  assert(proof.training.batches[0].policyPositions===0 && proof.training.batches[0].valuePositions>0);
  assert(proof.training.batches.at(-1).policyPositions>0);
  assert.equal(proof.training.batches[0].headGradientL1.policy,0);
  assert(proof.training.batches[0].headGradientL1.terminalValue>0);
  assert(proof.training.batches.at(-1).headGradientL1.policy>0);
  assert(proof.training.batches.every(b=>Number.isFinite(b.parameterDelta)&&b.parameterDelta>0));
  assert.equal(proof.parity.numericPassed,true);
  const reconciler = new Client({ url: 'https://compute.example', id: 'controller', token: 'admin-secret', fetcher });
  await reconciler.json('reconcile', {}); await reconciler.json('reconcile', {}); await reconciler.json('reconcile', {});
  assert.equal(creates,2);
  const replacementEnv=[...resources.values()][0].workerEnv;
  const replacementRoot=path.join(root,'replacement'); await fs.mkdir(replacementRoot);
  await fs.symlink(path.join(sourceRoot,'tools'),path.join(replacementRoot,'tools'));
  await fs.copyFile(path.join(root,'.compute-source.json'),path.join(replacementRoot,'.compute-source.json'));
  const replacementClient=new Client({url:replacementEnv.COMPUTE_URL,id:replacementEnv.COMPUTE_ID,token:replacementEnv.COMPUTE_WORKER_TOKEN,generation:Number(replacementEnv.COMPUTE_GENERATION),fetcher});
  const restored=await runWorker({env:{...process.env,...replacementEnv},root:replacementRoot,client:replacementClient,cleanup:async()=>{},snapshotter:publishSnapshot});
  assert.equal(restored.recoveredCompletedPhase,true,JSON.stringify(restored));
  assert.equal(JSON.parse(await fs.readFile(path.join(replacementRoot,'.ai-runs/pilot/run/result.json'))).execution.generation,1);
  await assert.rejects(fs.stat(path.join(replacementRoot,'.ai-runs/pilot/run/hosted-2.log')),{code:'ENOENT'});
  await reconciler.json('reconcile', {}); await reconciler.json('reconcile', {});
  assert.equal(resources.size, 0); assert.equal((await admin.json('status')).status, 'complete');
  const bundleFiles = (await fs.readdir(path.join(root,'.ai-runs/pilot/run'),{recursive:true})).map(p=>path.join(root,'.ai-runs/pilot/run',p));
  const sizes=[]; for(const p of bundleFiles) {const st=await fs.stat(p);if(st.isFile())sizes.push(st.size);}
  t.diagnostic(JSON.stringify({fixtureBundleFiles:sizes.length,fixtureBundleBytes:sizes.reduce((a,b)=>a+b,0),largestObjectBytes:Math.max(...sizes),localOnly:true}));
  const out = path.join(root, 'collected'); await collect(admin, out);
  const receipt = await verifyCollection(out);
  await assert.rejects(admin.json('clear',receipt),/rejected/);
  const vault=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()});
  const backup=await backupCollection(vault,out,receipt);
  await admin.json('clear',{...receipt,backup});
  await fs.rm(path.join(root,'.ai-runs'),{recursive:true});
  await fs.rm(replacementRoot,{recursive:true});
  await fs.rm(out,{recursive:true});
  const recovered=await restoreBackup(vault,backup.roots.at(-1).id,path.join(root,'cloud-download'),path.join(root,'fresh-checkout'));
  assert.equal(recovered.checkpointSha256,proof.checkpointSha256);assert.equal(recovered.updates,proof.recoveredUpdates);assert.equal(recovered.allocationResumed,false);
  assert.equal((await admin.json('status')).status, 'cleared');
  await assert.rejects(worker.json('heartbeat', {}), /rejected/);
  await assert.rejects(admin.download({ sha256: f.inputs[0].sha256, bytes: f.cp.length }), /rejected/);
});
