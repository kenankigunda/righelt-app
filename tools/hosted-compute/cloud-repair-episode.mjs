// New repair authority has its own ledger. Historical authorities never reopen.
import {CLOUD_REPAIR,CLOUD_LAUNCH,CLOUD_REPLACEMENT,isProspectiveLaunch,admissionWindow,isCloudRepair,exploratoryWindowFor,validateCloudRepairWindow} from './cloud-repair-policy.mjs';
export {CLOUD_REPAIR,isCloudRepair,exploratoryWindowFor,validateCloudRepairWindow} from './cloud-repair-policy.mjs';
import {assert,canonical,encode,sha256} from './policy.mjs';
import {readOperatorReceipt,sameReference} from './manual-authority.mjs';
import {effectiveRefusal} from './refusal-state.mjs';
import {spendBinding} from './actual-spend.mjs';
export async function cloudRepairAuthority(core,db,c,intent){
 const e=c.manifest.exploratory;validateCloudRepairWindow(e);
 const launch=isProspectiveLaunch(e),admission=admissionWindow(e);
 assert(launch?intent.exploratoryLaunch===e.launchAuthorityId:intent.exploratoryLaunch===undefined,'launch intent and manifest differ');
 assert(e.allocationStart<=intent.createdAt,'allocation lower bound exceeds intent start');
 assert(e.trainingStop<=intent.createdAt+CLOUD_REPAIR.maximumAllocationMs,'new repair allocation exceeds twelve hours');
 assert(intent.exploratoryEpisode===CLOUD_REPAIR.id,'new episode intent binding required');
 const r=await readOperatorReceipt(core.externalControl(c.manifest).store,intent.exploratoryWindow),now=core.now();
 assert(r.schema===(launch?3:2)&&r.kind==='bounded-exploratory-training-window'&&r.id===CLOUD_REPAIR.id&&r.preserveHistoricalAuthorities===true&&r.maximumCreates===CLOUD_REPAIR.maximumCreates,'new repair authority differs');
 assert(r.repairStartedAt===CLOUD_REPAIR.repairStartedAt&&r.admissionDeadline===admission.end&&r.maximumAllocationMs===CLOUD_REPAIR.maximumAllocationMs&&r.artifactAfterTrainingMs===CLOUD_REPAIR.artifactAfterTrainingMs&&r.maximumSameAllocationResumes===0,'new repair limits differ');
 if(launch)assert(r.launchAuthorityId===e.launchAuthorityId&&r.launchAuthorizedAt===admission.start&&r.repairDeadline===CLOUD_REPAIR.repairDeadline&&r.additionalRepairMs===0,'prospective launch cannot renew repair allowance');
 if(e.launchAuthorityId===CLOUD_REPLACEMENT.id){
  assert(r.repairReadyAt===admission.start&&r.repairReadyProofSha256===e.repairReadyProof.sha256&&r.consumedWorkTransferSha256===e.consumedWorkTransfer.sha256&&r.memoryScope===CLOUD_REPLACEMENT.memoryScope&&r.maximumReplacementOrdinal===2&&r.maximumAdditionalCreates===1,'replacement scope differs');
  const descriptor=c.manifest.inputs.find(a=>a.sha256===e.repairReadyProof.sha256&&a.path===e.repairReadyProof.path);
  assert(descriptor,'replacement ready proof is not an admitted input');
  const stored=await core.bucket.get(`${c.manifest.id}/${descriptor.sha256}`);assert(stored,'replacement ready proof missing');
  const raw=new Uint8Array(await stored.arrayBuffer());assert(raw.length===descriptor.bytes&&await sha256(raw)===descriptor.sha256,'replacement ready proof bytes differ');
  const ready=JSON.parse(new TextDecoder().decode(raw));
  assert(ready.kind==='bounded-repair-ready'&&ready.authorityId===CLOUD_REPLACEMENT.id&&ready.sourceRevision===c.manifest.sourceRevision&&ready.image===c.manifest.phases[0].host.image&&ready.repairReadyAt===admission.start&&['checksPassed','reviewPassed','imageVerified'].every(k=>ready[k]===true),'actual replacement source/image readiness missing');
 }
 assert(now>=admission.start&&now<r.admissionDeadline&&Number.isSafeInteger(r.createdAt)&&r.createdAt>=admission.start&&r.createdAt<=now,'new repair admission expired');
 assert(r.allocationStart===e.allocationStart&&r.trainingStop===e.trainingStop&&r.artifactDeadline===e.artifactDeadline&&r.liabilityUntil===intent.liabilityUntil&&r.liabilityUntil===r.artifactDeadline+7200000,'new episode absolute clocks differ');
 assert(intent.repairDeadline===r.admissionDeadline&&intent.repairMaxCents===r.repairMaxCents&&r.repairMaxCents<=CLOUD_REPAIR.maximumRepairCents&&r.repairMaxCents<=core.config.authorizedCents,'new repair cash ceiling differs');
 for(const [key,value]of Object.entries({accountId:intent.accountId,sourceRevision:c.manifest.sourceRevision,seed:c.manifest.seed,executionRecipeSha256:c.manifest.executionRecipeSha256,recipeSha256:c.manifest.recipeSha256,dataSha256:c.manifest.corpusSha256}))assert(r[key]===value,'new repair source/method/account differs');
 assert(r.accountId===db.actualSpendBasis.accountId&&/^[a-f0-9]{64}$/.test(r.reviewSha256)&&Number.isSafeInteger(r.lagContingencyCents)&&r.lagContingencyCents>=0&&r.lagContingencyCents<=r.repairMaxCents,'new repair review/funding evidence missing');
 assert(intent.expiresAt<=r.admissionDeadline&&intent.startup.deadline<=r.admissionDeadline&&e.handoffAt>now,'new repair startup or useful runway expired');
 const episode=db.exploratoryEpisodes?.[CLOUD_REPAIR.id],window=exploratoryWindowFor(db,c);
 if(e.launchAuthorityId===CLOUD_REPLACEMENT.id){
  assert(episode?.creates[0]?.campaignId===CLOUD_REPLACEMENT.consumedCampaignId,'replacement requires the closed P3 consumed attempt');
  assert(episode.creates.length===1||episode.creates.length===2&&episode.creates[1].campaignId===c.manifest.id,'only replacement ordinal two is authorized');
 }
 if(window){
  assert(sameReference(window.reference,intent.exploratoryWindow)&&canonical(window.authority)===canonical(r),'new episode already bound');
 }else assert(r.ledgerSha256===(await spendBinding(db)).ledgerSha256,'new episode actual ledger changed');
 if(episode){
  const existing=episode.creates.find(x=>x.campaignId===c.manifest.id);
  if(existing)assert(existing.manifestSha256===c.manifestSha256,'new episode create identity changed');
  else{
   assert(episode.creates.length<CLOUD_REPAIR.maximumCreates,'new episode create allowances consumed');
   for(const used of episode.creates){const prior=core.campaign(db,used.campaignId),a=prior.attempts.at(-1);
    assert(effectiveRefusal(db,prior)||prior.cleanupVerified===true&&Number.isSafeInteger(a?.endedAt)&&a.uncertain===false,'uncertain or unclosed new episode attempt blocks replacement');}
  }
 }
 return {authority:r,reference:intent.exploratoryWindow,publicWork:{schema:1,kind:'bounded-exploratory-training',receiptSha256:intent.exploratoryWindow.sha256,admissionDeadline:r.admissionDeadline,executionDeadline:r.artifactDeadline}};
}
export function consumeCloudRepairCreate(core,db,c,intent,window,intentSha256){
 db.exploratoryEpisodes??={};
 const episode=db.exploratoryEpisodes[CLOUD_REPAIR.id]??={schema:2,reference:structuredClone(window.reference),authority:structuredClone(window.authority),creates:[]};
 if(isProspectiveLaunch(c.manifest.exploratory)){
  episode.scheduleAuthorities??={};
  const key=c.manifest.exploratory.launchAuthorityId;
  const schedule={reference:structuredClone(window.reference),authority:structuredClone(window.authority)},prior=episode.scheduleAuthorities[key];
  assert(!prior||canonical(prior)===canonical(schedule),'prospective launch schedule already bound');
  episode.scheduleAuthorities[key]??=schedule;
 }
 if(c.manifest.exploratory.launchAuthorityId===CLOUD_REPLACEMENT.id)assert(episode.creates.length===1,'only replacement ordinal two is authorized');
 assert(episode.creates.length<CLOUD_REPAIR.maximumCreates&&!episode.creates.some(x=>x.campaignId===c.manifest.id),'new episode dispatch allowance consumed');
 episode.creates.push({campaignId:c.manifest.id,manifestSha256:c.manifestSha256,intentSha256,window:structuredClone(window.reference),consumedAt:core.now()});
}
