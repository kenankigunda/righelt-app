import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExploratoryResult,sealExploratoryEndpoint} from '../exploratory-result.mjs';
import {CLOUD_REPAIR as P} from '../cloud-repair-policy.mjs';
import {encode,canonical,sha256} from '../policy.mjs';
import {TRAINING_STOP,ARTIFACT_DEADLINE,EXPLORATORY_PURPOSE} from '../exploratory-policy.mjs';

async function resultFixture(change=()=>{}){
 const phase={runDir:'.ai-runs/candidate',workIds:['one-candidate']},sourceRevision='a'.repeat(40);
 const manifest={sourceRevision,exploratory:{canonicalPlanSha256:'b'.repeat(64)}};
 const model=encode('independent model bytes'),checkpoint=encode('independent checkpoint bytes'),cp=await sha256(checkpoint),modelHash=await sha256(model);
 const state={updates:12,inheritedUpdates:11,freshTraining:{batches:[{update:12,loss:1,policyLoss:1,valueLoss:0,gradientNorm:.2,parameterDelta:.3,
  policyExamples:[{gameId:'fresh-1',positionId:'fresh-1:0'}],freshPolicySampleCount:1}]}};
 const report={schema:1,kind:'exploratory-candidate',qualified:true,sourceRevision,planSha256:'b'.repeat(64),
  trainingStopWall:TRAINING_STOP/1000,artifactDeadlineWall:ARTIFACT_DEADLINE/1000,observedAt:TRAINING_STOP/1000,
  strengthEstablished:false,defaultPromotion:false,updates:1,parameterDelta:.3,
  learning:{freshExamplesUsed:true,freshPolicySamples:1,freshFiniteNonzeroUpdates:1,freshTerminalGames:0,freshValueExamples:0},
  checkpoint:{sha256:cp,updates:12},modelSha256:modelHash,numericParityPassed:true,recoveryPassed:true};
 const numeric={schema:2,referenceDevice:'cuda',numericPassed:true,onnxSha256:modelHash,arithmetic:{policyApplied:true}};
 const runner={status:'stopped',reason:'validation-handoff',state};
 change({report,numeric,runner,state,manifest});
 const rawByRole={model,checkpoint,'candidate-report':encode(canonical(report)),numeric:encode(canonical(numeric)),
  'runner-result':encode(canonical(runner)),'recovery-sidecar':encode(canonical({schema:2,checkpointSha256:cp,state})),
  'checkpoint-metadata':encode(canonical({sha256:cp}))};
 const artifacts=[],raws=new Map();
 for(const [role,raw]of Object.entries(rawByRole)){
  const a={name:role,path:phase.runDir+'/'+role,role,sha256:await sha256(raw),bytes:raw.length};artifacts.push(a);raws.set(a.sha256,raw);
 }
 const result={qualified:true,strengthEstablished:false,defaultPromotion:false,completedWorkIds:phase.workIds,artifacts};
 const sealedEndpoint={checkpointSha256:cp,runnerResultSha256:artifacts.find(a=>a.role==='runner-result').sha256,updates:12};
 const options={manifest,phase,sealedEndpoint,read:async a=>raws.get(a.sha256)};
 return {result,options};
}
test('actual fresh-policy-only candidate may complete without terminal labels while bound to sealed endpoint',async()=>{
 const f=await resultFixture();await verifyExploratoryResult(f.result,f.options);
});

test('early cloud stop with millisecond precision shortens the candidate artifact window',async()=>{
 const stopped=P.repairStartedAt+1200123,deadline=stopped+7200000;
 const change=({report,runner,manifest})=>{
  manifest.exploratory={...manifest.exploratory,schema:2,episodeId:P.id,trainingStop:P.repairStartedAt+36000000,artifactDeadline:P.repairStartedAt+43200000};
  runner.trainingStoppedAtMs=stopped;report.trainingStoppedAtMs=stopped;
  report.trainingStopWall=manifest.exploratory.trainingStop/1000;report.artifactDeadlineWall=deadline/1000;report.observedAt=(deadline-1)/1000;
 };
 const f=await resultFixture(change);await verifyExploratoryResult(f.result,f.options);
 for(const invalid of [({report})=>report.observedAt=deadline/1000,({report})=>report.artifactDeadlineWall=P.repairStartedAt/1000+43200,
  ({runner})=>runner.trainingStoppedAtMs=stopped+.5]){
  const g=await resultFixture(v=>{change(v);invalid(v);});await assert.rejects(verifyExploratoryResult(g.result,g.options));
 }
});

test('sealing the actual early endpoint fences delivery at two hours and refuses late sealing',async()=>{
 const stopped=P.repairStartedAt+1200123,deadline=stopped+7200000,checkpoint='d'.repeat(64),runDir='.ai-runs/repair';
 async function fixture(now){
  const files=[],objects=new Map();
  for(const [name,value]of [['latest.json',{sha256:checkpoint,updates:12}],['runner-result.json',{status:'stopped',reason:'validation-handoff',state:{updates:12},trainingStoppedAtMs:stopped}]]){
   const raw=encode(canonical(value)),digest=await sha256(raw);files.push({path:runDir+'/'+name,sha256:digest,bytes:raw.length});objects.set('repair/'+digest,{arrayBuffer:async()=>raw});
  }
  files.push({path:runDir+'/checkpoint.pt',sha256:checkpoint});
  const c={manifest:{purpose:EXPLORATORY_PURPOSE,exploratory:{schema:2,episodeId:P.id,trainingStop:P.repairStartedAt+36000000,artifactDeadline:P.repairStartedAt+43200000},phases:[{runDir}]},generation:1,phase:0,
   snapshot:{id:'snapshot',generation:1,phaseIndex:0,files},phaseDeadline:P.repairStartedAt+43200000,manual:{attached:{acceptedAt:P.repairStartedAt},campaignDeadline:P.repairStartedAt+43200000}};
  let saves=0;const core={load:async()=>({c}),campaign:db=>db.c,fence:(record,g)=>assert.equal(record.generation,g),now:()=>now,bucket:{get:async key=>objects.get(key)},event:()=>{},save:async()=>saves++};
  return {c,core,saves:()=>saves};
 }
 const f=await fixture(stopped+1),sealed=await sealExploratoryEndpoint(f.core,'repair',1,{snapshotId:'snapshot',checkpointSha256:checkpoint});
 assert.equal(sealed.artifactDeadline,deadline);assert.equal(f.c.phaseDeadline,deadline);assert.equal(f.c.manual.campaignDeadline,deadline);assert.equal(f.saves(),1);
 const late=await fixture(deadline);await assert.rejects(sealExploratoryEndpoint(late.core,'repair',1,{snapshotId:'snapshot',checkpointSha256:checkpoint}),/deadline expired/);assert.equal(late.saves(),0);
});
test('sealed mismatch, unwitnessed dose and invalid update cannot qualify a self-consistent artifact bundle',async()=>{
 const f=await resultFixture();f.options.sealedEndpoint.checkpointSha256='f'.repeat(64);
 await assert.rejects(verifyExploratoryResult(f.result,f.options),/sealed endpoint/);
 for(const change of [({report})=>report.learning.freshPolicySamples=2,
  ({state})=>state.freshTraining.batches[0].parameterDelta=0,
  ({state})=>state.freshTraining.batches[0].policyExamples=[]]){
  const g=await resultFixture(change);await assert.rejects(verifyExploratoryResult(g.result,g.options));
 }
});
