import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {refusalFixture} from './provider-refusal-fixture.mjs';
import {main} from '../cli.mjs';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
test('real private CLI and Worker adopt the exact singleton refusal with no provider action or token issuance',async t=>{
 const f=await refusalFixture(),ref=await f.receipt(f.r),before=await f.core.load();
 const records=new Map([[f.m.externalControl.path,await f.core.externalControl(f.m).store.readPrearm(f.m.externalControl)]]);
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
 const receiptFile=path.join(directory,'receipt.json');await fs.writeFile(receiptFile,JSON.stringify(ref),{mode:0o600});
 const env={COMPUTE_URL:'https://compute.example',COMPUTE_ADMIN_TOKEN:'private-admin'},services={fetcher:(...args)=>mf.dispatchFetch(...args)};
 const binding=await main(['provider-refusal-binding',f.m.id],env,services);assert.equal(binding.target.campaignId,f.m.id);
 const result=await main(['provider-refusal-resolve',f.m.id,'--receipt',receiptFile],env,services);assert.equal(result.resolved,true);assert.equal(result.workerToken,undefined);
 assert.equal((await main(['provider-refusal-resolve',f.m.id,'--receipt',receiptFile],env,services)).replayed,true);
 const denied=await mf.dispatchFetch(`https://compute.example/v1/${f.m.id}/provider-refusal-resolve`,{method:'POST',headers:{authorization:'Bearer invalid'},body:JSON.stringify(ref)});assert.equal(denied.status,409);assert.equal((await denied.json()).error,'authentication required');
 const after=await(await mf.dispatchFetch('https://compute.example/fixture-ledger')).json();
 assert.deepEqual(after.campaigns[f.m.id].attempts,before.campaigns[f.m.id].attempts);assert.deepEqual(after.manualProgram,before.manualProgram);assert.deepEqual(after.actualSpendBasis,before.actualSpendBasis);
 assert.equal(after.campaigns[f.m.id].status,'cancelled');assert.equal(after.providerRefusalResolution.receiptSha256,ref.sha256);assert.equal(providerCalls,0);
});
