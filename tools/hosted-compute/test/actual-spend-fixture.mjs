import {setup} from './manual-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

export async function actualFixture({elapsedAfterFirstMs=12*3600000}={}){
  const f=await setup();f.config.authorizedCents=2000;
  await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();await f.core.work('ui',1);
  f.advance(1000);await f.core.finish('ui',1,{kind:'correctness'});await f.core.reconcile();await f.core.reconcile();
  f.advance(elapsedAfterFirstMs); // A large legacy unknown-create estimate is not a debit.
  const old=await f.state(),ended=await f.ui(),anchor=structuredClone((await f.core.load()).manualProgram);
  const m=structuredClone(f.m);m.id='actual-next';m.deadline=f.now()+900000;
  const prearm=await f.arm(m,'2'.repeat(32));await f.core.stage(m);
  for(const [input,bytes] of [[f.inputs[0],f.cp],[f.inputs[1],f.corpus],[f.inputs[2],f.recipe]])await f.core.putObject(m.id,input,bytes);
  const registry={...f.registry,references:[f.manifest.externalControl,m.externalControl]},registryRef={...f.intent.registry,path:`control/prearms/${'9'.repeat(32)}.json`,sha256:await hash(registry)};
  f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
  const binding=await f.core.actualSpendBinding();
  const observation={schema:1,kind:'operator-actual-spend-reconciliation',id:'5'.repeat(32),priorCampaignId:'pilot',ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,
    authority:{kind:'user-actual-spend-basis-correction',evidenceSha256:'a'.repeat(64),repairCeilingCents:2000,runpodCeilingCents:10000},accountId:'test-account',observedAt:f.now(),validUntil:f.now()+900000,
    balance:{openingCreditCents:10000,currentCreditCents:9997,debitsCents:3,creditsCents:0,currentHourlyCents:0,autoPay:false,evidenceSha256:'b'.repeat(64)},
    inventory:{ordinary:{complete:true,evidenceSha256:'c'.repeat(64),resourceIds:[]},queued:{complete:true,evidenceSha256:'d'.repeat(64),resourceIds:[]}},activeResources:[]};
  const freeze=async()=>f.receipt(observation,'6');
  const ref=await freeze();
  const intent={...f.intent,id:'2'.repeat(32),campaignId:m.id,manifestSha256:await hash(m),name:prearm.launches[0].name,registry:registryRef,createdAt:f.now(),expiresAt:f.now()+300000,liabilityUntil:f.now()+8100000,priorRiskReserveCents:0,actualSpendBasisSha256:ref.sha256,fundingSha256:await hash(m.cash)};
  const ready={...f.ready,registry:registryRef,observedAt:f.now(),run:{...f.ready.run,results:registry.references.map(r=>({prearmSha256:r.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}};
  intent.cleanupReady=await f.receipt(ready,'8');
  const funding=structuredClone(f.funding);funding.kind='operator-actual-funding-freeze';funding.basisSha256=ref.sha256;
  funding.oldAttempt.supplementalRiskHoldCents=0;funding.oldAttempt.protectedShutdownReserveCents=0;
  Object.assign(funding.newIntent,{latestAdmission:new Date(f.now()+900000).toISOString(),latestWorkCutoff:new Date(m.deadline).toISOString(),responseUntil:new Date(intent.liabilityUntil).toISOString()});
  Object.assign(funding.aggregate,{runpodEncumberedCents:230,repairEncumberedCents:230,cloudflareEncumberedCents:200});
  const freezeFunding=async()=>{intent.fundingReservation=await f.receipt(funding,'7');};await freezeFunding();
  return {...f,old,ended,anchor,m,observation,ref,freeze,intent,funding,freezeFunding};
}
