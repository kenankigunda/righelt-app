import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processTable, live } from '../system.mjs';
import { POLICY } from '../policy.mjs';
const cli = fileURLToPath(new URL('../cli.mjs',import.meta.url));
const supervisorModule = fileURLToPath(new URL('../supervisor.mjs',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,timeout=12_000){const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(50);}throw Error('Timed out');}
async function fixture(t) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'righelt-resources-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const pidFile=path.join(dir,'pids.json'), script=path.join(dir,'tree.mjs');
 await writeFile(script,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid]));if(process.env.FAIL)process.exit(7);else if(process.env.COMPLETE)setTimeout(()=>process.exit(0),300);else setInterval(()=>{},1000);`);
 return {dir,pidFile,script};
}
function launch(f,options=[],extra={}) { const p=spawn(process.execPath,[cli,'run',...options,'--',process.execPath,f.script],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry'),...extra},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',c=>output+=c);p.stderr.on('data',c=>output+=c);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,output}));});return {p,done}; }
async function pids(f){return waitFor(async()=>{try{return JSON.parse(await readFile(f.pidFile,'utf8'));}catch{return false;}});}
async function assertGone(ids){await waitFor(async()=>!(await processTable()).some(r=>ids.includes(r.pid)&&live(r)));}
for(const [name,options,extra,expected] of [
 ['success',[],{COMPLETE:'1'},0],['failure',[],{FAIL:'1'},7],['timeout',['--timeout-ms','1000'],{},130],['cancel',[],{},130],
]) test(`whole-tree cleanup after ${name}`, {skip:process.platform==='win32',timeout:20_000},async t=>{
 const f=await fixture(t), {p,done}=launch(f,options,extra);t.after(()=>{try{p.kill('SIGKILL');}catch{}});
 const ids=await pids(f);if(name==='cancel')p.kill('SIGTERM');
 const result=await done;assert.equal(result.code,expected,result.output);await assertGone(ids);
});
test('unrelated process survives cleanup and missing probes do not disable cleanup',{skip:process.platform==='win32',timeout:20_000},async t=>{
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill('SIGKILL'));
 const f=await fixture(t),{done}=launch(f,[],{COMPLETE:'1'});const ids=await pids(f);assert.equal((await done).code,0);await assertGone(ids);assert.equal(unrelated.exitCode,null);
});
test('guardian detects launcher exit and cleans descendants',{skip:process.platform==='win32',timeout:20_000},async t=>{
 const f=await fixture(t), launcher=path.join(f.dir,'launcher.mjs');
 await writeFile(launcher,`import {spawn} from 'node:child_process';spawn(process.execPath,${JSON.stringify([cli,'run','--',process.execPath,f.script])},{stdio:'ignore'});setTimeout(()=>process.exit(0),1500);`);
 const p=spawn(process.execPath,[launcher],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});t.after(()=>p.kill('SIGKILL'));
 const ids=await pids(f);await assertGone(ids);
});
test('injected critical pressure cancels heavy work as retryable incomplete',{skip:process.platform==='win32',timeout:15_000},async t=>{
 const f=await fixture(t),driver=path.join(f.dir,'pressure.mjs');
 await writeFile(driver,`import {supervise} from ${JSON.stringify('file://'+supervisorModule)};let calls=0;const r=await supervise(${JSON.stringify([process.execPath,f.script])},{policy:${JSON.stringify({...POLICY,sampleMs:50,sustainedMs:100,ownershipSampleMs:25,graceMs:100})},sample:async()=>({level:calls++?'critical':'normal'})});process.exitCode=r.code;`);
 const p=spawn(process.execPath,[driver],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});const done=new Promise(r=>p.on('close',r));const ids=await pids(f);assert.equal(await done,75);await assertGone(ids);
 const record=JSON.parse(await readFile(path.join(f.dir,'registry',(await readdir(path.join(f.dir,'registry'))).find(n=>n.endsWith('.json'))),'utf8'));assert.equal(record.reason,'memory-pressure');assert.equal(record.cleanup,'verified');
});
test('killed guardian triggers independent process-group cleanup',{skip:process.platform==='win32',timeout:20_000},async t=>{
 const f=await fixture(t),{p,done}=launch(f);const ids=await pids(f);await sleep(200);p.kill('SIGKILL');await done;await assertGone(ids);
});
test('missing executable fails without launching or retaining a worker',{skip:process.platform==='win32',timeout:15_000},async t=>{
 const f=await fixture(t),p=spawn(process.execPath,[cli,'run','--','/definitely/missing/righelt-command'],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});const code=await new Promise(r=>p.on('close',r));assert.equal(code,1);
 const names=await readdir(path.join(f.dir,'registry'));for(const name of names.filter(n=>n.endsWith('.json'))){const record=JSON.parse(await readFile(path.join(f.dir,'registry',name),'utf8'));assert.equal(record.cleanup,'verified');assert(!(await processTable()).some(r=>sameProcessForTest(r,record.supervisor)&&live(r)));}
});
function sameProcessForTest(a,b){return a?.pid===b?.pid&&a?.start===b?.start;}
test('nested detached guardian is cleaned before outer run reports completion',{skip:process.platform==='win32',timeout:25_000},async t=>{
 const f=await fixture(t),nested=path.join(f.dir,'nested.mjs');
 await writeFile(nested,`import {spawn} from 'node:child_process';spawn(process.execPath,${JSON.stringify([cli,'run','--kind','preview','--',process.execPath,f.script])},{stdio:'ignore',detached:true});setTimeout(()=>process.exit(0),800);`);
 const p=spawn(process.execPath,[cli,'run','--',process.execPath,nested],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});
 const done=new Promise(r=>p.on('close',r));const ids=await pids(f);assert.equal(await done,0);assert(!(await processTable()).some(r=>ids.includes(r.pid)&&live(r)));
});
for (const keep of [false,true]) test(`sustained warning ${keep?'preserves requested':'releases disposable'} preview`,{skip:process.platform==='win32',timeout:15_000},async t=>{
 const f=await fixture(t),driver=path.join(f.dir,'warning.mjs');
 await writeFile(driver,`import {supervise} from ${JSON.stringify('file://'+supervisorModule)};const r=await supervise(${JSON.stringify([process.execPath,f.script])},{kind:'preview',keep:${keep},policy:${JSON.stringify({...POLICY,sampleMs:30,sustainedMs:90,ownershipSampleMs:20,graceMs:100})},sample:async()=>({level:'warning'})});process.exitCode=r.code;`);
 const p=spawn(process.execPath,[driver],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",COMPLETE:'1',RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});const done=new Promise(r=>p.on('close',r));const ids=await pids(f);assert.equal(await done,keep?0:75);await assertGone(ids);
});
test('Windows fallback runs direct commands without Unix process inspection',{timeout:15_000},async t=>{
 const f=await fixture(t),driver=path.join(f.dir,'windows.mjs');
 const command=`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path.join(f.dir,'ran'))},'ok');`;
 await writeFile(driver,`import {supervise} from ${JSON.stringify('file://'+supervisorModule)};const r=await supervise(${JSON.stringify([process.execPath,'--input-type=module','-e',command])},{platform:'win32',table:async()=>{throw Error('Unix inspection must not be called');},sample:async()=>({level:'unknown',reason:'unsupported'})});process.exitCode=r.code;`);
 const p=spawn(process.execPath,[driver],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});assert.equal(await new Promise(r=>p.on('close',r)),0);assert.equal(await readFile(path.join(f.dir,'ran'),'utf8'),'ok');
});
test('deferred heavy job can be cancelled without launching its command',{skip:process.platform==='win32',timeout:15_000},async t=>{
 const f=await fixture(t),driver=path.join(f.dir,'deferred.mjs');
 await writeFile(driver,`import {supervise} from ${JSON.stringify('file://'+supervisorModule)};const r=await supervise(${JSON.stringify([process.execPath,f.script])},{sample:async()=>({level:'critical'}),policy:${JSON.stringify({...POLICY,sampleMs:60_000})}});process.exitCode=r.code;`);
 const p=spawn(process.execPath,[driver],{env:{...process.env,RIGHELT_RESOURCE_RUN:"",RIGHELT_RESOURCE_KEEP:"",RIGHELT_RESOURCE_REGISTRY:path.join(f.dir,'registry')},stdio:'ignore'});const done=new Promise(r=>p.on('close',r));await waitFor(async()=>{try{return(await readdir(path.join(f.dir,'registry'))).some(n=>n.endsWith('.json'));}catch{return false;}});const started=Date.now();p.kill('SIGTERM');assert.equal(await done,130);assert(Date.now()-started<2000);await assert.rejects(readFile(f.pidFile),{code:'ENOENT'});
});
