import test from 'node:test';import assert from 'node:assert/strict';import {mergeAuthorized} from '../merge.mjs';
function fixture(){return {repository:'o/r',mergeMethod:'squash',mode:'local',replyCheckedAt:new Date().toISOString(),prs:[{number:1,head:'h',base:'main',noReviewRequired:true,preview:'passed',previewHead:'h',previewUrl:'https://example.invalid/preview',independentReview:{status:'passed',head:'h'},authorization:{state:'authorized',target:'main'}}],stages:[{index:0,head:'h',base:'b',status:'passed',visualReviewed:true,sourceClean:true}]};}
const state={number:1,headRefOid:'h',baseRefOid:'b',baseRefName:'main',state:'OPEN',isDraft:false,mergeable:'MERGEABLE',reviewDecision:'APPROVED',statusCheckRollup:[{conclusion:'SUCCESS'}]};
function response(argv,data=state){return JSON.stringify(argv[1]==='api'?{number:1,head:{sha:data.headRefOid},base:{sha:data.baseRefOid,ref:data.baseRefName},stack:null}:data);}
test('merge checks current head, uses expected-head and consumes only confirmed merge',async()=>{const run=fixture();const calls=[];let merged=false;const execute=async argv=>{calls.push(argv);if(argv[2]==='merge'){merged=true;return {output:''};}return {output:response(argv,{...state,state:merged?'MERGED':'OPEN',mergeCommit:merged?{oid:'merged'}:null})};};assert.equal(await mergeAuthorized(run,1,{execute}),true);const merge=calls.find(a=>a[2]==='merge');assert(merge.includes('--match-head-commit'));assert.equal(merge.at(-1),'h');assert(!merge.includes('--admin'));assert(!merge.includes('--auto'));assert.equal(run.prs[0].authorization.state,'consumed');});
test('head race, pending CI, dirty proof and stale reply check prevent a merge',async()=>{for(const variant of ['head','pending','dirty','stale','preview']){const run=fixture();if(variant==='preview')run.prs[0].previewHead='old';if(variant==='dirty')run.stages[0].sourceClean=false;if(variant==='stale')run.replyCheckedAt='not-a-date';let writes=0;const execute=async a=>{if(a[2]==='merge')writes++;return {output:response(a,{...state,headRefOid:variant==='head'?'new':'h',statusCheckRollup:[{conclusion:variant==='pending'?null:'SUCCESS'}]})};};await assert.rejects(mergeAuthorized(run,1,{execute}));assert.equal(writes,0);}});
test('queued merge retains authorization until actual merge',async()=>{const run=fixture();const execute=async a=>({output:a[2]==='merge'?'':response(a)});assert.equal(await mergeAuthorized(run,1,{execute}),false);assert.equal(run.prs[0].authorization.state,'authorized');assert.equal(run.prs[0].readiness,'queued or pending merge');});
test('run mutations are serialized and a later merge reads cancellation',async()=>{const {withRunLock,saveJSON,readJSON}=await import('../io.mjs');const {mkdtemp}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'merge-lock-'));const file=path.join(dir,'run.json');await saveJSON(file,fixture());await withRunLock(file,async()=>{await assert.rejects(withRunLock(file,async()=>{}),/busy/);const r=await readJSON(file);r.prs[0].authorization.state='cancelled';await saveJSON(file,r);});await withRunLock(file,async()=>{let writes=0;const execute=async a=>{if(a[2]==='merge')writes++;return {output:response(a)};};await assert.rejects(mergeAuthorized(await readJSON(file),1,{execute}));assert.equal(writes,0);});});

test('native stack membership and inconsistent primary metadata prevent any merge',async()=>{
 for(const variant of ['stack','head-race','base-race','missing','unavailable','false-stack','empty-stack','array-stack','wrong-number']){
  const run=fixture();let writes=0;const execute=async a=>{
   if(a[2]==='merge'){writes++;return {output:''};}
   if(a[1]==='api'){
    if(variant==='unavailable')throw Error('Membership unavailable');
    const meta=JSON.parse(response(a));if(variant==='stack')meta.stack={number:12,position:2,size:3};
    if(variant==='head-race')meta.head.sha='new';if(variant==='base-race')meta.base.sha='new-base';if(variant==='false-stack')meta.stack=false;if(variant==='empty-stack')meta.stack='';if(variant==='array-stack')meta.stack=[];
    return {output:JSON.stringify(variant==='missing'?{}:meta)};
   }
   return {output:response(a,variant==='wrong-number'?{...state,number:2}:state)};
  };
  await assert.rejects(mergeAuthorized(run,1,{execute}));assert.equal(writes,0);assert.equal(run.prs[0].authorization.state,'authorized');
  if(variant==='stack')assert(run.prs[0].waiting.some(w=>w.includes('Native GitHub stacks')));
 }
});

test('ordinary PR resources may omit stack membership under the GitHub REST contract',async()=>{
 const run=fixture();let merged=false;const execute=async a=>{
  if(a[2]==='merge'){merged=true;return {output:''};}
  const data=JSON.parse(response(a,{...state,state:merged?'MERGED':'OPEN'}));if(a[1]==='api')delete data.stack;
  return {output:JSON.stringify(data)};
 };
 assert.equal(await mergeAuthorized(run,1,{execute}),true);assert.equal(run.prs[0].nativeStack,null);
});
