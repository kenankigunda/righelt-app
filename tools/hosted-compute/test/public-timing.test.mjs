import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture} from './helpers.mjs';
import {validateManifest,canonical,encode,sha256} from '../policy.mjs';
import {executionIdentity,verifyResult} from '../result.mjs';
const exec=promisify(execFile);
import {publicTimingFixture as synthetic} from './public-timing-fixture.mjs';
test('actual Python timing producer crosses the hosted result verifier without scientific placeholders',async t=>{
 const f=await synthetic(t);await f.verify(f.result);
 assert.equal(f.result.kind,'public-performance-timing-result');assert.equal(f.result.accountingComplete,true);assert.equal(f.result.strengthEstablished,false);
 assert.equal(f.result.completedWorkIds.length,6);assert.equal(f.result.scopeCoverageComplete,true);
 assert(!Object.hasOwn(f.result.execution,'scientific'));assert(!Object.hasOwn(f.result.execution,'inputCheckpointSha256'));assert(!Object.hasOwn(f.result.execution,'dataSha256'));
});
test('public timing result rejects changed model, missing work, false strength and altered proof bytes',async t=>{
 const f=await synthetic(t);
 for(const change of [r=>r.strengthEstablished=true,r=>r.accountedWorkIds.pop(),r=>r.execution.publicTiming.modelSha256='9'.repeat(64),r=>r.completedWorkIds.pop(),r=>r.scopeCoverageComplete=false]){
  const result=structuredClone(f.result);change(result);await assert.rejects(f.verify(result));
 }
 await assert.rejects(verifyResult(f.result,{manifest:f.manifest,manifestSha256:f.manifestSha256,phase:f.phase,generation:1,read:f.read,phaseDeadline:f.phaseDeadline+1}),/deadline or publication reserve/);
 const missing=structuredClone(f.result);missing.artifacts=missing.artifacts.filter(a=>a.role!=='measurements');await assert.rejects(f.verify(missing),/original timing measurement/);
 const proof=f.result.artifacts.find(a=>a.role==='proof');await fs.appendFile(path.join(f.root,proof.path),' ');await assert.rejects(f.verify(f.result),/artifact bytes differ/);
});
test('public manifest pins exact entrypoint and only three public inputs while preserving partial accounting',async t=>{
 const f=await synthetic(t);
 for(const change of [m=>m.inputs.push({...m.inputs[0],name:'private',path:'.ai-runs/private'}),m=>m.scientific={},m=>m.corpusSha256='a'.repeat(64),m=>m.phases[0].argv.push('--unbound'),m=>m.phases[0].expect.timing.scopeCoverageComplete=true,m=>m.phases[0].kind='training']){
  const m=structuredClone(f.manifest);change(m);assert.throws(()=>validateManifest(m));
 }
 await f.f.core.stage(f.manifest);await assert.rejects(f.f.core.start(f.manifest.id),/explicit manual funding/);
});
test('actual controller completes, retains and cleans a bound public timing accounting result',async t=>{
 const f=await synthetic(t),core=f.f.core,m=f.manifest;
 await core.stage(m);
 const db=await core.load(),c=db.campaigns[m.id];c.generation=1;c.status='running';c.phaseDeadline=f.phaseDeadline;
 c.attempts=[{provider:'runpod',resourceId:'owned-public',name:'owned-public',hourlyCents:100,startedAt:f.f.now(),workStartedAt:f.f.now(),leaseExpires:f.f.now()+120000,placement:{id:'owned-public'}}];await core.save(db);
 f.f.providers.resources.set('owned-public',{id:'owned-public',name:'owned-public',host:m.phases[0].host});
 const files=[];
 for(const a of f.result.artifacts){const bytes=await f.read(a);await core.putObject(m.id,a,bytes,1);files.push(a);}
 const raw=encode(JSON.stringify(f.result)),output={name:'timing',sha256:await sha256(raw),bytes:raw.length};await core.putObject(m.id,output,raw,1);files.push({...output,path:f.phase.outputPaths.timing});
 await core.finish(m.id,1,{kind:'complete',outputs:{timing:output},files});await core.reconcile();await core.reconcile();
 const final=(await core.load()).campaigns[m.id];assert.equal(final.status,'complete');assert.equal(final.cleanupVerified,true);assert.equal(f.f.providers.resources.size,0);assert.equal(final.outputs['public-timing/timing'].sha256,output.sha256);
});
