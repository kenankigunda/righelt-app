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

test('unavailable model preserves honest unstarted accounting but never inferred work',async t=>{
 const f=await synthetic(t,{unavailable:true});await f.verify(f.result);
 assert.deepEqual(f.result.completedWorkIds,[]);assert.equal(f.result.scopeCoverageComplete,false);
 const attempt=f.result.artifacts.find(a=>a.role==='attempt'),original=JSON.parse(await f.read(attempt));
 for(const change of [a=>a.status='failed',a=>a.inferenceMs=1,a=>a.inferenceCalls={P1:1,P2:0},a=>a.timingComplete=true]){
  const value=structuredClone(original);change(value);const raw=encode(JSON.stringify(value)),hash=await sha256(raw),result=structuredClone(f.result);
  const descriptor=result.artifacts.find(a=>a.sha256===attempt.sha256);descriptor.sha256=hash;descriptor.name=hash;descriptor.bytes=raw.length;
  const proofDescriptor=result.artifacts.find(a=>a.role==='proof'),proof=JSON.parse(await f.read(proofDescriptor));proof.workReceipts.find(r=>r.evidenceSha256===attempt.sha256).evidenceSha256=hash;
  if(value.status!=='unstarted')proof.workReceipts.find(r=>r.evidenceSha256===hash).status=value.status;
  const proofRaw=encode(JSON.stringify(proof));proofDescriptor.sha256=await sha256(proofRaw);proofDescriptor.name=proofDescriptor.sha256;proofDescriptor.bytes=proofRaw.length;
  await assert.rejects(verifyResult(result,{manifest:f.manifest,manifestSha256:f.manifestSha256,phase:f.phase,generation:1,phaseDeadline:f.phaseDeadline,read:a=>a.path===attempt.path?raw:a.role==='proof'?proofRaw:f.read(a)}),/unavailable runtime/);
 }
});

test('expired original work budget crosses producer and verifier without loading or playing',async t=>{
 const f=await synthetic(t,{unavailable:'expired'});await f.verify(f.result);
 assert.deepEqual(f.result.completedWorkIds,[]);assert.equal(f.result.scopeCoverageComplete,false);
 const report=JSON.parse(await f.read(f.result.artifacts.find(a=>a.role==='report')));
 assert.deepEqual(report.inferenceCalls,{P1:0,P2:0});assert.equal(report.timingCoverageComplete,false);
 assert.equal(report.scopeCells.reduce((n,c)=>n+c.unstarted,0),6);
});

test('result rejects a rehashed timing report that its immutable proof did not bind',async t=>{
 const f=await synthetic(t),result=structuredClone(f.result),a=result.artifacts.find(a=>a.role==='report');
 const report=JSON.parse(await f.read(a));report.modelLoadMs=0;report.elapsedMs=0;
 const raw=encode(JSON.stringify(report));a.sha256=await sha256(raw);a.name=a.sha256;a.bytes=raw.length;
 await assert.rejects(verifyResult(result,{manifest:f.manifest,manifestSha256:f.manifestSha256,phase:f.phase,generation:1,phaseDeadline:f.phaseDeadline,read:b=>b.path===a.path?raw:f.read(b)}),/report differs from bound proof/);
});

test('result recomputes cost aggregates even when a changed report and proof are rehashed',async t=>{
 const f=await synthetic(t);
 for(const change of [r=>r.inferenceMs=123456,r=>r.unfinishedLowerBoundMs=[0]]){
  const result=structuredClone(f.result),a=result.artifacts.find(a=>a.role==='report'),p=result.artifacts.find(a=>a.role==='proof');
  const report=JSON.parse(await f.read(a));change(report);const raw=encode(JSON.stringify(report));a.sha256=await sha256(raw);a.name=a.sha256;a.bytes=raw.length;
  const proof=JSON.parse(await f.read(p));proof.reportSha256=a.sha256;const proofRaw=encode(JSON.stringify(proof));p.sha256=await sha256(proofRaw);p.name=p.sha256;p.bytes=proofRaw.length;
  await assert.rejects(verifyResult(result,{manifest:f.manifest,manifestSha256:f.manifestSha256,phase:f.phase,generation:1,phaseDeadline:f.phaseDeadline,read:b=>b.path===a.path?raw:b.path===p.path?proofRaw:f.read(b)}),/aggregate work cost differs/);
 }
});

test('expired recovery keeps all completed work and original measurements through the verifier',async t=>{
 const f=await synthetic(t,{unavailable:'recovery-expired'});await f.verify(f.result);
 assert.equal(f.result.execution.generation,2);assert.equal(f.result.completedWorkIds.length,6);
 const report=JSON.parse(await f.read(f.result.artifacts.find(a=>a.role==='report')));
 assert.deepEqual(report.inferenceCalls,{P1:6,P2:6});assert.equal(report.completedWholeGameMs.length,6);
 assert(report.completedWholeGameMs.every(ms=>ms>6000));
});
