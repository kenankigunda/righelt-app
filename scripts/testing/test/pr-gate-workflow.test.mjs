import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {workflow,workflowText,nightlyWorkflowText} from '../workflow.mjs';
import {expectedCILayout} from '../ci-layouts.mjs';
import {prGateLanes,laneKey} from '../catalog.mjs';

test('advisory planning cannot block the PR aggregate or successful CI deployment trigger',()=>{
 const {jobs}=workflow(),aggregate=jobs['pr-validation'];
 assert.equal(jobs.plan['continue-on-error'],true,'shadow failure must not fail the CI workflow');
 assert.ok(!aggregate.needs.includes('plan'),'shadow failure must not reach the required receipt verifier');
 assert.equal(aggregate.if,'always()');
 assert.deepEqual(new Set(aggregate.needs),new Set(Object.keys(jobs).filter(id=>!['plan','pr-validation'].includes(id))), 'every real test job remains required');
 assert.ok(jobs.plan.steps.some(step=>step.name==='Preserve shadow plan'));
 assert.ok(!Object.values(jobs).some(job=>job.name==='Full validation'));
});

test('released PR layout pins the generated workflow and complete unchanged PR inventory',async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const profile=await expectedCILayout(root,'auto');
 assert.equal(profile.evidenceProfile,'pr-gate');
 assert.deepEqual(profile.lanes.map(laneKey).sort(),prGateLanes().map(laneKey).sort());
 assert.equal(await readFile(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'),workflowText());
 assert.equal(await readFile(new URL('../../../.github/workflows/nightly-validation.yml',import.meta.url),'utf8'),nightlyWorkflowText());
});

test('four-way layout retains all suites and browser lanes with complete Node partitions',()=>{
 const lanes=prGateLanes(4),current=prGateLanes(1);
 assert.equal(lanes.length,25);
 assert.deepEqual([...new Set(lanes.map(l=>l.suite))].sort(),[...new Set(current.map(l=>l.suite))].sort());
 const {jobs}=workflow({nodePartitions:4});
 assert.equal(jobs.node.strategy['fail-fast'],false);
 assert.deepEqual(jobs.node.strategy.matrix.include.filter(l=>l.suite==='sync-stress').map(l=>[l.shard,l.shards]),[[1,4],[2,4],[3,4],[4,4]]);
 assert.deepEqual(jobs.node.strategy.matrix.include.filter(l=>l.suite==='tooling').map(l=>[l.shard,l.shards]),[[1,4],[2,4],[3,4],[4,4]]);
 assert.throws(()=>prGateLanes(2));
});
