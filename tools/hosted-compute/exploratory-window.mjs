import {isCloudRepair,cloudRepairAuthority,consumeCloudRepairCreate} from './cloud-repair-episode.mjs';
// One new authority, never an amendment of the historical manual program.
import {POLICY,assert,canonical,encode,sha256,safeName} from './policy.mjs';
import {readOperatorReceipt,sameReference} from './manual-authority.mjs';
import {spendBinding} from './actual-spend.mjs';
import {effectiveRefusal} from './refusal-state.mjs';
import {TRAINING_STOP,ARTIFACT_DEADLINE,LIABILITY_END,EXPLORATORY_PURPOSE} from './exploratory-policy.mjs';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export async function exploratoryAuthority(core,db,c,intent){
 assert(intent.exploratoryWindow&&c.manifest.purpose===EXPLORATORY_PURPOSE&&db.actualSpendBasis&&intent.startup,'typed actual-funded exploratory window required');
 if(isCloudRepair(c.manifest))return cloudRepairAuthority(core,db,c,intent);
 const r=await readOperatorReceipt(core.externalControl(c.manifest).store,intent.exploratoryWindow),now=core.now(),e=c.manifest.exploratory;
 assert(r.schema===1&&r.kind==='bounded-exploratory-training-window'&&r.id==='overnight-20261119'&&r.preserveHistoricalAuthorities===true&&r.maximumCreates===2,'exact new training window authority required');
 assert(r.trainingStop===TRAINING_STOP&&r.artifactDeadline===ARTIFACT_DEADLINE&&Number.isSafeInteger(r.liabilityUntil)&&r.liabilityUntil>=ARTIFACT_DEADLINE+7200000&&r.liabilityUntil<=LIABILITY_END,'exploratory absolute windows differ');
 assert(Number.isSafeInteger(r.createdAt)&&r.createdAt>=Date.UTC(2026,10,19)&&r.createdAt<=now&&Number.isSafeInteger(r.admissionDeadline)&&r.admissionDeadline>now&&r.admissionDeadline<=TRAINING_STOP-3600000,'new exploratory admission expired or lacks training runway');
 assert(r.accountId===intent.accountId&&r.accountId===db.actualSpendBasis.accountId&&r.sourceRevision===c.manifest.sourceRevision&&r.seed===c.manifest.seed&&r.executionRecipeSha256===c.manifest.executionRecipeSha256&&r.recipeSha256===c.manifest.recipeSha256&&r.dataSha256===c.manifest.corpusSha256,'exploratory source/method/data/account differs');
 assert(hex(r.reviewSha256)&&r.repairMaxCents===intent.repairMaxCents&&r.repairMaxCents<=10000&&r.repairMaxCents<=core.config.authorizedCents&&intent.repairDeadline===r.admissionDeadline&&intent.liabilityUntil===r.liabilityUntil,'new allowance/independent review differs');
 assert(Number.isSafeInteger(r.lagContingencyCents)&&r.lagContingencyCents>=0&&r.lagContingencyCents<=r.repairMaxCents&&e.handoffAt>=now+POLICY.startupMs+3600000,'lag contingency or useful training runway missing');
 assert(intent.publicTimingTransition===undefined&&intent.publicWorkAuthority===undefined&&intent.runtimeUpgrade===undefined&&c.manifest.mode==='supervised-qualification'&&e&&e.trainingStop===r.trainingStop&&e.artifactDeadline===r.artifactDeadline,'historical ladders cannot authorize exploratory training');
 assert(intent.createdAt<=now&&now<intent.expiresAt&&intent.expiresAt<=r.admissionDeadline&&intent.startup.deadline<=r.admissionDeadline,'exploratory intent/startup window differs');
 if(db.exploratoryWindow){
  const window=db.exploratoryWindow;
  assert(sameReference(window.reference,intent.exploratoryWindow)&&canonical(window.authority)===canonical(r),'exploratory window already bound');
  const existing=window.creates.find(x=>x.campaignId===c.manifest.id);
  if(existing)assert(existing.manifestSha256===c.manifestSha256,'exploratory create manifest changed');
  else{
   assert(window.creates.length===1,'two exploratory create allowances consumed');
   const first=core.campaign(db,window.creates[0].campaignId),a=first.attempts.at(-1);
   const noConsumedWork=Object.keys(first.claims??{}).length===0&&Object.keys(first.counters??{}).length===0
       &&Object.keys(first.outputs??{}).length===0&&!first.sealedEndpoint
       &&!first.snapshot?.files.some(f=>f.path===first.manifest.phases[0].runDir+'/latest.json');
   let cleanBeforeWork=noConsumedWork&&first.cleanupVerified===true&&Number.isSafeInteger(a?.endedAt)&&a?.resourceId&&!a.workStartedAt;
   if(!cleanBeforeWork&&first.cleanupVerified===true&&Number.isSafeInteger(a?.endedAt)&&a?.resourceId
       &&noConsumedWork){
    const artifact=first.files?.find(f=>f.path===first.manifest.phases[0].runDir+'/preflight-state.json');
    if(artifact){
     const stored=await core.bucket.get(`${first.manifest.id}/${artifact.sha256}`);
     assert(stored,'retained preflight disposition missing');const raw=new Uint8Array(await stored.arrayBuffer());
     assert(raw.length===artifact.bytes&&await sha256(raw)===artifact.sha256,'retained preflight disposition changed');
     const proof=JSON.parse(new TextDecoder().decode(raw));
     cleanBeforeWork=proof.schema===1&&proof.kind==='cloud-preflight-disposition'&&proof.status==='failed'&&proof.productiveWorkStarted===false
       &&proof.campaignId===first.manifest.id&&proof.generation===first.generation&&proof.sourceRevision===first.manifest.sourceRevision
       &&proof.planSha256===first.manifest.exploratory.canonicalPlanSha256;
    }
   }
   assert(effectiveRefusal(db,first)||cleanBeforeWork,'uncertain or attempted productive create blocks replacement');
   const old=first.manifest.phases[0].host,next=c.manifest.phases[0].host;
   assert(old.gpu!==next.gpu||old.dataCenterId!==next.dataCenterId,'replacement requires a different qualified placement');
  }
 }else assert(r.ledgerSha256===(await spendBinding(db)).ledgerSha256,'new exploratory window ledger changed');
 return {authority:r,reference:intent.exploratoryWindow,publicWork:{schema:1,kind:'bounded-exploratory-training',
  receiptSha256:intent.exploratoryWindow.sha256,admissionDeadline:r.admissionDeadline,executionDeadline:r.artifactDeadline}};
}
export function consumeExploratoryCreate(core,db,c,intent,window,intentSha256){
 if(isCloudRepair(c.manifest))return consumeCloudRepairCreate(core,db,c,intent,window,intentSha256);
 db.exploratoryWindow??={schema:1,reference:structuredClone(window.reference),authority:structuredClone(window.authority),
  originalManualProgram:structuredClone(db.manualProgram??null),creates:[]};
 assert(!db.exploratoryWindow.creates.some(x=>x.campaignId===c.manifest.id)&&db.exploratoryWindow.creates.length<2,'exploratory dispatch allowance already consumed');
 db.exploratoryWindow.creates.push({campaignId:c.manifest.id,manifestSha256:c.manifestSha256,intentSha256,
  window:structuredClone(window.reference),consumedAt:core.now()});
}

