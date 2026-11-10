import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { executionIdentity, verifyResult } from '../result.mjs';
import { canonical, encode, sha256 } from '../policy.mjs';
import { bundlePreflight } from '../bundle.mjs';
test('stale successful evidence, wrong model and zero updates fail; durable original completion survives replacement', async () => {
  const f=await fixture(); await f.launch(); const complete=await f.completion();
  const a=complete.outputs.proof;
  const raw=await f.bucket.get(`pilot/${a.sha256}`); const result=JSON.parse(new TextDecoder().decode(raw.body));
  const opts={manifest:f.manifest,manifestSha256:await sha256(encode(canonical(f.manifest))),phase:f.manifest.phases[0],generation:1,rawSha256:a.sha256,
    read:async record=>(await f.bucket.get(`pilot/${record.sha256}`)).body};
  await verifyResult(result,opts);
  await assert.rejects(verifyResult({...result,execution:{...result.execution,campaign:'old-run'}},opts),/identity/);
  await assert.rejects(verifyResult({...result,updates:0},opts),/zero actual/);
  await assert.rejects(verifyResult({...result,artifacts:result.artifacts.map(a=>a.role==='model'?{...a,sha256:'0'.repeat(64)}:a)},opts));
  await assert.rejects(verifyResult(result,{...opts,generation:2}),/recovery chain/);
  await verifyResult(result,{...opts,generation:2,snapshot:{generation:1,phaseIndex:0,files:[a]}});
  await assert.rejects(verifyResult({...result,completedWorkIds:[]},opts),/scheduled/);
  await assert.rejects(f.core.finish('pilot',1,{kind:'complete',outputs:{proof:await f.upload()},files:[]}),/typed/);
});
test('projected whole-tree size and transfer must fit object/count and durability limits',()=>{
 const options={projectedFiles:10,projectedObjects:20,projectedBytes:10000,bytesPerSecond:1000,checkpointAgeMs:240000,copyMs:100,requestOverheadMs:10};
 assert(bundlePreflight([{bytes:100}],options).qualified);
 assert.throws(()=>bundlePreflight([{bytes:70*1024*1024}],options),/oversized/);
 assert.throws(()=>bundlePreflight([{bytes:100}],{...options,projectedFiles:2001}),/artifact count/);
 assert.throws(()=>bundlePreflight([{bytes:100}],{...options,bytesPerSecond:1}),/durability/);
 assert.throws(()=>bundlePreflight([{bytes:100}],{...options,projectedObjects:2001}),/object count/);
});

test('republishing a restored receipt retains original completion provenance', async()=>{
 const f=await fixture(); await f.launch(); const completion=await f.completion();
 const latest={...completion.outputs.proof,path:'.ai-runs/pilot/run/latest.json'};
 const files=[...completion.files,latest];
 await f.core.snapshot('pilot',1,{id:'first',capturedAt:f.now(),files});
 await f.core.finish('pilot',1,{kind:'infrastructure'});
 await f.core.reconcile(); await f.core.reconcile(); await f.core.reconcile();
 const state=await f.state(); assert.equal(state.generation,2);
 await f.core.heartbeat('pilot',2,{restoredSnapshotId:'first'});
 await f.core.snapshot('pilot',2,{id:'second',capturedAt:f.now(),files});
 const renewed=(await f.state()).snapshot;
 assert.equal(renewed.generation,2);
 assert.equal(renewed.files.find(a=>a.sha256===completion.outputs.proof.sha256).originGeneration,1);
 await f.core.finish('pilot',2,completion);
 assert.equal((await f.state()).nextStatus,'complete');
});

test('fixture builder rejects unqualified prepared seeds before constructing commands', async()=>{
 const {canaryManifest}=await import('../canary-manifest.mjs');
 assert.throws(()=>canaryManifest({prepared:{fixtureOnly:true,seed:108}}),/fixture seed/);
});
