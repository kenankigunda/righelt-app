import test from 'node:test';
import assert from 'node:assert/strict';
import {actualFixture} from './actual-spend-fixture.mjs';
import {fixture} from './helpers.mjs';
import {CLOUD_REPAIR as P,CLOUD_LAUNCH as L,CLOUD_REPLACEMENT as R,validateCloudRepairWindow} from '../cloud-repair-policy.mjs';
import {cloudRepairAuthority,consumeCloudRepairCreate} from '../cloud-repair-episode.mjs';
import {spendBinding,actualEnvelope} from '../actual-spend.mjs';
import {validateManualIntent} from '../manual-authority.mjs';
import {canonical,encode,sha256,reserveCents} from '../policy.mjs';
import {EXPLORATORY_PURPOSE} from '../exploratory-policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

async function setup({launch=false,replacement=false}={}){
 if(replacement)launch=true;
 const f=await actualFixture();await f.core.reconcileActualSpend('pilot',f.ref);f.config.authorizedCents=10000;f.advance((replacement?R.authorizedAt:launch?L.authorizedAt:P.repairStartedAt)+60000-f.now());
 const db=await f.core.load();db.exploratoryWindow={schema:1,authority:{id:'historical'},creates:[{campaignId:'old-create'}]};
 const oldWindow=structuredClone(db.exploratoryWindow),oldManual=structuredClone(db.manualProgram);
 const c=structuredClone(db.campaigns['actual-next']);c.manifest.id='repair-1';c.manifest.checkpointSha256=P.checkpointSha256;
 const trainingStop=f.now()+10*3600000,artifactDeadline=trainingStop+P.artifactAfterTrainingMs;
 c.manifest.exploratory={schema:2,episodeId:P.id,allocationStart:f.now(),trainingStop,artifactDeadline,
  maximumSameAllocationResumes:0,artifactAfterTrainingMs:P.artifactAfterTrainingMs,handoffAt:trainingStop-300000};
 if(launch)Object.assign(c.manifest.exploratory,{launchAuthorityId:L.id,launchAuthorizedAt:L.authorizedAt,launchAdmissionDeadline:L.admissionDeadline,additionalRepairMs:0});
 if(replacement){
  const ready={kind:'bounded-repair-ready',authorityId:R.id,sourceRevision:c.manifest.sourceRevision,image:c.manifest.phases[0].host.image,repairReadyAt:f.now(),checksPassed:true,reviewPassed:true,imageVerified:true};
  const bytes=encode(canonical(ready)),proof={path:'.ai-runs/ready.json',sha256:await sha256(bytes)};
  Object.assign(c.manifest.exploratory,{launchAuthorityId:R.id,repairReadyAt:f.now(),launchAuthorizedAt:f.now(),launchAdmissionDeadline:Math.min(f.now()+R.maximumQualificationMs,R.qualificationDeadline),memoryScope:R.memoryScope,repairReadyProof:proof,consumedWorkTransfer:{path:'.ai-runs/consumed.json',sha256:R.consumptionEvidenceSha256}});
  c.manifest.inputs.push({...proof,name:'ready.json',bytes:bytes.length});c.objects[proof.sha256]={bytes:bytes.length};await f.bucket.put(c.manifest.id+'/'+proof.sha256,bytes);
  const parent=structuredClone(db.campaigns.ui);parent.manifest.id=R.consumedCampaignId;parent.status='failed';parent.cleanupVerified=true;db.campaigns[parent.manifest.id]=parent;
  db.exploratoryEpisodes={[P.id]:{schema:2,authority:{id:'retained'},reference:{sha256:'e'.repeat(64)},creates:[{campaignId:parent.manifest.id}]}};
 }
 c.manifestSha256=await hash(c.manifest);db.campaigns[c.manifest.id]=c;
 const r={schema:launch?3:2,kind:'bounded-exploratory-training-window',id:P.id,preserveHistoricalAuthorities:true,
  maximumCreates:3,maximumAllocationMs:P.maximumAllocationMs,artifactAfterTrainingMs:P.artifactAfterTrainingMs,
  maximumSameAllocationResumes:0,repairStartedAt:P.repairStartedAt,admissionDeadline:launch?L.admissionDeadline:P.repairDeadline,
  createdAt:f.now(),allocationStart:f.now(),trainingStop,artifactDeadline,liabilityUntil:artifactDeadline+7200000,
  accountId:'test-account',sourceRevision:c.manifest.sourceRevision,seed:c.manifest.seed,
  executionRecipeSha256:c.manifest.executionRecipeSha256,recipeSha256:c.manifest.recipeSha256,
  dataSha256:c.manifest.corpusSha256,reviewSha256:'a'.repeat(64),repairMaxCents:10000,lagContingencyCents:50,
  ledgerSha256:(await spendBinding(db)).ledgerSha256};
 if(launch)Object.assign(r,{launchAuthorityId:L.id,launchAuthorizedAt:L.authorizedAt,repairDeadline:P.repairDeadline,additionalRepairMs:0});
 if(replacement)Object.assign(r,{launchAuthorityId:R.id,repairReadyAt:f.now(),launchAuthorizedAt:f.now(),admissionDeadline:c.manifest.exploratory.launchAdmissionDeadline,repairReadyProofSha256:c.manifest.exploratory.repairReadyProof.sha256,consumedWorkTransferSha256:R.consumptionEvidenceSha256,memoryScope:R.memoryScope,maximumReplacementOrdinal:2,maximumAdditionalCreates:1});
 const intent={...f.intent,campaignId:c.manifest.id,manifestSha256:c.manifestSha256,exploratoryEpisode:P.id,
  createdAt:f.now(),expiresAt:f.now()+300000,runtimeWindowMs:P.maximumAllocationMs,
  repairDeadline:launch?L.admissionDeadline:P.repairDeadline,repairMaxCents:10000,liabilityUntil:r.liabilityUntil,
  startup:{schema:1,kind:'confirmed-pod-startup',maximumMs:900000,deadline:f.now()+900000}};
 if(launch)intent.exploratoryLaunch=replacement?R.id:L.id;
 if(replacement)intent.repairDeadline=r.admissionDeadline;
 intent.exploratoryWindow=await f.receipt(r,'c');
 return {...f,db,c,r,intent,oldWindow,oldManual};
}

async function manualRepairFixture(options){
 const f=await setup(options),{c,intent,r}=f,m=c.manifest,host=m.phases[0].host;
 // Compose the admission boundary with synthetic, already-staged input records.
 // This does not claim cryptographic original-checkpoint staging or CUDA proof.
 m.purpose=EXPLORATORY_PURPOSE;m.deadline=r.artifactDeadline;m.maxCents=2000;m.cash.computeUsageCapCents=2000;
 host.quoteObservedAt=f.now();host.quoteExpires=f.now()+900000;
 const prearm=await f.arm(m,'3'.repeat(32));c.manifestSha256=await hash(m);await f.core.save(f.db);
 const binding=await f.core.actualSpendBinding();
 Object.assign(f.observation,{id:'a'.repeat(32),ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,observedAt:f.now(),validUntil:f.now()+900000});
 f.observation.authority.repairCeilingCents=10000;
 const basis=await f.receipt(f.observation,'a');await f.core.reconcileActualSpend('pilot',basis);
 const registry={...f.registry,references:[f.manifest.externalControl,m.externalControl]};
 const registryRef={...f.intent.registry,path:`control/prearms/${'9'.repeat(32)}.json`,sha256:await hash(registry)};
 f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
 const ready={...f.ready,registry:registryRef,observedAt:f.now(),run:{...f.ready.run,results:registry.references.map(reference=>({prearmSha256:reference.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}};
 Object.assign(intent,{manifestSha256:c.manifestSha256,name:prearm.launches[0].name,registry:registryRef,
  repairStartedAt:P.repairStartedAt,actualSpendBasisSha256:basis.sha256,fundingSha256:await hash(m.cash),cleanupReady:await f.receipt(ready,'b')});
 r.ledgerSha256=(await f.core.actualSpendBinding()).ledgerSha256;intent.exploratoryWindow=await f.receipt(r,'c');
 const funding=structuredClone(f.funding);funding.basisSha256=basis.sha256;
 Object.assign(funding.newIntent,{computeAllocationCents:m.maxCents,protectedShutdownReserveCents:reserveCents(m.maxCents),
  latestAdmission:new Date(intent.startup.deadline).toISOString(),latestWorkCutoff:new Date(m.deadline).toISOString(),
  responseUntil:new Date(intent.liabilityUntil).toISOString(),startupDeadline:intent.startup.deadline});
 const amount=actualEnvelope(f.core,await f.core.load(),c,intent,r).requiredCents;
 Object.assign(funding.aggregate,{runpodEncumberedCents:amount,repairEncumberedCents:amount,repairCeilingCents:10000});
 intent.fundingReservation=await f.receipt(funding,'d');
 return f;
}

test('composed manual prepare and attach accept the new repair clock while retaining original attempt history',async()=>{
 const f=await manualRepairFixture(),before=await f.core.load(),creates=f.providers.creates;
 const prepared=await f.core.manualPrepare(f.c.manifest.id,f.intent),after=await f.core.load();
 assert(prepared.workerToken);assert.equal(after.exploratoryEpisodes[P.id].creates.length,1);
 assert.deepEqual(after.exploratoryWindow,f.oldWindow);assert.deepEqual(after.manualProgram,f.oldManual);
 assert.deepEqual(after.campaigns.pilot,before.campaigns.pilot);assert.equal(f.providers.creates,creates);
 f.providers.resources.set('repair-pod',{id:'repair-pod',name:f.intent.name,host:f.c.manifest.phases[0].host});
 await f.core.manualAttach(f.c.manifest.id,{intentSha256:prepared.intentSha256,podId:'repair-pod',acceptedAt:f.now(),accountId:f.intent.accountId});
 assert.equal((await f.core.load()).campaigns[f.c.manifest.id].programAnchor.deadline,f.r.artifactDeadline);
 for(const clock of [f.intent.priorAttempt.startedAt,P.repairStartedAt+1]){
  const g=await manualRepairFixture(),untouched=await g.core.load();g.intent.repairStartedAt=clock;
  await assert.rejects(g.core.manualPrepare(g.c.manifest.id,g.intent),/repair clock/);assert.deepEqual(await g.core.load(),untouched);
 }
});

test('new repair uses a separate append-only three-create ledger and preserves historical authority',async()=>{
 const f=await setup();validateManualIntent(f.intent);validateCloudRepairWindow(f.c.manifest.exploratory);
 let current=f.c;
 for(let i=0;i<3;i++){
  if(i){current=structuredClone(f.c);current.manifest.id='repair-'+(i+1);current.manifestSha256=await hash(current.manifest);f.db.campaigns[current.manifest.id]=current;}
  const intent={...f.intent,campaignId:current.manifest.id,manifestSha256:current.manifestSha256};
  const window=await cloudRepairAuthority(f.core,f.db,current,intent);
  consumeCloudRepairCreate(f.core,f.db,current,intent,window,'d'.repeat(64));
  Object.assign(current,{cleanupVerified:true});current.attempts=[{endedAt:f.now(),uncertain:false}];
 }
 const next=structuredClone(current);next.manifest.id='repair-4';next.manifestSha256=await hash(next.manifest);
 await assert.rejects(cloudRepairAuthority(f.core,f.db,next,{...f.intent,campaignId:next.manifest.id}),/allowances consumed/);
 assert.equal(f.db.exploratoryEpisodes[P.id].creates.length,3);
 assert.deepEqual(f.db.exploratoryWindow,f.oldWindow);assert.deepEqual(f.db.manualProgram,f.oldManual);
 assert.equal(f.providers.creates,1,'authority and consumption perform no new provider I/O');
});

test('unknown create blocks replacement and clock, source, allowance and ledger changes reject',async()=>{
 const f=await setup(),window=await cloudRepairAuthority(f.core,f.db,f.c,f.intent);
 consumeCloudRepairCreate(f.core,f.db,f.c,f.intent,window,'d'.repeat(64));
 f.c.cleanupVerified=true;f.c.attempts=[{endedAt:f.now(),uncertain:true}];
 const next=structuredClone(f.c);next.manifest.id='repair-next';next.manifestSha256=await hash(next.manifest);
 await assert.rejects(cloudRepairAuthority(f.core,f.db,next,{...f.intent,campaignId:next.manifest.id}),/uncertain/);
 for(const change of [{maximumCreates:4},{admissionDeadline:P.repairDeadline+1},{maximumSameAllocationResumes:1},{sourceRevision:'f'.repeat(40)}]){
  const g=await setup();g.intent.exploratoryWindow=await g.receipt({...g.r,...change},'c');
  await assert.rejects(cloudRepairAuthority(g.core,g.db,g.c,g.intent));
 }
 const g=await setup();g.db.manualRiskHolds={changed:1};await assert.rejects(cloudRepairAuthority(g.core,g.db,g.c,g.intent),/ledger changed/);
});

test('twelve-hour ceiling binds the conservative allocation start, never global repair expiry',()=>{
 const e={schema:2,episodeId:P.id,allocationStart:P.repairStartedAt,trainingStop:P.repairStartedAt+P.maximumAllocationMs,
  artifactDeadline:P.repairStartedAt+P.maximumAllocationMs+P.artifactAfterTrainingMs,maximumSameAllocationResumes:0,artifactAfterTrainingMs:P.artifactAfterTrainingMs};
 validateCloudRepairWindow(e);
 assert.throws(()=>validateCloudRepairWindow({...e,trainingStop:e.trainingStop+1,artifactDeadline:e.artifactDeadline+1}),/twelve|allocation/);
});

test('work is granted once durably and a new controller cannot reopen the same allocation',async()=>{
 const f=await fixture();await f.launch();
 const db=await f.core.load(),c=db.campaigns.pilot;
 // Exercise the work boundary on an already qualified synthetic placement.
 // Admission authority and paid provider creation are covered separately.
 c.manifest.exploratory={schema:2,episodeId:P.id};await f.core.save(db);
 const first=await f.core.work('pilot',1);assert.equal(first.resume,false);
 assert.equal((await f.state()).attempts[0].workGrantedAt,f.now());
 await assert.rejects(f.controller().work('pilot',1),/no worker restart/);
 for(const change of [record=>{delete record.attempts[0].workGrantedAt;record.attempts[0].recovery=true;},
  record=>{delete record.attempts[0].workGrantedAt;record.snapshot={id:'recovery'};}]){
  const altered=await f.core.load();change(altered.campaigns.pilot);await f.core.save(altered);
  await assert.rejects(f.controller().work('pilot',1),/no worker restart/);
 }
 assert.equal(f.providers.creates,1);
});


test('fresh launch composes prepare and attach without reopening expired repair or separate create pools',async()=>{
 const f=await manualRepairFixture({launch:true}),before=await f.core.load();
 validateManualIntent(f.intent);validateCloudRepairWindow(f.c.manifest.exploratory);
 const prepared=await f.core.manualPrepare(f.c.manifest.id,f.intent),db=await f.core.load();
 assert.equal(db.exploratoryEpisodes[P.id].creates.length,1);
 assert.equal(db.exploratoryEpisodes[P.id].scheduleAuthorities[L.id].authority.additionalRepairMs,0);
 assert.deepEqual(db.manualProgram,before.manualProgram);assert.deepEqual(db.campaigns.pilot,before.campaigns.pilot);
 f.providers.resources.set('launch-pod',{id:'launch-pod',name:f.intent.name,host:f.c.manifest.phases[0].host});
 await f.core.manualAttach(f.c.manifest.id,{intentSha256:prepared.intentSha256,podId:'launch-pod',acceptedAt:f.now(),accountId:f.intent.accountId});
 assert.equal((await f.core.load()).campaigns[f.c.manifest.id].programAnchor.deadline,f.r.artifactDeadline);
 for(const mutate of [g=>g.advance(L.admissionDeadline-g.now()),g=>{delete g.intent.exploratoryLaunch;},g=>{g.c.manifest.exploratory.additionalRepairMs=1;}]){
  const g=await manualRepairFixture({launch:true});mutate(g);
  if(g.c.manifest.exploratory.additionalRepairMs) {const d=await g.core.load();d.campaigns[g.c.manifest.id].manifest.exploratory.additionalRepairMs=1;await g.core.save(d);}
  const unchanged=await g.core.load();await assert.rejects(g.core.manualPrepare(g.c.manifest.id,g.intent));assert.deepEqual(await g.core.load(),unchanged);
 }
});

test('prospective schedule retains the prior episode authority and consumes only the remaining shared allowance',async()=>{
 const f=await setup({launch:true}),oldAuthority={id:'retained-old-authority'},oldReference={sha256:'e'.repeat(64)};
 const prior=structuredClone(f.c);prior.manifest.id='earlier-create';prior.attempts=[{endedAt:f.now()-1000,uncertain:false}];prior.cleanupVerified=true;f.db.campaigns[prior.manifest.id]=prior;
 f.db.exploratoryEpisodes={[P.id]:{schema:2,authority:oldAuthority,reference:oldReference,creates:[{campaignId:prior.manifest.id}]}};
 f.r.ledgerSha256=(await spendBinding(f.db)).ledgerSha256;f.intent.exploratoryWindow=await f.receipt(f.r,'c');
 const w=await cloudRepairAuthority(f.core,f.db,f.c,f.intent);consumeCloudRepairCreate(f.core,f.db,f.c,f.intent,w,'d'.repeat(64));
 const episode=f.db.exploratoryEpisodes[P.id];assert.equal(episode.creates.length,2);assert.deepEqual(episode.authority,oldAuthority);assert.deepEqual(episode.reference,oldReference);
 Object.assign(f.c,{cleanupVerified:true,attempts:[{endedAt:f.now(),uncertain:false}]});
 const next=structuredClone(f.c);next.manifest.id='last-create';next.manifestSha256=await hash(next.manifest);f.db.campaigns[next.manifest.id]=next;
 const intent={...f.intent,campaignId:next.manifest.id,manifestSha256:next.manifestSha256};
 consumeCloudRepairCreate(f.core,f.db,next,intent,await cloudRepairAuthority(f.core,f.db,next,intent),'d'.repeat(64));
 const fourth=structuredClone(next);fourth.manifest.id='fourth-create';
 await assert.rejects(cloudRepairAuthority(f.core,f.db,fourth,{...intent,campaignId:fourth.manifest.id}),/allowances consumed/);
 assert.equal(episode.creates.length,3);assert.deepEqual(episode.authority,oldAuthority);
});


test('bounded replacement admits only actual ready source/image and only global ordinal two',async()=>{
 const f=await manualRepairFixture({replacement:true}),before=await f.core.load();
 const prepared=await f.core.manualPrepare(f.c.manifest.id,f.intent),after=await f.core.load();
 assert(prepared.workerToken);assert.equal(after.exploratoryEpisodes[P.id].creates.length,2);
 assert.deepEqual(after.exploratoryEpisodes[P.id].authority,before.exploratoryEpisodes[P.id].authority);
 assert.equal(after.exploratoryEpisodes[P.id].scheduleAuthorities[R.id].authority.maximumAdditionalCreates,1);
 const third=structuredClone(f.c);third.manifest.id='forbidden-third';third.manifestSha256=await hash(third.manifest);
 await f.bucket.put(third.manifest.id+'/'+f.c.manifest.exploratory.repairReadyProof.sha256,
  (await f.bucket.get(f.c.manifest.id+'/'+f.c.manifest.exploratory.repairReadyProof.sha256)).body);
 await assert.rejects(cloudRepairAuthority(f.core,after,third,{...f.intent,campaignId:third.manifest.id,manifestSha256:third.manifestSha256}),/ordinal two/);
 for(const change of ['expired','ready-body','repair-clock','ordinal']){
  const g=await manualRepairFixture({replacement:true});
  if(change==='expired')g.advance(g.intent.repairDeadline-g.now());
  if(change==='ready-body')await g.bucket.put(g.c.manifest.id+'/'+g.c.manifest.exploratory.repairReadyProof.sha256,encode('{}'));
  if(change==='repair-clock')g.intent.repairDeadline=R.qualificationDeadline+1;
  if(change==='ordinal'){const d=await g.core.load();d.exploratoryEpisodes[P.id].creates.push({campaignId:'another'});await g.core.save(d);}
  const untouched=await g.core.load();await assert.rejects(g.core.manualPrepare(g.c.manifest.id,g.intent));assert.deepEqual(await g.core.load(),untouched);
 }
});
