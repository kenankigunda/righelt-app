import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stagePolicy,validatePlan} from '../plan.mjs';
import {executeCheck,checkInputFingerprint} from '../execution.mjs';
import {verifyGeneralEvidence,localRun,harnessRoot} from '../local.mjs';
import {command} from '../io.mjs';
const spec={version:2,questions:[{id:'transport',description:'Recovery retains history',paths:['apps/'],checks:['Integration','E2E'],boundaryChecks:['Integration']}],prs:[{number:1,tests:['e2e/workflows/reconnect-recovery.spec.mjs']},{number:2}]};
test('boundary selects explicit acceptance checks; final keeps broad assertions and limits visuals independently',()=>{
 const boundary=stagePolicy(spec,1,{changed:['apps/api/src/x.ts']});
 assert.equal(boundary.visualMode,'none');assert.ok(boundary.selected.includes('Integration'));assert.ok(!boundary.selected.includes('E2E'));assert.equal(boundary.tests.length,1);
 const final=stagePolicy(spec,2,{accounts:true,changed:['apps/web/app.js']});
 assert.ok(final.selected.includes('E2E'));assert.ok(final.selected.includes('Auth E2E'));assert.equal(final.tests.length,0);assert.equal(final.coverageViewports.length,3);assert.equal(final.viewports.length,2);assert.ok(!final.selected.includes('Report viewer'));
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
 await writeFile(path.join(cwd,'package.json'),'{}');await command(['git','add','.'],{cwd});await command(['git','commit','-m','fixture'],{cwd});
 const seen=[];const policy={version:2,phase:'final',lanes:1,visualMode:'none',viewports:['mobile','mid-wide'],coverageViewports:['mobile','mid-wide','full-wide'],questions:[],unmapped:[],selected:['Typecheck','Generated runtime','Unit','E2E','Responsive proof','Report viewer']};
 const {stage}=await localRun({cwd,base:'HEAD',dir:path.join(root,'out'),lockPath:path.join(root,'lock'),publishReport:false,policy,execute:async argv=>{seen.push(argv);return {code:argv[1]==='typecheck'?1:0,duration:1};}});
 assert.equal(stage.status,'failed');assert.equal(seen.length,2);assert.match(seen[1][1],/report-browser/);assert.ok(stage.checks.some(c=>c.name==='E2E'&&c.status==='blocked'));
});
test('report-only regeneration does not execute product checks or change raw evidence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bounded-report-'));const run=path.join(root,'run.json');const evidence=path.join(root,'raw-evidence.json');
 await writeFile(evidence,'preserve failed attempt');await writeFile(run,JSON.stringify({id:'report-only',version:2,mode:'local',stages:[],prs:[],risks:['Disclosed intermittent failure']}));
 await command(['node',path.join(harnessRoot,'scripts/validation/cli.mjs'),'report','--run',run],{cwd:root});
 assert.equal(await readFile(evidence,'utf8'),'preserve failed attempt');assert.match(await readFile(path.join(root,'site/index.html'),'utf8'),/Disclosed intermittent failure/);
});
