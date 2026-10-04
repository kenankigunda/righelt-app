import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness,canMerge,publicRun,finalProofReady} from '../model.mjs';
import {mergeAuthorized} from '../merge.mjs';
function fixture(){
 const prs=[1,2].map(number=>({number,head:`h${number}`,base:'main',inputBaseSha:'b',gatesHead:`h${number}`,gatesBase:'b',independentReview:{status:'passed',head:`h${number}`},checks:'passed',review:'passed',preview:'not-configured',previewCheckedHead:`h${number}`,conflicts:false,open:true,authorization:{state:'authorized',target:'main'}}));
 return {version:2,mode:'integrated',repository:'o/r',mergeMethod:'squash',base:'b',complete:true,replyCheckedAt:new Date().toISOString(),prs,stages:[0,1,2].map(index=>({index,policyVersion:2,phase:index===2?'final':index?'boundary':'baseline',head:index?`h${index}`:'b',base:'b',status:'passed',sourceClean:true,visualRequired:index===2,visualReviewed:index===2,checks:[{name:'Unit',status:'passed'}],...(index===2?{checkpointProvenance:{base:'b',prefix:prs.map(p=>({number:p.number,head:p.head}))}}:{})}))};
}
test('v2 boundary waits for successful reviewed final evidence and exact complete inputs',()=>{
 const valid=fixture();assert.equal(finalProofReady(valid,'b'),true);assert.equal(canMerge(valid.prs[0],valid.stages[1],'b',valid),true);
 for(const mutate of [r=>r.stages[2].status='failed',r=>r.stages.pop(),r=>r.stages[2].visualReviewed=false,r=>r.complete=false,r=>r.prs[1].head='new',r=>r.base='new-base',r=>r.stages[2].checks[0].status='failed',r=>delete r.stages[2].checkpointProvenance]){
  const run=fixture();mutate(run);assert.equal(canMerge(run.prs[0],run.stages[1],'b',run),false);assert.notEqual(publicRun(run).prs[0].readiness,'merge-ready');
 }
 assert.notEqual(readiness(valid.prs[0],valid.stages[1],'b').status,'merge-ready','omitting the run cannot bypass v2 linkage');
});
test('local v2 requires final review but v1 readiness remains compatible',()=>{
 const run=fixture();run.mode='local';run.revision='h1';run.stages=[{...run.stages[2],index:0,head:'h1'}];delete run.complete;
 assert.equal(finalProofReady(run,'b'),true);run.stages[0].visualReviewed=false;assert.equal(finalProofReady(run,'b'),false);
 const old={...fixture().stages[1]};delete old.policyVersion;assert.equal(canMerge(run.prs[0],old,'b'),true);
});
test('merge refresh invalidates final evidence when another input head or base changes',async()=>{
 for(const variant of ['head','base','target','missing-receipt']){
  const run=fixture();if(variant==='missing-receipt')delete run.prs[1].inputBaseSha;let writes=0;const read=[];
  const execute=async argv=>{
   if(argv[2]==='merge'){writes++;throw Error('Must not merge');}
   const number=argv[1]==='api'?1:Number(argv[3]);read.push(number);
   const current={number,headRefOid:variant==='head'&&number===2?'changed':`h${number}`,baseRefOid:variant==='base'&&number===2?'changed-base':'b',baseRefName:variant==='target'&&number===2?'other':'main',state:'OPEN',isDraft:false,mergeable:'MERGEABLE',reviewDecision:'APPROVED',statusCheckRollup:[{conclusion:'SUCCESS'}]};
   return {output:JSON.stringify(argv[1]==='api'?{number,head:{sha:current.headRefOid},base:{sha:current.baseRefOid,ref:current.baseRefName},stack:null}:current)};
  };
  await assert.rejects(mergeAuthorized(run,1,{execute}),/Not ready/);assert.equal(writes,0);assert.ok(read.includes(2));assert.equal(run.complete,false);
 }
});
