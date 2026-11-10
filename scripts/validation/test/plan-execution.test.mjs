import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stagePolicy,validatePlan} from '../plan.mjs';
import {executeCheck,checkInputFingerprint} from '../execution.mjs';
import {verifyGeneralEvidence,localRun,harnessRoot} from '../local.mjs';
import {command} from '../io.mjs';
const spec={version:2,questions:[{id:'transport',description:'Recovery retains history',paths:['apps/'],checks:['Integration','E2E'],boundaryChecks:['Integration']}],prs:[{number:1,tests:['e2e/workflows/reconnect-recovery.spec.mjs']},{number:2}]};
test('AI tooling release questions can require their dedicated checks',()=>{
 const ai={...spec,questions:[{id:'ai-tools',description:'Model and benchmark tooling passes its candidate checks',paths:['tools/ai-trainer/','tools/ai-benchmark/'],checks:['Trainer checks','AI benchmark checks']}]};
 assert.equal(validatePlan(ai),ai);
 const policy=stagePolicy(ai,2,{changed:['tools/ai-trainer/model.py']});
 for(const name of ai.questions[0].checks)assert.ok(policy.selected.includes(name));
});
test('boundary selects explicit acceptance checks; final requires PR gate plus explicit feature assertions and independent visuals',()=>{
 const boundary=stagePolicy(spec,1,{changed:['apps/api/src/x.ts']});
 assert.equal(boundary.visualMode,'none');assert.ok(boundary.selected.includes('Integration'));assert.ok(!boundary.selected.includes('E2E'));assert.equal(boundary.tests.length,1);
 const final=stagePolicy(spec,2,{accounts:true,changed:['apps/web/app.js']});
 assert.ok(final.selected.includes('E2E'));assert.ok(!final.selected.includes('Auth E2E'));assert.ok(final.selected.includes('PR gate'));assert.ok(final.selected.includes('Account responsive proof'));assert.ok(!final.selected.includes('Browser integration'));assert.ok(!final.selected.includes('Performance'));assert.deepEqual(final.tests,['e2e/workflows/reconnect-recovery.spec.mjs']);assert.ok(final.selected.includes('Boundary E2E'));assert.equal(final.coverageViewports.length,3);assert.equal(final.viewports.length,2);assert.ok(!final.selected.includes('Report viewer'));
 assert.ok(stagePolicy(spec,2,{changed:['scripts/validation/report.mjs']}).selected.includes('Report viewer'));
 assert.ok(stagePolicy(spec,1,{changed:['packages/new/module.js']}).unmapped.length);
 const missing=structuredClone(spec);delete missing.questions[0].boundaryChecks;delete missing.prs[0].tests;assert.ok(stagePolicy(missing,1,{changed:['apps/a']}).unmapped.length);
 assert.throws(()=>validatePlan({...spec,lanes:3}));
});
test('check reuse preserves original provenance, verifies log integrity, and never credits a killed process',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'bounded-check-')));const log=path.join(root,'check.log');let calls=0;
 const execute=async()=>{calls++;await writeFile(log,'passed\n');return {code:0,duration:3};};
 const args={cwd:root,argv:['test'],name:'Unit',log,execute,cacheDir:path.join(root,'cache'),provenance:{tree:'first',compatibility:{inputs:'same'}},reuse:true};
 assert.equal((await executeCheck(args)).status,'passed');
 const reused=await executeCheck({...args,provenance:{tree:'second',compatibility:{inputs:'same'}}});assert.equal(reused.reused,true);assert.equal(reused.reusedProvenance.tree,'first');assert.equal(calls,1);
 await writeFile(log,'tampered');await executeCheck(args);assert.equal(calls,2);
 const killed=await executeCheck({...args,reuse:false,execute:async()=>({code:null,signal:'SIGTERM',duration:2})});assert.equal(killed.status,'failed');
});
test('declared input fingerprints survive documentation-only changes but invalidate product changes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bounded-input-'));await command(['git','init'],{cwd:root});await mkdir(path.join(root,'apps'));await mkdir(path.join(root,'docs'));
 await writeFile(path.join(root,'apps/a.js'),'a');await writeFile(path.join(root,'docs/a.md'),'a');await command(['git','add','.'],{cwd:root});
 const before=await checkInputFingerprint(root,'E2E');await writeFile(path.join(root,'docs/a.md'),'b');assert.equal(await checkInputFingerprint(root,'E2E'),before);
 await writeFile(path.join(root,'apps/untracked.js'),'new behavior');assert.notEqual(await checkInputFingerprint(root,'E2E'),before);
 await writeFile(path.join(root,'apps/a.js'),'b');assert.notEqual(await checkInputFingerprint(root,'E2E'),before);
});
test('text-only behavioral evidence requires every existing client and retained flow',()=>{
 const flow='create, move, viewer live update, reload and reconnect';const items=['mobile','mid-wide','full-wide'].map(viewport=>({viewport,title:`core / ${flow}`,status:'passed',images:[]}));
 verifyGeneralEvidence(items);assert.throws(()=>verifyGeneralEvidence(items.slice(0,2)));assert.throws(()=>verifyGeneralEvidence(items,{retained:true}));
 items[2].status='skipped';assert.throws(()=>verifyGeneralEvidence(items));
});

test('failed prerequisite blocks product work but allows independent report checks',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'bounded-failfast-')));const cwd=path.join(root,'repo');await mkdir(cwd);
 await command(['git','init','-b','main'],{cwd});await command(['git','config','user.email','test@example.invalid'],{cwd});await command(['git','config','user.name','Validation test'],{cwd});
 await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled PR gate'}}));await command(['git','add','.'],{cwd});await command(['git','commit','-m','fixture'],{cwd});
 const seen=[];const policy={version:2,phase:'final',lanes:1,visualMode:'none',viewports:['mobile','mid-wide'],coverageViewports:['mobile','mid-wide','full-wide'],questions:[],unmapped:[],selected:['Typecheck','Generated runtime','Unit','E2E','Responsive proof','Report viewer']};
 const {stage}=await localRun({cwd,base:'HEAD',dir:path.join(root,'out'),lockPath:path.join(root,'lock'),publishReport:false,policy,execute:async argv=>{seen.push(argv);return {code:argv[1]==='typecheck'?1:0,duration:1};}});
 assert.equal(stage.status,'failed');assert.equal(seen.length,3);assert.equal(seen[0][1],'test:pr-gate');assert.match(seen[2][1],/report-browser/);assert.ok(stage.checks.some(c=>c.name==='E2E'&&c.status==='blocked'));
});
test('report-only regeneration does not execute product checks or change raw evidence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bounded-report-'));const run=path.join(root,'run.json');const evidence=path.join(root,'raw-evidence.json');
 await writeFile(evidence,'preserve failed attempt');await writeFile(run,JSON.stringify({id:'report-only',version:2,mode:'local',stages:[],prs:[],risks:['Disclosed intermittent failure']}));
 await command(['node',path.join(harnessRoot,'scripts/validation/cli.mjs'),'report','--run',run],{cwd:root});
 assert.equal(await readFile(evidence,'utf8'),'preserve failed attempt');assert.match(await readFile(path.join(root,'site/index.html'),'utf8'),/Disclosed intermittent failure/);
});

test('checkpoint or receipt interruption cannot leave a passed final candidate',async()=>{
 const {markInterrupted}=await import('../integrated-bounded.mjs');const run={complete:true,stages:[{status:'passed',checks:[{name:'E2E',status:'passed'}]}]};
 markInterrupted(run);assert.equal(run.complete,false);assert.equal(run.orchestration,'failed');assert.equal(run.stages[0].status,'failed');assert.equal(run.stages[0].checks.at(-1).name,'Validation orchestration');
});

test('ordinary local validation runs only PR gate and fresh/retained proof unless a feature plan asks for more',async t=>{
 for(const mode of ['fresh','retained','missing-retained']){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'default-pr-policy-'))),cwd=path.join(root,'repo');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);
  await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled gate','test:e2e':'must not run','test:performance':'must not run','test:browser:integration':'must not run'}}));await command(['git','init','-b','main'],{cwd});await command(['git','config','user.email','test@example.invalid'],{cwd});await command(['git','config','user.name','Test'],{cwd});await command(['git','add','.'],{cwd});await command(['git','commit','-m','fixture'],{cwd});const base=(await command(['git','rev-parse','HEAD'],{cwd})).output.trim(),seen=[];
  const retained=mode!=='fresh';const result=await localRun({cwd,base:'HEAD',dir:path.join(root,'run'),lockPath:path.join(root,'lock'),publishReport:false,...(retained?{continuityInput:path.join(root,'retained-input'),persistRoot:path.join(root,'retained-db')}:{}) ,execute:async(argv,{env})=>{
   seen.push(argv);if(argv[1]==='test:pr-gate'){assert.equal(env.RIGHELT_E2E_PERSIST_ROOT,undefined);assert.equal(env.RIGHELT_CONTINUITY_INPUT,undefined);}else if(retained){assert.equal(env.RIGHELT_E2E_PERSIST_ROOT,path.join(root,'retained-db'));assert.equal(env.RIGHELT_CONTINUITY_INPUT,path.join(root,'retained-input'));}assert.equal(env.RIGHELT_TEST_BASE_REVISION,base);assert.equal(env.RIGHELT_EVIDENCE_PROFILE,'pr-gate');
   const flows=['create, move, viewer live update, reload and reconnect',...(mode==='retained'?['previous-stage identity and game survive migrations']:[])];
   await writeFile(env.RIGHELT_EVIDENCE_JSON,JSON.stringify(['mobile','mid-wide','full-wide'].flatMap(viewport=>flows.map(title=>({viewport,title,status:'passed',images:[]})))));return{code:0,duration:1};
  }});
  assert.equal(result.stage.status,mode==='missing-retained'?'failed':'passed');assert.equal(seen.length,2);assert.deepEqual(seen[0],['pnpm','test:pr-gate']);assert(seen[1].some(x=>x.endsWith('playwright.validation.config.mjs')));
  for(const name of ['E2E','Auth E2E','Performance','Browser integration','Unit','Integration'])assert(!result.stage.checks.some(c=>c.name===name));
 }
});
test('missing candidate PR gate script refuses before any broad local fallback',async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'missing-pr-gate-'))),cwd=path.join(root,'repo');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);await writeFile(path.join(cwd,'package.json'),'{}');await command(['git','init','-b','main'],{cwd});await command(['git','config','user.email','test@example.invalid'],{cwd});await command(['git','config','user.name','Test'],{cwd});await command(['git','add','.'],{cwd});await command(['git','commit','-m','fixture'],{cwd});let calls=0;
 const{stage}=await localRun({cwd,base:'HEAD',dir:path.join(root,'run'),lockPath:path.join(root,'lock'),publishReport:false,execute:async()=>{calls++;return{code:0};}});assert.equal(calls,0);assert.equal(stage.status,'failed');assert(stage.checks.some(c=>c.name==='Validation startup'));
});

test('single and multi-PR final stages execute every explicit feature file once without broad E2E',async t=>{
 const a='e2e/workflows/feature-a.spec.mjs',b='e2e/workflows/feature-b.spec.mjs';
 for(const prs of [[{number:1,tests:[a]}],[{number:1,tests:[a]},{number:2,tests:[b,a]}]]){
  const spec={version:2,prs,questions:[{id:'specific',description:'Bounded feature acceptance',paths:['apps/'],checks:['PR gate']}]},policy=stagePolicy(spec,prs.length);assert.deepEqual(policy.tests,prs.length===1?[a]:[a,b]);assert(policy.selected.includes('Boundary E2E'));assert(!policy.selected.includes('E2E'));assert.deepEqual(stagePolicy(spec,0).tests,[]);if(prs.length>1)assert.deepEqual(stagePolicy(spec,1).tests,[a]);
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'feature-final-'))),cwd=path.join(root,'repo');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:pr-gate':'controlled gate'}}));await command(['git','init','-b','main'],{cwd});await command(['git','config','user.email','test@example.invalid'],{cwd});await command(['git','config','user.name','Test'],{cwd});await command(['git','add','.'],{cwd});await command(['git','commit','-m','fixture'],{cwd});const seen=[];
  await localRun({cwd,base:'HEAD',policy,dir:path.join(root,'run'),lockPath:path.join(root,'lock'),publishReport:false,execute:async(argv,{env})=>{seen.push(argv);await writeFile(env.RIGHELT_EVIDENCE_JSON,JSON.stringify(['mobile','mid-wide','full-wide'].map(viewport=>({viewport,title:'create, move, viewer live update, reload and reconnect',status:'passed',images:[]}))));return{code:0,duration:1};}});
  assert.deepEqual(seen.filter(argv=>argv[1]==='test:e2e'),[['pnpm','test:e2e',...policy.tests,'--project=chromium']]);
 }
});
