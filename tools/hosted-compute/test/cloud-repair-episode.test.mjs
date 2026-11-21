import test from 'node:test';
import assert from 'node:assert/strict';
import {actualFixture} from './actual-spend-fixture.mjs';
import {fixture} from './helpers.mjs';
import {CLOUD_REPAIR as P,validateCloudRepairWindow} from '../cloud-repair-policy.mjs';
import {cloudRepairAuthority,consumeCloudRepairCreate} from '../cloud-repair-episode.mjs';
import {spendBinding} from '../actual-spend.mjs';
import {validateManualIntent} from '../manual-authority.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

async function setup(){
 const f=await actualFixture();await f.core.reconcileActualSpend('pilot',f.ref);f.config.authorizedCents=10000;f.advance(P.repairStartedAt+60000-f.now());
 const db=await f.core.load();db.exploratoryWindow={schema:1,authority:{id:'historical'},creates:[{campaignId:'old-create'}]};
 const oldWindow=structuredClone(db.exploratoryWindow),oldManual=structuredClone(db.manualProgram);
 const c=structuredClone(db.campaigns['actual-next']);c.manifest.id='repair-1';c.manifest.checkpointSha256=P.checkpointSha256;
 const trainingStop=f.now()+10*3600000,artifactDeadline=trainingStop+P.artifactAfterTrainingMs;
 c.manifest.exploratory={schema:2,episodeId:P.id,allocationStart:f.now(),trainingStop,artifactDeadline,
  maximumSameAllocationResumes:0,artifactAfterTrainingMs:P.artifactAfterTrainingMs,handoffAt:trainingStop-300000};
 c.manifestSha256=await hash(c.manifest);db.campaigns[c.manifest.id]=c;
 const r={schema:2,kind:'bounded-exploratory-training-window',id:P.id,preserveHistoricalAuthorities:true,
  maximumCreates:3,maximumAllocationMs:P.maximumAllocationMs,artifactAfterTrainingMs:P.artifactAfterTrainingMs,
  maximumSameAllocationResumes:0,repairStartedAt:P.repairStartedAt,admissionDeadline:P.repairDeadline,
  createdAt:f.now(),allocationStart:f.now(),trainingStop,artifactDeadline,liabilityUntil:artifactDeadline+7200000,
  accountId:'test-account',sourceRevision:c.manifest.sourceRevision,seed:c.manifest.seed,
  executionRecipeSha256:c.manifest.executionRecipeSha256,recipeSha256:c.manifest.recipeSha256,
  dataSha256:c.manifest.corpusSha256,reviewSha256:'a'.repeat(64),repairMaxCents:10000,lagContingencyCents:50,
  ledgerSha256:(await spendBinding(db)).ledgerSha256};
 const intent={...f.intent,campaignId:c.manifest.id,manifestSha256:c.manifestSha256,exploratoryEpisode:P.id,
  createdAt:f.now(),expiresAt:f.now()+300000,runtimeWindowMs:P.maximumAllocationMs,
  repairDeadline:P.repairDeadline,repairMaxCents:10000,liabilityUntil:r.liabilityUntil,
  startup:{schema:1,kind:'confirmed-pod-startup',maximumMs:900000,deadline:f.now()+900000}};
 intent.exploratoryWindow=await f.receipt(r,'c');
 return {...f,db,c,r,intent,oldWindow,oldManual};
}

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
