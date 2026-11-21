import {isCloudRepair,validateCloudRepairWindow,CLOUD_REPAIR} from './cloud-repair-policy.mjs';
import {POLICY,assert,canonical} from './policy.mjs';
export const TRAINING_STOP=Date.UTC(2026,10,20,14),ARTIFACT_DEADLINE=Date.UTC(2026,10,20,16),LIABILITY_END=Date.UTC(2026,10,20,18);
export const EXPLORATORY_PURPOSE='bounded-exploratory-training';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateExploratoryManifest(m){
 const e=m.exploratory,p=m.phases[0],repair=isCloudRepair(m);
 if(repair){validateCloudRepairWindow(e);assert(m.checkpointSha256===CLOUD_REPAIR.checkpointSha256,'new repair input checkpoint differs');}
 const trainingStop=repair?e.trainingStop:TRAINING_STOP,artifactDeadline=repair?e.artifactDeadline:ARTIFACT_DEADLINE;
 assert(m.scientific===undefined&&m.developmentEvidence===undefined&&m.inputs.every(a=>a.role!=='protected-final'),'exploratory training cannot open scientific/final-data stages');
 assert((repair||e?.schema===1)&&e.trainingStop===trainingStop&&e.artifactDeadline===artifactDeadline&&m.deadline===artifactDeadline&&m.mode==='supervised-qualification'&&m.phases.length===1&&p.kind==='training'&&p.device==='cuda','one exact exploratory training phase required');
 assert(['planSha256','gateSha256','methodInputScopeSha256'].every(k=>hex(e[k])&&m.inputs.some(a=>a.sha256===e[k]))&&hex(e.canonicalPlanSha256),'bound exploratory plan/gate/scope required');
 assert(p.planSha256===e.planSha256&&p.outputs.length===1&&p.outputPaths[p.outputs[0]]===p.runDir+'/exploratory-result.json','exploratory result output differs');
 const plan=m.inputs.find(a=>a.sha256===e.planSha256),gate=m.inputs.find(a=>a.sha256===e.gateSha256);
 for(const argv of [p.argv,p.resumeArgv])assert(canonical(argv)===canonical(['tools/ai-trainer/.venv/bin/python','-m','righelt_training.exploratory_cloud','--plan',plan.path,'--gate-report',gate.path]),'exact admitted CUDA preflight/shared exploratory entry required');
 assert(canonical(p.expect[p.outputs[0]])===canonical({qualified:true,strengthEstablished:false,defaultPromotion:false}),'exploratory acceptance cannot claim strength/promotion');
 assert(Number.isSafeInteger(e.handoffAt)&&e.handoffAt<trainingStop&&Number.isSafeInteger(e.maxPublicationObjects)&&e.maxPublicationObjects>64&&e.maxPublicationObjects<=POLICY.maxArtifacts&&Number.isSafeInteger(e.maxPublicationBytes)&&e.maxPublicationBytes>=2*POLICY.maxObjectBytes,'predeclared finite artifact envelope required');
 assert(m.inputs.length+e.maxPublicationObjects<=POLICY.maxArtifacts,'inputs leave insufficient artifact inventory');
}
