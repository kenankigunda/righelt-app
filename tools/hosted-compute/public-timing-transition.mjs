// Controller-only authority for a new public cost workload. This is not a
// scientific admission or an amendment of the qualified fixture's image.
import {POLICY,assert,canonical,encode,sha256} from './policy.mjs';
import {readOperatorReceipt} from './manual-authority.mjs';
import {runtimeUpgradeEndpoint} from './runtime-upgrade.mjs';
import fixture from './fixture-contract.json' with {type:'json'};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const shape=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
export function publicTimingEndpoint(c){return {...runtimeUpgradeEndpoint(c),purpose:c.manifest.purpose,publicTiming:c.manifest.publicTiming};}
async function object(core,c,hash){
 const stored=await core.bucket.get(`${c.manifest.id}/${hash}`);assert(stored&&c.objects[hash],'qualification object missing');
 const raw=new Uint8Array(await stored.arrayBuffer());assert(raw.length===c.objects[hash].bytes&&await sha256(raw)===hash,'qualification object bytes differ');
 return JSON.parse(new TextDecoder().decode(raw));
}
export async function validatePublicTimingTransition(core,db,prior,c,intent){
 assert(db.actualSpendBasis&&intent.startup&&!intent.runtimeUpgrade&&c.manifest.purpose===POLICY.publicTiming.purpose,'public timing requires explicit actual funding and startup');
 const r=await readOperatorReceipt(core.externalControl(c.manifest).store,intent.publicTimingTransition);
 assert(shape(r,'schema,kind,scope,createdAt,expiresAt,prior,next,qualification,publicInputs,review,historicalDisposition')&&r.schema===1&&r.kind==='manual-public-timing-transition'&&r.scope==='public-original-incumbent-evaluation-cost','typed public timing transition required');
 assert(canonical(r.prior)===canonical(runtimeUpgradeEndpoint(prior))&&canonical(r.next)===canonical(publicTimingEndpoint(c)),'public timing transition endpoint differs');
 assert(c.manifest.sourceRevision!==prior.manifest.sourceRevision&&c.manifest.phases[0].host.image!==prior.manifest.phases[0].host.image,'public timing needs its reviewed new source and image');
 assert(Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.expiresAt)&&r.createdAt<=intent.createdAt&&intent.createdAt-r.createdAt<=POLICY.startupMs&&r.expiresAt>=intent.expiresAt&&r.expiresAt-r.createdAt<=POLICY.startupMs&&core.now()<r.expiresAt,'public timing transition expired');
 const t=c.manifest.publicTiming;
 assert(canonical(r.publicInputs)===canonical({modelSha256:t.modelSha256,profilesSha256:t.profilesSha256,planSha256:t.planSha256,seed:c.manifest.seed}),'public timing reviewed inputs differ');
 assert(shape(r.review,'sourceRevision,proofInventorySha256,localEvidenceSha256,independentReviewSha256,qualificationReviewSha256')&&r.review.sourceRevision===c.manifest.sourceRevision&&Object.entries(r.review).filter(([key])=>key!=='sourceRevision').every(([,v])=>hex(v))&&r.historicalDisposition==='preserve-all-prior-failures-and-unknown-ownership','public timing independent review missing');
 const plan=await object(core,c,t.planSha256),recipe=await object(core,c,c.manifest.executionRecipeSha256),phase=c.manifest.phases[0];
 const model=c.manifest.inputs.find(a=>a.role==='public-incumbent-model');
 assert(shape(plan,'schema,kind,purpose,model,profiles,schedule,qualifiedRuntimeSha256,accountingReserveSeconds')&&plan.schema===1&&plan.kind===POLICY.publicTiming.planKind&&plan.purpose===POLICY.publicTiming.purpose&&plan.qualifiedRuntimeSha256===t.qualifiedRuntimeSha256,'public timing actual plan differs');
 assert(shape(plan.model,'kind,id,path,sha256,bytes')&&plan.model.kind==='original-public-incumbent-onnx'&&plan.model.id===POLICY.publicTiming.incumbent.id&&plan.model.sha256===t.modelSha256&&plan.model.bytes===model.bytes&&plan.model.path===model.path&&await sha256(encode(canonical(plan.profiles)))===t.profilesSha256,'public timing actual original model or profiles differ');
 assert(Number.isFinite(plan.accountingReserveSeconds)&&plan.accountingReserveSeconds>0&&plan.accountingReserveSeconds<phase.seconds&&Array.isArray(plan.schedule)&&canonical(plan.schedule.map(j=>j.id))===canonical(phase.workIds),'public timing original work/reserve differs');
 for(const job of plan.schedule)assert(shape(job,'id,profile,referenceSeat,seed,gameSeconds,startKind,kind,startIdentity')&&Object.hasOwn(plan.profiles.profiles,job.profile)&&['P1','P2'].includes(job.referenceSeat)&&Number.isSafeInteger(job.seed)&&job.seed>=0&&job.seed<2**32&&Number.isFinite(job.gameSeconds)&&job.gameSeconds>0&&job.gameSeconds<=POLICY.publicTiming.maxGameSeconds&&job.startKind==='normal'&&job.kind==='normal','public timing actual schedule differs');
 assert(shape(recipe,'schema,kind,sourceRevision,dependencySha256,sourceInventorySha256,proofInventorySha256,producerSha256,planSha256,modelSha256,profilesSha256,qualifiedRuntimeSha256')&&recipe.schema===1&&recipe.kind===POLICY.publicTiming.recipeKind&&recipe.sourceRevision===c.manifest.sourceRevision&&recipe.dependencySha256===c.manifest.dependencySha256&&hex(recipe.sourceInventorySha256)&&recipe.proofInventorySha256===r.review.proofInventorySha256&&['producerSha256','planSha256','modelSha256','profilesSha256','qualifiedRuntimeSha256'].every(key=>recipe[key]===t[key]),'public timing actual recipe or image proof differs');
 const q=r.qualification;
 assert(shape(q,'campaignId,manifestSha256,resultSha256,runtimeArtifactSha256')&&[q.manifestSha256,q.resultSha256,q.runtimeArtifactSha256].every(hex),'exact public qualification reference required');
 const qualified=core.campaign(db,q.campaignId),qm=qualified.manifest;
 assert(qualified!==c&&qualified!==prior&&qualified.status==='complete'&&qualified.cleanupVerified===true&&qualified.manifestSha256===q.manifestSha256&&qm.purpose==='reliability-pilot'&&qm.mode==='supervised-qualification'&&qm.phases.length===1&&qm.phases[0].device==='cuda'&&qm.phases[0].kind==='rehearsal','completed cleaned public CUDA fixture required');
 assert(c.manifest.sourceRevision!==qm.sourceRevision&&c.manifest.phases[0].host.image!==qm.phases[0].host.image,'public timing cannot relabel the qualified fixture source or image');
 assert(Object.values(qualified.outputs).some(a=>a.sha256===q.resultSha256)&&qualified.files?.some(a=>a.sha256===q.runtimeArtifactSha256&&a.path===qm.phases[0].runDir+`/runtime-${qualified.generation}.json`),'qualification result or runtime membership differs');
 const result=await object(core,qualified,q.resultSha256);
 // The completed durable controller state already crossed verifyResult. Read
 // the exact small result/runtime bindings, without rerunning models or games.
 assert(result.schema===1&&result.kind==='compute-result'&&result.disposition==='complete'&&canonical(result.completedWorkIds)===canonical(fixture.workIds)&&result.execution?.manifestSha256===q.manifestSha256&&Number.isSafeInteger(result.updates)&&result.updates>0&&Number.isFinite(result.parameterDelta)&&result.parameterDelta>0,'qualified public fixture completion differs');
 const runtime=await object(core,qualified,q.runtimeArtifactSha256);
 assert(runtime.runtimeSha256===t.qualifiedRuntimeSha256&&runtime.record?.kernelPassed===true&&await sha256(encode(canonical(runtime.record)))===t.qualifiedRuntimeSha256,'qualified public runtime differs');
 for(const key of ['gpu','dataCenterId','minVcpu','minRamGb','diskGb','minCudaVersion'])assert(canonical(c.manifest.phases[0].host[key])===canonical(qm.phases[0].host[key]),'public timing cohort differs');
 assert(c.manifest.dependencySha256===qm.dependencySha256&&c.manifest.dependencySha256===prior.manifest.dependencySha256&&c.manifest.seed===prior.manifest.seed,'public timing dependencies or program seed differ');
 return {sha256:intent.publicTimingTransition.sha256};
}
