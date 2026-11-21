import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitForDocker} from './docker-readiness.mjs';

// No Torch, model, private games, pressure generator, or provider is involved.
test('actual namespaced Linux container reads its workload limits and raw pressure',async t=>{
 const execute=promisify(execFile);
 try{await waitForDocker(execute);}catch(error){
  if(process.env.RIGHELT_REQUIRE_NATIVE_HOSTED_PROOF==='1')throw error;
  t.skip('Docker unavailable locally; actual container proof is mandatory in native CI');return;
 }
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 const image='python:3.14-slim-bookworm@sha256:1faf2343e747208b2a36e5f2b5ff908ec3b2d0078a6a7bfe73b535698fe83909';
 const code=`import json,sys\nfrom pathlib import Path\nsys.path.insert(0,'/proof/tools/ai-trainer')\nfrom righelt_training.linux_memory import MemoryReader\nm=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())\na=int(m['MemAvailable'].split()[0])*1024\nr=MemoryReader().sample(a)\nassert r['scope']=='cgroup-v2-v1'\nassert 0<=r['effectiveAvailable']<=256*1024*1024\nassert r['levels'][0]['max']==256*1024*1024\nassert r['levels'][0]['raw']['memory.pressure']\nprint(json.dumps({'scope':r['scope'],'membership':r['membership'],'mountRoot':r['mountRoot'],'effectiveAvailable':r['effectiveAvailable'],'workloadPressure':r['workloadPressure']}))`;
 const result=await execute('docker',['run','--rm','--network','none','--cgroupns=private','--memory','256m','--memory-swap','256m','-v',`${root}:/proof:ro`,image,'python','-c',code],{timeout:120000,maxBuffer:1024*1024});
 const observed=JSON.parse(result.stdout);assert.equal(observed.scope,'cgroup-v2-v1');
 assert(observed.effectiveAvailable<=268435456);
});
