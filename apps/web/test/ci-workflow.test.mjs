import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {nightlyWorkflow,workflow} from '../../../scripts/testing/workflow.mjs';
import {nightlyFullLanes,prGateLanes,laneKey,suiteById} from '../../../scripts/testing/catalog.mjs';
const actual=JSON.parse(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const nightly=JSON.parse(readFileSync(new URL('../../../.github/workflows/nightly-validation.yml',import.meta.url),'utf8'));
test('checked-in CI equals the catalog-generated workflow',()=>assert.equal(JSON.stringify(actual),JSON.stringify(workflow())));
test('checked-in nightly equals the catalog-generated workflow',()=>assert.equal(JSON.stringify(nightly),JSON.stringify(nightlyWorkflow())));
const workflowLanes=(definition)=>Object.entries(definition.jobs).flatMap(([id,job])=>{
 if(['plan','pr-validation','full-validation','nightly-validation'].includes(id))return[];
 if(job.strategy)return job.strategy.matrix.include.map(l=>laneKey({...l,project:l.project||null}));
 if(id.endsWith('-retry'))return[];
 const validate=job.steps.find(step=>step.name==='Validate suite');
 if(!validate)return[];
 return[laneKey({suite:validate.env.SUITE,project:validate.env.PROJECT||null,shard:Number(validate.env.SHARD),shards:Number(validate.env.SHARDS)})];
});
test('every PR-gate lane runs exactly once before any conditional retry',()=>{
 assert.deepEqual(workflowLanes(actual).sort(),prGateLanes().map(laneKey).sort());
 const retries=Object.entries(actual.jobs).filter(([id])=>id.endsWith('-retry'));
 assert.equal(retries.length,prGateLanes().filter(l=>suiteById(l.suite).browser).length);
 for(const[,job]of retries)assert.match(job.if,/retry_eligible == 'true'/);
});
test('PR validation is the sole required aggregate',()=>{
 const gate=actual.jobs['pr-validation'];assert.equal(gate.name,'PR validation');assert.equal(gate.if,'always()');
 assert.deepEqual(gate.needs.sort(),Object.keys(actual.jobs).filter(id=>id!=='pr-validation').sort());
 assert.equal(actual.jobs['full-validation'],undefined);
 for(const [id,job] of Object.entries(actual.jobs)){
  assert.equal(job.steps.find(s=>s.uses==='actions/checkout@v5').with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.ok(job.steps.some(s=>s.run==='pnpm install --frozen-lockfile'));
  assert.ok(job.steps.some(s=>s.uses==='pnpm/action-setup@v4'&&s.with.version==='9.15.9'));
 }
 assert.deepEqual(actual.on.pull_request,{types:['opened','synchronize','reopened']},'PR source lifecycle events run full CI without repeating unchanged checks on ready status');
 assert.deepEqual(actual.on.push,{branches:['main']});assert.deepEqual(actual.on.workflow_dispatch,{});
});

test('nightly is advisory, complete, and cannot emit required gate contexts',()=>{
 assert.equal(nightly.name,'Nightly validation');
 assert.deepEqual(nightly.on.schedule,[{cron:'0 9 * * *'}]);assert.deepEqual(nightly.on.workflow_dispatch,{});
 assert.deepEqual(workflowLanes(nightly).sort(),nightlyFullLanes().map(laneKey).sort());
 assert.equal(nightly.jobs['pr-validation'],undefined);assert.equal(nightly.jobs['full-validation'],undefined);
 assert.equal(nightly.jobs['nightly-validation'].name,'Nightly validation');
});

test('model CI installs pinned pnpm before Node cache discovery and uses the frozen lock',()=>{
 const source=readFileSync(new URL('../../../.github/workflows/trained-play.yml',import.meta.url),'utf8');
 assert.ok(source.indexOf('pnpm/action-setup@v4') < source.indexOf('actions/setup-node@v5'));
 assert.match(source,/version: '9\.15\.9'/);
 assert.match(source,/pnpm install --frozen-lockfile\n/);
 assert.doesNotMatch(source,/corepack prepare|frozen-lockfile=false/);
});


test('browser-install jobs pin the Playwright-supported Ubuntu24.04 image',()=>{
 for(const [name,job]of Object.entries(actual.jobs)){
  const installsBrowsers=job.steps.some(step=>step.run==='node scripts/testing/install-browsers.mjs');
  assert.equal(job['runs-on'],installsBrowsers?'ubuntu-24.04':'ubuntu-latest',`${name} runner must match its browser requirement`);
 }
 for(const [file,browser]of [['trained-play.yml','chromium'],['webkit-rendering-diagnostic.yml','webkit']]){
  const source=readFileSync(new URL(`../../../.github/workflows/${file}`,import.meta.url),'utf8');
  assert.match(source,/runs-on: ubuntu-24\.04(?:\s|$)/);
  assert.ok(source.includes(`playwright install --with-deps ${browser}`));
  assert.doesNotMatch(source,/runs-on: ubuntu-latest/);
 }
});
