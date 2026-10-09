import test from 'node:test';import assert from 'node:assert/strict';
import {parseCommands,applyReply,readiness,canMerge,invalidate,publicRun,coverage} from '../model.mjs';
import {transition,statusOf,mergeBackup} from '../assets/progress.mjs';
import {validateManifest} from '../integrated.mjs';
test('commands accept case, optional mixed hashes and multiple PRs',()=>{
 for(const s of ['Merge 123','merge #123',' MERGE #123 '])assert.deepEqual(parseCommands(s),[{action:'merge',prs:[123]}]);
 assert.deepEqual(parseCommands('MERGE 123 #124\ncancel MERGE #123'),[{action:'merge',prs:[123,124]},{action:'cancel',prs:[123]}]);
 assert.throws(()=>parseCommands('merge 123 and 124'));assert.throws(()=>parseCommands('merge 0'));assert.deepEqual(parseCommands('> Merge 123'),[]);assert.deepEqual(parseCommands('Thanks\n-- \nmerge 123'),[]);
});
test('only tracked sent-account replies authorize; duplicate and foreign input cannot mutate',()=>{
 const run={startedAt:'2026-01-01',emailThreads:['t'],prs:[{number:123,base:'main'}]};const m={id:'m',threadId:'t',from:'me@example.com',labels:['SENT'],internalDate:'2026-02-01',text:'merge 123'};
 assert.throws(()=>applyReply(run,{...m,labels:['INBOX']},m.from,m.from));assert.throws(()=>applyReply(run,{...m,text:'merge 123 999'},m.from,m.from));assert.equal(run.prs[0].authorization,undefined);
 assert.equal(applyReply(run,m,m.from,m.from),true);assert.equal(applyReply(run,m,m.from,m.from),false);assert.equal(run.prs[0].authorization.state,'authorized');
 applyReply(run,{...m,id:'c',text:'cancel merge #123'},m.from,m.from);assert.equal(run.prs[0].authorization.state,'cancelled');
});
test('merge requires current gates, source revision, explicit authorization and dependencies',()=>{
 const p={head:'h',base:'main',gatesHead:'h',gatesBase:'b',independentReview:{status:'passed',head:'h'},checks:'passed',review:'passed',preview:'not-configured',previewCheckedHead:'h',conflicts:false,open:true,authorization:{state:'authorized',target:'main'}};
 const s={head:'h',base:'b',status:'passed',visualReviewed:true,sourceClean:true};assert.equal(canMerge(p,s,'b'),true);
 for(const patch of [{checks:'pending'},{review:'pending'},{conflicts:true},{scopeDecision:true},{waitingFor:[12]},{authorization:{state:'cancelled'}}])assert.equal(canMerge({...p,...patch},s,'b'),false);
 assert.equal(canMerge(p,{...s,head:'old'},'b'),false);assert.equal(canMerge(p,{...s,visualReviewed:false},'b'),false);
});
test('input changes invalidate downstream stages',()=>{const r={base:'b',prs:[{head:'a'},{head:'c'}],stages:[0,1,2].map(index=>({index,id:String(index),status:'passed'}))};assert.deepEqual(invalidate(r,'b',['a','new']),['2']);assert.deepEqual(invalidate(r,'changed',['a','new']),['0','1','2']);});
test('public projection excludes private metadata',()=>{const p=publicRun({id:'r',recipient:'secret',emailThreads:['private'],stages:[],logs:'secret'});assert(!JSON.stringify(p).includes('secret'));});
test('published readiness cannot retain a cached ready verdict after invalidation',()=>{const run={base:'b',mode:'integrated',prs:[{number:1,head:'h',readiness:'merge-ready',waiting:[]}],stages:[{index:1,head:'h',base:'b',status:'stale'}]};const shown=publicRun(run).prs[0];assert.equal(shown.readiness,'unverified/stale');assert(shown.waiting.includes('Current integrated validation'));});
test('review actions preserve history and notes, revisions do not clear deferral',()=>{let r={status:'Not started',notes:'note',history:[],revision:'a'};let t=transition(r,'Complete','a');assert.equal(t.expanded,false);r=t.record;r=transition(r,'Reopen','a').record;assert.equal(statusOf(r,'b'),'Needs revisit');r=transition(r,'Skip','b').record;assert.equal(statusOf(r,'c'),'Skipped');r=transition(r,'Cancel','c').record;assert.equal(r.notes,'note');assert.equal(r.history.length,1);assert.equal(r.status,'Not started');});
test('backup rejects invalid data atomically and retains conflicting notes',()=>{const r={status:'Complete',notes:'local',revision:'a',updatedAt:'2026-01-01',history:[]};const local={version:1,namespace:'n',records:{x:r},expanded:{x:true}};assert.throws(()=>mergeBackup(local,{...local,records:{x:{...r,status:'bogus'}}}));const result=mergeBackup(local,{...local,records:{x:{...r,notes:'incoming',updatedAt:'2026-02-01'}}});assert.equal(result.conflicts[0].local,'local');assert.equal(local.records.x.notes,'local');assert.equal(result.next.records.x.notes,'incoming');});
test('manifest enforces ordered prerequisites and mapped coverage is explicit',()=>{assert.throws(()=>validateManifest({version:1,repository:'o/r',base:'main',prs:[{number:2,dependsOn:[1]}]}));assert.deepEqual(coverage(['unknown.xyz']).unmapped,['unknown.xyz']);assert.equal(coverage(['apps/web/app.js']).files.length,0);});

test('known T108 feasibility tooling is mapped without accepting unrelated tools',()=>{
 const known=['tools/t108-feasibility/core.mjs','tools/t108-feasibility/runtime.test.mjs','tools/t108-feasibility/evidence/RESULTS.md'];
 const selected=coverage(known);
 assert.deepEqual(selected.areas,['core','tooling']);
 assert.deepEqual(selected.unmapped,[]);
 assert.ok(selected.files.includes('e2e/workflows/reconnect-recovery.spec.mjs'));
 const unknown=['tools/unknown/core.mjs','tools/t108-feasibility-other/core.mjs','tools/t108-feasibility.mjs'];
 assert.deepEqual(coverage([...known,...unknown]).unmapped,unknown);
 assert.equal(coverage([...known,'apps/web/shell/app.js']).files.length,0);
});

test('AI tooling selects dedicated checks without accepting similarly named directories',()=>{
 const selected=coverage(['tools/ai-trainer/engine-worker.mjs','tools/ai-benchmark/worker.mjs']);
 assert.deepEqual(selected.areas,['core','tooling','ai-trainer','ai-benchmark']);
 assert.deepEqual(selected.unmapped,[]);
 const unknown=['tools/ai-trainer-other/file.py','tools/ai-benchmark.mjs','tools/unknown/file.mjs'];
 assert.deepEqual(coverage(unknown).unmapped,unknown);
 assert.equal(coverage(['docs/ai/PR_WORKFLOW.md']).areas.includes('ai-trainer'),false);
});

test('account proof directory is mapped without accepting unrelated validation folders',()=>{
 const known=['validation-account-e2e/accounts.spec.mjs','playwright.validation-account.config.mjs'];
 assert.deepEqual(coverage(known).unmapped,[]);
 assert.ok(coverage(known).areas.includes('tooling'));
 const unknown=['validation-account-other/example.mjs','validation-other-e2e/example.mjs'];
 assert.deepEqual(coverage([...known,...unknown]).unmapped,unknown);
});

test('public items allowlist text/client provenance and exclude nested private fields',()=>{
 const p=publicRun({stages:[{items:[{id:'i',title:'journey',status:'failed',privateLog:'SECRET',client:{browser:'webkit',width:390,baseURL:'SECRET'},behaviors:[{label:'owned move',checkpoint:'owned-move',raw:'SECRET'}],images:[{src:'images/a.png',caption:'board',checkpoint:'created',kind:'context',viewport:'mobile',privatePath:'SECRET'}]}]}]});assert(!JSON.stringify(p).includes('SECRET'));assert.equal(p.stages[0].items[0].client.browser,'webkit');assert.equal(p.stages[0].items[0].behaviors[0].label,'owned move');assert.deepEqual(p.stages[0].items[0].images[0],{src:'images/a.png',thumbnail:undefined,caption:'board',digest:undefined,checkpoint:'created',kind:'context',viewport:'mobile'});
});

test('historical attempts retain failures without private paths, payloads or images',()=>{
 const attempt={stages:[{id:'old',title:'Earlier',status:'failed',checks:[{name:'E2E',status:'failed',log:'SECRET'}],items:[{images:[{src:'SECRET'}]}]}],risks:['SECRET'],publication:{url:'https://example.test/report',directory:'SECRET',stableUrl:'file:///SECRET'}};
 const p=publicRun({attempts:[attempt],history:[{status:'failed',logs:'SECRET'}],stages:[]});assert(!JSON.stringify(p).includes('SECRET'));assert.equal(p.history[0].stages[0].status,'failed');assert.equal(p.history[1].links[0].url,'https://example.test/report');
});
