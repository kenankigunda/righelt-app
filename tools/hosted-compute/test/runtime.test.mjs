import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {verifyRuntime,probeRuntime} from '../runtime.mjs';
import {runWorker} from '../worker.mjs';
import {fixture} from './helpers.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const config={pythonVersion:'3.14',torchVersion:'2.14.1',cudaVersion:'13.0'};
const arithmetic={policyApplied:true,policy:{id:'hosted-ieee-fp32-v1',parameterDtype:'float32',cudaMatmul:'ieee',cudnnConvolution:'ieee',autocast:false},precision:{global:'ieee',cudaMatmul:'ieee',cudnn:'ieee',cudnnConvolution:'ieee'},autocast:{cpu:false,cuda:false},cudnnEnabled:true};
const record={schema:1,kind:'cuda-runtime-probe',pythonVersion:'3.14.1',machine:'x86_64',torchVersion:'2.14.1',cudaVersion:'13.0',driverVersion:'580.1',gpuCount:1,gpuName:'test GPU',computeCapability:[9,0],gpuMemoryBytes:24000000000,kernelPassed:true,arithmetic};

test('CUDA qualification binds real kernel, driver, software and device identity',async()=>{
 const manifest={mode:'supervised-qualification'},identity={buildConfig:config};
 const proof=await verifyRuntime(record,identity,manifest);assert.match(proof.runtimeSha256,/^[a-f0-9]{64}$/);
 await verifyRuntime(record,identity,{mode:'unattended',runtimeSha256:proof.runtimeSha256});
 for(const changed of [{kernelPassed:false},{gpuCount:0},{cudaVersion:'12.8'},{driverVersion:''},{machine:'arm64'}])await assert.rejects(verifyRuntime({...record,...changed},identity,manifest));
 await assert.rejects(verifyRuntime({...record,driverVersion:'581.1'},identity,{mode:'unattended',runtimeSha256:proof.runtimeSha256}),/runtime changed/);
 for(const math of [undefined,{...arithmetic,policy:{...arithmetic.policy,id:'old'}},{...arithmetic,precision:{...arithmetic.precision,cudnnConvolution:'tf32'}},{...arithmetic,precision:{...arithmetic.precision,cudaMatmul:'tf32'}},{...arithmetic,autocast:{cpu:false,cuda:true}},{...arithmetic,cudnnEnabled:false}])await assert.rejects(verifyRuntime({...record,arithmetic:math},identity,manifest),/IEEE/);
});
test('unqualified CUDA stops the actual worker before downloading any private input',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await fixture();await fs.writeFile(path.join(root,'.compute-source.json'),JSON.stringify({sourceRevision:f.manifest.sourceRevision,dependencySha256:f.manifest.dependencySha256,buildConfig:config}));
 let downloads=0,finish;
 const client={json:async(action,body)=>{if(action==='work')return {manifest:f.manifest,manifestSha256:await sha256(encode(canonical(f.manifest))),phase:f.manifest.phases[0],phaseIndex:0,generation:1};if(action==='finish'){finish=body;return {};}throw Error('unexpected action');},download:async()=>{downloads++;throw Error('must not hydrate');}};
 const result=await runWorker({root,client,runtimeProbe:async()=>({...record,kernelPassed:false})});
 assert.equal(result.kind,'correctness');assert.equal(finish.kind,'correctness');assert.equal(downloads,0);await assert.rejects(fs.stat(path.join(root,'.ai-runs')),{code:'ENOENT'});
});

test('runtime probe retains only needed CUDA configuration in its captured subprocess environment',async()=>{
 const environment={PATH:'/usr/bin',HOME:'/root',LD_LIBRARY_PATH:'/provider/cuda/lib',CUDA_VISIBLE_DEVICES:'0',CUDA_DEVICE_ORDER:'PCI_BUS_ID',NVIDIA_VISIBLE_DEVICES:'assigned-device',NVIDIA_DRIVER_CAPABILITIES:'compute,utility',LD_PRELOAD:'/secret/injected.so',RUNPOD_API_KEY:'private-provider',GITHUB_TOKEN:'private-github',COMPUTE_BACKUP_SECRET_ACCESS_KEY:'private-backup'};
 let captured;const result=await probeRuntime('/image',environment,{execute:async(_file,_args,options)=>{captured=options.env;return {stdout:JSON.stringify(record)};}});
 assert.deepEqual(result,record);
 for(const name of ['PATH','HOME','LD_LIBRARY_PATH','CUDA_VISIBLE_DEVICES','CUDA_DEVICE_ORDER','NVIDIA_VISIBLE_DEVICES','NVIDIA_DRIVER_CAPABILITIES'])assert.equal(captured[name],environment[name]);
 for(const name of ['LD_PRELOAD','RUNPOD_API_KEY','GITHUB_TOKEN','COMPUTE_BACKUP_SECRET_ACCESS_KEY'])assert.equal(captured[name],undefined);
});

test('actual worker child retains CUDA configuration while excluding operator credentials and preload injection',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-runtime-env-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await fixture(),keys=['LD_LIBRARY_PATH','CUDA_VISIBLE_DEVICES','CUDA_DEVICE_ORDER','NVIDIA_VISIBLE_DEVICES','NVIDIA_DRIVER_CAPABILITIES','LD_PRELOAD','RUNPOD_API_KEY','GITHUB_TOKEN','COMPUTE_BACKUP_SECRET_ACCESS_KEY'];
 f.manifest.phases[0].device='cpu';f.manifest.phases[0].argv=[process.execPath,'-e',`console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key=>[key,process.env[key]??null]))));process.exit(1)`];
 await f.launch();await fs.writeFile(path.join(root,'.compute-source.json'),JSON.stringify({sourceRevision:f.manifest.sourceRevision,dependencySha256:f.manifest.dependencySha256}));
 const client={json:async(action,body)=>action==='work'?f.core.work('pilot',1):action==='heartbeat'?f.core.heartbeat('pilot',1,body):action==='progress'?f.core.progress('pilot',1,body):action==='finish'?f.core.finish('pilot',1,body):Promise.reject(Error('unexpected action')),
  upload:async raw=>f.core.putObject('pilot',{name:await sha256(raw),sha256:await sha256(raw),bytes:raw.length},raw,1),download:async a=>new Uint8Array(await (await f.bucket.get(`pilot/${a.sha256}`)).arrayBuffer())};
 const environment={PATH:process.env.PATH,HOME:root,LD_LIBRARY_PATH:'/provider/cuda/lib',CUDA_VISIBLE_DEVICES:'0',CUDA_DEVICE_ORDER:'PCI_BUS_ID',NVIDIA_VISIBLE_DEVICES:'assigned-device',NVIDIA_DRIVER_CAPABILITIES:'compute,utility',LD_PRELOAD:'/do-not-load/injected.so',RUNPOD_API_KEY:'provider-marker',GITHUB_TOKEN:'github-marker',COMPUTE_BACKUP_SECRET_ACCESS_KEY:'backup-marker'};
 const result=await runWorker({root,env:environment,client,clock:f.now,cleanup:async()=>{}});assert.equal(result.exitCode,1);
 const seen=JSON.parse(await fs.readFile(path.join(root,'.ai-runs/pilot/run/hosted-1.log'),'utf8'));
 for(const name of keys.slice(0,5))assert.equal(seen[name],environment[name]);for(const name of keys.slice(5))assert.equal(seen[name],null);
});
test('actual worker child receives the bound process session without logging it or accepting an ambient substitute',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-child-session-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await fixture();f.manifest.phases[0].device='cpu';f.manifest.phases[0].argv=[process.execPath,'-e',`process.exit(process.env.COMPUTE_STARTUP_SESSION==='${'a'.repeat(32)}'?17:18)`];
 await f.launch();await fs.writeFile(path.join(root,'.compute-source.json'),JSON.stringify({sourceRevision:f.manifest.sourceRevision,dependencySha256:f.manifest.dependencySha256}));
 const client={startupSessionId:'a'.repeat(32),json:async(action,body)=>action==='work'?f.core.work('pilot',1):action==='heartbeat'?f.core.heartbeat('pilot',1,body):action==='progress'?f.core.progress('pilot',1,body):action==='finish'?f.core.finish('pilot',1,body):Promise.reject(Error('unexpected action')),
  upload:async raw=>f.core.putObject('pilot',{name:await sha256(raw),sha256:await sha256(raw),bytes:raw.length},raw,1),download:async a=>new Uint8Array(await (await f.bucket.get(`pilot/${a.sha256}`)).arrayBuffer())};
 const result=await runWorker({root,env:{PATH:process.env.PATH,HOME:root,COMPUTE_STARTUP_SESSION:'b'.repeat(32)},client,clock:f.now,cleanup:async()=>{}});
 assert.equal(result.exitCode,17);assert.equal(await fs.readFile(path.join(root,'.ai-runs/pilot/run/hosted-1.log'),'utf8'),'');
});
