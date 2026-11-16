import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {manualStartupArgv} from '../manual-start.mjs';
const execute=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manual-start-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const modules=path.join(root,'tools/hosted-compute');await fs.mkdir(modules,{recursive:true});
 await fs.symlink(path.resolve('tools/hosted-compute/client.mjs'),path.join(modules,'client.mjs'));
 await fs.writeFile(path.join(modules,'worker.mjs'),`import{writeFileSync}from'node:fs';export async function runWorker(){if(globalThis.readyCalls<3)throw Error('worker started before readiness');writeFileSync('started.json',JSON.stringify({calls:globalThis.readyCalls}));}`);
 const preload=path.join(root,'preload.mjs');await fs.writeFile(preload,`import assert from'node:assert/strict';globalThis.readyCalls=0;const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms)=>timer(fn,Math.min(ms,10));globalThis.fetch=async(url,options)=>{assert(new URL(url).pathname.endsWith('/manual-ready'));assert.equal(options.method,'GET');globalThis.readyCalls++;return Response.json({ready:process.env.TEST_NEVER!=='1'&&globalThis.readyCalls>=3,until:Number(process.env.COMPUTE_MANUAL_READY_UNTIL)});};`);
 return {root,preload};
}
test('reviewed inline startup waits through pending replies then starts the worker exactly once',async t=>{
 const f=await fixture(t),[, ...argv]=manualStartupArgv();
 await execute(process.execPath,['--import',f.preload,...argv],{cwd:f.root,env:{...process.env,COMPUTE_URL:'https://fixture.invalid',COMPUTE_ID:'manual',COMPUTE_GENERATION:'1',COMPUTE_WORKER_TOKEN:'private-test-token',COMPUTE_MANUAL_READY_UNTIL:String(Date.now()+30000)},timeout:10000});
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root,'started.json'))),{calls:3});
});
test('reviewed inline startup exits at the finite bound without importing the worker if admission never completes',async t=>{
 const f=await fixture(t),[, ...argv]=manualStartupArgv();
 await assert.rejects(execute(process.execPath,['--import',f.preload,...argv],{cwd:f.root,env:{...process.env,COMPUTE_URL:'https://fixture.invalid',COMPUTE_ID:'manual',COMPUTE_GENERATION:'1',COMPUTE_WORKER_TOKEN:'private-test-token',COMPUTE_MANUAL_READY_UNTIL:String(Date.now()+300),TEST_NEVER:'1'},timeout:5000}),error=>error.code===1&&!error.stderr.includes('private-test-token'));
 await assert.rejects(fs.stat(path.join(f.root,'started.json')),{code:'ENOENT'});
});
test('cold-start inline process retries one claim and passes its session-carrying client to the frozen worker',async t=>{
 const f=await fixture(t),[, ...argv]=manualStartupArgv();
 await fs.writeFile(path.join(f.root,'tools/hosted-compute/worker.mjs'),`import{writeFileSync}from'node:fs';export async function runWorker({client}){if(!/^[a-f0-9]{32}$/.test(client.startupSessionId))throw Error('missing private session bridge');await client.json('work');await client.json('heartbeat',{});writeFileSync('started.json',JSON.stringify({calls:globalThis.readyCalls}));}`);
 await fs.writeFile(f.preload,`import assert from'node:assert/strict';globalThis.readyCalls=0;let claim;const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms)=>timer(fn,Math.min(ms,10));globalThis.fetch=async(url,options)=>{const action=new URL(url).pathname.split('/').at(-1);if(action==='manual-ready'){assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.podId,'fixture-pod');assert.equal(body.intentSha256,'a'.repeat(64));assert.match(body.sessionId,/^[a-f0-9]{32}$/);if(claim)assert.deepEqual(body,claim);claim=body;globalThis.readyCalls++;if(globalThis.readyCalls===1)throw Error('lost response after saved claim');return Response.json({ready:globalThis.readyCalls>=3,until:Number(process.env.COMPUTE_MANUAL_READY_UNTIL)});}assert.equal(options.headers['x-compute-startup-session'],claim.sessionId);assert(['work','heartbeat'].includes(action));return Response.json({ok:true});};`);
 const env={...process.env,COMPUTE_URL:'https://fixture.invalid',COMPUTE_ID:'manual',COMPUTE_GENERATION:'1',COMPUTE_WORKER_TOKEN:'private-test-token',COMPUTE_MANUAL_READY_PROTOCOL:'confirmed-pod-startup',COMPUTE_MANUAL_INTENT_SHA256:'a'.repeat(64),RUNPOD_POD_ID:'fixture-pod',COMPUTE_MANUAL_READY_UNTIL:String(Date.now()+600000)};
 const result=await execute(process.execPath,['--import',f.preload,...argv],{cwd:f.root,env,timeout:10000});
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root,'started.json'))),{calls:3});assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
test('cold-start inline process rejects missing Pod identity and exits on a closed server deadline before worker import',async t=>{
 const f=await fixture(t),[, ...argv]=manualStartupArgv();
 const env={...process.env,COMPUTE_URL:'https://fixture.invalid',COMPUTE_ID:'manual',COMPUTE_GENERATION:'1',COMPUTE_WORKER_TOKEN:'private-test-token',COMPUTE_MANUAL_READY_PROTOCOL:'confirmed-pod-startup',COMPUTE_MANUAL_INTENT_SHA256:'a'.repeat(64),RUNPOD_POD_ID:'',COMPUTE_MANUAL_READY_UNTIL:String(Date.now()+600000)};
 await assert.rejects(execute(process.execPath,['--import',f.preload,...argv],{cwd:f.root,env,timeout:5000}));
 await fs.writeFile(f.preload,`globalThis.fetch=async()=>Response.json({ready:false,until:Date.now()});`);
 await assert.rejects(execute(process.execPath,['--import',f.preload,...argv],{cwd:f.root,env:{...env,RUNPOD_POD_ID:'fixture-pod'},timeout:5000}));
 await assert.rejects(fs.stat(path.join(f.root,'started.json')),{code:'ENOENT'});
});
