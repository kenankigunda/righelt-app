import {assert,canonical,encode,sha256} from './policy.mjs';
import {TRAINING_STOP,ARTIFACT_DEADLINE,EXPLORATORY_PURPOSE} from './exploratory-policy.mjs';
export const currentSealedEndpoint=c=>c.manifest.purpose===EXPLORATORY_PURPOSE&&c.sealedEndpoint?.generation===c.generation&&c.sealedEndpoint.phaseIndex===c.phase;
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
export async function verifyExploratoryResult(result,{manifest,phase,read,sealedEndpoint}){
 assert(result.qualified===true&&result.strengthEstablished===false&&result.defaultPromotion===false&&canonical(result.completedWorkIds)===canonical(phase.workIds),'exploratory result scope/work differs');
 const artifacts=new Map();
 for(const a of result.artifacts??[]){
  assert(typeof a.path==='string'&&a.path.startsWith(phase.runDir+'/')&&!artifacts.has(a.role),'duplicate or foreign exploratory artifact');
  const raw=await read(a);assert(raw.length===a.bytes&&await sha256(raw)===a.sha256,'exploratory artifact bytes differ');
  artifacts.set(a.role,{record:a,raw});
 }
 for(const role of ['candidate-report','model','checkpoint','recovery-sidecar','checkpoint-metadata','numeric','runner-result'])assert(artifacts.has(role),'exploratory artifact missing: '+role);
 const report=decode(artifacts.get('candidate-report').raw),numeric=decode(artifacts.get('numeric').raw),
  sidecar=decode(artifacts.get('recovery-sidecar').raw),metadata=decode(artifacts.get('checkpoint-metadata').raw),runner=decode(artifacts.get('runner-result').raw);
 assert(report.schema===1&&report.kind==='exploratory-candidate'&&report.qualified===true&&report.sourceRevision===manifest.sourceRevision&&report.planSha256===manifest.exploratory.canonicalPlanSha256,'candidate source/plan qualification differs');
 assert(report.trainingStopWall===TRAINING_STOP/1000&&report.artifactDeadlineWall===ARTIFACT_DEADLINE/1000&&report.observedAt*1000<ARTIFACT_DEADLINE&&report.strengthEstablished===false&&report.defaultPromotion===false,'candidate deadline or promotion scope differs');
 assert(Number.isSafeInteger(report.updates)&&report.updates>0&&Number.isFinite(report.parameterDelta)&&report.parameterDelta>0&&report.learning?.freshExamplesUsed===true&&report.learning.freshPolicySamples>0&&report.learning.freshFiniteNonzeroUpdates>0,'no checkpoint-bound actual fresh-policy update');
 const cp=artifacts.get('checkpoint').record.sha256,model=artifacts.get('model').record.sha256;
 if(sealedEndpoint)assert(cp===sealedEndpoint.checkpointSha256&&artifacts.get('runner-result').record.sha256===sealedEndpoint.runnerResultSha256&&report.checkpoint?.updates===sealedEndpoint.updates,'completed candidate differs from sealed endpoint');
 assert(cp===report.checkpoint?.sha256&&model===report.modelSha256&&numeric.onnxSha256===model&&sidecar.checkpointSha256===cp&&metadata.sha256===cp,'candidate/recovery/model identities differ');
 assert(sidecar.schema===2&&canonical(sidecar.state)===canonical(runner.state)&&sidecar.state.updates===report.checkpoint.updates&&runner.status==='stopped'&&['validation-handoff','insufficient-generation-runway','budget-or-resource-stop'].includes(runner.reason),'sealed recovery cursor or stop reason differs');
 assert(numeric.schema===2&&numeric.referenceDevice==='cuda'&&numeric.numericPassed===true&&report.numericParityPassed===true&&report.recoveryPassed===true&&numeric.arithmetic?.policyApplied===true,'actual CUDA numeric/recovery proof missing');
 assert(report.learning.freshFiniteNonzeroUpdates===sidecar.state.freshTraining?.batches.length,'fresh witness history differs');
 const batches=sidecar.state.freshTraining.batches;
 assert(report.updates===sidecar.state.updates-sidecar.state.inheritedUpdates&&batches.length===report.updates,'new update cursor differs');
 let samples=0;
 for(const [index,batch]of batches.entries()){
  assert(batch.update===sidecar.state.inheritedUpdates+index+1&&['loss','policyLoss','valueLoss','gradientNorm','parameterDelta'].every(k=>Number.isFinite(batch[k]))&&batch.parameterDelta>0,'invalid checkpoint-retained finite update');
  assert(Array.isArray(batch.policyExamples)&&batch.freshPolicySampleCount===batch.policyExamples.length,'fresh sample count differs from retained witnesses');
  samples+=batch.policyExamples.length;
 }
 assert(samples===report.learning.freshPolicySamples&&samples>0,'candidate fresh-policy dose differs from checkpoint');
 return result;
}

export async function sealExploratoryEndpoint(core,id,generation,body){
 const db=await core.load(),c=core.campaign(db,id);core.fence(c,generation);
 assert(c.manifest.purpose===EXPLORATORY_PURPOSE&&c.snapshot?.generation===generation&&c.snapshot.phaseIndex===c.phase&&core.now()<ARTIFACT_DEADLINE,'current exploratory snapshot required');
 if(c.sealedEndpoint){assert(c.sealedEndpoint.checkpointSha256===body.checkpointSha256&&c.sealedEndpoint.snapshotId===body.snapshotId,'endpoint already sealed');return c.sealedEndpoint;}
 assert(body.snapshotId===c.snapshot.id,'sealed snapshot identity differs');
 const phase=c.manifest.phases[c.phase];
 const load=async suffix=>{
  const a=c.snapshot.files.find(a=>a.path===phase.runDir+'/'+suffix);assert(a,'sealed snapshot component missing');
  const stored=await core.bucket.get(`${id}/${a.sha256}`);assert(stored,'sealed snapshot bytes missing');
  const raw=new Uint8Array(await stored.arrayBuffer());assert(raw.length===a.bytes&&await sha256(raw)===a.sha256,'sealed snapshot bytes changed');return {a,value:decode(raw)};
 };
 const latest=await load('latest.json'),report=await load('runner-result.json');
 assert(latest.value.sha256===body.checkpointSha256&&report.value.status==='stopped'&&report.value.state?.updates===latest.value.updates&&['validation-handoff','insufficient-generation-runway','budget-or-resource-stop'].includes(report.value.reason),'complete fixed endpoint required');
 assert(c.snapshot.files.some(a=>a.sha256===body.checkpointSha256&&a.path.endsWith('.pt')),'sealed checkpoint payload missing');
 c.sealedEndpoint={snapshotId:c.snapshot.id,checkpointSha256:body.checkpointSha256,latestSha256:latest.a.sha256,
  runnerResultSha256:report.a.sha256,updates:latest.value.updates,generation,phaseIndex:c.phase,sealedAt:core.now(),reason:report.value.reason};
 core.event(c,'exploratory-endpoint-sealed',{checkpointSha256:body.checkpointSha256});await core.save(db);return c.sealedEndpoint;
}
