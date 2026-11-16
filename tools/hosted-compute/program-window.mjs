// Controller-only, one-time operator amendment. Existing job authorities are immutable.
import {assert,canonical,encode,safeName,sha256} from './policy.mjs';
import {spendBinding} from './actual-spend.mjs';
import {readOperatorReceipt,sameReference,MANUAL_REPAIR_END} from './manual-authority.mjs';
export const AUTHORIZED_PROGRAM_END=1794891540000;
const hash=value=>sha256(encode(canonical(value)));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const shape=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
export async function programWindowBinding(db){
  assert(db.manualProgram,'original manual program unavailable');
  const amendments=db.programDeadlineAmendments??[];
  const original=amendments[0]?.original??db.manualProgram;
  const value={schema:1,kind:'program-window-binding',original:structuredClone(original),
    current:structuredClone(db.manualProgram),amendments:structuredClone(amendments),ledgerSha256:(await spendBinding(db)).ledgerSha256};
  return {...value,bindingSha256:await hash(value)};
}
export async function amendProgramWindow(core,id,reference){
  const db=await core.load(),campaign=core.campaign(db,id);
  const receipt=await readOperatorReceipt(core.externalControl(campaign.manifest).store,reference);
  const amendments=db.programDeadlineAmendments??[];
  const prior=amendments.find(a=>sameReference(a.reference,reference));
  if(prior)return {amended:true,idempotent:true,receiptSha256:reference.sha256,program:structuredClone(db.manualProgram)};
  assert(shape(receipt,'schema,kind,id,createdAt,expiresAt,expectedBindingSha256,original,newDeadline,authority,preserveExistingAuthorities')
    &&receipt.schema===1&&receipt.kind==='operator-program-deadline-amendment'&&/^[a-f0-9]{32}$/.test(receipt.id),'typed program amendment required');
  assert(amendments.length===0,'program deadline already amended');
  const now=core.now(),binding=await programWindowBinding(db),original=binding.original;
  assert(digest(receipt.expectedBindingSha256)&&receipt.expectedBindingSha256===binding.bindingSha256,'program amendment binding changed');
  assert(shape(original,'acceptedAt,deadline,intentSha256,campaignId')&&Number.isSafeInteger(original.acceptedAt)
    &&original.deadline===original.acceptedAt+86400000&&digest(original.intentSha256)&&safeName(original.campaignId)
    &&canonical(receipt.original)===canonical(original),'original program anchor differs');
  assert(Number.isSafeInteger(receipt.createdAt)&&Number.isSafeInteger(receipt.expiresAt)&&receipt.createdAt<=now&&now<receipt.expiresAt
    &&receipt.expiresAt>receipt.createdAt&&receipt.expiresAt-receipt.createdAt<=900000&&now<original.deadline&&now<MANUAL_REPAIR_END,'program amendment window expired');
  assert(receipt.newDeadline===AUTHORIZED_PROGRAM_END&&receipt.newDeadline>original.deadline&&receipt.preserveExistingAuthorities===true,'program extension authority differs');
  assert(shape(receipt.authority,'kind,evidenceSha256')&&receipt.authority.kind==='user-approved-program-deadline-extension'
    &&digest(receipt.authority.evidenceSha256),'direct human extension authority required');
  db.programDeadlineAmendments=[{schema:1,id:receipt.id,appliedAt:now,reference:structuredClone(reference),receiptSha256:reference.sha256,
    original:structuredClone(original),newDeadline:receipt.newDeadline,expectedBindingSha256:receipt.expectedBindingSha256,
    authority:structuredClone(receipt.authority),preserveExistingAuthorities:true}];
  db.manualProgram={...db.manualProgram,deadline:receipt.newDeadline};
  await core.save(db);
  return {amended:true,idempotent:false,receiptSha256:reference.sha256,program:structuredClone(db.manualProgram)};
}
