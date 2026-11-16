import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {spendBinding} from '../actual-spend.mjs';
import {isRuntimeSourcePath,isProofSourcePath} from '../image-identity.mjs';
const hash=value=>sha256(encode(canonical(value)));
async function prepared(){
 const f=await setup();f.advance(Date.UTC(2026,10,16,6)-f.now());
 const db=await f.core.load();db.manualProgram={acceptedAt:1794789331599,deadline:1794875731599,campaignId:'ui',intentSha256:'1'.repeat(64)};
 db.campaigns.ui.programAnchor=structuredClone(db.manualProgram);await f.core.save(db);
 const binding=await f.core.programWindowBinding();
 const receipt={schema:1,kind:'operator-program-deadline-amendment',id:'a'.repeat(32),createdAt:f.now(),expiresAt:f.now()+900000,
  expectedBindingSha256:binding.bindingSha256,original:binding.original,newDeadline:1794891540000,
  authority:{kind:'user-approved-program-deadline-extension',evidenceSha256:'b'.repeat(64)},preserveExistingAuthorities:true};
 return {...f,binding,receiptValue:receipt,reference:await f.receipt(receipt,'a')};
}
test('global amendment changes only global deadline and append-only audit, preserving every old authority and financial state',async()=>{
 const f=await prepared(),before=await f.core.load(),spendBefore=await spendBinding(before);
 const result=await f.core.amendProgramWindow('ui',f.reference),after=await f.core.load();
 assert.equal(result.program.acceptedAt,1794789331599);assert.equal(result.program.deadline,1794891540000);
 assert.deepEqual(after.campaigns,before.campaigns);assert.equal(f.providers.creates,1);assert.equal(f.providers.resources.size,0);
 const expected=structuredClone(before);expected.manualProgram.deadline=1794891540000;expected.programDeadlineAmendments=after.programDeadlineAmendments;
 assert.deepEqual(after,expected);assert.equal(after.programDeadlineAmendments.length,1);
 assert.deepEqual(after.programDeadlineAmendments[0].original,before.manualProgram);
 assert.notEqual((await spendBinding(after)).ledgerSha256,spendBefore.ledgerSha256);
 const binding=await f.core.programWindowBinding();assert.deepEqual(binding.original,before.manualProgram);assert.equal(binding.current.deadline,1794891540000);
 assert.equal(binding.amendments[0].receiptSha256,f.reference.sha256);
});
test('exact immutable reference is idempotent after restart or expiry; divergent replay cannot extend again',async()=>{
 const f=await prepared();await f.core.amendProgramWindow('ui',f.reference);const before=await f.core.load();f.advance(86400000);
 assert.equal((await f.controller().amendProgramWindow('ui',f.reference)).idempotent,true);assert.deepEqual(await f.core.load(),before);
 const divergent=await f.receipt({...f.receiptValue,id:'b'.repeat(32)},'b');
 await assert.rejects(f.core.amendProgramWindow('ui',divergent),/already amended/);assert.deepEqual(await f.core.load(),before);
});
test('wrong anchor, stale ledger, time, authority or ceiling rejects without mutation',async()=>{
 for(const mutate of [r=>r.original.acceptedAt++,r=>r.original.deadline++,r=>r.expectedBindingSha256='0'.repeat(64),
  r=>r.newDeadline++,r=>r.newDeadline--,r=>r.preserveExistingAuthorities=false,r=>r.authority.kind='operator-only',
  r=>delete r.authority.evidenceSha256,r=>r.expiresAt=r.createdAt,r=>r.expiresAt=r.createdAt+900001,
  r=>r.createdAt++,r=>r.id='invalid',r=>r.extra='unbound']){
  const f=await prepared(),r=structuredClone(f.receiptValue);mutate(r);const ref=await f.receipt(r,'b'),before=await f.core.load();
  await assert.rejects(f.core.amendProgramWindow('ui',ref));assert.deepEqual(await f.core.load(),before);
 }
 const f=await prepared(),db=await f.core.load();db.pilotReservedCents++;await f.core.save(db);
 await assert.rejects(f.core.amendProgramWindow('ui',f.reference),/binding changed/);assert.deepEqual(await f.core.load(),db);
 for(const instant of [Date.UTC(2026,10,16,18),1794875731599]){
  const f=await prepared();f.advance(instant-f.now());await assert.rejects(f.core.amendProgramWindow('ui',f.reference),/expired/);
 }
});
test('amendment and routing/operator sources do not change the audited image or proof inventory',()=>{
 for(const file of ['tools/hosted-compute/program-window.mjs','tools/hosted-compute/controller.mjs','tools/hosted-compute/manual-authority.mjs','tools/hosted-compute/cli.mjs','apps/compute-controller/index.mjs','tools/hosted-compute/test/program-window.test.mjs']){
  assert.equal(isRuntimeSourcePath(file),false,file);assert.equal(isProofSourcePath(file),false,file);
 }
});
