import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processTable, live } from '../system.mjs';
import { cleanupRecord } from '../registry.mjs';
import { spawnAuthStackCommand, stopAuthStackCommand } from '../../auth-stack-process.mjs';

const helper = new URL('../../auth-stack-process.mjs', import.meta.url).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(50); }
  throw Error('Account stack cleanup did not finish');
}

test('account stack registers one-shot and service guardians before branching', async () => {
  const source = await readFile(new URL('../../e2e-auth-stack.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(stopping\) throw/);
  assert.match(source, /children\.add\(child\);\s*child\.on\("close", \(\) => children\.delete\(child\)\);\s*if \(service\)/);
  assert.match(source, /await Promise\.all\(\[\.\.\.children\]\.map\(stopAuthStackCommand\)\)/);
});

test('failed guardian cannot be reported as successful cleanup', async () => {
  assert.equal(await stopAuthStackCommand({exitCode:1,signalCode:null}), false);
  assert.equal(await stopAuthStackCommand({exitCode:null,signalCode:'SIGKILL'}), false);
});

for (const mode of ['stop', 'one-shot-stop', 'launcher-death', 'command-exit']) {
  test(`account command guardian cleans descendants after ${mode}`, {skip: process.platform === 'win32', timeout: 25_000}, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'righelt-auth-guardian-'));
    const registry = path.join(dir, 'registry');
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    const pidsFile = path.join(dir, 'pids.json');
    // The command's descendant ignores TERM. Cleanup must include escalation,
    // even when its immediate parent exits first.
    await writeFile(path.join(bin, 'pnpm'), `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,c.pid]));
${mode === 'command-exit' ? 'setTimeout(()=>process.exit(0),250);' : 'setInterval(()=>{},1000);'}
`, {mode: 0o755});
    const launcher = path.join(dir, 'launcher.mjs');
    await writeFile(launcher, `import {spawnAuthStackCommand,stopAuthStackCommand} from ${JSON.stringify(helper)};
import {writeFileSync} from 'node:fs';
const child=spawnAuthStackCommand([], {cwd:${JSON.stringify(dir)},service:${mode !== 'one-shot-stop'}});
${mode.endsWith('stop') ? `process.on('SIGUSR1',async()=>{writeFileSync(${JSON.stringify(path.join(dir,'stopped'))},String(await stopAuthStackCommand(child)));process.exit(0);});` : ''}
${mode === 'command-exit' ? "child.once('close',code=>process.exit(code));" : 'setInterval(()=>{},1000);'}
`);
    const proc = spawn(process.execPath, [launcher], {env: {...process.env, PATH: `${bin}:${process.env.PATH}`, RIGHELT_RESOURCE_RUN:'', RIGHELT_RESOURCE_KEEP:'', RIGHELT_RESOURCE_REGISTRY:registry}, stdio:['ignore','pipe','pipe']});
    let output = '';
    proc.stdout.on('data', chunk => output += chunk);
    proc.stderr.on('data', chunk => output += chunk);
    const done = new Promise(resolve => proc.once('close', resolve));
    t.after(async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      for (const name of await readdir(registry).catch(()=>[])) {
        if (name.endsWith('.json')) await cleanupRecord(JSON.parse(await readFile(path.join(registry,name),'utf8')));
      }
      await rm(dir, {recursive:true,force:true});
    });
    const ids = await until(async () => { try { return JSON.parse(await readFile(pidsFile,'utf8')); } catch { return false; } });
    if (mode.endsWith('stop')) proc.kill('SIGUSR1');
    if (mode === 'launcher-death') proc.kill('SIGKILL');
    const code = await done;
    if (mode !== 'launcher-death') assert.equal(code, 0, output);
    await until(async () => !(await processTable()).some(row => ids.includes(row.pid) && live(row)));
    if (mode.endsWith('stop')) assert.equal(await readFile(path.join(dir,'stopped'),'utf8'), 'true');
    const receipts = await Promise.all((await readdir(registry)).filter(name=>name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(registry,name),'utf8'))));
    await until(async () => (await Promise.all(receipts.map(async receipt => JSON.parse(await readFile(path.join(registry,`${receipt.id}.json`),'utf8'))))).every(receipt=>receipt.cleanup === 'verified'));
  });
}

// Execute the actual controller bodies with controlled process/HTTP leaves.
// These are startup/ownership controls, not application credential proof.
const authSource=await readFile(new URL('../../e2e-auth-stack.mjs',import.meta.url),'utf8');
const runSource=authSource.slice(authSource.indexOf('function run('),authSource.indexOf('async function shutdown('));
const startupSource=authSource.slice(authSource.indexOf('  const backendPort = await reserveApiBackendPort'),authSource.indexOf('  // Test-runner-only loopback control'));
const shutdownSource=authSource.slice(authSource.indexOf('async function shutdown('),authSource.indexOf('process.on("SIGTERM"'));
const fakeChild=()=>Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),exitCode:null,signalCode:null});

test('account spawn preserves default guardian delegation and opts into two captured streams only when requested',()=>{
 const calls=[],child=fakeChild(),process={execPath:'owned-node',env:{original:'yes'}};
 const actual=vm.runInNewContext('('+spawnAuthStackCommand.toString()+')',{spawn:(...args)=>{calls.push(args);return child;},cliPath:'released-guardian',process});
 assert.equal(actual(['original'],{cwd:'/owned',service:true}),child);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['owned-node',['released-guardian','run','--kind','preview','--','pnpm','original'],{cwd:'/owned',env:{original:'yes'},stdio:'inherit'}]);
 actual(['original'],{cwd:'/owned',service:true,captureOutput:true});assert.deepEqual(Array.from(calls[1][2].stdio),['inherit','pipe','pipe']);
 actual(['original'],{cwd:'/owned',captureStderr:true});assert.deepEqual(Array.from(calls[2][2].stdio),['inherit','inherit','pipe']);assert.equal(calls.length,3);
});

test('actual API run registers ownership then forwards each captured stdout/stderr chunk once without conversion',()=>{
 const child=fakeChild(),out=[],err=[],spawned=[],observed=[];
 const scope={stopping:false,root:'/owned',privateLogs:'/private/logs',diagnostics:'/private/diagnostics',path,children:new Set(),serviceReceipts:[],failureDirectory:'/private/failures',failureRunId:'owned-run',diagnosticsFailed:false,
  process:{env:{original:'yes'},stdout:{write:x=>out.push(x)},stderr:{write:x=>err.push(x)}},
  spawnAuthStackCommand:(args,options)=>{spawned.push({args,options});return child;},observeAuthService:(...args)=>{observed.push(args);return Promise.resolve({expected:true});},localHttpsEnvironment:()=>({https:'yes'}),recordUnexpectedExit(){},shutdown(){}};
 vm.createContext(scope);vm.runInContext(runSource,scope);assert.equal(scope.run(['exec','wrangler','dev'],{service:'api',captureOutput:true}),child);
 assert.equal(scope.children.has(child),true);assert.equal(observed.length,1);assert.equal(scope.serviceReceipts.length,1);
 assert.equal(spawned[0].options.captureOutput,true);assert.equal(spawned[0].options.env.RIGHELT_AUTH_FRESH_CONNECTIONS,'1');
 const a=Buffer.from([0xff,0x00,0x81]),b=Buffer.from('same stderr');child.stdout.emit('data',a);child.stderr.emit('data',b);
 assert.equal(out.length,1);assert.equal(err.length,1);assert.equal(out[0],a);assert.equal(err[0],b);child.emit('close');assert.equal(scope.children.size,0);
});

async function actualStartup({stopAt=null,readyError=null,exitDuringBridge=false}={}){
 const events=[],child=fakeChild();let closed=0;
 const connection={url:new URL('http://127.0.0.1:9987'),target:'http://127.0.0.1:45678',async close(){closed++;events.push(['bridge-close']);}};
 const scope={AUTH_READY_TIMEOUT_MS:120000,stopping:false,apiPort:'9987',webPort:'9988',configs:['api.toml','admission.toml','hash.toml'],persist:'/private/state',apiPublicConnection:undefined,
  reserveApiBackendPort:async ports=>{events.push(['reserve',Array.from(ports)]);if(stopAt==='reservation')scope.stopping=true;return 45678;},
  run:(args,options)=>{events.push(['run',Array.from(args),{...options}]);return child;},
  waitForOwnedApiReady:async(c,port,deadline)=>{assert.equal(c,child);events.push(['owned-ready',port,deadline]);if(readyError)throw readyError;},
  ready:async url=>{events.push(['health',url]);if(stopAt==='health')scope.stopping=true;},
  createPublicApiConnection:async options=>{events.push(['bridge',JSON.parse(JSON.stringify(options))]);if(stopAt==='bridge')scope.stopping=true;if(exitDuringBridge)child.exitCode=1;return connection;},console:{log:x=>events.push(['log',x])},Error};
 vm.createContext(scope);let error;
 try{await vm.runInContext('(async()=>{'+startupSource+'})()',scope);}catch(e){error=e;}
 return{events,error,child,closed,scope,connection};
}

test('actual Auth startup keeps all multiworker/inspector/config arguments and readies the owned backend before the exact public bridge',async()=>{
 const x=await actualStartup();assert.equal(x.error,undefined);
 assert.deepEqual(x.events.filter(e=>e[0]!=='log'),[
  ['reserve',[9987,9988,9997,9998,10088]],
  ['run',['exec','wrangler','dev','--config','api.toml','--config','admission.toml','--config','hash.toml','--local','--port','45678','--inspector-port','9997','--persist-to','/private/state'],{service:'api',captureOutput:true}],
  ['owned-ready',45678,120000],['health','http://127.0.0.1:45678/api/health'],['bridge',{publicPort:9987,backendPort:45678}],['health','http://127.0.0.1:9987/api/health']]);
 assert.equal(x.scope.apiPublicConnection,x.connection);assert.equal(x.closed,0);
});

test('owned readiness failure keeps the same primary and never opens a public listener',async()=>{
 const primary=new Error('owned backend refused');const x=await actualStartup({readyError:primary});assert.equal(x.error,primary);assert.equal(x.events.some(e=>e[0]==='bridge'),false);assert.equal(x.events.filter(e=>e[0]==='health').length,0);
});
for(const stage of['reservation','health'])test('Auth stop during '+stage+' forbids late public creation',async()=>{
 const x=await actualStartup({stopAt:stage});assert.ok(x.error);assert.equal(x.events.some(e=>e[0]==='bridge'),false);
 if(stage==='reservation')assert.equal(x.events.some(e=>e[0]==='run'),false);
});
for(const options of[{stopAt:'bridge'},{exitDuringBridge:true}])test('late Auth bridge is closed when its owner stops during creation '+JSON.stringify(options),async()=>{
 const x=await actualStartup(options);assert.ok(x.error);assert.equal(x.closed,1);assert.equal(x.events.filter(e=>e[0]==='health').length,1);
});

test('actual Auth shutdown closes the bridge once and preserves child/journal cleanup even if bridge close fails',async()=>{
 for(const fail of[false,true]){
  const calls=[],primary=new Error('bridge close failed'),child={};let exit;
  const scope={stopping:false,control:{close(){calls.push('control');}},apiPublicConnection:{async close(){calls.push('bridge');if(fail)throw primary;}},children:new Set([child]),stopAuthStackCommand:async value=>{assert.equal(value,child);calls.push('child');return true;},serviceReceipts:[Promise.resolve({expected:true})],diagnosticsFailed:false,
   proxyDiagnosticsInstallation:Promise.resolve(async()=>calls.push('restore')),failureJournalReady:true,failureDirectory:'/private/failures',failureRunId:'same-run',completeProxyFailureJournal:async(_dir,_run,successful)=>{calls.push(['journal',successful]);return false;},temporary:'/private/owned',rm:async()=>calls.push('rm'),process:{exit:code=>{exit=code;}},console:{error:e=>{assert.equal(e,primary);calls.push('primary');}}};
  vm.createContext(scope);vm.runInContext(shutdownSource,scope);await scope.shutdown();await scope.shutdown();
  assert.equal(exit,fail?1:0);assert.equal(calls.filter(x=>x==='bridge').length,1);assert.equal(calls.filter(x=>x==='child').length,1);assert.ok(calls.indexOf('bridge')<calls.indexOf('child'));assert.ok(calls.includes('restore'));assert.ok(calls.includes('rm'));assert.deepEqual(calls.find(x=>Array.isArray(x)),['journal',!fail]);
 }
});
