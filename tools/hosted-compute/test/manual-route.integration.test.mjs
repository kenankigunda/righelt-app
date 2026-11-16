import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {setup} from './manual-fixture.mjs';
import {LedgerStorage} from '../storage.mjs';
import {Client} from '../client.mjs';
import {main} from '../cli.mjs';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
test('real admin routes privately bootstrap a fenced worker, attach one UI Pod, and keep both campaigns through DO storage',async t=>{
 const f=await setup(),oldRecord=await f.core.externalControl(f.manifest).store.readPrearm(f.manifest.externalControl);
 const bundle=await build({stdin:{contents:`import app,{ComputeController} from './apps/compute-controller/index.mjs';export class SeedableControl extends ComputeController{constructor(ctx,env){super(ctx,env);this.core.now=()=>Number(env.FIXTURE_NOW);const external=this.core.externalControl;this.core.externalControl=m=>{const control=external(m);control.clock=this.core.now;return control;};}async fetch(request){const p=new URL(request.url).pathname;if(p==='/fixture-seed')return this.serialize(async()=>{await this.core.save(await request.json());return Response.json({ok:true});});if(p==='/fixture-ledger')return Response.json(await this.core.load());return super.fetch(request);}}export default app;`,resolveDir:process.cwd(),sourcefile:'manual-test-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
 let posts=0;
 const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-09',durableObjects:{CONTROL:{className:'SeedableControl',useSQLite:true}},r2Buckets:['ARTIFACTS'],bindings:{FIXTURE_NOW:String(f.now()),ADMIN_TOKEN:'private-admin',WORKER_SIGNING_KEY:'private-signing-'.repeat(4),COMPUTE_ENABLED:'true',AUTHORIZED_PILOT_CENTS:'10000',CONTROLLER_URL:'https://compute.example',COMPUTE_CONTROL_REPOSITORY:'fixture/private-control',COMPUTE_CONTROL_READ_TOKEN:'private-reader',RUNPOD_API_KEY:'private-provider'},outboundService:async req=>{
  const u=new URL(req.url);if(req.method==='POST')posts++;
  if(u.origin==='https://api.runpod.io'){
   assert.equal(req.method,'GET');assert.equal(u.pathname,'/v2/pods/manual');return Response.json(await f.providers.inspect('runpod','manual'));
  }
  assert.equal(u.origin,'https://api.github.com');assert.equal(req.method,'GET');
  if(u.pathname==='/repos/fixture/private-control')return Response.json({private:true,full_name:'fixture/private-control',default_branch:'main'});
  const key=u.pathname.split('/contents/')[1];let value;
  if(key===f.manifest.externalControl.path)value=oldRecord;
  else if(key===f.m.externalControl.path)value=f.record;
  else if(key===`control/fences/${oldRecord.nonce}.json`)value={kind:'terminal',prearmSha256:f.manifest.externalControl.sha256};
  else value=f.control.records.get(`${key}@${u.searchParams.get('ref')}`);
  if(!value)return new Response(null,{status:404});
  const bytes=Buffer.from(JSON.stringify(value));return Response.json({type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});
 }});t.after(()=>mf.dispose());
 await mf.dispatchFetch('https://compute.example/fixture-seed',{method:'POST',body:JSON.stringify(await f.core.load())});
 const fetcher=(...args)=>mf.dispatchFetch(...args),admin=new Client({url:'https://compute.example',id:'ui',token:'private-admin',fetcher});
 const originalAdmin=new Client({url:'https://compute.example',id:'pilot',token:'private-admin',fetcher});
 const originalBinding=await originalAdmin.json('attempt-binding');assert.equal(originalBinding.attempt.startedAt,f.old.startedAt);assert.equal(originalBinding.manifestSha256,f.intent.priorManifestSha256);
 const stagedBinding=await admin.json('attempt-binding');assert.equal(stagedBinding.generation,0);assert.equal(stagedBinding.attempt,null);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'manual-bootstrap-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const intentFile=path.join(directory,'intent.json'),bootstrap=path.join(directory,'bootstrap.json');await fs.writeFile(intentFile,JSON.stringify(f.intent),{mode:0o600});
 const printed=await main(['manual-prepare','ui','--intent',intentFile,'--bootstrap',bootstrap],{COMPUTE_URL:'https://compute.example',COMPUTE_ADMIN_TOKEN:'private-admin'},{fetcher});
 const secret=JSON.parse(await fs.readFile(bootstrap));assert(!JSON.stringify(printed).includes(secret.env.COMPUTE_WORKER_TOKEN));assert.equal((await fs.stat(bootstrap)).mode&0o777,0o600);
 const worker=new Client({url:secret.env.COMPUTE_URL,id:'ui',generation:1,token:secret.env.COMPUTE_WORKER_TOKEN,fetcher});assert.equal((await worker.json('manual-ready')).ready,false);await assert.rejects(worker.json('work'),/rejected \(409\)/);
 f.addPod();const body={intentSha256:printed.intentSha256,podId:'manual',acceptedAt:f.intent.createdAt,accountId:f.intent.accountId};
 await admin.json('manual-attach',body);const first=await admin.json('status');await admin.json('manual-attach',body);assert.deepEqual((await admin.json('status')).programAnchor,first.programAnchor);
 assert.equal((await worker.json('manual-ready')).ready,true);assert.equal((await worker.json('work')).manifestSha256,f.intent.manifestSha256);assert.equal(posts,0);
 const ledger=await(await mf.dispatchFetch('https://compute.example/fixture-ledger')).json();assert.deepEqual(ledger.campaigns.pilot.attempts[0],f.old);assert.equal(ledger.creditAllocatedCents,2000);assert.equal(ledger.manualProgram.deadline,f.intent.createdAt+86400000);
 await assert.rejects(worker.json('manual-attach',body),/rejected \(409\)/);
 await assert.rejects(worker.json('attempt-binding'),/rejected \(409\)/);
});
