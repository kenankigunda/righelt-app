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

test('reporter records client and checkpoints without leaking failure data',()=>{
 const reporter=new EvidenceReporter(),workflow={titlePath:()=>['suite','workflow'],parent:{project:()=>({name:'mobile',use:{browserName:'webkit',viewport:{width:390,height:844},hasTouch:true,baseURL:'secret'}})}};
 reporter.onTestEnd(workflow,{status:'failed',error:{message:'private recovery secret'},attachments:[{name:'behavior',contentType:'application/json',body:Buffer.from(JSON.stringify({label:'owned move',checkpoint:'owned-move',private:'secret'}))}]});const row=reporter.items[0];assert.deepEqual(row.client,{browser:'webkit',viewport:'mobile',width:390,height:844,hasTouch:true});assert.deepEqual(row.behaviors,[{label:'owned move',checkpoint:'owned-move'}]);assert(!JSON.stringify(row).includes('secret'));
});
