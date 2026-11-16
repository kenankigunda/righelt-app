import {publicWorkAuthority} from '../public-work.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicTransitionFixture as setup} from './public-transition-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));
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
