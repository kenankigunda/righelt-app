import test from 'node:test';
import assert from 'node:assert/strict';
import EvidenceReporter from '../reporter.mjs';

test('reporter distinguishes skipped workflows from failed and passed workflows',()=>{
 const reporter=new EvidenceReporter();
 const workflow={titlePath:()=>['suite','workflow'],parent:{project:()=>({name:'mobile'})}};
 for(const status of ['skipped','failed','timedOut','passed'])reporter.onTestEnd(workflow,{status,attachments:[]});
 assert.deepEqual(reporter.items.map(i=>i.status),['skipped','failed','failed','passed']);
 assert.deepEqual(reporter.items.map(i=>i.assertions[0]),[
  'Workflow was skipped; no pass or failure was recorded.',
  'Workflow did not pass; inspect private test logs.',
  'Workflow did not pass; inspect private test logs.',
  'All assertions in this workflow passed.'
 ]);
});
