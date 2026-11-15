import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrearm, launchManifestSha256, PrimaryControl } from '../external-control.mjs';
import { GitHubControlReader, GitHubControlWriter } from '../github-control.mjs';
import { RunpodCleanup, sweepExternal } from '../external-cleanup.mjs';
import { prearmCampaign } from '../prearm.mjs';
import { cleanupFromEnvironment,cleanupProcessResult } from '../cleanup-run.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import { syntheticGithubUsage } from './github-usage-fixture.mjs';

const repository='owner/private-compute-control',runtime='a'.repeat(40),image=`example/compute@sha256:${'b'.repeat(64)}`;
const start=Date.UTC(2026,10,14);
function manifest() { return {id:'pilot',sourceRevision:'c'.repeat(40),deadline:start+86400000,recipe:{loss:'observed'},phases:[{id:'training',host:{image}},{id:'evaluation',host:{image}}]}; }

test('finite registry preserves the original watch and sweeps the other owner even when one inventory fails',async()=>{
 const f=await setup(),m=manifest();m.id='manual';
 const next=await prearmCampaign(m,{accountId:'account-pilot',accountEvidenceReference:'reviewed-new-account',fundedCutoff:start+3600000,workflowRevision:runtime,controlRepository:repository,githubUsage:syntheticGithubUsage(start,start+3600000,{repository}),nonce:'2'.repeat(32)},{store:f.writer,clock:()=>start});
 const registry={schema:1,kind:'runpod-dual-cleanup-registry',runtimeRevision:'e'.repeat(40),references:[f.reference,next.externalControl]},registryPath=`control/prearms/${'3'.repeat(32)}.json`;
 const stored=await f.writer.append(registryPath,registry);
 const env={COMPUTE_CONTROL_ARMED:'true',GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',COMPUTE_CONTROL_REPOSITORY:repository,COMPUTE_CONTROL_WRITE_TOKEN:'private',COMPUTE_PREARM_COMMIT:f.reference.commit,COMPUTE_PREARM_PATH:f.reference.path,COMPUTE_PREARM_SHA256:f.reference.sha256,RUNPOD_CLEANUP_API_KEY:'private',RUNPOD_ACCOUNT_ID:'account-pilot',COMPUTE_RUNTIME_REVISION:registry.runtimeRevision,COMPUTE_CLEANUP_REGISTRY_COMMIT:stored.commit,COMPUTE_CLEANUP_REGISTRY_PATH:registryPath,COMPUTE_CLEANUP_REGISTRY_SHA256:await sha256(encode(canonical(registry)))};
 const frozen={...env},rp=runpod();let failOnce=true,calls=0;
 const fetcher=async(url,opts)=>{
  if(new URL(url).hostname==='api.github.com')return f.gh.fetcher(url,opts);
  calls++;assert.notEqual(opts?.method,'POST');
  if(new URL(url).pathname==='/v2/queued-pods')return Response.json({queuedPods:[],pagination:{hasNextPage:false}});
  if(failOnce){failOnce=false;return new Response('',{status:503});}
  return rp.fetcher(url,opts);
 };
 const result=await cleanupFromEnvironment(env,{fetcher,clock:()=>start+3600001});
 assert.equal(result.kind,'dual-cleanup-result');assert.equal(result.results.length,2);assert(result.results[0].failures.length>0);assert.equal(result.results[1].durableReceiptConfirmed,true);assert.equal(result.results[1].cleanupObservedAbsent,true);assert.equal(cleanupProcessResult(result).exitCode,1);assert(calls>4);assert.deepEqual(env,frozen);
 const status=cleanupProcessResult(result).status;assert.equal(status.ownershipSets[0].prearmSha256,f.reference.sha256);assert.equal(status.ownershipSets[1].prearmSha256,next.externalControl.sha256);
 const priorCalls=calls;await assert.rejects(cleanupFromEnvironment({...env,COMPUTE_RUNTIME_REVISION:'f'.repeat(40)},{fetcher,clock:()=>start+3600001}),/registry runtime/);assert.equal(calls,priorCalls);
});
function github() {
  const files=new Map(),commits=new Map(),history=new Map(),calls=[]; let sequence=0;
  const api={files,calls,private:true,failFence:false,lostPut:false,deny:false,hidden:false,revokeOnMissingFence:false};
  api.fetcher=async(url,options={})=>{
    calls.push({url,method:options.method??'GET',redirect:options.redirect});
    assert.equal(new URL(url).origin,'https://api.github.com');
    const parsed=new URL(url),base=`/repos/${repository}`,path=parsed.pathname;
    if(api.hidden) return new Response('',{status:404});
    if(api.deny) return new Response('provider secret body',{status:403});
    if(path===base) return Response.json({private:api.private,full_name:repository,default_branch:'main'});
    if(path===`${base}/commits`) return Response.json([{sha:history.get(parsed.searchParams.get('path'))}]);
    assert(path.startsWith(`${base}/contents/`));
    const key=path.slice(`${base}/contents/`.length);
    if(api.failFence && key.startsWith('control/fences/')) return new Response('unavailable',{status:503});
    if(options.method==='PUT') {
      const body=JSON.parse(options.body);assert.equal(body.sha,undefined,'records must never overwrite');
      if(files.has(key)) return new Response('exists',{status:422});
      const raw=Buffer.from(body.content,'base64').toString(),sha=(++sequence).toString(16).padStart(40,'0');
      files.set(key,raw);history.set(key,sha);commits.set(sha,new Map(files));
      if(api.lostPut) {api.lostPut=false;throw Error('lost commit response');}
      return Response.json({commit:{sha}},{status:201});
    }
    const ref=parsed.searchParams.get('ref'),raw=(ref==='main'?files:commits.get(ref))?.get(key);
    if(raw===undefined && key.startsWith('control/fences/') && api.revokeOnMissingFence) api.hidden=true;
    return raw===undefined ? new Response('',{status:404}) : Response.json({type:'file',encoding:'base64',size:Buffer.byteLength(raw),content:Buffer.from(raw).toString('base64')});
  };
  return api;
}
async function setup() {
  const gh=github(),writer=new GitHubControlWriter({repository,token:'operator-private',fetcher:gh.fetcher});
  const m=manifest();
  const {record,externalControl:reference}=await prearmCampaign(m,{accountId:'account-pilot',accountEvidenceReference:'human-key-scope-verification',fundedCutoff:start+3600000,workflowRevision:runtime,controlRepository:repository,githubUsage:syntheticGithubUsage(start,start+3600000,{repository}),nonce:'1'.repeat(32)},{store:writer,clock:()=>start});
  m.externalControl=reference;
  const reader=new GitHubControlReader({repository,token:'primary-read-only',fetcher:gh.fetcher});
  return {gh,writer,reader,m,record,reference};
}
function runpod() {
  const calls=[],pods=new Map(),api={calls,pods,fail:false,late:null,scans:0,swap:false,malformed:false};
  api.fetcher=async(url,options={})=>{
    const method=options.method??'GET';calls.push({url,method});
    const parsed=new URL(url);assert.equal(parsed.origin,'https://api.runpod.io');
    if(api.fail) return new Response('provider token secret',{status:429});
    if(parsed.pathname==='/v2/pods') {
      api.scans++;
      if(api.late && api.scans>=3) {pods.set(api.late.id,api.late);api.late=null;}
      if(api.malformed) return Response.json({pods:[...pods.values()]});
      const cursor=parsed.searchParams.get('cursor');
      if(!cursor) return Response.json({pods:[{id:'other',name:'unrelated-righelt-pod'}],pagination:{hasNextPage:true,nextCursor:'opaque/+='}});
      assert.equal(cursor,'opaque/+=');
      return Response.json({pods:[...pods.values()],pagination:{hasNextPage:false}});
    }
    const id=parsed.pathname.split('/').at(-1),pod=pods.get(id);
    if(!pod) return new Response('',{status:404});
    if(method==='DELETE') {pods.delete(id);return new Response(null,{status:204});}
    return Response.json(api.swap?{...pod,name:'unrelated-reused-identity'}:pod);
  };
  api.provider=new RunpodCleanup({token:'private-runpod',accountId:'account-pilot',fetcher:api.fetcher});
  return api;
}

test('operator prearm commits and reads back exact immutable launch content without a circular hash',async()=>{
  const f=await setup();
  assert.equal(f.record.launchSha256,await launchManifestSha256(f.m));
  assert.equal(f.record.cutoff,start+3600000);
  assert.equal(f.record.maximumGeneration,4);
  assert.equal(f.record.launches.length,6);
  assert.deepEqual(await f.writer.prearm(f.record),f.reference);
  await assert.rejects(f.writer.prearm({...f.record,accountEvidenceReference:'different-operator-scope-evidence'}),/immutable/);
  f.gh.lostPut=true;
  const second=await buildPrearm({...f.m,id:'second'},{accountId:'account-pilot',accountEvidenceReference:'operator-scope-check',createdAt:start,fundedCutoff:start+3600000,workflowRevision:runtime,controlRepository:repository,githubUsage:syntheticGithubUsage(start,start+3600000,{repository}),nonce:'2'.repeat(32)});
  assert.equal((await f.writer.prearm(second)).sha256.length,64);
});
test('primary uses only read authority and rejects changed recipes, unarmed generations, cutoff and unavailable fences',async()=>{
  const f=await setup(),control=new PrimaryControl({store:f.reader,reference:f.reference,clock:()=>start+1});
  const before=f.gh.calls.length;
  assert.equal((await control.authorizeLaunch(f.m,{phaseIndex:0,generation:1})).name,f.record.launches[0].name);
  assert(f.gh.calls.slice(before).every(x=>x.method==='GET'));
  await assert.rejects(f.reader.request(`/repos/${repository}/contents/control/fences/${f.record.nonce}.json`,{method:'PUT',body:{}}),/read-only/);
  await assert.rejects(control.authorizeLaunch({...f.m,recipe:{loss:'different'}},{phaseIndex:0,generation:1}),/manifest/);
  await assert.rejects(control.authorizeLaunch(f.m,{phaseIndex:0,generation:4}),/inventory/);
  await assert.rejects(new PrimaryControl({store:f.reader,reference:f.reference,clock:()=>f.record.cutoff}).authorizeLaunch(f.m,{phaseIndex:0,generation:1}),/cutoff/);
  f.gh.failFence=true;
  await assert.rejects(control.authorizeLaunch(f.m,{phaseIndex:0,generation:1}),/503/);
});
test('public or inaccessible control repositories fail closed without disclosing API bodies',async()=>{
  const f=await setup();f.gh.private=false;
  await assert.rejects(new GitHubControlReader({repository,token:'x',fetcher:f.gh.fetcher}).readPrearm(f.reference),/private/);
  f.gh.private=true;f.gh.deny=true;
  const reader=new GitHubControlReader({repository,token:'x',fetcher:f.gh.fetcher});
  await assert.rejects(reader.readPrearm(f.reference),e=>/403/.test(e.message)&&!e.message.includes('secret'));
  f.gh.deny=false;assert.equal((await reader.readPrearm(f.reference)).nonce,f.record.nonce);
});
test('missing fence after a successful prearm read does not hide revoked private access',async()=>{
  const f=await setup();f.gh.revokeOnMissingFence=true;
  await assert.rejects(new PrimaryControl({store:f.reader,reference:f.reference,clock:()=>start+1}).authorizeLaunch(f.m,{phaseIndex:0,generation:1}),/404/);
});
test('cleanup waits for original cutoff, fences durably, deletes exact owned Pods across pagination and leaves unrelated Pods alone',async()=>{
  const f=await setup(),api=runpod(),pod={id:'owned',name:f.record.launches[0].name};api.pods.set(pod.id,pod);
  const run=now=>sweepExternal({store:f.writer,reference:f.reference,provider:api.provider,clock:()=>now,workflowRevision:runtime});
  assert.equal((await run(f.record.cutoff-1)).state,'waiting');assert.equal(api.calls.length,0);
  const receipt=await run(f.record.cutoff);
  assert.equal(receipt.cleanupObservedAbsent,true);assert.equal(receipt.armed,true);assert.equal(receipt.requiresOperatorResolution,true);
  assert.deepEqual(api.calls.filter(x=>x.method==='DELETE').map(x=>new URL(x.url).pathname),['/v2/pods/owned']);
  assert(api.calls.every(x=>['GET','DELETE'].includes(x.method)));
  assert.equal((await f.reader.readFence(f.record.nonce)).kind,'terminal');
  await assert.rejects(new PrimaryControl({store:f.reader,reference:f.reference,clock:()=>start+1}).authorizeLaunch(f.m,{phaseIndex:0,generation:1}),/terminal fence/);
});
test('empty scans do not disarm and a late visible lost-create Pod is terminated by a later run',async()=>{
  const f=await setup(),api=runpod();
  const run=()=>sweepExternal({store:f.writer,reference:f.reference,provider:api.provider,clock:()=>f.record.cutoff+1,workflowRevision:runtime});
  const first=await run();assert.equal(first.armed,true);assert.equal(first.cleanupObservedAbsent,true);
  api.late={id:'late',name:f.record.launches[1].name};
  const second=await run();assert.equal(second.cleanupObservedAbsent,true);assert.equal(api.pods.size,0);
  assert.equal(api.calls.filter(x=>x.method==='DELETE').length,1);
});
test('expired immutable authority permits cleanup through fence-write failure, while provider outages remain uncertain',async()=>{
  const f=await setup(),api=runpod();api.pods.set('owned',{id:'owned',name:f.record.launches[0].name});
  const run=()=>sweepExternal({store:f.writer,reference:f.reference,provider:api.provider,clock:()=>f.record.cutoff,workflowRevision:runtime});
  f.gh.failFence=true;const unfenced=await run();assert.equal(unfenced.terminalFenceConfirmed,false);assert.equal(unfenced.cleanupObservedAbsent,true);assert.equal(api.pods.size,0);assert.equal(unfenced.requiresOperatorResolution,true);
  await assert.rejects(new PrimaryControl({store:f.reader,reference:f.reference,clock:()=>f.record.cutoff}).authorizeLaunch(f.m,{phaseIndex:0,generation:1}),/cutoff/);
  f.gh.failFence=false;api.fail=true;
  const failed=await run();assert.equal(failed.cleanupObservedAbsent,false);assert.equal(failed.armed,true);assert.equal(failed.failures.length,2);
  api.fail=false;assert.equal((await run()).cleanupObservedAbsent,true);
});
test('changed ownership and incomplete inventory cannot become deletion success',async()=>{
  const f=await setup(),api=runpod();api.pods.set('owned',{id:'owned',name:f.record.launches[0].name});
  const run=()=>sweepExternal({store:f.writer,reference:f.reference,provider:api.provider,clock:()=>f.record.cutoff,workflowRevision:runtime});
  api.swap=true;const changed=await run();assert.equal(changed.cleanupObservedAbsent,false);assert.equal(api.calls.filter(x=>x.method==='DELETE').length,0);
  api.swap=false;api.malformed=true;const incomplete=await run();assert.equal(incomplete.cleanupObservedAbsent,false);assert.equal(incomplete.remaining,null);
  await assert.rejects(api.provider.request('https://attacker.test/pods','DELETE'),/fixed Runpod/);
  await assert.rejects(api.provider.request('/pods','POST'),/fixed Runpod/);
});
test('runtime checks pinned workflow/account and ignores arbitrary dispatch ownership fields',async()=>{
  const f=await setup(),api=runpod();
  await assert.rejects(sweepExternal({store:f.writer,reference:f.reference,provider:api.provider,clock:()=>f.record.cutoff,workflowRevision:'d'.repeat(40)}),/runtime differs/);
  await assert.rejects(sweepExternal({store:f.writer,reference:f.reference,provider:new RunpodCleanup({token:'x',accountId:'different-account',fetcher:api.fetcher}),clock:()=>f.record.cutoff,workflowRevision:runtime}),/account/);
  await assert.rejects(sweepExternal({store:f.writer,reference:{...f.reference,sha256:'0'.repeat(64)},provider:api.provider,clock:()=>f.record.cutoff,workflowRevision:runtime}),/identity mismatch/);
  const env={COMPUTE_CONTROL_ARMED:'true',GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',COMPUTE_CONTROL_REPOSITORY:repository,COMPUTE_CONTROL_WRITE_TOKEN:'cleanup-repo-token',COMPUTE_PREARM_COMMIT:f.reference.commit,COMPUTE_PREARM_PATH:f.reference.path,COMPUTE_PREARM_SHA256:f.reference.sha256,COMPUTE_RUNTIME_REVISION:runtime,RUNPOD_ACCOUNT_ID:'account-pilot',RUNPOD_CLEANUP_API_KEY:'private-provider',INPUT_POD_NAME:'unrelated-righelt-pod'};
  const fetcher=(url,options)=>url.startsWith('https://api.github.com')?f.gh.fetcher(url,options):api.fetcher(url,options);
  assert.equal((await cleanupFromEnvironment(env,{fetcher,clock:()=>f.record.cutoff})).armed,true);
  assert.equal(api.calls.filter(x=>x.method==='DELETE').length,0);
  await assert.rejects(cleanupFromEnvironment({...env,COMPUTE_CONTROL_ARMED:'false'},{fetcher}),/not armed/);
  await assert.rejects(cleanupFromEnvironment({...env,GITHUB_REF:'refs/heads/unreviewed'},{fetcher}),/default branch/);
});
test('prearm forbids mid-run review dependencies and cleanup escalates only after the funded autonomous window',async()=>{
  const f=await setup(),api=runpod();
  const usage=syntheticGithubUsage(start,start+3600000,{repository});
  const writesBefore=f.gh.calls.filter(x=>x.method==='PUT').length;
  for(const short of [{expiresAt:start+1800000},{escalateAt:start+900000},{autonomousUntil:start+1800000}])
    await assert.rejects(prearmCampaign(f.m,{accountId:'account-pilot',accountEvidenceReference:'operator-key-scope-verification',fundedCutoff:start+3600000,workflowRevision:runtime,controlRepository:repository,githubUsage:{...usage,...short},nonce:'3'.repeat(32)},{store:f.writer,clock:()=>start}));
  assert.equal(f.gh.calls.filter(x=>x.method==='PUT').length,writesBefore);
  const {record,externalControl:reference}=await prearmCampaign(f.m,{accountId:'account-pilot',accountEvidenceReference:'operator-key-scope-verification',fundedCutoff:start+3600000,workflowRevision:runtime,controlRepository:repository,githubUsage:usage,nonce:'3'.repeat(32)},{store:f.writer,clock:()=>start});
  const m={...f.m,externalControl:reference};
  assert.equal((await new PrimaryControl({store:f.reader,reference,clock:()=>record.cutoff-1}).authorizeLaunch(m,{phaseIndex:0,generation:1})).name,record.launches[0].name);
  const waiting=await sweepExternal({store:f.writer,reference,provider:api.provider,clock:()=>start+1200000,workflowRevision:runtime});
  assert.equal(cleanupProcessResult(waiting).status.usageReviewRequired,false);assert.equal(cleanupProcessResult(waiting).exitCode,0);assert.equal(api.calls.length,0);
  api.pods.set('owned',{id:'owned',name:record.launches[0].name});
  const receipt=await sweepExternal({store:f.writer,reference,provider:api.provider,clock:()=>record.cutoff+1,workflowRevision:runtime});
  assert.equal(receipt.cleanupObservedAbsent,true);assert.equal(receipt.usageReviewRequired,false);assert.equal(receipt.armed,true);
  assert.equal(cleanupProcessResult(receipt).exitCode,0);
  api.pods.set('late',{id:'late',name:record.launches[1].name});
  const overdue=await sweepExternal({store:f.writer,reference,provider:api.provider,clock:()=>usage.autonomousUntil,workflowRevision:runtime});
  assert.equal(overdue.cleanupObservedAbsent,true);assert.equal(overdue.usageReviewRequired,true);assert.equal(overdue.armed,true);
  assert.equal(cleanupProcessResult(overdue).exitCode,1);assert.equal(cleanupProcessResult(overdue).status.usageReviewRequired,true);
  assert(usage.autonomousUntil<record.githubUsage.projection.forecastUntil);
});
