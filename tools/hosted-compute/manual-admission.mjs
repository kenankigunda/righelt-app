import {assert,canonical,encode,sha256,reserveCents,TERMINAL} from './policy.mjs';
import {cashPlan,cloudflareCoverage} from './cash.mjs';
import {readCleanupRegistry,readOperatorReceipt,sameReference,validateManualIntent,validateRepairAllowance,operatorAttemptBinding,MANUAL_STARTUP_MS} from './manual-authority.mjs';
import {validateRuntimeUpgrade} from './runtime-upgrade.mjs';
import {actualEnvelope} from './actual-spend.mjs';

const hash=value=>sha256(encode(canonical(value)));
export async function manualAuthority(core,db,c,intent){
  assert(core.config.enabled===true&&(db.pilotReservedCents??0)<=core.config.authorizedCents,'manual compute disabled or authorization reduced');
  validateManualIntent(intent);
  validateRepairAllowance(intent,core.config.authorizedCents);
  const now=core.now(),prior=core.campaign(db,intent.priorCampaignId),old=prior.attempts.at(-1);
  const actual=Boolean(db.actualSpendBasis);
  if(actual){
    assert(now<db.actualSpendBasis.validUntil&&intent.expiresAt<=db.actualSpendBasis.validUntil,'fresh actual-spend reconciliation required');
    assert(Object.keys(db.actualSpendBasis.admissions).every(id=>id===c.manifest.id),'reconcile actual balance after the previous manual attempt');
  }else assert(intent.actualSpendBasisSha256===undefined,'actual-spend reconciliation missing');
  assert(c.manifest.id===intent.campaignId&&c.manifestSha256===intent.manifestSha256&&prior!==c&&prior.manifestSha256===intent.priorManifestSha256,'manual campaign binding differs');
  assert(c.manifest.sourceRevision===intent.sourceRevision,'manual source differs from intent');
  if(intent.runtimeUpgrade)await validateRuntimeUpgrade(core,prior,c,intent);
  else{
    assert(c.manifest.sourceRevision===prior.manifest.sourceRevision&&c.manifest.runtimeSha256===prior.manifest.runtimeSha256,'manual frozen source/runtime differs');
    for(const key of ['executionRecipeSha256','inputs'])assert(canonical(c.manifest[key])===canonical(prior.manifest[key]),'manual frozen public inputs differ');
    assert(c.manifest.phases[0].host.image===prior.manifest.phases[prior.phase].host.image,'manual frozen image differs');
  }
  for(const key of ['dependencySha256','checkpointSha256','corpusSha256','recipeSha256','seed'])assert(canonical(c.manifest[key])===canonical(prior.manifest[key]),'manual frozen public inputs differ');
  assert(c.manifest.mode==='supervised-qualification'&&c.manifest.purpose!=='scientific-comparison'&&c.manifest.phases.length===1,'manual public qualification only');
  assert(prior.attempts.length===1&&old?.uncertain===true&&['stopping','cleanup-uncertain'].includes(prior.status),'original uncertain owner required');
  assert(canonical(intent.priorAttempt)===canonical({generation:prior.generation,name:old.name,prearmSha256:old.prearmSha256,startedAt:old.startedAt}),'original attempt binding differs');
  const repairStartedAt=operatorAttemptBinding(prior).repairStartedAt;
  assert(Number.isSafeInteger(repairStartedAt)&&repairStartedAt>=old.startedAt&&intent.repairStartedAt===repairStartedAt,'original repair clock differs');
  assert(now>=intent.createdAt&&now<intent.expiresAt&&now<intent.repairDeadline,'manual admission window expired');
  const host=c.manifest.phases[0].host;assert(host.quoteObservedAt<=now&&host.quoteExpires>now,'manual host quote expired');
  assert(intent.fundingSha256===await hash(c.manifest.cash),'manual funding identity differs');
  const control=core.externalControl(c.manifest),registry=await readCleanupRegistry(control.store,intent.registry);
  assert(registry.references.some(r=>sameReference(r,c.manifest.externalControl))&&registry.references.some(r=>sameReference(r,prior.manifest.externalControl)),'dual registry omits an ownership set');
  const oldRecord=registry.records[registry.references.findIndex(r=>sameReference(r,prior.manifest.externalControl))];
  assert(oldRecord.accountId===intent.accountId,'manual account differs');
  const fence=await control.store.readFence(oldRecord.nonce,prior.manifest.externalControl);
  assert(fence?.kind==='terminal'&&fence.prearmSha256===prior.manifest.externalControl.sha256,'original terminal fence missing');
  const authority=await control.authorizeLaunch(c.manifest,{phaseIndex:0,generation:1});
  if(intent.startup)assert(intent.startup.deadline<=Math.min(c.manifest.deadline,authority.cutoff,intent.repairDeadline,db.manualProgram?.deadline??Infinity),'startup authority exceeds immutable bounds');
  assert(authority.name===intent.name&&authority.name!==old.name,'manual exact name differs');
  assert(intent.liabilityUntil>=authority.cutoff,'cleanup and response liability horizon missing');
  const ready=await readOperatorReceipt(control.store,intent.cleanupReady);
  assert(ready.schema===1&&ready.kind==='dual-cleanup-readiness'&&sameReference(ready.registry,intent.registry)&&ready.runtimeRevision===registry.runtimeRevision&&/^[a-f0-9]{64}$/.test(ready.workflowSourceSha256)&&/^[a-f0-9]{40}$/.test(ready.workflowCommit),'cleanup readiness source differs');
  assert(Number.isSafeInteger(ready.observedAt)&&ready.observedAt<=now&&now-ready.observedAt<=900000&&Number.isSafeInteger(ready.run?.id)&&['success','failure'].includes(ready.run.conclusion)&&ready.run.headSha===ready.workflowCommit,'fresh actual dual runner proof required');
  assert(Array.isArray(ready.run.results)&&ready.run.results.length===2&&new Set(ready.run.results.map(r=>r.prearmSha256)).size===2,'dual runner evidence inventory differs');
  for(const ref of registry.references){const result=ready.run.results.find(r=>r.prearmSha256===ref.sha256);assert(result&&['waiting','terminal'].includes(result.state)&&result.failures===0&&(result.state!=='terminal'||result.cleanupObservedAbsent===true&&result.durableReceiptConfirmed===true),'dual cleanup proof incomplete');}
  if(ready.run.conclusion==='failure'){
    const oldResult=ready.run.results.find(r=>r.prearmSha256===prior.manifest.externalControl.sha256),newResult=ready.run.results.find(r=>r.prearmSha256===c.manifest.externalControl.sha256);
    assert(ready.run.usageReviewRequired===true&&oldResult.state==='terminal'&&oldResult.usageReviewRequired===true&&newResult.usageReviewRequired===false,'cleanup failure is not solely the retained old usage warning');
  }
  const funding=await readOperatorReceipt(control.store,intent.fundingReservation),oldFunding=funding.oldAttempt,next=funding.newIntent,total=funding.aggregate;
  if(intent.startup)assert(next?.startupDeadline===intent.startup.deadline,'startup funding binding differs');
  // Every earlier prepared manual allocation remains committed after cleanup,
  // cancellation or completion. The original unknown owner stays the prior.
  const retainedManualCents=Object.values(db.campaigns).filter(other=>other!==c&&other.manual?.intent.priorCampaignId===prior.manifest.id).reduce((sum,other)=>sum+other.manifest.maxCents,0);
  const envelope=actual?actualEnvelope(core,db,c,intent):null;
  const encumberedCents=envelope?.requiredCents??prior.manifest.maxCents+intent.priorRiskReserveCents+retainedManualCents+c.manifest.maxCents;
  assert(funding.schema===1&&funding.kind===(actual?'operator-actual-funding-freeze':'operator-additive-funding-freeze')&&(!actual||funding.basisSha256===db.actualSpendBasis.receiptSha256)&&oldFunding?.id===prior.manifest.id&&oldFunding.manifestSha256===prior.manifestSha256&&Date.parse(oldFunding.startedAt)===old.startedAt,'operator funding prior binding differs');
  const oldReserve=actual?(db.actualSpendBasis.activeResources.some(r=>r.campaignId===prior.manifest.id)?reserveCents(prior.manifest.maxCents):0):reserveCents(prior.manifest.maxCents);
  assert(oldFunding.originalAllocationCents===prior.manifest.maxCents&&oldFunding.supplementalRiskHoldCents===intent.priorRiskReserveCents&&oldFunding.protectedShutdownReserveCents===oldReserve&&oldFunding.hourlyCeilingCents===old.hourlyCents,'operator prior allocation differs');
  assert(next?.computeAllocationCents===c.manifest.maxCents&&next.protectedShutdownReserveCents===reserveCents(c.manifest.maxCents)&&next.allInHourlyCeilingCents===host.hourlyCents&&next.host===host.gpu&&next.dataCenterId===host.dataCenterId&&next.diskGb===host.diskGb&&next.gpuCount===1,'operator new funding/placement differs');
  assert(now<=Date.parse(next.latestAdmission)&&intent.expiresAt<=Date.parse(next.latestAdmission)&&intent.expiresAt-intent.createdAt<=next.maximumIntentMs&&next.maximumIntentMs===900000&&authority.cutoff<=Date.parse(next.latestWorkCutoff)&&intent.liabilityUntil<=Date.parse(next.responseUntil)&&intent.liabilityUntil>=authority.cutoff+7200000,'finite operator funding window exceeded');
  assert(total?.runpodEncumberedCents===encumberedCents&&total.repairEncumberedCents===encumberedCents&&total.runpodEncumberedCents<=total.runpodCeilingCents&&total.runpodCeilingCents<=10000&&total.repairEncumberedCents<=intent.repairMaxCents&&total.repairCeilingCents===intent.repairMaxCents&&total.cloudflareEncumberedCents<=total.cloudflareCeilingCents&&total.cloudflareCeilingCents<=2000&&total.githubPaidOverageAuthorized===false,'operator aggregate funding exceeded');
  cloudflareCoverage(c.manifest.cash,{now,deadline:c.manifest.deadline,forecastUntil:authority.forecastUntil});
  return {prior,old,authority,registry};
}
function repairCost(core,db,prior){
  let total=core.cost(prior);
  for(const c of Object.values(db.campaigns))if(c.manual?.intent.priorCampaignId===prior.manifest.id){
    total+=Math.ceil(c.attempts.reduce((n,a)=>n+Math.max(0,Math.min(a.workStartedAt??Infinity,a.endedAt??core.now())-a.startedAt)*a.hourlyCents/3600000,0));
  }
  return total;
}
function requireHeadroom(core,db,prior,c,cutoff){
  if(db.actualSpendBasis){actualEnvelope(core,db,c,c.manual.intent);return;}
  cutoff=c.manual.intent.liabilityUntil;
  const now=core.now(),host=c.manifest.phases[0].host;
  const repair=repairCost(core,db,prior);
  assert(repair<c.manual.intent.repairMaxCents,'combined repair cash exhausted');
  // Reserve both still-open potential streams through the new funded cutoff.
  // Absence never releases the original allocation or its conservative charge.
  const oldFuture=prior.attempts.filter(a=>!a.endedAt).reduce((n,a)=>n+Math.ceil(a.hourlyCents*Math.max(0,cutoff-now)/3600000),0);
  const newFuture=Math.ceil(host.hourlyCents*Math.max(0,cutoff-now)/3600000);
  assert(repair+oldFuture+newFuture+reserveCents(prior.manifest.maxCents)+reserveCents(c.manifest.maxCents)<=c.manual.intent.repairMaxCents,'combined repair tail exceeds cash allowance');
  assert(core.cost(prior)+oldFuture<=prior.manifest.maxCents+c.manual.intent.priorRiskReserveCents-reserveCents(prior.manifest.maxCents),'original liability allocation exhausted');
  assert(core.cost(c)+newFuture<=c.manifest.maxCents-reserveCents(c.manifest.maxCents),'manual funded window exceeds allocation');
}
export async function prepareManual(core,id,intent){
  const db=await core.load(),c=core.campaign(db,id),intentSha256=await hash(intent);
  if(c.manual){
    assert(c.manual.intentSha256===intentSha256,'manual intent already bound');
    assert(c.status==='manual-pending'&&core.now()<intent.expiresAt,'manual bootstrap closed');
    await manualAuthority(core,db,c,intent);
    return {intentSha256,generation:1,workerToken:await core.token(id,1)};
  }
  assert(c.status==='staged'&&core.config.enabled===true,'manual campaign unavailable');
  assert(!db.manualFundingReservations?.[intent.fundingReservation?.sha256],'funding reservation already assigned');
  assert(!db.manualProgram||core.now()<db.manualProgram.deadline,'overall actual program ended');
  const {prior,authority}=await manualAuthority(core,db,c,intent),now=core.now();
  for(const other of Object.values(db.campaigns))assert(other===c||other===prior||TERMINAL.has(other.status)||other.status==='staged','another campaign owns compute');
  for(const input of c.manifest.inputs)assert(c.objects[input.sha256]?.bytes===input.bytes,'manual inputs incomplete');
  const host=c.manifest.phases[0].host;assert(host.quoteObservedAt<=now&&host.quoteExpires>now,'manual host quote expired');
  const cash=cashPlan(c.manifest.cash,c.manifest.maxCents),{computeUsageCapCents,cloudflareUsageCapCents,...funding}=c.manifest.cash;
  assert(db.cashFunding&&canonical(db.cashFunding)===canonical(funding),'manual cumulative funding differs');
  const oldHold=db.manualRiskHolds?.[prior.manifest.id]??0;assert(intent.priorRiskReserveCents>=oldHold,'prior risk reservation cannot shrink');
  const additionalRisk=intent.priorRiskReserveCents-oldHold;
  const actual=Boolean(db.actualSpendBasis),envelope=actual?actualEnvelope(core,db,c,intent):null;
  assert(actual?envelope.requiredCents<=cash.fundedCreditCents:(db.creditAllocatedCents??0)+c.manifest.maxCents+additionalRisk<=cash.fundedCreditCents&&(db.pilotReservedCents??0)+c.manifest.maxCents+additionalRisk<=core.config.authorizedCents,'manual cumulative credit/authorization exhausted');
  assert((db.cloudflareAllocatedCents??0)+cloudflareUsageCapCents<=cash.cloudflareReservedCents,'manual cumulative Cloudflare reserve exhausted');
  c.manual={intent:structuredClone(intent),intentSha256};
  if(actual)c.manual.actualSpendBasisSha256=db.actualSpendBasis.receiptSha256;
  c.attempts.push({manual:true,provider:'runpod',name:authority.name,quote:structuredClone(host),hourlyCents:host.hourlyCents,startedAt:intent.createdAt,cutoff:authority.cutoff,prearmSha256:authority.prearmSha256,uncertain:true});
  requireHeadroom(core,db,prior,c,authority.cutoff);
  c.generation=1;c.status='manual-pending';c.cleanupVerified=false;
  db.manualRiskHolds??={};db.manualRiskHolds[prior.manifest.id]=intent.priorRiskReserveCents;
  db.manualFundingReservations??={};db.manualFundingReservations[intent.fundingReservation.sha256]={campaignId:id,intentSha256};
  if(actual)db.actualSpendBasis.admissions[id]={intentSha256,manifestSha256:c.manifestSha256,forecastCents:envelope.forecastCents};
  else{db.creditAllocatedCents+=c.manifest.maxCents+additionalRisk;db.pilotReservedCents+=c.manifest.maxCents+additionalRisk;}
  db.cloudflareAllocatedCents+=cloudflareUsageCapCents;
  c.manual.requiredAuthorizationCents=actual?envelope.requiredCents:db.pilotReservedCents;
  core.event(c,'manual-prepared',{intentSha256});await core.save(db);
  return {intentSha256,generation:1,workerToken:await core.token(id,1)};
}
export async function attachManual(core,id,body){
  assert(body&&Object.keys(body).sort().join(',')==='acceptedAt,accountId,intentSha256,podId'&&typeof body.podId==='string'&&/^[A-Za-z0-9_-]+$/.test(body.podId)&&Number.isSafeInteger(body.acceptedAt),'typed observed manual attachment required');
  const db=await core.load(),c=core.campaign(db,id),a=c.attempts.at(-1);
  assert(c.manual?.intentSha256===body.intentSha256&&c.manual.intent.accountId===body.accountId,'manual intent/account differs');
  if(c.manual.attached){assert(c.manual.attached.podId===body.podId&&c.manual.attached.acceptedAt===body.acceptedAt,'manual attachment already bound');return core.status(c);}
  assert(c.status==='manual-pending'&&body.acceptedAt>=a.startedAt&&body.acceptedAt<=core.now(),'manual accepted clock differs');
  const {prior,authority}=await manualAuthority(core,db,c,c.manual.intent);
  requireHeadroom(core,db,prior,c,authority.cutoff);
  const observed=await core.providers.inspect('runpod',body.podId);
  assert(observed?.id===body.podId,'observed Pod identity differs');
  if(observed.createdAt!==undefined)assert(Number.isFinite(Date.parse(observed.createdAt))&&body.acceptedAt<=Date.parse(observed.createdAt),'manual accepted clock is later than provider creation');
  const placement=core.providers.qualify(observed,c.manifest.phases[0].host,a.name);
  // Recheck the actual wall clock after provider I/O, before granting authority.
  assert(core.now()<c.manual.intent.expiresAt&&core.now()<authority.cutoff&&core.now()<c.manual.intent.repairDeadline,'manual attach expired during qualification');
  c.manual.attached={podId:body.podId,acceptedAt:body.acceptedAt};
  if(db.manualProgram)assert(body.acceptedAt>=db.manualProgram.acceptedAt,'overall actual start cannot move backward');
  else db.manualProgram={acceptedAt:body.acceptedAt,deadline:body.acceptedAt+c.manual.intent.runtimeWindowMs,intentSha256:body.intentSha256,campaignId:id};
  c.programAnchor=structuredClone(db.manualProgram);
  c.manual.campaignDeadline=Math.min(db.manualProgram.deadline,c.manifest.deadline,body.acceptedAt+MANUAL_STARTUP_MS);
  assert(core.now()<c.manual.campaignDeadline,'manual actual run window expired');
  if(c.manual.intent.startup){c.manual.startupDeadline=Math.min(c.manual.intent.startup.deadline,body.acceptedAt+c.manual.intent.startup.maximumMs,c.manual.campaignDeadline,authority.cutoff,c.manual.intent.repairDeadline);assert(core.now()<c.manual.startupDeadline,'manual startup already expired');}
  a.resourceId=body.podId;a.placement=placement;a.uncertain=false;
  c.status='provisioning';core.event(c,'manual-attached',{intentSha256:body.intentSha256});await core.save(db);
  return core.status(c);
}

export function checkManualLiability(core,db,c){
  if(!c.manual)return;
  validateRepairAllowance(c.manual.intent,core.config.authorizedCents);
  assert(core.config.enabled===true&&db.pilotReservedCents<=core.config.authorizedCents,'manual compute authorization revoked');
  const prior=core.campaign(db,c.manual.intent.priorCampaignId);
  if(db.actualSpendBasis&&c.manual.actualSpendBasisSha256){
    actualEnvelope(core,db,c,c.manual.intent);
    assert(c.attempts.at(-1)?.workStartedAt||core.now()<c.manual.intent.repairDeadline,'manual repair allowance exhausted');return;
  }
  assert(core.cost(prior)<=prior.manifest.maxCents+c.manual.intent.priorRiskReserveCents-reserveCents(prior.manifest.maxCents),'prior risk reserve exhausted');
  if(!c.attempts.at(-1)?.workStartedAt){
    assert(core.now()<c.manual.intent.repairDeadline&&repairCost(core,db,prior)<c.manual.intent.repairMaxCents,'manual repair allowance exhausted');
  }
}
