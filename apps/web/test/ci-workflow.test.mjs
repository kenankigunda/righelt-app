import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {workflow,workflowText} from '../../../scripts/testing/workflow.mjs';
import {fullLanes,laneKey} from '../../../scripts/testing/catalog.mjs';
const actual=JSON.parse(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
test('checked-in CI equals the catalog-generated workflow',()=>assert.equal(JSON.stringify(actual),JSON.stringify(workflow())));
test('every full lane runs exactly once with independent jobs',()=>{
 const lanes=Object.entries(actual.jobs).filter(([id])=>id!=='full-validation').flatMap(([,job])=>{assert.equal(job.needs,undefined);assert.equal(job.strategy['fail-fast'],false);return job.strategy.matrix.include.map(l=>laneKey({...l,project:l.project||null}));});
 assert.deepEqual(lanes.sort(),fullLanes().map(laneKey).sort());
});
test('full gate always runs and depends on every lane, installs are frozen and pinned',()=>{
 const gate=actual.jobs['full-validation'];assert.equal(gate.name,'Full validation');assert.equal(gate.if,'always()');assert.deepEqual(gate.needs.sort(),Object.keys(actual.jobs).filter(id=>id!=='full-validation').sort());
 for(const job of Object.values(actual.jobs)){
  assert.equal(job.steps.find(s=>s.uses==='actions/checkout@v5').with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.ok(job.steps.some(s=>s.run==='pnpm install --frozen-lockfile'));
  assert.ok(job.steps.some(s=>s.uses==='pnpm/action-setup@v4'&&s.with.version==='9.15.9'));
 }
 assert.ok(actual.on.pull_request.types.includes('ready_for_review'));assert.ok(actual.on.workflow_dispatch);assert.equal(actual.on.pull_request.paths,undefined);
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
