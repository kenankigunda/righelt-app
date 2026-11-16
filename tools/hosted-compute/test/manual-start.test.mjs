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
