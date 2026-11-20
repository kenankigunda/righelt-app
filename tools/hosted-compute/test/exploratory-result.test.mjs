import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExploratoryResult} from '../exploratory-result.mjs';
import {encode,canonical,sha256} from '../policy.mjs';
import {TRAINING_STOP,ARTIFACT_DEADLINE} from '../exploratory-policy.mjs';

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
 change({report,numeric,runner,state});
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
test('sealed mismatch, unwitnessed dose and invalid update cannot qualify a self-consistent artifact bundle',async()=>{
 const f=await resultFixture();f.options.sealedEndpoint.checkpointSha256='f'.repeat(64);
 await assert.rejects(verifyExploratoryResult(f.result,f.options),/sealed endpoint/);
 for(const change of [({report})=>report.learning.freshPolicySamples=2,
  ({state})=>state.freshTraining.batches[0].parameterDelta=0,
  ({state})=>state.freshTraining.batches[0].policyExamples=[]]){
  const g=await resultFixture(change);await assert.rejects(verifyExploratoryResult(g.result,g.options));
 }
});
