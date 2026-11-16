import {assert,canonical,encode,sha256,POLICY} from './policy.mjs';
import {readOperatorReceipt,operatorAttemptBinding,sameReference} from './manual-authority.mjs';
import {spendBinding} from './actual-spend.mjs';
import {refusalHeld,latchRefusalContradiction} from './refusal-state.mjs';
const shape=(v,names)=>v&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// One independently reviewed historical refusal, not a general HTTP-400 rule.
export const CAPACITY_REFUSAL=Object.freeze({campaignId:'public-timing-20261116-1c3a839f',
 attemptSha256:'c939e25d440c481e08b451c5a282b04ce2ad5cd6c3b9b8ef375c2cad09cca4e7',
 outcomeSha256:'52e621dc834c1b9c40f074ae3a2c577f8d04d3c01765133464ee4dc7b87f8dad',
 bodySha256:'ef5e3eaa37cf3899e571b0f19298d18b81128c9a1328f599a9affce455e51ef6',
 contractRevision:'3ff535a35d23eef07c962830ba35978f561fe441',
 contractSha256:'27538a3a0f71f757af26af05bb83ac2988f1920ad87232692262250b4768958c',
 evidenceSha256:'bd043adbe0ba7c87f0a8fb099715855146c323bc810e33917d74e969ac9b540c',
 helperSnapshotSha256:'8c3ffcad10a33e966d88b46e1d3033b34784658e892692a44de18f5b9d43a24b',
 bootstrapSnapshotSha256:'e5867c15a2eaeae6e7bdc76148603f3e4dfaa1629295985108f7fcf37a2107c0',
 credentialBindingSha256:'fbdcd71dd2cb159f0a0a973f0bb615058ce0e2b73ac5a7fb05d2bb9d9edff322',
 manifestSha256:'e6805ccb4f3efec99ac60e89f8813f4eef1dfe3162692148d1ba22987dda9508',
 sourceRevision:'ea726e0f77594dde18563a3c82a99f6ff7a96664',
 contractUrl:'https://docs.runpod.io/api-reference-v2/pods/create-a-pod'});
async function journal(raw,expected){
 assert(typeof raw==='string'&&encode(raw).length<=8192&&await sha256(encode(raw))===expected,'native journal bytes differ');return JSON.parse(raw);
}
export async function providerRefusalBinding(core,id){
 const db=await core.load(),c=core.campaign(db,id),binding=await spendBinding(db);
 return {schema:1,kind:'provider-refusal-binding',ledgerSha256:binding.ledgerSha256,target:operatorAttemptBinding(c),
   applied:db.providerRefusalResolution?.campaignId===id?{receiptSha256:db.providerRefusalResolution.receiptSha256,held:refusalHeld(db,db.providerRefusalResolution)}:null};
}
export async function resolveProviderRefusal(core,id,reference){
 const db=await core.load(),c=core.campaign(db,id),prior=db.providerRefusalResolution;
 assert(id===CAPACITY_REFUSAL.campaignId,'only the reviewed capacity refusal may resolve');
 if(prior){
  assert(prior.campaignId===id&&sameReference(prior.reference,reference),'capacity refusal resolution already bound');
  const positive=db.actualSpendBasis?.activeResources.filter(r=>r.campaignId===id)??[];
  if(latchRefusalContradiction(core,db,c,{source:'actual-spend-replay',evidenceSha256:db.actualSpendBasis?.receiptSha256,resourceIds:positive.map(r=>r.id)}))await core.save(db);
  return {receiptSha256:prior.receiptSha256,resolved:!refusalHeld(db,prior),held:refusalHeld(db,prior),replayed:true};
 }
 const store=core.externalControl(c.manifest).store,r=await readOperatorReceipt(store,reference),now=core.now();
 assert(shape(r,'schema,kind,id,createdAt,expiresAt,ledgerSha256,programAcceptedAt,target,accountId,actualSpendBasisSha256,native,attestation,contract')&&r.schema===1&&r.kind==='operator-attested-capacity-refusal'&&/^[a-f0-9]{32}$/.test(r.id),'typed capacity refusal receipt required');
 assert(Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.expiresAt)&&r.createdAt<=now&&now<r.expiresAt&&r.expiresAt-r.createdAt<=900000,'capacity refusal receipt stale');
 assert(r.ledgerSha256===(await spendBinding(db)).ledgerSha256&&canonical(r.target)===canonical(operatorAttemptBinding(c))&&db.manualProgram?.acceptedAt===r.programAcceptedAt,'capacity refusal ledger or target differs');
 const a=c.attempts.at(-1),intent=c.manual?.intent,basis=db.actualSpendBasis;
 assert(c.manifest.purpose===POLICY.publicTiming.purpose&&c.generation===1&&c.attempts.length===1&&a?.manual===true&&a.uncertain===true&&c.status==='cleanup-uncertain'&&c.cleanupVerified===false,'capacity refusal requires the exact unresolved manual owner');
 assert(a.resourceId==null&&a.placement==null&&a.workStartedAt==null&&c.manual.attached==null&&c.manual.startupSession==null,'accepted Pod or worker evidence forbids refusal resolution');
 assert(basis&&basis.receiptSha256===r.actualSpendBasisSha256&&basis.accountId===r.accountId&&basis.observedAt<=r.createdAt&&now-basis.observedAt<=900000&&now<basis.validUntil&&!basis.activeResources.some(x=>x.campaignId===id),'fresh complete absent actual-resource basis required');
 const prearm=await store.readPrearm(c.manifest.externalControl),fence=await store.readFence(prearm.nonce,c.manifest.externalControl);
 assert(prearm.accountId===r.accountId&&a.prearmSha256===c.manifest.externalControl.sha256&&prearm.launches.some(l=>l.name===a.name)&&fence?.kind==='terminal'&&fence.prearmSha256===a.prearmSha256,'capacity refusal account, prearm or permanent fence differs');
 const n=r.native;
 assert(shape(n,'attemptJournalUtf8,outcomeJournalUtf8,responseBodyUtf8'),'exact native journals and reconstructed body required');
 const attempt=await journal(n.attemptJournalUtf8,CAPACITY_REFUSAL.attemptSha256),outcome=await journal(n.outcomeJournalUtf8,CAPACITY_REFUSAL.outcomeSha256);
 assert(shape(attempt,'acceptedAt,method,url,name,intentSha256,maximumAttempts,bootstrapSecretsExcluded')&&attempt.method==='POST'&&attempt.url==='https://api.runpod.io/v2/pods'&&attempt.maximumAttempts===1&&attempt.bootstrapSecretsExcluded===true,'single native dispatch journal differs');
 assert(attempt.name===a.name&&attempt.intentSha256===c.manual.intentSha256&&Number.isSafeInteger(attempt.acceptedAt)&&attempt.acceptedAt>=intent.createdAt&&attempt.acceptedAt<intent.expiresAt&&attempt.acceptedAt<a.cutoff,'native request identity or original clock differs');
 assert(shape(outcome,'outcome,httpStatus,acceptedAt,name,responseBodySha256,responseCategory,rawBodyRetained')&&outcome.outcome==='response-received'&&outcome.httpStatus===400&&outcome.acceptedAt===attempt.acceptedAt&&outcome.name===attempt.name&&outcome.responseBodySha256===CAPACITY_REFUSAL.bodySha256&&outcome.rawBodyRetained===false,'native refusal outcome differs');
 const body=await journal(n.responseBodyUtf8,CAPACITY_REFUSAL.bodySha256);
 assert(shape(body,'detail,status,title')&&body.status===400&&body.title==='Bad Request','capacity refusal body differs');
 const att=r.attestation;
 assert(shape(att,'kind,evidenceSha256,helperSnapshotSha256,bootstrapSnapshotSha256,manifestSha256,sourceRevision,requestBodySha256,redirectPolicy,timeoutMs,credentialBindingSha256')&&att.kind==='operator-reviewed-single-native-request'&&[att.evidenceSha256,att.helperSnapshotSha256,att.bootstrapSnapshotSha256,att.credentialBindingSha256].every(hex)&&att.manifestSha256===c.manifestSha256&&att.sourceRevision===c.manifest.sourceRevision&&att.requestBodySha256===null&&att.redirectPolicy==='error'&&att.timeoutMs===20000,'honest reviewed helper/bootstrap/account commitment required');
 assert(['evidenceSha256','helperSnapshotSha256','bootstrapSnapshotSha256','credentialBindingSha256','manifestSha256','sourceRevision'].every(k=>att[k]===CAPACITY_REFUSAL[k]),'reviewed historical evidence commitment differs');
 assert(canonical(r.contract)===canonical({url:CAPACITY_REFUSAL.contractUrl,revision:CAPACITY_REFUSAL.contractRevision,sha256:CAPACITY_REFUSAL.contractSha256}),'pinned provider refusal contract differs');
 assert(core.now()<r.expiresAt&&core.now()<basis.validUntil&&(await spendBinding(await core.load())).ledgerSha256===r.ledgerSha256,'capacity refusal evidence expired or ledger changed during validation');
 const resolution={schema:1,campaignId:id,receiptSha256:reference.sha256,reference:structuredClone(reference),appliedAt:core.now(),programAcceptedAt:r.programAcceptedAt,
   target:structuredClone(r.target),originalAttempt:structuredClone(a),originalStatus:c.status,originalCleanupVerified:c.cleanupVerified,
   allocationDisposition:'provider-capacity-refused',nativeBodySha256:CAPACITY_REFUSAL.bodySha256,actualSpendBasisSha256:r.actualSpendBasisSha256};
 db.providerRefusalResolution=resolution;
 // Current bookkeeping closes by explicit refusal evidence, not by an empty
 // scan. Keep the original uncertain attempt and all its clocks unchanged.
 c.status='cancelled';c.cleanupVerified=true;core.event(c,'provider-capacity-refusal-resolved',{receiptSha256:reference.sha256});
 await core.save(db);return {receiptSha256:reference.sha256,resolved:true,held:false};
}
