import {assert,canonical,encode,sha256,reserveCents,POLICY} from './policy.mjs';
import {readOperatorReceipt,operatorAttemptBinding} from './manual-authority.mjs';
const hash=value=>sha256(encode(canonical(value)));
const cents=value=>Number.isSafeInteger(value)&&value>=0;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=(value,names)=>value&&Object.keys(value).sort().join(',')===names.split(',').sort().join(',');

// Snapshot only durable ownership/outcome and financial state. Poll time and
// legacy elapsed-price estimates are not actual debit evidence.
export async function spendBinding(db){
  const campaigns=Object.values(db.campaigns).map(c=>({id:c.manifest.id,manifestSha256:c.manifestSha256,status:c.status,generation:c.generation,
    phase:c.phase,failure:c.failure??null,repairStartedAt:operatorAttemptBinding(c).repairStartedAt,programAnchor:c.programAnchor??null,
    cleanupVerified:c.cleanupVerified,attempts:c.attempts,manual:c.manual??null})).sort((a,b)=>a.id.localeCompare(b.id));
  const state={campaigns,cashFunding:db.cashFunding??null,creditAllocatedCents:db.creditAllocatedCents??0,pilotReservedCents:db.pilotReservedCents??0,
    manualRiskHolds:db.manualRiskHolds??{},manualFundingReservations:db.manualFundingReservations??{},manualProgram:db.manualProgram??null,
    priorBasisSha256:db.actualSpendBasis?.receiptSha256??null};
  return {schema:1,kind:'actual-spend-binding',ledgerSha256:await hash(state),priorBasisSha256:state.priorBasisSha256,
    financialBasis:db.actualSpendBasis?'verified-account-observation':'legacy-reservations',observedDebitCents:db.actualSpendBasis?.observedDebitCents??null,
    creditAllocatedCents:state.creditAllocatedCents,pilotReservedCents:state.pilotReservedCents,observedActiveResourceCount:db.actualSpendBasis?.activeResources.length??null};
}

export async function reconcileActualSpend(core,id,reference){
  const db=await core.load(),prior=core.campaign(db,id),receipt=await readOperatorReceipt(core.externalControl(prior.manifest).store,reference);
  assert(receipt.priorCampaignId===id,'actual-spend reconciliation campaign differs');
  db.actualSpendReconciliations??=[];
  const consumed=db.actualSpendReconciliations.find(r=>r.receiptSha256===reference.sha256);
  if(consumed)return {receiptSha256:consumed.receiptSha256,reconciled:true,observedDebitCents:consumed.observedDebitCents};
  assert(keys(receipt,'schema,kind,id,priorCampaignId,ledgerSha256,priorBasisSha256,authority,accountId,observedAt,validUntil,balance,inventory,activeResources')&&receipt.schema===1&&receipt.kind==='operator-actual-spend-reconciliation'&&/^[a-f0-9]{32}$/.test(receipt.id),'typed actual-spend reconciliation required');
  assert(!db.actualSpendReconciliations.some(r=>r.id===receipt.id),'reconciliation identity already consumed');
  const binding=await spendBinding(db),now=core.now();
  assert(receipt.priorCampaignId===id&&receipt.ledgerSha256===binding.ledgerSha256&&receipt.priorBasisSha256===binding.priorBasisSha256,'actual-spend ledger binding differs');
  const prearm=await core.externalControl(prior.manifest).store.readPrearm(prior.manifest.externalControl);
  assert(receipt.accountId===prearm.accountId,'actual-spend account differs');
  const authority=receipt.authority;
  assert(keys(authority,'kind,evidenceSha256,repairCeilingCents,runpodCeilingCents')&&authority.kind==='user-actual-spend-basis-correction'&&digest(authority.evidenceSha256)&&authority.repairCeilingCents===core.config.authorizedCents&&authority.repairCeilingCents>0&&authority.repairCeilingCents<=POLICY.pilotCents&&authority.runpodCeilingCents===POLICY.pilotCents,'actual-spend correction authority differs');
  assert(Number.isSafeInteger(receipt.observedAt)&&receipt.observedAt<=now&&Number.isSafeInteger(receipt.validUntil)&&now<receipt.validUntil&&receipt.validUntil<=receipt.observedAt+900000,'fresh actual-spend observation required');
  const balance=receipt.balance;
  assert(keys(balance,'openingCreditCents,currentCreditCents,debitsCents,creditsCents,currentHourlyCents,autoPay,evidenceSha256')&&['openingCreditCents','currentCreditCents','debitsCents','creditsCents','currentHourlyCents'].every(k=>cents(balance[k]))&&balance.autoPay===false&&digest(balance.evidenceSha256),'actual balance evidence required');
  assert(balance.creditsCents===0&&balance.openingCreditCents===db.cashFunding?.runpod.openingCreditCents+db.cashFunding?.runpod.purchasedCreditCents&&balance.openingCreditCents-balance.debitsCents===balance.currentCreditCents&&balance.debitsCents<=authority.repairCeilingCents&&balance.debitsCents<=authority.runpodCeilingCents,'actual balance/debit arithmetic differs');
  assert(!db.actualSpendBasis||balance.debitsCents>=db.actualSpendBasis.observedDebitCents&&receipt.observedAt>=db.actualSpendBasis.observedAt,'observed debit/time cannot silently shrink');
  assert(keys(receipt.inventory,'ordinary,queued')&&['ordinary','queued'].every(k=>keys(receipt.inventory[k],'complete,evidenceSha256,resourceIds')&&receipt.inventory[k].complete===true&&digest(receipt.inventory[k].evidenceSha256)&&Array.isArray(receipt.inventory[k].resourceIds)&&receipt.inventory[k].resourceIds.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]+$/.test(x))),'complete ordinary and queued observations required');
  const inventoryIds=[...receipt.inventory.ordinary.resourceIds,...receipt.inventory.queued.resourceIds];
  assert(Array.isArray(receipt.activeResources)&&new Set(inventoryIds).size===inventoryIds.length&&inventoryIds.length===receipt.activeResources.length,'actual resource inventory differs');
  const known=new Set();let hourly=0;
  for(const r of receipt.activeResources){
    assert(keys(r,'id,campaignId,generation,name,hourlyCents')&&inventoryIds.includes(r.id)&&!known.has(r.id)&&Number.isSafeInteger(r.generation)&&r.generation>0&&cents(r.hourlyCents),'typed actual resource required');known.add(r.id);
    const c=core.campaign(db,r.campaignId),a=c.attempts[r.generation-1];
    assert(a&&a.name===r.name&&(!a.resourceId||a.resourceId===r.id)&&a.hourlyCents>=r.hourlyCents,'observed resource ownership/rate differs');hourly+=r.hourlyCents;
  }
  assert(hourly===balance.currentHourlyCents,'observed current rate differs');
  assert(!Object.values(db.campaigns).some(c=>c.manual&&['manual-pending','provisioning','running'].includes(c.status)),'cannot reconcile an in-flight manual admission');
  const before={creditAllocatedCents:db.creditAllocatedCents??0,pilotReservedCents:db.pilotReservedCents??0,manualRiskHolds:structuredClone(db.manualRiskHolds??{}),actualSpendBasis:structuredClone(db.actualSpendBasis??null)};
  const entry={id:receipt.id,receiptSha256:reference.sha256,reference:structuredClone(reference),ledgerSha256:binding.ledgerSha256,observedAt:receipt.observedAt,observedDebitCents:balance.debitsCents,
    before,releasedCreditAllocationCents:Math.max(0,before.creditAllocatedCents-balance.debitsCents),releasedPilotReservationCents:Math.max(0,before.pilotReservedCents-balance.debitsCents)};
  db.actualSpendReconciliations.push(entry);
  db.actualSpendBasis={receiptSha256:reference.sha256,priorCampaignId:id,accountId:receipt.accountId,observedAt:receipt.observedAt,validUntil:receipt.validUntil,
    observedDebitCents:balance.debitsCents,currentCreditCents:balance.currentCreditCents,authority:structuredClone(authority),activeResources:structuredClone(receipt.activeResources),admissions:{}};
  // Supersede financial counters only. Original attempts, receipt records,
  // unresolved create status, fences and all program/repair clocks stay intact.
  db.creditAllocatedCents=balance.debitsCents;db.pilotReservedCents=balance.debitsCents;db.manualRiskHolds={};
  assert(core.now()<receipt.validUntil,'actual-spend observation expired during reconciliation');
  await core.save(db);
  return {receiptSha256:reference.sha256,reconciled:true,observedDebitCents:balance.debitsCents};
}

export function actualEnvelope(core,db,c,intent){
  const basis=db.actualSpendBasis;
  assert(basis&&intent.actualSpendBasisSha256===basis.receiptSha256&&basis.priorCampaignId===intent.priorCampaignId&&basis.accountId===intent.accountId,'actual-spend admission basis differs');
  assert(intent.priorRiskReserveCents===0&&intent.repairMaxCents<=basis.authority.repairCeilingCents,'actual-spend repair authority differs');
  let required=basis.observedDebitCents;
  const ids=new Set();
  for(const r of basis.activeResources){
    const owner=core.campaign(db,r.campaignId),attempt=owner.attempts[r.generation-1];ids.add(r.id);
    // A fresh positive observation supersedes an older cleanup timestamp for
    // forecasting only. Keep the historical outcome unchanged.
    const cleanedAfterObservation=attempt?.endedAt>basis.observedAt&&owner.cleanupVerified;
    const until=cleanedAfterObservation?attempt.endedAt:intent.liabilityUntil;
    required+=Math.ceil(r.hourlyCents*Math.max(0,until-basis.observedAt)/3600000)+(cleanedAfterObservation?0:reserveCents(owner.manifest.maxCents));
  }
  for(const [id,allocation] of Object.entries(basis.admissions)){
    if(id===c.manifest.id)continue;
    const owner=core.campaign(db,id),a=owner.attempts.at(-1);
    if(ids.has(a?.resourceId))continue;
    if(a?.endedAt&&owner.cleanupVerified)required+=knownManualCost(owner,core.now());
    else required+=allocation.forecastCents;
  }
  const host=c.manifest.phases[0].host;
  const futureCents=Math.ceil(host.hourlyCents*Math.max(0,intent.liabilityUntil-intent.createdAt)/3600000),shutdownCents=reserveCents(c.manifest.maxCents);
  assert(futureCents+shutdownCents<=c.manifest.maxCents,'actual new-resource forecast exceeds campaign cap');
  required+=futureCents+shutdownCents;
  assert(required<=intent.repairMaxCents&&required<=core.config.authorizedCents&&required<=basis.authority.runpodCeilingCents&&required-basis.observedDebitCents<=basis.currentCreditCents,'actual spend plus forward forecast exceeds allowance');
  return {requiredCents:required,forecastCents:futureCents+shutdownCents};
}
export function knownManualCost(c,now){
  return Math.ceil(c.attempts.reduce((sum,a)=>sum+(a.resourceId?Math.max(0,(a.endedAt??now)-(c.manual.attached?.acceptedAt??a.startedAt))*a.hourlyCents/3600000:0),0));
}
