import test from 'node:test';
import assert from 'node:assert/strict';
import {refusalFixture,historical} from './provider-refusal-fixture.mjs';
import {REFUSAL_899} from '../additional-refusal.mjs';
import {refusalFor,effectiveRefusal,needsOwnershipWatch} from '../refusal-state.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));

async function fixture899(){
 const f=await refusalFixture(),old=await f.core.load(),legacy=old.campaigns[f.m.id];
 legacy.status='cancelled';legacy.cleanupVerified=true;
 old.providerRefusalResolution={campaignId:f.m.id,receiptSha256:'1'.repeat(64),reference:{sha256:'1'.repeat(64)},originalAttempt:structuredClone(legacy.attempts[0])};
 const acceptedAt=1794842117921,name='righelt-public-variation-20261116-89927452-a9f6959048c115e393ee475ee0fa8535-1-0',intentSha256='952bc3c0acdc207c6d33a7eb1adee38b52aa5749d87da168f2cee4b3f77ba330';
 f.advance(acceptedAt+60000-f.now());
 const m=structuredClone(f.m);m.id=REFUSAL_899.campaignId;m.deadline=f.now()+900000;
 const prearm=await f.arm(m,'a9f6959048c115e393ee475ee0fa8535');
 const c={manifest:m,manifestSha256:REFUSAL_899.manifestSha256,status:'cleanup-uncertain',cleanupVerified:false,generation:1,
  phase:0,events:[],objects:{},manual:{intentSha256,intent:{createdAt:acceptedAt-1000,expiresAt:acceptedAt+299000}},
  attempts:[{manual:true,provider:'runpod',name,prearmSha256:m.externalControl.sha256,startedAt:acceptedAt-1000,
   cutoff:acceptedAt+900000,hourlyCents:272,uncertain:true}]};
 old.campaigns[m.id]=c;old.actualSpendBasis.observedAt=f.now();old.actualSpendBasis.validUntil=f.now()+900000;
 f.control.fences.set(prearm.nonce,{kind:'terminal',prearmSha256:m.externalControl.sha256});await f.core.save(old);
 const attempt={acceptedAt,method:'POST',url:'https://api.runpod.io/v2/pods',name,intentSha256,maximumAttempts:1,bootstrapSecretsExcluded:true};
 const outcome={outcome:'response-received',httpStatus:400,acceptedAt,name,responseCategory:'capacity-unavailable',rawBodyRetained:true,
  responseBodySha256:'ef5e3eaa37cf3899e571b0f19298d18b81128c9a1328f599a9affce455e51ef6',
  capturedBodySha256:'ef5e3eaa37cf3899e571b0f19298d18b81128c9a1328f599a9affce455e51ef6',capturedBytes:157,observedBytes:157,
  bodyComplete:true,bodyTruncated:false,bodyReadFailed:false,encryptedBody:{file:'provider-create-error.age',bytes:357,
   sha256:'eebc7cfc670a6b275dd64ffa18014906fe5c4ff6f3ae2c7ac7752e64e3f51c5a',format:'age',capturesCompleteBody:true}};
 const native={attemptJournalUtf8:JSON.stringify(attempt,null,2)+'\n',outcomeJournalUtf8:JSON.stringify(outcome,null,2)+'\n',responseBodyUtf8:historical.body};
 assert.equal(await sha256(encode(native.attemptJournalUtf8)),REFUSAL_899.attemptSha256);
 assert.equal(await sha256(encode(native.outcomeJournalUtf8)),REFUSAL_899.outcomeSha256);
 const receipt=async(value,n)=>{
  const reference={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/receipts/${n.repeat(32)}/${n.repeat(32)}.json`,sha256:await hash(value)};
  f.control.records.set(`${reference.path}@${reference.commit}`,structuredClone(value));return reference;
 };
 const review={schema:1,kind:'independently-reviewed-exact-capacity-refusal',campaignId:m.id,manifestSha256:c.manifestSha256,
  sourceRevision:m.sourceRevision,accountId:'test-account',intentSha256,attemptSha256:REFUSAL_899.attemptSha256,
  outcomeSha256:REFUSAL_899.outcomeSha256,responseBodySha256:outcome.responseBodySha256,
  helperSnapshotSha256:'2'.repeat(64),bootstrapSnapshotSha256:'3'.repeat(64),credentialBindingSha256:'4'.repeat(64),
  evidenceSha256:'5'.repeat(64),requestBodySha256:null,redirectPolicy:'error',maximumAttempts:1};
 const r={schema:1,kind:'operator-attested-exact-capacity-refusal',createdAt:f.now(),expiresAt:f.now()+900000,
  ledgerSha256:(await f.core.actualSpendBinding()).ledgerSha256,target:(await f.core.providerRefusalBinding(m.id)).target,
  actualSpendBasisSha256:old.actualSpendBasis.receiptSha256,accountId:'test-account',review:await receipt(review,'6'),native};
 return {...f,m,r,review,receipt,legacyResolution:old.providerRefusalResolution};
}

test('899 resolution appends without replacing1c3, changing history/clocks or releasing money',async()=>{
 const f=await fixture899(),before=await f.core.load(),reference=await f.receipt(f.r,'7');
 assert.equal((await f.core.resolveProviderRefusal(f.m.id,reference)).resolved,true);
 const after=await f.core.load(),c=after.campaigns[f.m.id];
 assert.deepEqual(after.providerRefusalResolution,f.legacyResolution);assert.deepEqual(after.manualProgram,before.manualProgram);
 assert.deepEqual(c.attempts,before.campaigns[f.m.id].attempts);assert.deepEqual(after.actualSpendBasis,before.actualSpendBasis);
 assert.equal(effectiveRefusal(after,c),true);assert.equal(needsOwnershipWatch(after,c,c.attempts[0],0),false);
 assert.equal(refusalFor(after,c).receiptSha256,reference.sha256);assert.equal((await f.core.resolveProviderRefusal(f.m.id,reference)).replayed,true);
 assert.equal(f.providers.creates,0);
});
test('generic400, missing complete native response, different account and stale CAS cannot resolve899',async()=>{
 for(const change of [f=>f.r.native.responseBodyUtf8='{"status":400}',f=>f.r.accountId='other',
  f=>f.r.ledgerSha256='f'.repeat(64),f=>f.r.native.outcomeJournalUtf8=f.r.native.outcomeJournalUtf8.replace('"bodyComplete": true','"bodyComplete": false')]){
  const f=await fixture899();change(f);const before=await f.core.load();
  await assert.rejects(f.core.resolveProviderRefusal(f.m.id,await f.receipt(f.r,'7')));assert.deepEqual(await f.core.load(),before);
 }
});
test('late899 resource latches a permanent contradiction independently of1c3',async()=>{
 const f=await fixture899(),reference=await f.receipt(f.r,'7');await f.core.resolveProviderRefusal(f.m.id,reference);
 f.providers.resources.set('late899',{id:'late899',name:(await f.core.load()).campaigns[f.m.id].attempts[0].name,host:f.m.phases[0].host});
 await f.core.reconcile();const db=await f.core.load();assert.equal(db.providerRefusalContradictions.length,1);
 assert.equal(db.providerRefusalContradictions[0].campaignId,f.m.id);assert.deepEqual(db.providerRefusalResolution,f.legacyResolution);
 assert.equal((await f.core.resolveProviderRefusal(f.m.id,reference)).held,true);
});
