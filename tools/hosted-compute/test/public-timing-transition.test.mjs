import {publicWorkAuthority} from '../public-work.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {publicTimingFixture} from './public-timing-fixture.mjs';
import {runtimeUpgradeEndpoint} from '../runtime-upgrade.mjs';
import {publicTimingEndpoint} from '../public-timing-transition.mjs';
import {executionIdentity} from '../result.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import fixtureContract from '../fixture-contract.json' with {type:'json'};
const hash=value=>sha256(encode(canonical(value)));
async function setup(t,{long=false,diagnostic=false,diagnosticCap=500}={}){
 long=long||diagnostic;
 const fixture=await publicTimingFixture(t,{sourceRevision:'e'.repeat(40),...(diagnostic?{unavailable:'diagnostic'}:{}),...(long?{time:Date.UTC(2026,10,16,diagnostic?14:17,30)}:{})}),f=fixture.f,core=f.core;
 f.config.authorizedCents=2000;f.manifest.maxCents=1000;f.manifest.cash.computeUsageCapCents=1000;f.manifest.dependencySha256=fixture.manifest.dependencySha256;
 f.providers.create=async()=>{f.providers.creates++;throw Error('synthetic original lost response');};
 await f.stage();await core.start('pilot');await core.reconcile();await core.reconcile();f.advance(3600000);
 const prior=await f.state();
 const qualified=structuredClone(f.manifest);qualified.id='qualified';qualified.maxCents=300;qualified.cash.computeUsageCapCents=300;qualified.cash.cloudflareUsageCapCents=50;qualified.deadline=f.now()+900000;
 qualified.phases[0].workIds=fixtureContract.workIds;qualified.phases[0].seconds=600;qualified.phases[0].runDir='.ai-runs/qualified/run';qualified.phases[0].outputPaths.proof='.ai-runs/qualified/run/result.json';
 await f.arm(qualified,'3'.repeat(32));await core.stage(qualified);
 let db=await core.load(),q=db.campaigns.qualified;q.status='running';q.generation=1;q.phaseDeadline=f.now()+600000;
 q.attempts=[{provider:'runpod',resourceId:'qualified-pod',name:'qualified-pod',hourlyCents:100,startedAt:f.now(),workStartedAt:f.now(),leaseExpires:f.now()+120000,placement:{id:'qualified-pod'}}];await core.save(db);
 f.providers.resources.set('qualified-pod',{id:'qualified-pod',name:'qualified-pod',host:qualified.phases[0].host});
 const upload=async(id,raw,role,relative)=>{const a={name:role,sha256:await sha256(raw),bytes:raw.length,path:relative,role};await core.putObject(id,a,raw,1);return a;};
 const model=await upload('qualified',encode('synthetic fixture export'),'model','.ai-runs/qualified/run/model.onnx'),checkpoint=await upload('qualified',encode('synthetic fixture checkpoint'),'checkpoint','.ai-runs/qualified/run/checkpoint.pt');
 const execution=executionIdentity(qualified,q.manifestSha256,qualified.phases[0],1);
 const proof=await upload('qualified',encode(JSON.stringify({kind:'pipeline-proof',execution,export:{sha256:model.sha256},checkpointSha256:checkpoint.sha256,training:{updates:2,recoveryPassed:true},recoveredUpdates:2,parity:{numericPassed:true}})),'proof','.ai-runs/qualified/run/pipeline.json');
 const runtime=await upload('qualified',await fs.readFile(path.join(fixture.root,'.ai-runs/run/runtime-1.json')),'runtime','.ai-runs/qualified/run/runtime-1.json');
 const result=await upload('qualified',encode(JSON.stringify({schema:1,kind:'compute-result',disposition:'complete',passed:true,execution,completedWorkIds:fixtureContract.workIds,updates:2,parameterDelta:1,artifacts:[model,checkpoint,proof]})),'result','.ai-runs/qualified/run/result.json');
 await core.finish('qualified',1,{kind:'complete',outputs:{proof:result},files:[model,checkpoint,proof,runtime,result]});await core.reconcile();await core.reconcile();
 assert.equal((await core.load()).campaigns.qualified.status,'complete');f.advance(1000);
 const m=structuredClone(fixture.manifest);m.maxCents=diagnostic?diagnosticCap:long?500:300;m.cash.computeUsageCapCents=m.maxCents;m.cash.cloudflareUsageCapCents=50;m.deadline=f.now()+(long?3600000:900000);
 if(long){m.phases[0].seconds=3600;for(const argv of [m.phases[0].argv,m.phases[0].resumeArgv])argv[argv.indexOf('--seconds')+1]='3600';}
 if(diagnostic){
  const planInput=m.inputs.find(a=>a.role==='public-timing-plan'),recipeInput=m.inputs.find(a=>a.role==='public-timing-execution');
  const plan=JSON.parse(await fs.readFile(path.join(fixture.root,planInput.path)));plan.schedule=plan.schedule.slice(-1);
  const raw=encode(canonical(plan));planInput.sha256=await sha256(raw);planInput.bytes=raw.length;await fs.writeFile(path.join(fixture.root,planInput.path),raw);
  const recipe=JSON.parse(await fs.readFile(path.join(fixture.root,recipeInput.path)));recipe.planSha256=planInput.sha256;
  const recipeRaw=encode(canonical(recipe));recipeInput.sha256=await sha256(recipeRaw);recipeInput.bytes=recipeRaw.length;await fs.writeFile(path.join(fixture.root,recipeInput.path),recipeRaw);
  m.publicTiming.planSha256=planInput.sha256;m.recipeSha256=planInput.sha256;m.executionRecipeSha256=recipeInput.sha256;m.phases[0].planSha256=planInput.sha256;m.phases[0].workIds=plan.schedule.map(j=>j.id);
 }
 const prearm=await f.arm(m,'4'.repeat(32));await core.stage(m);
 for(const a of m.inputs)await core.putObject(m.id,a,await fs.readFile(path.join(fixture.root,a.path)));
 db=await core.load();db.manualProgram={acceptedAt:f.now()-60000,deadline:f.now()-60000+86400000,campaignId:'qualified',intentSha256:'f'.repeat(64)};await core.save(db);const anchor=structuredClone(db.manualProgram);
 f.control.records=new Map();f.control.fences=new Map([['f'.repeat(32),{kind:'terminal',prearmSha256:f.manifest.externalControl.sha256}]]);
 const receipt=async(value,n)=>{const ref={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/receipts/${n.repeat(32)}/${n.repeat(32)}.json`,sha256:await hash(value)};f.control.records.set(`${ref.path}@${ref.commit}`,value);return ref;};
 const registry={schema:1,kind:'runpod-dual-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[f.manifest.externalControl,m.externalControl]},registryRef={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/prearms/${'9'.repeat(32)}.json`,sha256:await hash(registry)};f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
 let shortTiming;
 if(long){
  const sf=await publicTimingFixture(t,{sourceRevision:m.sourceRevision,time:f.now(),campaignId:'short-public',...(diagnostic?{unavailable:'diagnostic'}:{})}),sc=sf.f.core;await sc.stage(sf.manifest);
  let sd=await sc.load(),s=sd.campaigns['short-public'];s.status='running';s.generation=1;s.phaseDeadline=sf.phaseDeadline;
  s.attempts=[{provider:'runpod',name:'short-pod',resourceId:'short-pod',hourlyCents:100,startedAt:sf.f.now(),workStartedAt:sf.f.now(),leaseExpires:sf.f.now()+120000,placement:{id:'short-pod'}}];await sc.save(sd);sf.f.providers.resources.set('short-pod',{id:'short-pod',name:'short-pod',host:sf.phase.host});
  const files=[];for(const a of sf.result.artifacts){await sc.putObject('short-public',a,await sf.read(a),1);files.push(a);}
  const raw=encode(JSON.stringify(sf.result)),out={name:'timing',sha256:await sha256(raw),bytes:raw.length};await sc.putObject('short-public',out,raw,1);files.push({...out,path:sf.phase.outputPaths.timing});
  await sc.finish('short-public',1,{kind:'complete',outputs:{timing:out},files});await sc.reconcile();await sc.reconcile();
  const closed=(await sc.load()).campaigns['short-public'];assert.equal(closed.status,'complete');assert.equal(closed.cleanupVerified,true);
  db=await core.load();db.campaigns['short-public']=closed;await core.save(db);for(const [key,value]of sf.f.bucket.data)await f.bucket.put(key,value);
  shortTiming={campaignId:'short-public',manifestSha256:closed.manifestSha256,resultSha256:out.sha256};
 }
 const binding=await core.actualSpendBinding(),observation={schema:1,kind:'operator-actual-spend-reconciliation',id:'5'.repeat(32),priorCampaignId:'pilot',ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,authority:{kind:'user-actual-spend-basis-correction',evidenceSha256:'a'.repeat(64),repairCeilingCents:2000,runpodCeilingCents:10000},accountId:'test-account',observedAt:f.now(),validUntil:f.now()+900000,balance:{openingCreditCents:10000,currentCreditCents:9997,debitsCents:3,creditsCents:0,currentHourlyCents:0,autoPay:false,evidenceSha256:'b'.repeat(64)},inventory:{ordinary:{complete:true,evidenceSha256:'c'.repeat(64),resourceIds:[]},queued:{complete:true,evidenceSha256:'d'.repeat(64),resourceIds:[]}},activeResources:[]};
 const actual=await receipt(observation,'5');await core.reconcileActualSpend('pilot',actual);
 const attempt=await core.attemptBinding('pilot');
 const intent={schema:1,kind:'manual-ui-admission',id:'1'.repeat(32),campaignId:m.id,manifestSha256:await hash(m),sourceRevision:m.sourceRevision,priorCampaignId:'pilot',priorManifestSha256:prior.manifestSha256,priorAttempt:{generation:1,name:attempt.attempt.name,prearmSha256:attempt.attempt.prearmSha256,startedAt:attempt.attempt.startedAt},accountId:'test-account',name:prearm.launches[0].name,registry:registryRef,createdAt:f.now(),expiresAt:f.now()+300000,liabilityUntil:f.now()+(long?10800000:8100000),repairStartedAt:attempt.repairStartedAt,repairDeadline:Date.UTC(2026,10,16,18),repairMaxCents:2000,priorRiskReserveCents:0,runtimeWindowMs:86400000,fundingSha256:await hash(m.cash),actualSpendBasisSha256:actual.sha256,startup:{schema:1,kind:'confirmed-pod-startup',deadline:f.now()+900000,maximumMs:900000}};
 intent.cleanupReady=await receipt({schema:1,kind:'dual-cleanup-readiness',registry:registryRef,runtimeRevision:'c'.repeat(40),workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.now(),run:{id:123,conclusion:'success',headSha:'8'.repeat(40),results:registry.references.map(r=>({prearmSha256:r.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}},'6');
 intent.fundingReservation=await receipt({schema:1,kind:'operator-actual-funding-freeze',basisSha256:actual.sha256,oldAttempt:{id:'pilot',manifestSha256:prior.manifestSha256,startedAt:new Date(attempt.attempt.startedAt).toISOString(),originalAllocationCents:1000,supplementalRiskHoldCents:0,protectedShutdownReserveCents:0,hourlyCeilingCents:100},newIntent:{computeAllocationCents:m.maxCents,protectedShutdownReserveCents:Math.ceil(m.maxCents/5),allInHourlyCeilingCents:100,host:m.phases[0].host.gpu,dataCenterId:m.phases[0].host.dataCenterId,diskGb:m.phases[0].host.diskGb,gpuCount:1,latestAdmission:new Date(f.now()+900000).toISOString(),maximumIntentMs:900000,latestWorkCutoff:new Date(m.deadline).toISOString(),responseUntil:new Date(intent.liabilityUntil).toISOString(),startupDeadline:intent.startup.deadline},aggregate:{runpodEncumberedCents:long?303+Math.ceil(m.maxCents/5):288,repairEncumberedCents:long?303+Math.ceil(m.maxCents/5):288,runpodCeilingCents:10000,repairCeilingCents:2000,cloudflareEncumberedCents:150,cloudflareCeilingCents:2000,githubPaidOverageAuthorized:false}},'7');
 const transition={schema:1,kind:'manual-public-timing-transition',scope:'public-original-incumbent-evaluation-cost',createdAt:f.now(),expiresAt:f.now()+900000,prior:runtimeUpgradeEndpoint(prior),next:publicTimingEndpoint((await core.load()).campaigns[m.id]),qualification:{campaignId:'qualified',manifestSha256:q.manifestSha256,resultSha256:result.sha256,runtimeArtifactSha256:runtime.sha256},publicInputs:{modelSha256:m.publicTiming.modelSha256,profilesSha256:m.publicTiming.profilesSha256,planSha256:m.publicTiming.planSha256,seed:m.seed},review:{sourceRevision:m.sourceRevision,proofInventorySha256:'4'.repeat(64),localEvidenceSha256:'6'.repeat(64),independentReviewSha256:'7'.repeat(64),qualificationReviewSha256:'8'.repeat(64)},historicalDisposition:'preserve-all-prior-failures-and-unknown-ownership'};
 const freeze=async()=>{intent.publicTimingTransition=await receipt(transition,'8');};await freeze();
 let publicWork;
 if(long){publicWork={schema:1,kind:'finite-public-work-authority',id:'b'.repeat(32),createdAt:f.now(),expiresAt:f.now()+900000,campaignId:m.id,manifestSha256:await hash(m),sourceRevision:m.sourceRevision,publicTiming:m.publicTiming,phaseSeconds:3600,admissionDeadline:f.now()+900000,executionDeadline:m.deadline,timingQualification:shortTiming,review:{localEvidenceSha256:'a'.repeat(64),independentReviewSha256:'b'.repeat(64),qualifiedTimingCostSha256:'c'.repeat(64)},historicalDisposition:'preserve-all-prior-authorities-and-failures'};if(diagnostic){
   const priorShort=(await core.load()).campaigns['short-public'];
   const sfPlan=await core.bucket.get('short-public/'+priorShort.manifest.publicTiming.planSha256);const oldPlan=JSON.parse(new TextDecoder().decode(new Uint8Array(await sfPlan.arrayBuffer())));
   const oldResult=JSON.parse(new TextDecoder().decode(new Uint8Array(await (await core.bucket.get('short-public/'+shortTiming.resultSha256)).arrayBuffer())));
   publicWork.kind='public-qualification-escalation';publicWork.escalation={priorPlanSha256:priorShort.manifest.publicTiming.planSha256,priorResultSha256:shortTiming.resultSha256,priorReportSha256:oldResult.artifacts.find(a=>a.role==='report').sha256,workIdentity:oldPlan.schedule.at(-1),selectionRule:'prior-frozen-last-item',terminationReserveSeconds:60,disposition:'lower-bound-only-no-completed-throughput',prospectiveCeilingCents:m.maxCents};
  }
  intent.publicWorkAuthority=await receipt(publicWork,'b');}
 return {...fixture,f,core,m,prior,anchor,intent,transition,freeze,publicWork,receipt};
}
test('typed public timing admission uses exact completed cohort and fresh actual funding without resetting ownership or clocks',async t=>{
 const f=await setup(t);await f.core.manualPrepare(f.m.id,f.intent);
 f.f.providers.resources.set('public-pod',{id:'public-pod',name:f.intent.name,host:f.m.phases[0].host});
 await f.core.manualAttach(f.m.id,{intentSha256:await hash(f.intent),podId:'public-pod',acceptedAt:f.f.now(),accountId:'test-account'});f.f.advance(300001);
 await f.core.manualReady(f.m.id,1,{podId:'public-pod',intentSha256:await hash(f.intent),sessionId:'a'.repeat(32)});
 const work=await f.core.work(f.m.id,1),db=await f.core.load();assert.equal(work.manifest.purpose,'public-performance-timing');assert.equal(work.lifecycle.acceptedAt,f.intent.createdAt);
 assert.deepEqual(db.manualProgram,f.anchor);assert.deepEqual(db.campaigns.pilot.attempts,f.prior.attempts);assert.equal(db.pilotReservedCents,3);assert.equal(f.f.config.authorizedCents,2000);assert.equal(f.f.providers.creates,1);
});
test('wrong scope, cohort, review, public input, prior identity or expiry rejects before granting a token',async t=>{
 for(const change of [r=>r.scope='scientific',r=>r.qualification.campaignId='pilot',r=>r.qualification.resultSha256='0'.repeat(64),r=>r.review.sourceRevision='0'.repeat(40),r=>r.publicInputs.modelSha256='0'.repeat(64),r=>r.next.image='other',r=>r.expiresAt=r.createdAt,r=>r.historicalDisposition='forget-old']){
  const f=await setup(t);change(f.transition);await f.freeze();const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};
  await assert.rejects(f.core.manualPrepare(f.m.id,f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);
 }
});

test('prequalified finite NEW public work attaches after repair cutoff with separate frozen startup and execution limits',async t=>{
 const f=await setup(t,{long:true});const old=await f.core.load();await f.core.manualPrepare(f.m.id,f.intent);
 f.f.providers.resources.set('public-pod',{id:'public-pod',name:f.intent.name,host:f.m.phases[0].host});
 const body={intentSha256:await hash(f.intent),podId:'public-pod',acceptedAt:f.f.now(),accountId:'test-account'};
 await f.core.manualAttach(f.m.id,body);const attached=(await f.core.load()).campaigns[f.m.id];
 assert.equal(attached.manual.campaignDeadline,f.publicWork.executionDeadline);assert.equal(attached.manual.startupDeadline,f.intent.startup.deadline);
 f.f.advance(300001);await f.core.manualReady(f.m.id,1,{podId:'public-pod',intentSha256:await hash(f.intent),sessionId:'a'.repeat(32)});
 await f.core.work(f.m.id,1);await f.core.heartbeat(f.m.id,1);const deadline=(await f.core.load()).campaigns[f.m.id].manual.campaignDeadline;
 for(let i=0;i<16;i++){f.f.advance(60000);await f.core.heartbeat(f.m.id,1);}
 assert.equal((await f.core.load()).campaigns[f.m.id].manual.campaignDeadline,deadline);
 assert.deepEqual((await f.core.load()).campaigns.pilot,old.campaigns.pilot);assert.equal(f.f.providers.creates,1);
});
test('finite public authority rejects missing or changed queue, review, timing and cutoff before granting credentials',async t=>{
 for(const change of [r=>r.phaseSeconds++,r=>r.executionDeadline++,r=>r.admissionDeadline=Date.UTC(2026,10,16,19)+1,r=>r.review={},r=>r.timingQualification.campaignId='qualified',r=>r.publicTiming.modelSha256='0'.repeat(64),r=>r.expiresAt=r.createdAt]){
  const f=await setup(t,{long:true});change(f.publicWork);f.intent.publicWorkAuthority=await f.receipt(f.publicWork,'c');const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};
  await assert.rejects(f.core.manualPrepare(f.m.id,f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);
 }
 const f=await setup(t,{long:true});delete f.intent.publicWorkAuthority;await assert.rejects(f.core.manualPrepare(f.m.id,f.intent));
});

test('finite public work never repairs or replaces a failed/expired worker and cloud cleanup reaches durable stop',async t=>{
 for(const failure of ['infrastructure','expired']){
  const f=await setup(t,{long:true});await f.core.manualPrepare(f.m.id,f.intent);
  f.f.providers.resources.set('public-pod',{id:'public-pod',name:f.intent.name,host:f.m.phases[0].host});
  await f.core.manualAttach(f.m.id,{intentSha256:await hash(f.intent),podId:'public-pod',acceptedAt:f.f.now(),accountId:'test-account'});
  await f.core.manualReady(f.m.id,1,{podId:'public-pod',intentSha256:await hash(f.intent),sessionId:'a'.repeat(32)});await f.core.heartbeat(f.m.id,1);
  if(failure==='infrastructure')await f.core.finish(f.m.id,1,{kind:'infrastructure',files:[]});else f.f.advance(120001);
  for(let i=0;i<4;i++)await f.core.reconcile();
  const c=(await f.core.load()).campaigns[f.m.id];assert.equal(c.status,'failed');assert.equal(c.cleanupVerified,true);assert.equal(c.generation,1);assert.equal(f.f.providers.creates,1);assert.equal(f.f.providers.resources.size,0);assert.equal(c.repairStartedAt,undefined);
 }
});
test('finite public authority cannot renew the five-minute attachment, startup or fixed execution cutoff',async t=>{
 for(const boundary of ['attach','startup','execution']){
  const f=await setup(t,{long:true});await f.core.manualPrepare(f.m.id,f.intent);
  f.f.providers.resources.set('public-pod',{id:'public-pod',name:f.intent.name,host:f.m.phases[0].host});
  const body={intentSha256:await hash(f.intent),podId:'public-pod',acceptedAt:f.f.now(),accountId:'test-account'};
  if(boundary==='attach'){f.f.advance(300001);await assert.rejects(f.core.manualAttach(f.m.id,body));continue;}
  await f.core.manualAttach(f.m.id,body);
  const claim={podId:'public-pod',intentSha256:body.intentSha256,sessionId:'a'.repeat(32)};
  if(boundary==='startup'){f.f.advance(900001);assert.equal((await f.core.manualReady(f.m.id,1,claim)).ready,false);await assert.rejects(f.core.work(f.m.id,1));continue;}
  await f.core.manualReady(f.m.id,1,claim);await f.core.heartbeat(f.m.id,1);
  for(let i=0;i<59;i++){f.f.advance(60000);await f.core.heartbeat(f.m.id,1);}
  f.f.advance(60000);await assert.rejects(f.core.heartbeat(f.m.id,1));assert.equal((await f.core.load()).campaigns[f.m.id].manual.campaignDeadline,f.publicWork.executionDeadline);
 }
});

test('one online diagnostic uses only the frozen last unclaimed item and consumes its marker before any create',async t=>{
 const f=await setup(t,{diagnostic:true}),before=await f.core.load();
 await f.core.manualPrepare(f.m.id,f.intent);const prepared=await f.core.load();
 assert.equal(prepared.publicQualificationEscalation.campaignId,f.m.id);assert.equal(prepared.publicQualificationEscalation.receiptSha256,f.intent.publicWorkAuthority.sha256);
 assert.equal(f.f.providers.creates,1);assert.equal(f.f.providers.resources.size,0);assert.deepEqual(prepared.campaigns.pilot,before.campaigns.pilot);
 const duplicate=await f.core.manualPrepare(f.m.id,f.intent);assert.equal(duplicate.generation,1);assert.deepEqual((await f.core.load()).publicQualificationEscalation,prepared.publicQualificationEscalation);
 await f.core.cancel(f.m.id);const stopped=await f.core.load();assert.deepEqual(stopped.publicQualificationEscalation,prepared.publicQualificationEscalation);
 const changed={...f.intent,id:'2'.repeat(32),publicWorkAuthority:await f.receipt({...f.publicWork,id:'e'.repeat(32)},'e')};
 await assert.rejects(publicWorkAuthority(f.core,stopped,stopped.campaigns[f.m.id],changed,{cutoff:f.m.deadline}),/one diagnostic escalation/);
});
test('diagnostic rejects consumed or claimed items, changed identity/bound, late execution, cost and selection changes',async t=>{
 const cases=[f=>f.publicWork.escalation.workIdentity.seed++,f=>f.publicWork.escalation.workIdentity.startIdentity.stateHash='0'.repeat(64),
  f=>f.publicWork.escalation.workIdentity.gameSeconds++,f=>f.publicWork.escalation.selectionRule='choose-any-unused',
  f=>f.publicWork.executionDeadline=Date.UTC(2026,10,16,18)+1,f=>f.publicWork.escalation.prospectiveCeilingCents=1001,
  f=>f.publicWork.escalation.terminationReserveSeconds=0,f=>f.publicWork.phaseSeconds=3601];
 for(const change of cases){
  const f=await setup(t,{diagnostic:true});change(f);f.intent.publicWorkAuthority=await f.receipt(f.publicWork,'c');const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};
  await assert.rejects(f.core.manualPrepare(f.m.id,f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);
 }
 const f=await setup(t,{diagnostic:true}),db=await f.core.load(),q=db.campaigns['short-public'];
 const key=await sha256(encode('public-timing:'+q.manifestSha256+':'+q.manifest.phases[0].id+':'+f.m.phases[0].workIds[0]));
 q.claims={[key]:{generation:1,at:f.f.now(),phaseIndex:0}};await f.core.save(db);
 await assert.rejects(f.core.manualPrepare(f.m.id,f.intent),/durable consumption/);assert.equal((await f.core.load()).publicQualificationEscalation,undefined);
});

test('a coherently shortened diagnostic phase cannot consume the marker even with a later external cutoff',async t=>{
 const f=await setup(t,{diagnostic:true}),db=await f.core.load(),c=db.campaigns[f.m.id];
 c.manifest.phases[0].seconds=120;for(const argv of [c.manifest.phases[0].argv,c.manifest.phases[0].resumeArgv])argv[argv.indexOf('--seconds')+1]='120';
 c.manifestSha256=await hash(c.manifest);const intent={...f.intent,manifestSha256:c.manifestSha256};
 const authority={...f.publicWork,manifestSha256:c.manifestSha256,phaseSeconds:120};intent.publicWorkAuthority=await f.receipt(authority,'e');
 await assert.rejects(publicWorkAuthority(f.core,db,c,intent,{cutoff:c.manifest.deadline}),/declared phase cannot fit/);
 assert.equal(db.publicQualificationEscalation,undefined);assert.equal(f.f.providers.creates,1);
});

test('diagnostic complete-envelope design cap accepts1200 cents and rejects1201 without authority',async t=>{
 const accepted=await setup(t,{diagnostic:true,diagnosticCap:1200});await accepted.core.manualPrepare(accepted.m.id,accepted.intent);
 assert.equal((await accepted.core.load()).campaigns[accepted.m.id].manifest.maxCents,1200);
 const rejected=await setup(t,{diagnostic:true,diagnosticCap:1201}),before=await rejected.core.load();let tokens=0;rejected.core.token=async()=>{tokens++;return 'forbidden';};
 await assert.rejects(rejected.core.manualPrepare(rejected.m.id,rejected.intent),/diagnostic lower-bound\/budget binding/);
 assert.deepEqual(await rejected.core.load(),before);assert.equal(tokens,0);assert.equal((await rejected.core.load()).publicQualificationEscalation,undefined);
});
