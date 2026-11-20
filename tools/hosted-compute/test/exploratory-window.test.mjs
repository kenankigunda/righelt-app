import test from 'node:test';
import assert from 'node:assert/strict';
import {actualFixture} from './actual-spend-fixture.mjs';
import {canonical,encode,sha256,reserveCents} from '../policy.mjs';
import {actualEnvelope} from '../actual-spend.mjs';
import {exploratoryAuthority,consumeExploratoryCreate} from '../exploratory-window.mjs';
import {TRAINING_STOP,ARTIFACT_DEADLINE,LIABILITY_END,EXPLORATORY_PURPOSE} from '../exploratory-policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

async function exploratoryFixture(){
 const f=await actualFixture();f.config.authorizedCents=10000;f.advance(Date.UTC(2026,10,20,3)-f.now());
 let db=await f.core.load();const original=structuredClone(db.manualProgram);
 const b6=structuredClone(db.campaigns.pilot);b6.manifest.id='old-b6';b6.manifest.deadline=f.now()+86400000;
 const oldPrearm=await f.arm(b6.manifest,'b'.repeat(32));b6.manifestSha256=await hash(b6.manifest);
 b6.attempts[0].name=oldPrearm.launches[0].name;b6.attempts[0].prearmSha256=b6.manifest.externalControl.sha256;
 b6.status='cleanup-uncertain';b6.cleanupVerified=false;db.campaigns['old-b6']=b6;
 f.control.fences.set(oldPrearm.nonce,{kind:'terminal',prearmSha256:b6.manifest.externalControl.sha256});await f.core.save(db);
 const m=structuredClone(f.m);m.id='overnight-b';m.purpose=EXPLORATORY_PURPOSE;m.deadline=ARTIFACT_DEADLINE;
 m.maxCents=1000;m.cash.computeUsageCapCents=1000;
 const phase=m.phases[0];phase.kind='training';phase.seconds=Math.floor((ARTIFACT_DEADLINE-f.now())/1000);
 phase.runDir='.ai-runs/overnight-b';phase.outputs=['candidate'];phase.outputPaths={candidate:phase.runDir+'/exploratory-result.json'};
 phase.expect={candidate:{qualified:true,strengthEstablished:false,defaultPromotion:false}};
 Object.assign(phase.host,{hourlyCents:24,minRamGb:31,minVcpu:8,dataCenterId:'EUR-IS-1',quoteObservedAt:f.now(),quoteExpires:f.now()+900000});
 const additions=[];
 async function input(name,value){const raw=encode(canonical(value)),a={name,path:'.ai-runs/control/'+name,sha256:await sha256(raw),bytes:raw.length};m.inputs.push(a);additions.push([a,raw]);return a;}
 const plan=await input('plan.json',{schema:1,kind:'attention-exploratory-window'}),gate=await input('source-gate.json',{schema:1,kind:'exploratory-source-gate'}),scope=await input('scope.json',{schema:1,kind:'exploratory-continuation-input-scope-v1'});
 phase.planSha256=plan.sha256;phase.argv=['tools/ai-trainer/.venv/bin/python','-m','righelt_training.exploratory_cloud','--plan',plan.path,'--gate-report',gate.path];phase.resumeArgv=[...phase.argv];
 m.exploratory={schema:1,planSha256:plan.sha256,canonicalPlanSha256:'f'.repeat(64),gateSha256:gate.sha256,
  methodInputScopeSha256:scope.sha256,trainingStop:TRAINING_STOP,artifactDeadline:ARTIFACT_DEADLINE,
  handoffAt:f.now()+7200000,maxPublicationObjects:500,maxPublicationBytes:128*1024*1024};
 const prearm=await f.arm(m,'3'.repeat(32));await f.core.stage(m);
 for(const [a,raw]of [[f.inputs[0],f.cp],[f.inputs[1],f.corpus],[f.inputs[2],f.recipe],...additions])await f.core.putObject(m.id,a,raw);
 const binding=await f.core.actualSpendBinding();
 Object.assign(f.observation,{id:'a'.repeat(32),ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,observedAt:f.now(),validUntil:f.now()+900000});
 f.observation.authority.repairCeilingCents=10000;
 const basis=await f.receipt(f.observation,'a');await f.core.reconcileActualSpend('pilot',basis);
 const registry={schema:1,kind:'runpod-finite-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[f.manifest.externalControl,b6.manifest.externalControl,m.externalControl]};
 const registryRef={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/prearms/${'4'.repeat(32)}.json`,sha256:await hash(registry)};
 f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
 const ready={schema:1,kind:'finite-cleanup-readiness',registry:registryRef,runtimeRevision:registry.runtimeRevision,
  workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.now(),run:{id:321,headSha:'8'.repeat(40),conclusion:'success',
  results:registry.references.map((r,i)=>({prearmSha256:r.sha256,state:i===2?'waiting':'terminal',failures:0,cleanupObservedAbsent:i!==2,durableReceiptConfirmed:i!==2,usageReviewRequired:false}))}};
 const authority={schema:1,kind:'bounded-exploratory-training-window',id:'overnight-20261119',maximumCreates:2,
  preserveHistoricalAuthorities:true,createdAt:f.now(),admissionDeadline:f.now()+900000,trainingStop:TRAINING_STOP,
  artifactDeadline:ARTIFACT_DEADLINE,liabilityUntil:LIABILITY_END,accountId:'test-account',sourceRevision:m.sourceRevision,
  seed:m.seed,executionRecipeSha256:m.executionRecipeSha256,recipeSha256:m.recipeSha256,dataSha256:m.corpusSha256,
  reviewSha256:'7'.repeat(64),repairMaxCents:10000,lagContingencyCents:52,ledgerSha256:(await f.core.actualSpendBinding()).ledgerSha256};
 const intent={...f.intent,id:'c'.repeat(32),campaignId:m.id,manifestSha256:await hash(m),name:prearm.launches[0].name,
  sourceRevision:m.sourceRevision,createdAt:f.now(),expiresAt:f.now()+300000,repairDeadline:authority.admissionDeadline,
  repairMaxCents:10000,liabilityUntil:LIABILITY_END,registry:registryRef,actualSpendBasisSha256:basis.sha256,
  fundingSha256:await hash(m.cash),cleanupReady:await f.receipt(ready,'b'),
  exploratoryWindow:await f.receipt(authority,'c'),startup:{schema:1,kind:'confirmed-pod-startup',maximumMs:900000,deadline:f.now()+900000}};
 const funding=structuredClone(f.funding);funding.basisSha256=basis.sha256;
 Object.assign(funding.newIntent,{computeAllocationCents:m.maxCents,protectedShutdownReserveCents:reserveCents(m.maxCents),
  allInHourlyCeilingCents:24,host:phase.host.gpu,dataCenterId:phase.host.dataCenterId,diskGb:phase.host.diskGb,gpuCount:1,
  latestAdmission:new Date(authority.admissionDeadline).toISOString(),latestWorkCutoff:new Date(ARTIFACT_DEADLINE).toISOString(),
  responseUntil:new Date(LIABILITY_END).toISOString(),startupDeadline:intent.startup.deadline});
 const amount=actualEnvelope(f.core,await f.core.load(),(await f.core.load()).campaigns[m.id],intent,authority).requiredCents;
 Object.assign(funding.aggregate,{runpodEncumberedCents:amount,repairEncumberedCents:amount,repairCeilingCents:10000});
 intent.fundingReservation=await f.receipt(funding,'d');
 return {...f,m,intent,authority,original,b6,funding};
}

test('new window admits after historical expiry, funds conditional old streams and consumes before credentials',async()=>{
 const f=await exploratoryFixture(),before=await f.core.load(),creates=f.providers.creates;
 const prepared=await f.core.manualPrepare(f.m.id,f.intent),after=await f.core.load();
 assert(prepared.workerToken);assert.deepEqual(after.manualProgram,f.original);
 assert.deepEqual(after.campaigns.pilot.attempts,before.campaigns.pilot.attempts);
 assert.deepEqual(after.campaigns['old-b6'].attempts,before.campaigns['old-b6'].attempts);
 assert.equal(after.exploratoryWindow.creates.length,1);assert.equal(f.providers.creates,creates);
 assert(f.funding.aggregate.runpodEncumberedCents>3000);assert(f.funding.aggregate.runpodEncumberedCents<10000);
 await f.core.manualPrepare(f.m.id,f.intent);assert.equal((await f.core.load()).exploratoryWindow.creates.length,1);
 f.providers.resources.set('pod',{id:'pod',name:f.intent.name,host:f.m.phases[0].host});
 await f.core.manualAttach(f.m.id,{intentSha256:prepared.intentSha256,podId:'pod',acceptedAt:f.now(),accountId:'test-account'});
 await f.core.manualReady(f.m.id,1,{intentSha256:prepared.intentSha256,podId:'pod',sessionId:'a'.repeat(32)});
 await f.core.heartbeat(f.m.id,1);
 assert.equal((await f.core.load()).campaigns[f.m.id].programAnchor.deadline,ARTIFACT_DEADLINE);
 assert.deepEqual((await f.core.load()).manualProgram,f.original);
});
test('new purpose cannot start through automatic legacy launch or omit the typed window',async()=>{
 const f=await exploratoryFixture();await assert.rejects(f.core.start(f.m.id),/explicit new window/);
 const intent=structuredClone(f.intent);delete intent.exploratoryWindow;
 await assert.rejects(f.core.manualPrepare(f.m.id,intent));assert.equal((await f.core.load()).exploratoryWindow,undefined);
});
test('conditional old streams and lag cannot be replaced by zero-current-rate or historical allocation estimates',async()=>{
 const f=await exploratoryFixture();f.authority.lagContingencyCents=9900;
 f.intent.exploratoryWindow=await f.receipt(f.authority,'c');
 const before=await f.core.load();await assert.rejects(f.core.manualPrepare(f.m.id,f.intent),/allowance/);
 assert.deepEqual(await f.core.load(),before);
});
test('second different placement requires exact cleaned preflight/no-consumption proof, never unknown work',async()=>{
 const f=await exploratoryFixture();await f.core.manualPrepare(f.m.id,f.intent);
 const db=await f.core.load(),first=db.campaigns[f.m.id];
 first.status='failed';first.cleanupVerified=true;Object.assign(first.attempts[0],{resourceId:'known-cleaned',endedAt:f.now(),workStartedAt:f.now(),uncertain:false});
 const marker={schema:1,kind:'cloud-preflight-disposition',campaignId:f.m.id,generation:1,sourceRevision:f.m.sourceRevision,
  planSha256:f.m.exploratory.canonicalPlanSha256,status:'failed',productiveWorkStarted:false};
 const bytes=encode(canonical(marker)),artifact={name:'preflight-state.json',path:f.m.phases[0].runDir+'/preflight-state.json',sha256:await sha256(bytes),bytes:bytes.length};
 await f.bucket.put(`${f.m.id}/${artifact.sha256}`,bytes);first.files=[artifact];
 const next=structuredClone(first);next.manifest.id='overnight-b2';next.manifest.phases[0].host.gpu='Different qualified GPU';
 next.manifestSha256=await hash(next.manifest);next.status='staged';next.attempts=[];delete next.manual;
 const intent={...f.intent,campaignId:next.manifest.id,manifestSha256:next.manifestSha256};
 assert.equal((await exploratoryAuthority(f.core,db,next,intent)).authority.id,'overnight-20261119');
 for(const mutate of [c=>{c.attempts[0].resourceId=null;},c=>{c.claims={consumed:{}};},
  c=>{c.counters={generation:1};},c=>{c.outputs={model:{}};},c=>{c.cleanupVerified=false;}]){
  const changed=structuredClone(db);mutate(changed.campaigns[f.m.id]);
  await assert.rejects(exploratoryAuthority(f.core,changed,next,intent),/blocks replacement/);
 }
 consumeExploratoryCreate(f.core,db,next,intent,{reference:f.intent.exploratoryWindow,authority:f.authority},'e'.repeat(64));
 assert.equal(db.exploratoryWindow.creates.length,2);
 const third=structuredClone(next);third.manifest.id='overnight-b3';
 await assert.rejects(exploratoryAuthority(f.core,db,third,{...intent,campaignId:third.manifest.id}),/allowances consumed/);
});
