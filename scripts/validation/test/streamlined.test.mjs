import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stagePolicy,validatePlan,questionEvidencePassed} from '../plan.mjs';
import {localRun} from '../local.mjs';
import {executeCheck,checkReuse,checkProvenance} from '../execution.mjs';
import {saveSuccessfulEvidence,loadSuccessfulEvidence,evidenceKey,fileDigest} from '../reuse.mjs';
import {git,command} from '../io.mjs';
import {finalProofReady} from '../model.mjs';
import {compactStatus} from '../status.mjs';

const gate={version:3,questions:[]};
const history={version:3,prs:[{number:1}],questions:[{id:'old-history',description:'Existing acknowledged history survives the reader upgrade',paths:['apps/'],checks:['PR gate','Responsive proof'],continuity:['guest'],evidence:[{check:'Responsive proof',workflows:['previous-stage identity and game survive migrations']}]}]};
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'streamlined-'))),cwd=path.join(root,'candidate');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);
 await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled gate'}}));
 await git(['init','-b','main'],cwd);await git(['config','user.name','Validation test'],cwd);await git(['config','user.email','test@example.invalid'],cwd);await git(['add','.'],cwd);await git(['commit','-m','fixture'],cwd);return {root,cwd};
}
test('v3 docs need only the stable gate, no baseline reruns or visual review',()=>{
 const final=stagePolicy(gate,0,{accounts:true,changed:['docs/a.md']});assert.deepEqual(final.selected,['PR gate']);assert.equal(final.visualMode,'none');
 assert.deepEqual(stagePolicy({...gate,prs:[{number:1}]},0,{accounts:true}).selected,[]);
 assert.deepEqual(stagePolicy(gate,0,{changed:['apps/new.js']}).unmapped,['apps/new.js']);
 assert.deepEqual(stagePolicy(gate,0,{changed:['scripts/validation/model.mjs']}).selected,['PR gate']);
 assert(stagePolicy(gate,0,{changed:['scripts/validation/assets/app.mjs']}).selected.includes('Report viewer'));
 assert(stagePolicy({...gate,validateReportViewer:true},0).selected.includes('Report viewer'));
});
test('v3 requires mappings for changed native fixtures and validation journeys without changing v2',()=>{
 const files=['browser-integration/support/history.html','validation-e2e/core.spec.mjs','validation-account-e2e/accounts.spec.mjs'];
 for(const file of files){assert.deepEqual(stagePolicy(gate,0,{changed:[file]}).unmapped,[file]);assert.deepEqual(stagePolicy({...history,version:2},0,{changed:[file]}).unmapped,[]);}
 const spec={version:3,questions:[{id:'native',description:'The changed native History interaction remains correct',paths:['browser-integration/'],checks:['PR gate','Browser integration'],evidence:[{check:'Browser integration',files:['browser-integration/history-narration.spec.mjs']}]}]};
 const policy=stagePolicy(spec,0,{changed:[files[0]]});assert.deepEqual(policy.unmapped,[]);assert.deepEqual(policy.browserTests,['browser-integration/history-narration.spec.mjs']);assert.equal(questionEvidencePassed(spec.questions[0],[{name:'PR gate',status:'passed'},{name:'Browser integration',status:'passed',provenance:{argv:['pnpm','test:browser:integration',...policy.browserTests]}}],[]),true);
});
test('native acceptance executes the bound file rather than its whole browser suite',async t=>{
 const {root,cwd}=await fixture(t);await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled gate','test:browser:integration':'controlled native'}}));await git(['add','.'],cwd);await git(['commit','-m','native script fixture'],cwd);
 const file='browser-integration/history-narration.spec.mjs',spec={version:3,questions:[{id:'native',description:'Changed native History behavior',paths:['browser-integration/'],checks:['PR gate','Browser integration'],evidence:[{check:'Browser integration',files:[file]}]}]},seen=[];
 const {stage}=await localRun({cwd,base:'HEAD',policy:stagePolicy(spec,0),dir:path.join(root,'native'),lockPath:path.join(root,'lock'),publishReport:false,execute:async(argv,{log})=>{seen.push(argv);await writeFile(log,'passed');return {code:0,duration:1};}});assert.equal(stage.status,'passed');assert.deepEqual(seen.find(a=>a[1]==='test:browser:integration'),['pnpm','test:browser:integration',file]);
});
test('exact gate CI credit and a targeted native check coexist without rerunning the gate',async t=>{
 const {root,cwd}=await fixture(t);await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled gate','test:browser:integration':'controlled native'}}));await git(['add','.'],cwd);await git(['commit','-m','native script fixture'],cwd);
 const tree=await git(['rev-parse','HEAD^{tree}'],cwd),checkout=await git(['rev-parse','HEAD'],cwd),log=path.join(root,'ci.log'),archive=path.join(root,'ci.zip');await writeFile(log,'verified original CI log');await writeFile(archive,'verified archive');
 const receipt={version:2,validity:'inputs-and-artifacts',status:'passed',name:'PR gate',source:'github-actions',testedTree:tree,argv:['pnpm','test:pr-gate'],evidenceProfile:'pr-gate',layout:'pr-gate-v3',importedAt:new Date(Date.now()-1000).toISOString(),evidence:[{checkout,provenance:{testedTree:tree,checkout,evidenceProfile:'pr-gate',layout:'pr-gate-v3'},log,logHash:await fileDigest(log),archive,archiveHash:await fileDigest(archive)}]};receipt.integrity=evidenceKey(receipt);const ciEvidence=path.join(root,'ci-import.json');await writeFile(ciEvidence,JSON.stringify({receipts:{'PR gate':receipt}}));
 const file='browser-integration/history-narration.spec.mjs',spec={version:3,questions:[{id:'native',description:'Changed native History behavior',paths:['browser-integration/'],checks:['PR gate','Browser integration'],evidence:[{check:'Browser integration',files:[file]}]}]},seen=[];
 const {stage}=await localRun({cwd,base:'HEAD',policy:stagePolicy(spec,0),ciEvidence,dir:path.join(root,'mixed'),lockPath:path.join(root,'lock'),publishReport:false,execute:async(argv,{log})=>{seen.push(argv);await writeFile(log,'native passed');return {code:0,duration:1};}});assert.equal(stage.status,'passed');assert.deepEqual(seen,[['pnpm','test:browser:integration',file]]);assert.equal(stage.checks.find(c=>c.name==='PR gate').source,'github-actions');assert.match(stage.checks.find(c=>c.name==='Browser integration').ciReason,/targeted command/);
});
test('v3 retained contracts select only the necessary baseline and final journeys',()=>{
 assert.deepEqual(stagePolicy(history,0).selected,['Responsive proof']);
 assert.deepEqual(stagePolicy(history,1,{changed:['apps/reader.js']}).selected,['PR gate','Responsive proof']);
 const account=structuredClone(history);account.questions[0].continuity=['account'];assert(stagePolicy(account,0).unmapped.length);assert(stagePolicy(account,0,{accounts:true}).selected.includes('Account responsive proof'));
});
test('acceptance is bound to actual workflow evidence, not a generic green check',()=>{
 const q=history.questions[0],checks=[{name:'PR gate',status:'passed'},{name:'Responsive proof',status:'passed'}];
 assert.equal(questionEvidencePassed(q,checks,[{title:'different workflow',status:'passed'}]),false);
 assert.equal(questionEvidencePassed(q,checks,[{title:'mobile / previous-stage identity and game survive migrations',status:'passed'}]),true);
 assert.throws(()=>validatePlan({...history,questions:[{...q,evidence:[]}]}));
 assert.throws(()=>validatePlan({...history,questions:[{...q,evidence:[{check:'PR gate',requirements:['imaginary-proof']}]}]}));
});
test('targeted test bindings cannot be satisfied by a different containing file',()=>{
 const q={checks:['PR gate'],evidence:[{check:'Boundary E2E',files:['e2e/workflows/a.spec.mjs']}]};
 const checks=[{name:'PR gate',status:'passed'},{name:'Boundary E2E',status:'passed',provenance:{argv:['pnpm','test:e2e','e2e/workflows/b.spec.mjs']}}];
 assert.equal(questionEvidencePassed(q,checks,[]),false);checks[1].provenance.argv.push('e2e/workflows/a.spec.mjs');assert.equal(questionEvidencePassed(q,checks,[]),true);
});
test('read-only planning writes nothing and launches no check',async t=>{
 const {root,cwd}=await fixture(t),before=await readdir(root);let calls=0;
 const result=await localRun({cwd,base:'HEAD',dir:path.join(root,'must-not-exist'),inspectOnly:true,execute:async()=>{calls++;throw Error('no launch');}});
 assert.equal(calls,0);assert.deepEqual(await readdir(root),before);assert.deepEqual(result.decisions.map(c=>c.name),['PR gate']);assert.equal(result.visualRequired,false);
});
test('separate local invocations reuse a verified immutable log and run no duplicate check',async t=>{
 const {root,cwd}=await fixture(t);let calls=0;const execute=async(argv,{log})=>{calls++;await writeFile(log,'controlled completed gate');return {code:0,duration:25};};
 const options={cwd,base:'HEAD',lockPath:path.join(root,'lock'),execute,publishReport:false};
 const first=await localRun({...options,dir:path.join(root,'first')});assert.equal(first.stage.status,'passed');assert.equal(first.stage.visualRequired,false);
 const plan=await localRun({...options,dir:path.join(root,'plan'),inspectOnly:true});assert.equal(plan.decisions[0].action,'reuse');
 const second=await localRun({...options,dir:path.join(root,'second')});assert.equal(second.stage.status,'passed');assert.equal(calls,1);assert.equal(second.stage.checks[0].reused,true);assert.notEqual(second.stage.checks[0].log,first.stage.checks[0].log);
 const files=await readdir(path.join(cwd,'.git/righelt-validation-evidence'));const receipt=JSON.parse(await readFile(path.join(cwd,'.git/righelt-validation-evidence',files.find(f=>f.endsWith('.json')))));assert.equal(receipt.version,2);assert.equal(receipt.expiresAt,undefined);
});
test('cross-worktree evidence matches unchanged inputs and invalidates a relevant edit',async t=>{
 const {root,cwd}=await fixture(t),other=path.join(root,'other');await git(['worktree','add','--detach',other,'HEAD'],cwd);
 const env={RIGHELT_VALIDATION:'1'},args={fingerprint:'fallback',phase:'stateless',name:'Typecheck'},argv=['pnpm','typecheck'];
 const first=await checkProvenance(cwd,argv,env,args),second=await checkProvenance(other,argv,env,args);assert.deepEqual(first.compatibility,second.compatibility);
 await mkdir(path.join(other,'docs'));await writeFile(path.join(other,'docs/a.md'),'copy');assert.deepEqual((await checkProvenance(other,argv,env,args)).compatibility,first.compatibility);
 await mkdir(path.join(other,'apps'));await writeFile(path.join(other,'apps/new.ts'),'new input');assert.notDeepEqual((await checkProvenance(other,argv,env,args)).compatibility,first.compatibility);
 const runtime=await checkProvenance(other,argv,{...env,NODE_OPTIONS:'--no-warnings'},args);assert.notEqual(runtime.environmentHash,second.environmentHash);
});
test('immutable corruption, incompatible inputs and incomplete results never earn reuse credit',async t=>{
 const {root,cwd}=await fixture(t),cacheDir=path.join(root,'cache'),log=path.join(root,'source.log'),provenance={compatibility:{inputs:'v1'}};let calls=0;
 const args={cwd,argv:['fixture'],name:'Unit',log,cacheDir,provenance,reuse:true,immutable:true,execute:async()=>{calls++;await writeFile(log,'original');return {code:0,duration:10};}};
 await executeCheck(args);const original=await checkReuse(args);assert(original.result);assert.equal((await checkReuse({...args,provenance:{compatibility:{inputs:'v2'}}})).result,undefined);
 await writeFile(original.result.log,'corrupt');assert.equal((await checkReuse(args)).reason,'artifact-integrity');
 const failed=await executeCheck({...args,execute:async()=>({code:75,duration:1})});assert.equal(failed.status,'failed');assert.equal(failed.incomplete,true);assert.equal(calls,1);
});
test('legacy expiry stays enforced while new stateless evidence is not invalidated by age alone',async t=>{
 const {root}=await fixture(t),log=path.join(root,'log');await writeFile(log,'pass');const provenance={inputs:'same'},result={status:'passed',code:0,incomplete:false,signal:null};
 await saveSuccessfulEvidence(path.join(root,'legacy'),{provenance,result,artifacts:[log],expiresAt:new Date(Date.now()+1000).toISOString()});
 await saveSuccessfulEvidence(path.join(root,'immutable'),{provenance,result,artifacts:[log],immutable:true});
 const future=Date.now()+86400000*2;assert.equal(await loadSuccessfulEvidence(path.join(root,'legacy'),provenance,{now:future}),null);assert(await loadSuccessfulEvidence(path.join(root,'immutable'),provenance,{now:future}));
});
test('invalid supplied CI evidence blocks rather than duplicating a whole gate',async t=>{
 const {root,cwd}=await fixture(t);await writeFile(path.join(root,'bad-import.json'),'{}');let calls=0;
 const {stage}=await localRun({cwd,base:'HEAD',dir:path.join(root,'out'),lockPath:path.join(root,'lock'),ciEvidence:path.join(root,'bad-import.json'),execute:async()=>{calls++;return {code:0};},publishReport:false});
 assert.equal(calls,0);assert.equal(stage.status,'failed');assert.match(await readFile(path.join(root,'out/startup-error.json'),'utf8'),/no implicit whole-gate fallback/);
});
test('v3 final readiness requires review only when selected and keeps exact lineage',()=>{
 const stage={policyVersion:3,phase:'final',index:0,base:'b',head:'h',status:'passed',sourceClean:true,visualRequired:false,visualReviewed:false,unmapped:[],checks:[{name:'PR gate',status:'passed'}]};
 const run={version:3,mode:'local',base:'b',revision:'h',stages:[stage]};assert.equal(finalProofReady(run,'b'),true);stage.visualRequired=true;assert.equal(finalProofReady(run,'b'),false);stage.visualReviewed=true;assert.equal(finalProofReady(run,'b'),true);stage.head='old';assert.equal(finalProofReady(run,'b'),false);
});
test('intermediate boundaries do not repeat the gate or unrelated continuity',()=>{
 const spec=structuredClone(history);spec.prs.push({number:2});
 const unrelated=stagePolicy(spec,1,{changed:['docs/help.md']});assert.deepEqual(unrelated.selected,[]);
 const affected=stagePolicy(spec,1,{changed:['apps/reader.js']});assert.deepEqual(affected.selected,['Responsive proof']);
 assert.throws(()=>validatePlan({...spec,prs:[{number:1,tests:['e2e/workflows/forgotten.spec.mjs']}]}),/legacy prs.tests/);
});
test('stale execution cannot publish durable success for later reuse',async t=>{
 const {root,cwd}=await fixture(t),file=path.join(cwd,'package.json'),original=await readFile(file);let calls=0;
 const options={cwd,base:'HEAD',lockPath:path.join(root,'lock'),publishReport:false,execute:async(argv,{log})=>{calls++;await writeFile(log,'completed child');await writeFile(file,JSON.stringify({scripts:{'test:pr-gate':'changed while running'}}));return {code:0,duration:1};}};
 const first=await localRun({...options,dir:path.join(root,'stale')});assert.equal(first.stage.status,'stale');await writeFile(file,original);
 const plan=await localRun({...options,inspectOnly:true});assert.equal(plan.decisions[0].action,'execute');assert.equal(calls,1);
});
test('E2E helper, generated tsconfig and evidence-profile changes invalidate reuse',async t=>{
 const {cwd}=await fixture(t);await mkdir(path.join(cwd,'browser-integration'));await mkdir(path.join(cwd,'browser-integration/support'));const helper=path.join(cwd,'browser-integration/support/message-semantic-geometry.mjs');await writeFile(helper,'original');
 const options={name:'E2E',phase:'stateless',fingerprint:'fallback'},env={RIGHELT_EVIDENCE_PROFILE:'pr-gate'},argv=['pnpm','test:e2e'];
 const before=await checkProvenance(cwd,argv,env,options);await writeFile(helper,'changed helper');assert.notDeepEqual((await checkProvenance(cwd,argv,env,options)).compatibility,before.compatibility);
 const generated=await checkProvenance(cwd,['pnpm','check:web-engine-generated'],env,{...options,name:'Generated runtime'});await writeFile(path.join(cwd,'tsconfig.json'),'{}');assert.notDeepEqual((await checkProvenance(cwd,['pnpm','check:web-engine-generated'],env,{...options,name:'Generated runtime'})).compatibility,generated.compatibility);
 assert.notDeepEqual((await checkProvenance(cwd,argv,{RIGHELT_EVIDENCE_PROFILE:'nightly-full'},options)).compatibility,before.compatibility);
});
test('historical local resume refuses silent acceptance downgrade before altering old output',async t=>{
 const {root,cwd}=await fixture(t),runFile=path.join(root,'old-run.json'),original=JSON.stringify({version:2,mode:'local',stages:[{visualRequired:true}],risks:[]});await writeFile(runFile,original);
 const result=await command([process.execPath,path.resolve('scripts/validation/cli.mjs'),'local','--candidate',cwd,'--base','HEAD','--resume',runFile,'--no-email','--no-publish'],{allowFailure:true});assert.notEqual(result.code,0);assert.match(result.output,/explicit equivalent plan/);assert.equal(await readFile(runFile,'utf8'),original);
});
test('a real v3 baseline seeds prior state without asserting an upgrade that has not happened',async t=>{
 const {root,cwd}=await fixture(t),continuityOutput=path.join(root,'continuity.json');
 const policy=stagePolicy(history,0);
 const {stage}=await localRun({cwd,base:'HEAD',policy,dir:path.join(root,'baseline'),lockPath:path.join(root,'lock'),continuityOutput,publishReport:false,execute:async(argv,{env})=>{
  await writeFile(env.RIGHELT_EVIDENCE_JSON,JSON.stringify(['mobile','mid-wide','full-wide'].map(viewport=>({viewport,title:'create, move, viewer live update, reload and reconnect',status:'passed',images:[]}))));
  await writeFile(continuityOutput,JSON.stringify({version:2,hash:'#/game/original',storage:{cookies:[],origins:[]},history:{version:1,gameId:'original',moves:[{moveId:'original-move',action:{type:'pass'},selectionSnapshot:{},snapshot:{}}],turns:[{}],board:{state:{}}}}));return {code:0,duration:1};
 }});
 assert.equal(stage.status,'passed');assert(!stage.checks.some(c=>c.name==='Release question: old-history'));assert(stage.checks.some(c=>c.name==='Guest continuity fixture'&&c.status==='passed'));
});
for(const changed of ['apps/new-reader.js','browser-integration/support/new-history.html'])test(`resuming a v3 policy cannot hide newly unmapped ${changed}`,async t=>{
 const {root,cwd}=await fixture(t);let calls=0;const execute=async(argv,{log})=>{calls++;await writeFile(log,'pass');return {code:0,duration:1};};
 const original=await localRun({cwd,base:'HEAD',dir:path.join(root,'original'),lockPath:path.join(root,'lock'),publishReport:false,execute});
 await mkdir(path.dirname(path.join(cwd,changed)),{recursive:true});await writeFile(path.join(cwd,changed),'new contract');
 const result=await localRun({cwd,base:'HEAD',policy:original.run.localPolicy,dir:path.join(root,'resumed'),lockPath:path.join(root,'lock'),publishReport:false,execute});assert.equal(result.stage.status,'failed');assert(result.stage.unmapped.includes(changed));assert.equal(calls,1);
});
test('fresh v3 browser checks clear inherited state roots instead of caching a retained run',async t=>{
 const {root,cwd}=await fixture(t),prior=process.env.RIGHELT_ACCOUNT_PERSIST_ROOT;process.env.RIGHELT_ACCOUNT_PERSIST_ROOT='/must-not-use-retained-state';t.after(()=>{if(prior===undefined)delete process.env.RIGHELT_ACCOUNT_PERSIST_ROOT;else process.env.RIGHELT_ACCOUNT_PERSIST_ROOT=prior;});
 const spec={version:3,questions:[{id:'native',description:'The affected native workflow succeeds',paths:['apps/'],checks:['PR gate'],evidence:[{check:'Boundary E2E',files:['e2e/workflows/native.spec.mjs']}]}]},seen=[];
 const {stage}=await localRun({cwd,base:'HEAD',policy:stagePolicy(spec,0),dir:path.join(root,'fresh'),lockPath:path.join(root,'lock'),publishReport:false,execute:async(argv,{env,log})=>{assert.equal(env.RIGHELT_ACCOUNT_PERSIST_ROOT,undefined);assert.equal(env.RIGHELT_CONTINUITY_INPUT,undefined);seen.push(argv);await writeFile(log,'passed');return {code:0,duration:1};}});assert.equal(stage.status,'passed');assert.equal(seen.length,2);
});
test('status explains completed reuse and changes when the remaining requirement changes',()=>{
 const run={id:'status',stages:[{id:'final',status:'passed',checks:[{name:'PR gate',status:'passed',reused:true,reuseReason:'Compatible artifact'}]}],prs:[{number:1,waiting:['Review']}]};
 const first=compactStatus(run);assert.equal(first.completed[0].reused,true);assert.deepEqual(first.unresolved,[{pr:1,reason:'Review'}]);run.prs[0].waiting=['Authorization'];assert.equal(compactStatus(run,{afterCursor:first.cursor}).changed,true);
});
test('the new CLI plan mode requires no recipient and leaves candidate source unchanged',async t=>{
 const {root,cwd}=await fixture(t),before=await git(['status','--porcelain'],cwd);
 const result=await command([process.execPath,path.resolve('scripts/validation/cli.mjs'),'plan','--candidate',cwd,'--base','HEAD'],{cwd:process.cwd(),env:{RIGHELT_VALIDATION_CONFIG:path.join(root,'absent-config')}});assert.equal(JSON.parse(result.output).version,3);assert.equal(await git(['status','--porcelain'],cwd),before);
});
