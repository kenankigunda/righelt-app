import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {actualFixture} from './actual-spend-fixture.mjs';
import {includeRetainedOwner} from './finite-cleanup-fixture.mjs';
import {main} from '../cli.mjs';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
test('real private CLI and Worker admit exact three-owner cleanup without a provider create or historical rewrite',async t=>{
 const f=await actualFixture({elapsedAfterFirstMs:0}),retained=await includeRetainedOwner(f);
 await f.core.reconcileActualSpend('pilot',retained.basis);const before=await f.core.load();
 assert.equal(before.campaigns.ui.status,'cleanup-uncertain');assert.equal(before.campaigns.ui.attempts[0].uncertain,true);
 const records=new Map();for(const ref of retained.registry.references)records.set(ref.path,await f.core.externalControl(f.m).store.readPrearm(ref));
 const bundle=await build({stdin:{contents:`import app,{ComputeController}from'./apps/compute-controller/index.mjs';export class SeedableControl extends ComputeController{constructor(ctx,env){super(ctx,env);this.core.now=()=>Number(env.FIXTURE_NOW);const external=this.core.externalControl;this.core.externalControl=m=>{const control=external(m);control.clock=this.core.now;return control;};}async fetch(req){if(new URL(req.url).pathname==='/fixture-seed')return this.serialize(async()=>{await this.core.save(await req.json());return Response.json({ok:true});});if(new URL(req.url).pathname==='/fixture-ledger')return Response.json(await this.core.load());return super.fetch(req);}}export default app;`,resolveDir:process.cwd(),sourcefile:'finite-cleanup-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
 let providerCalls=0;
 const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-09',durableObjects:{CONTROL:{className:'SeedableControl',useSQLite:true}},r2Buckets:['ARTIFACTS'],bindings:{FIXTURE_NOW:String(f.now()),ADMIN_TOKEN:'private-admin',WORKER_SIGNING_KEY:'private-signing-'.repeat(4),COMPUTE_ENABLED:'true',AUTHORIZED_PILOT_CENTS:'2000',CONTROLLER_URL:'https://compute.example',COMPUTE_CONTROL_REPOSITORY:'fixture/private-control',COMPUTE_CONTROL_READ_TOKEN:'private-reader'},outboundService:async req=>{
  const u=new URL(req.url);if(u.origin!=='https://api.github.com'){providerCalls++;throw Error('provider action forbidden');}
  assert.equal(req.method,'GET');if(u.pathname==='/repos/fixture/private-control')return Response.json({private:true,full_name:'fixture/private-control',default_branch:'main'});
  const key=u.pathname.split('/contents/')[1],nonce=key?.match(/^control\/fences\/([a-f0-9]{32})\.json$/)?.[1];
  const value=records.get(key)??(nonce?f.control.fences.get(nonce):f.control.records.get(`${key}@${u.searchParams.get('ref')}`));
  if(!value)return new Response(null,{status:404});const raw=Buffer.from(JSON.stringify(value));return Response.json({type:'file',encoding:'base64',size:raw.length,content:raw.toString('base64')});
 }});t.after(()=>mf.dispose());
 await mf.dispatchFetch('https://compute.example/fixture-seed',{method:'POST',body:JSON.stringify(before)});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'finite-cleanup-cli-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const intentFile=path.join(directory,'intent.json'),bootstrap=path.join(directory,'bootstrap.json');await fs.writeFile(intentFile,JSON.stringify(f.intent),{mode:0o600});
 const result=await main(['manual-prepare','actual-next','--intent',intentFile,'--bootstrap',bootstrap],{COMPUTE_URL:'https://compute.example',COMPUTE_ADMIN_TOKEN:'private-admin'},{fetcher:(...args)=>mf.dispatchFetch(...args)});
 const secret=JSON.parse(await fs.readFile(bootstrap));assert(!JSON.stringify(result).includes(secret.env.COMPUTE_WORKER_TOKEN));assert.equal((await fs.stat(bootstrap)).mode&0o777,0o600);
 const after=await(await mf.dispatchFetch('https://compute.example/fixture-ledger')).json();
 assert.deepEqual(after.campaigns.pilot,before.campaigns.pilot);assert.deepEqual(after.campaigns.ui,before.campaigns.ui);assert.equal(after.actualSpendBasis.observedDebitCents,3);
 assert.equal(after.campaigns['actual-next'].manual.intent.registry.sha256,retained.ref.sha256);assert.equal(providerCalls,0);
});
