import {isCloudRepair,exploratoryWindowFor,CLOUD_REPAIR} from './cloud-repair-policy.mjs';
// Historical resolutions and new episode dispatches retain separate limits.
// An HTTP status or empty inventory never grants this transition.
import {assert,canonical,encode,sha256} from './policy.mjs';
import {readOperatorReceipt,operatorAttemptBinding,sameReference} from './manual-authority.mjs';
import {spendBinding} from './actual-spend.mjs';
import {refusalFor,refusalHeld,latchRefusalContradiction} from './refusal-state.mjs';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const BODY='ef5e3eaa37cf3899e571b0f19298d18b81128c9a1328f599a9affce455e51ef6';
export const REFUSAL_899=Object.freeze({campaignId:'public-variation-20261116-89927452',
 attemptSha256:'527392ce5346d8e59a48bb8cb47041f1cce465f95e34e56d0fc87c06bd731716',
 outcomeSha256:'1c835fa4fb6ea4b363c3d55e9f81784d3bba4a6f50d361ed73aa0a33ccb82d4a',
 manifestSha256:'06d9f9342c0060f7afc7c77ca5704648d8da62f4bf4d58e35231970defc8a77e'});
async function journal(raw,expected){assert(typeof raw==='string'&&encode(raw).length<=8192&&await sha256(encode(raw))===expected,'reviewed native journal differs');return JSON.parse(raw);}
export async function resolveAdditionalRefusal(core,id,reference){
 const db=await core.load(),c=core.campaign(db,id),prior=refusalFor(db,c);
 if(prior){
  assert(sameReference(prior.reference,reference),'refusal resolution already bound');
  if(latchRefusalContradiction(core,db,c,{source:'actual-spend-replay',evidenceSha256:db.actualSpendBasis?.receiptSha256,
   resourceIds:db.actualSpendBasis?.activeResources.filter(r=>r.campaignId===id).map(r=>r.id)??[]}))await core.save(db);
  return {receiptSha256:prior.receiptSha256,resolved:!refusalHeld(db,prior),held:refusalHeld(db,prior),replayed:true};
 }
 const episode=isCloudRepair(c.manifest)?exploratoryWindowFor(db,c):null;
 const repairCreate=episode?.creates.find(row=>row.campaignId===id);
 const historical=id===REFUSAL_899.campaignId,first=db.exploratoryWindow?.creates?.[0];
 assert(isCloudRepair(c.manifest)?repairCreate:historical||first?.campaignId===id&&db.exploratoryWindow.creates.length===1,'only a recorded authorized create may resolve');
 const resolutions=Object.values(db.additionalProviderRefusalResolutions??{});
 assert(repairCreate?resolutions.filter(r=>r.episodeId===CLOUD_REPAIR.id).length<CLOUD_REPAIR.maximumCreates:resolutions.filter(r=>r.episodeId!==CLOUD_REPAIR.id).length<2,'additional refusal resolution allowance exhausted');
 const store=core.externalControl(c.manifest).store,r=await readOperatorReceipt(store,reference),now=core.now();
 assert(r.schema===1&&r.kind==='operator-attested-exact-capacity-refusal'&&Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.expiresAt)&&r.createdAt<=now&&now<r.expiresAt&&r.expiresAt-r.createdAt<=900000,'fresh typed exact refusal receipt required');
 const binding=await spendBinding(db),basis=db.actualSpendBasis,a=c.attempts.at(-1);
 assert(r.ledgerSha256===binding.ledgerSha256&&canonical(r.target)===canonical(operatorAttemptBinding(c)),'exact refusal ledger/target changed');
 assert(c.generation===1&&c.attempts.length===1&&a?.manual&&a.uncertain&&c.status==='cleanup-uncertain'&&c.cleanupVerified===false,
  'exact unresolved manual attempt required');
 assert(a.resourceId==null&&a.placement==null&&a.workStartedAt==null&&c.manual.attached==null&&c.manual.startupSession==null,'accepted resource forbids refusal resolution');
 assert(basis&&basis.receiptSha256===r.actualSpendBasisSha256&&basis.accountId===r.accountId&&now-basis.observedAt<=900000&&basis.observedAt<=r.createdAt&&now<basis.validUntil&&!basis.activeResources.some(x=>x.campaignId===id),'fresh absent actual-resource basis required');
 const prearm=await store.readPrearm(c.manifest.externalControl),fence=await store.readFence(prearm.nonce,c.manifest.externalControl);
 assert(prearm.accountId===r.accountId&&a.prearmSha256===c.manifest.externalControl.sha256&&prearm.launches.some(l=>l.name===a.name)&&fence?.kind==='terminal'&&fence.prearmSha256===a.prearmSha256,'permanent exact terminal fence required');
 const review=await readOperatorReceipt(store,r.review);
 assert(review.schema===1&&review.kind==='independently-reviewed-exact-capacity-refusal'&&review.campaignId===id&&review.manifestSha256===c.manifestSha256&&review.sourceRevision===c.manifest.sourceRevision&&review.accountId===r.accountId&&review.intentSha256===c.manual.intentSha256,'independent reviewed request binding required');
 assert(['attemptSha256','outcomeSha256','helperSnapshotSha256','bootstrapSnapshotSha256','credentialBindingSha256','evidenceSha256'].every(k=>hex(review[k]))&&review.responseBodySha256===BODY&&review.redirectPolicy==='error'&&review.maximumAttempts===1,'complete reviewed dispatch/evidence commitments required');
 if(historical)assert(review.attemptSha256===REFUSAL_899.attemptSha256&&review.outcomeSha256===REFUSAL_899.outcomeSha256&&c.manifestSha256===REFUSAL_899.manifestSha256,'retained899 journals or manifest differ');
 else if(repairCreate)assert(repairCreate.intentSha256===c.manual.intentSha256&&sameReference(repairCreate.window,r.window),'new episode refusal belongs to another create/window');
 else assert(first.intentSha256===c.manual.intentSha256&&sameReference(first.window,r.window),'fresh refusal belongs to another create/window');
 const attempt=await journal(r.native?.attemptJournalUtf8,review.attemptSha256),outcome=await journal(r.native?.outcomeJournalUtf8,review.outcomeSha256);
 const body=await journal(r.native?.responseBodyUtf8,BODY);
 assert(body.status===400&&body.title==='Bad Request'&&body.detail==='There are no longer any instances available with the requested specifications. Please refresh and try again.','exact capacity refusal body required');
 assert(attempt.method==='POST'&&attempt.url==='https://api.runpod.io/v2/pods'&&attempt.maximumAttempts===1&&attempt.bootstrapSecretsExcluded===true&&attempt.name===a.name&&attempt.intentSha256===c.manual.intentSha256&&attempt.acceptedAt>=c.manual.intent.createdAt&&attempt.acceptedAt<c.manual.intent.expiresAt&&attempt.acceptedAt<a.cutoff,'exact single native dispatch required');
 assert(outcome.outcome==='response-received'&&outcome.httpStatus===400&&outcome.acceptedAt===attempt.acceptedAt&&outcome.name===a.name&&outcome.responseBodySha256===BODY&&outcome.rawBodyRetained===true&&outcome.bodyComplete===true&&outcome.capturedBytes===157&&outcome.observedBytes===157&&!outcome.bodyTruncated&&!outcome.bodyReadFailed,'full retained native refusal required');
 assert(core.now()<r.expiresAt&&core.now()<basis.validUntil&&(await spendBinding(await core.load())).ledgerSha256===binding.ledgerSha256,'refusal evidence expired or ledger changed');
 const resolution={...(repairCreate?{episodeId:CLOUD_REPAIR.id}:{}),schema:1,campaignId:id,reference:structuredClone(reference),receiptSha256:reference.sha256,appliedAt:core.now(),
  originalAttempt:structuredClone(a),originalStatus:c.status,originalCleanupVerified:c.cleanupVerified,
  nativeBodySha256:BODY,review:structuredClone(r.review),actualSpendBasisSha256:r.actualSpendBasisSha256};
 db.additionalProviderRefusalResolutions??={};db.additionalProviderRefusalResolutions[id]=resolution;
 c.status='cancelled';c.cleanupVerified=true;core.event(c,'provider-capacity-refusal-resolved',{receiptSha256:reference.sha256});
 await core.save(db);return {receiptSha256:reference.sha256,resolved:true,held:false};
}
