// Controller-only authority for one new, prequalified finite public queue.
import {POLICY,assert,canonical,encode,sha256} from './policy.mjs';
import {readOperatorReceipt,MANUAL_PUBLIC_ADMISSION_END} from './manual-authority.mjs';
const shape=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
async function object(core,c,hash){
 const a=c.objects[hash],stored=await core.bucket.get(`${c.manifest.id}/${hash}`);assert(a&&stored,'public qualification object missing');
 const raw=new Uint8Array(await stored.arrayBuffer());assert(raw.length===a.bytes&&await sha256(raw)===hash,'public qualification bytes differ');return JSON.parse(new TextDecoder().decode(raw));
}
export async function publicWorkAuthority(core,db,c,intent,authority){
 const phase=c.manifest.phases[0];
 if(!intent.publicWorkAuthority){assert(c.manifest.purpose!==POLICY.publicTiming.purpose||phase.seconds<=POLICY.startupMs/1000,'long public work requires separate authority');return null;}
 assert(c.manifest.purpose===POLICY.publicTiming.purpose&&c.manifest.mode==='supervised-qualification'&&intent.publicTimingTransition&&intent.startup&&db.actualSpendBasis&&db.manualProgram,'finite public-only authority required');
 const r=await readOperatorReceipt(core.externalControl(c.manifest).store,intent.publicWorkAuthority),now=core.now();
 assert(shape(r,'schema,kind,id,createdAt,expiresAt,campaignId,manifestSha256,sourceRevision,publicTiming,phaseSeconds,admissionDeadline,executionDeadline,timingQualification,review,historicalDisposition')&&r.schema===1&&r.kind==='finite-public-work-authority'&&/^[a-f0-9]{32}$/.test(r.id),'typed finite public work authority required');
 assert(r.campaignId===c.manifest.id&&r.manifestSha256===c.manifestSha256&&r.sourceRevision===c.manifest.sourceRevision&&canonical(r.publicTiming)===canonical(c.manifest.publicTiming)&&r.phaseSeconds===phase.seconds,'finite public queue binding differs');
 assert(Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.expiresAt)&&r.createdAt<=intent.createdAt&&intent.createdAt-r.createdAt<=POLICY.startupMs&&r.expiresAt>=intent.expiresAt&&r.expiresAt-r.createdAt<=POLICY.startupMs&&now<r.expiresAt,'finite public authority expired');
 assert(Number.isSafeInteger(r.admissionDeadline)&&r.admissionDeadline<=MANUAL_PUBLIC_ADMISSION_END&&intent.expiresAt<=r.admissionDeadline&&intent.startup.deadline<=r.admissionDeadline&&now<r.admissionDeadline,'finite public admission cutoff differs');
 assert(Number.isSafeInteger(r.executionDeadline)&&r.executionDeadline>intent.startup.deadline&&r.executionDeadline<=Math.min(c.manifest.deadline,authority.cutoff,db.manualProgram.deadline)&&r.executionDeadline-intent.createdAt<=POLICY.campaignMs,'finite public execution cutoff differs');
 assert(shape(r.review,'localEvidenceSha256,independentReviewSha256,qualifiedTimingCostSha256')&&Object.values(r.review).every(hex)&&r.historicalDisposition==='preserve-all-prior-authorities-and-failures','finite public queue review missing');
 assert(phase.workIds.length*POLICY.publicTiming.artifactsPerWork+POLICY.publicTiming.baseArtifacts+Math.ceil(phase.seconds*1000/POLICY.snapshotEveryMs)<=POLICY.maxArtifacts,'finite public artifact/log envelope exceeded');
 const q=r.timingQualification;
 assert(shape(q,'campaignId,manifestSha256,resultSha256')&&hex(q.manifestSha256)&&hex(q.resultSha256),'actual short timing reference required');
 const prior=core.campaign(db,q.campaignId),m=prior.manifest;
 assert(prior!==c&&prior.status==='complete'&&prior.cleanupVerified===true&&prior.manifestSha256===q.manifestSha256&&m.purpose===POLICY.publicTiming.purpose&&m.sourceRevision===c.manifest.sourceRevision&&m.dependencySha256===c.manifest.dependencySha256&&m.phases[0].host.image===phase.host.image,'same-image completed short public timing required');
 for(const key of ['modelSha256','profilesSha256','producerSha256','qualifiedRuntimeSha256'])assert(m.publicTiming[key]===c.manifest.publicTiming[key],'short timing cohort/model/profile differs');
 assert(Object.values(prior.outputs).some(a=>a.sha256===q.resultSha256),'short timing output membership differs');
 const result=await object(core,prior,q.resultSha256),reportArtifact=result.artifacts?.find(a=>a.role==='report');
 assert(result.kind===POLICY.publicTiming.resultKind&&result.disposition==='complete'&&result.accountingComplete===true&&result.strengthEstablished===false&&result.scientificAdmission===false&&result.completedWorkIds?.length>0&&reportArtifact,'verified whole-game timing required');
 const report=await object(core,prior,reportArtifact.sha256);
 assert(report.kind===POLICY.publicTiming.reportKind&&report.timingCoverageComplete===true&&report.completedWholeGameMs?.length>0&&report.completedWholeGameMs.every(ms=>Number.isFinite(ms)&&ms>0),'usable original whole-game timing required');
 return {receiptSha256:intent.publicWorkAuthority.sha256,admissionDeadline:r.admissionDeadline,executionDeadline:r.executionDeadline,phaseSeconds:r.phaseSeconds,timingQualification:structuredClone(q)};
}
