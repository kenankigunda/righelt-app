import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePRGate,currentPRGatePassed} from '../ci-gate.mjs';
import {gateFixture} from './support/ci-gate-fixture.mjs';
const current=selected=>({number:1,headRefOid:'h',baseRefOid:'b',baseRefName:'main',statusCheckRollup:[selected]});
const resolve=async(f,changes={})=>resolvePRGate({current:{...current(f.selected),...changes},repository:'o/r',execute:async argv=>{assert.equal(argv[0],'gh');assert.equal(argv[1],'api');const row=f.resources[argv[2]];assert.ok(row,argv[2]);return {output:JSON.stringify(row)};}});

test('canonical current PR gate passes independently of failed, missing or pending advisory checks',async()=>{
 for(const advisories of [[],[{name:'Nightly full validation',conclusion:'FAILURE'}],[{name:'Full validation',conclusion:'PENDING'}]]){
  const f=gateFixture();const result=await resolve(f,{statusCheckRollup:[f.selected,...advisories]});
  assert.equal(result.status,'passed');assert.deepEqual(result.advisoryChecks,advisories);
  assert.equal(currentPRGatePassed({number:1,head:'h',base:'main',ciGate:result.gate},'b',{repository:'o/r'}),true);
 }
});
test('actual gate pending, failure, cancellation, neutral and skipped never become successful',async()=>{
 for(const [status,conclusion,expected] of [['in_progress',null,'pending'],['completed','failure','failed'],['completed','cancelled','failed'],['completed','neutral','failed'],['completed','skipped','failed']]){
  const f=gateFixture({status,conclusion});assert.equal((await resolve(f)).status,expected);
 }
});
test('missing, duplicate and passing-label-only check cannot satisfy the gate',async()=>{
 const f=gateFixture();
 for(const checks of [[],[f.selected,f.selected],[{name:'PR validation',conclusion:'SUCCESS'}],[{...f.selected,__typename:'StatusContext'}],[{__typename:'StatusContext',context:'PR validation',state:'FAILURE'}],[{...f.selected,workflowName:'Nightly validation'}]]){
  const result=await resolve(f,{statusCheckRollup:checks});assert.equal(result.status,'unknown');assert.equal(result.gate,null);
 }
});
test('primary provenance refuses wrong job, app, workflow, head, base, repository, attempt and check suite',async()=>{
 const mutations=[f=>f.selected.detailsUrl='https://evil.invalid/o/r/actions/runs/101/job/202',f=>f.selected.detailsUrl+='?x=1',f=>f.job.id=203,f=>f.job.run_id=102,f=>f.job.head_sha='old',f=>f.job.check_run_url='https://api.github.com/repos/other/repo/check-runs/303',f=>f.check.app.slug='other',f=>f.check.app.owner.login='other',f=>f.check.head_sha='old',f=>f.check.check_suite.id=405,f=>f.run.path='.github/workflows/nightly-validation.yml',f=>f.run.name='Nightly validation',f=>f.run.repository.full_name='other/repo',f=>f.run.head_sha='old',f=>f.run.event='workflow_dispatch',f=>f.run.run_attempt=2,f=>f.run.pull_requests[0].number=2,f=>f.run.pull_requests[0].base.sha='old',f=>f.run.pull_requests[0].base.ref='other',f=>f.run.pull_requests[0].head.sha='old',f=>f.run.pull_requests.push(f.run.pull_requests[0]),f=>f.check.conclusion='failure'];
 for(const mutate of mutations){const f=gateFixture();mutate(f);const result=await resolve(f);assert.equal(result.status,'unknown');assert.equal(result.gate,null);}
});
test('unavailable or malformed primary resources remain unknown',async()=>{
 for(const execute of [async()=>{throw Error('network unavailable');},async()=>({output:'not JSON'})]){
  const result=await resolvePRGate({current:current(gateFixture().selected),repository:'o/r',execute});assert.equal(result.status,'unknown');assert.equal(result.gate,null);
 }
});
test('readiness rejects stale, future, missing and foreign gate provenance even with cached passed flag',()=>{
 const f=gateFixture();const pr={number:1,head:'h',base:'main',ciGate:f.gate};
 for(const change of [{checkedAt:new Date(Date.now()-61_000).toISOString()},{checkedAt:new Date(Date.now()+60_000).toISOString()},{verified:false},{head:'old'},{base:'old'},{number:2},{repository:'foreign/repo'},{runAttempt:0},{workflowPath:'.github/workflows/nightly-validation.yml'},{status:'pending'}])assert.equal(currentPRGatePassed({...pr,ciGate:{...f.gate,...change}},'b',{repository:'o/r'}),false);
 assert.equal(currentPRGatePassed({...pr,ciGate:null},'b',{repository:'o/r'}),false);
});
