import {gateFixture} from './support/ci-gate-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {mergeAuthorized,refreshPR,verifyCheckApplicability} from '../merge.mjs';
function fixture(){return {repository:'o/r',mergeMethod:'squash',mode:'local',replyCheckedAt:new Date().toISOString(),prs:[{number:1,head:'h',base:'main',noReviewRequired:true,preview:'passed',previewHead:'h',previewUrl:'https://example.invalid/preview',independentReview:{status:'passed',head:'h'},authorization:{state:'authorized',target:'main'}}],stages:[{index:0,head:'h',base:'b',status:'passed',visualReviewed:true,sourceClean:true}]};}
const state={number:1,headRefOid:'h',baseRefOid:'b',baseRefName:'main',state:'OPEN',isDraft:false,mergeable:'MERGEABLE',reviewDecision:'APPROVED',statusCheckRollup:[gateFixture().selected]};
function response(argv,data=state){const primary=gateFixture().resources[argv[2]];if(argv[1]==='api'&&primary)return JSON.stringify(primary);if(argv[1]==='api'&&argv[2]==='repos/o/r')return JSON.stringify({allow_merge_commit:false,allow_squash_merge:true,allow_rebase_merge:true});return JSON.stringify(argv[1]==='api'?{number:1,head:{sha:data.headRefOid},base:{sha:data.baseRefOid,ref:data.baseRefName},stack:null,merged:data.state==='MERGED',merge_commit_sha:data.mergeCommit?.oid??null}:data);}
test('merge checks current head, uses expected-head and consumes only confirmed merge',async()=>{const run=fixture();const calls=[];let merged=false;const execute=async argv=>{calls.push(argv);if(argv[2]==='merge'){merged=true;return {output:''};}return {output:response(argv,{...state,state:merged?'MERGED':'OPEN',mergeCommit:merged?{oid:'merged'}:null})};};assert.equal(await mergeAuthorized(run,1,{execute}),true);const merge=calls.find(a=>a[2]==='merge');assert(merge.includes('--match-head-commit'));assert.equal(merge.at(-1),'h');assert(!merge.includes('--admin'));assert(!merge.includes('--auto'));assert.equal(run.prs[0].authorization.state,'consumed');});
test('head race, pending CI, dirty proof and stale reply check prevent a merge',async()=>{for(const variant of ['head','pending','dirty','stale','preview']){const run=fixture();if(variant==='preview')run.prs[0].previewHead='old';if(variant==='dirty')run.stages[0].sourceClean=false;if(variant==='stale')run.replyCheckedAt='not-a-date';let writes=0;const execute=async a=>{if(a[2]==='merge')writes++;return {output:response(a,{...state,headRefOid:variant==='head'?'new':'h',statusCheckRollup:[{...gateFixture().selected,status:variant==='pending'?'IN_PROGRESS':'COMPLETED',conclusion:variant==='pending'?null:'SUCCESS'}]})};};await assert.rejects(mergeAuthorized(run,1,{execute}));assert.equal(writes,0);}});
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
  const data=JSON.parse(response(a,{...state,state:merged?'MERGED':'OPEN',mergeCommit:merged?{oid:'merged'}:null}));if(a[1]==='api')delete data.stack;
  return {output:JSON.stringify(data)};
 };
 assert.equal(await mergeAuthorized(run,1,{execute}),true);assert.equal(run.prs[0].nativeStack,null);
});


test('merge method is checked against fresh repository settings, with no fallback',async()=>{
 for(const allowed of [false,undefined,null]){
  const run=fixture();let writes=0;
  const execute=async a=>{if(a[2]==='merge'){writes++;return {output:''};}if(a[1]==='api'&&a[2]==='repos/o/r')return {output:JSON.stringify({allow_squash_merge:allowed})};return {output:response(a)};};
  await assert.rejects(mergeAuthorized(run,1,{execute}),/Repository does not allow squash/);assert.equal(writes,0);
 }
 for(const method of ['merge','rebase']){
  const run=fixture();run.mergeMethod=method;let writes=0;
  const execute=async a=>{if(a[2]==='merge'){writes++;assert(a.includes('--rebase'));return {output:''};}return {output:response(a)};};
  if(method==='merge')await assert.rejects(mergeAuthorized(run,1,{execute}),/Repository does not allow merge/);
  else assert.equal(await mergeAuthorized(run,1,{execute}),false);
  assert.equal(writes,method==='rebase'?1:0);
 }
});

test('absent CI is not applicable only with exact workflow-filter and required-check evidence',async()=>{
 const proof={head:'h',base:'b',verified:true,workflowFiltersVerified:true,requiredChecksVerified:true,requiredChecks:[],sources:['retained/workflow-and-protection-inspection.json']};
 assert.equal(verifyCheckApplicability(proof,'h','b'),true);
 for(const changes of [{head:'old'},{base:'old'},{verified:false},{workflowFiltersVerified:false},{requiredChecksVerified:false},{requiredChecks:['CI']},{requiredChecks:null},{sources:[]},{sources:[' ']}]){
  const run=fixture();run.prs[0].checkApplicability={...proof,...changes};const execute=async a=>({output:response(a,{...state,statusCheckRollup:[]})});
  await refreshPR(run,1,{execute});assert.equal(run.prs[0].checks,'unknown');
 }
 const run=fixture();run.prs[0].checkApplicability=proof;
 await refreshPR(run,1,{execute:async a=>({output:response(a,{...state,statusCheckRollup:[]})})});assert.equal(run.prs[0].checks,'not-applicable');
 await refreshPR(run,1,{execute:async a=>({output:response(a,{...state,statusCheckRollup:[gateFixture({conclusion:'failure'}).selected]})})});assert.equal(run.prs[0].checks,'unknown','applicability evidence never overrides a present unverified gate');
});


test('a real-shaped StatusContext named PR validation cannot use absent-check applicability',async()=>{
 const run=fixture();run.prs[0].checkApplicability={head:'h',base:'b',verified:true,workflowFiltersVerified:true,requiredChecksVerified:true,requiredChecks:[],sources:['retained/workflow-and-protection-inspection.json']};
 await refreshPR(run,1,{execute:async a=>({output:response(a,{...state,statusCheckRollup:[{__typename:'StatusContext',context:'PR validation',state:'FAILURE'}]})})});
 assert.equal(run.prs[0].checks,'unknown');assert.equal(run.prs[0].ciGate,null);assert.deepEqual(run.prs[0].advisoryChecks,[]);
 assert.ok(run.prs[0].waiting.includes('Required CI checks'));
});

function oldPRExecution({live='b',snapshot='historical',ciSnapshot=snapshot,behind=0,foreign=false,merged=()=>false,writes=[]}={}){
 const f=gateFixture({base:live,baseSnapshot:ciSnapshot}),data={...state,baseRefOid:snapshot};
 if(behind){f.compare.status='diverged';f.compare.behind_by=behind;f.compare.merge_base_commit.sha='earlier';}
 if(foreign)f.compare.url='https://api.github.com/repos/foreign/repo/compare/b...h';
 return async argv=>{
  if(argv[2]==='merge'){writes.push(argv);return {output:''};}
  if(argv[1]==='api'&&f.resources[argv[2]])return {output:JSON.stringify(f.resources[argv[2]])};
  return {output:response(argv,{...data,state:merged()?'MERGED':'OPEN'})};
 };
}
test('refresh and merge use contained live main, while preserving historical matching PR/run snapshots',async()=>{
 const run=fixture();run.version=2;run.base='b';run.complete=true;run.prs[0].inputBaseSha='historical';
 run.revision='h';Object.assign(run.stages[0],{phase:'final',checks:[{name:'PR gate',status:'passed'}]});
 const result=await refreshPR(run,1,{execute:oldPRExecution()});
 assert.equal(result.currentBase,'b');assert.equal(result.current.baseRefOid,'historical');assert.equal(run.complete,true);
 assert.equal(run.prs[0].gatesBase,'b');assert.equal(run.prs[0].baseSnapshot,'historical');assert.equal(run.prs[0].ciGate.baseSnapshot,'historical');assert.equal(run.prs[0].readiness,'merge-ready');
 const writes=[];assert.equal(await mergeAuthorized(run,1,{execute:oldPRExecution({writes})}),false);assert.equal(writes.length,1);assert.equal(writes[0].at(-1),'h');
});
test('advancing live main invalidates final proof even if the PR snapshot stays historical',async()=>{
 const run=fixture();run.version=2;run.base='b';run.complete=true;run.prs[0].inputBaseSha='historical';
 await refreshPR(run,1,{execute:oldPRExecution({live:'new-main'})});
 assert.equal(run.complete,false);assert.equal(run.stages[0].status,'stale');assert.equal(run.prs[0].gatesBase,'new-main');
 const writes=[];await assert.rejects(mergeAuthorized(run,1,{execute:oldPRExecution({live:'new-main',writes})}),/Not ready/);assert.equal(writes.length,0);
});
test('uncontained live base and foreign comparison fail closed and invalidate proof before any merge',async()=>{
 for(const change of [{behind:1},{foreign:true}]){
  const run=fixture();run.version=2;run.base='b';run.complete=true;run.prs[0].inputBaseSha='historical';const writes=[];
  await assert.rejects(mergeAuthorized(run,1,{execute:oldPRExecution({...change,writes})}),/live base/);
  assert.equal(writes.length,0);assert.equal(run.complete,false);assert.equal(run.stages[0].status,'stale');
 }
});
test('a changed historical snapshot cannot borrow the previous CI association',async()=>{
 const run=fixture();run.version=2;run.base='b';run.complete=true;run.prs[0].inputBaseSha='historical';
 await refreshPR(run,1,{execute:oldPRExecution({snapshot:'changed',ciSnapshot:'historical'})});
 assert.equal(run.complete,false);assert.equal(run.prs[0].checks,'unknown');assert.equal(run.prs[0].ciGate,null);
});

test('confirmed squash completion is not rejected because live main advanced past the former head',async()=>{
 const run=fixture();let merged=false,ancestryAfterMerge=0;
 const execute=async argv=>{
  if(argv[2]==='merge'){merged=true;return {output:''};}
  if(merged&&argv[1]==='api'&&(/git\/ref|compare\//.test(argv[2]))){ancestryAfterMerge++;throw Error('Former PR head cannot contain its squash');}
  return {output:response(argv,{...state,state:merged?'MERGED':'OPEN',mergeCommit:merged?{oid:'squashed-live-main'}:null})};
 };
 assert.equal(await mergeAuthorized(run,1,{execute}),true);assert.equal(ancestryAfterMerge,0);assert.equal(run.prs[0].authorization.state,'consumed');assert.equal(run.prs[0].mergeCommit,'squashed-live-main');
});
test('an unconfirmed merged label cannot consume merge authorization',async()=>{
 const run=fixture();const execute=async argv=>{
  const data=JSON.parse(response(argv,{...state,state:'MERGED',mergeCommit:{oid:'squash'}}));
  if(argv[1]==='api')data.merge_commit_sha='foreign';return {output:JSON.stringify(data)};
 };
 await assert.rejects(refreshPR(run,1,{execute}),/Completed merge primary/);assert.equal(run.prs[0].authorization.state,'authorized');
});
test('live-main movement during input refresh invalidates the earlier proof',async()=>{
 const run=fixture();run.version=2;run.base='b';run.complete=true;run.prs[0].inputBaseSha='historical';let refs=0;
 const before=gateFixture({baseSnapshot:'historical'}),after=gateFixture({base:'new-main',baseSnapshot:'historical'});
 const execute=async argv=>{
  if(argv[1]==='api'&&argv[2]==='repos/o/r/git/ref/heads/main'){refs++;return {output:JSON.stringify(refs===1?before.ref:after.ref)};}
  if(argv[1]==='api'&&after.resources[argv[2]])return {output:JSON.stringify(after.resources[argv[2]])};
  return {output:response(argv,{...state,baseRefOid:'historical'})};
 };
 await refreshPR(run,1,{execute});assert.equal(refs,2);assert.equal(run.complete,false);assert.equal(run.stages[0].status,'stale');assert.equal(run.prs[0].gatesBase,'new-main');
});
