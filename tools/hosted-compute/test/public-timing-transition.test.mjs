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
async function setup(t){
 const fixture=await publicTimingFixture(t,{sourceRevision:'e'.repeat(40)}),f=fixture.f,core=f.core;
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
 const m=structuredClone(fixture.manifest);m.maxCents=300;m.cash.computeUsageCapCents=300;m.cash.cloudflareUsageCapCents=50;m.deadline=f.now()+900000;
 const prearm=await f.arm(m,'4'.repeat(32));await core.stage(m);
 for(const a of m.inputs)await core.putObject(m.id,a,await fs.readFile(path.join(fixture.root,a.path)));
 db=await core.load();db.manualProgram={acceptedAt:f.now()-60000,deadline:f.now()-60000+86400000,campaignId:'qualified',intentSha256:'f'.repeat(64)};await core.save(db);const anchor=structuredClone(db.manualProgram);
 f.control.records=new Map();f.control.fences=new Map([['f'.repeat(32),{kind:'terminal',prearmSha256:f.manifest.externalControl.sha256}]]);
 const receipt=async(value,n)=>{const ref={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/receipts/${n.repeat(32)}/${n.repeat(32)}.json`,sha256:await hash(value)};f.control.records.set(`${ref.path}@${ref.commit}`,value);return ref;};
 const registry={schema:1,kind:'runpod-dual-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[f.manifest.externalControl,m.externalControl]},registryRef={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/prearms/${'9'.repeat(32)}.json`,sha256:await hash(registry)};f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);
 const binding=await core.actualSpendBinding(),observation={schema:1,kind:'operator-actual-spend-reconciliation',id:'5'.repeat(32),priorCampaignId:'pilot',ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,authority:{kind:'user-actual-spend-basis-correction',evidenceSha256:'a'.repeat(64),repairCeilingCents:2000,runpodCeilingCents:10000},accountId:'test-account',observedAt:f.now(),validUntil:f.now()+900000,balance:{openingCreditCents:10000,currentCreditCents:9997,debitsCents:3,creditsCents:0,currentHourlyCents:0,autoPay:false,evidenceSha256:'b'.repeat(64)},inventory:{ordinary:{complete:true,evidenceSha256:'c'.repeat(64),resourceIds:[]},queued:{complete:true,evidenceSha256:'d'.repeat(64),resourceIds:[]}},activeResources:[]};
 const actual=await receipt(observation,'5');await core.reconcileActualSpend('pilot',actual);
 const attempt=await core.attemptBinding('pilot');
 const intent={schema:1,kind:'manual-ui-admission',id:'1'.repeat(32),campaignId:m.id,manifestSha256:await hash(m),sourceRevision:m.sourceRevision,priorCampaignId:'pilot',priorManifestSha256:prior.manifestSha256,priorAttempt:{generation:1,name:attempt.attempt.name,prearmSha256:attempt.attempt.prearmSha256,startedAt:attempt.attempt.startedAt},accountId:'test-account',name:prearm.launches[0].name,registry:registryRef,createdAt:f.now(),expiresAt:f.now()+300000,liabilityUntil:f.now()+8100000,repairStartedAt:attempt.repairStartedAt,repairDeadline:Date.UTC(2026,10,16,18),repairMaxCents:2000,priorRiskReserveCents:0,runtimeWindowMs:86400000,fundingSha256:await hash(m.cash),actualSpendBasisSha256:actual.sha256,startup:{schema:1,kind:'confirmed-pod-startup',deadline:m.deadline,maximumMs:900000}};
 intent.cleanupReady=await receipt({schema:1,kind:'dual-cleanup-readiness',registry:registryRef,runtimeRevision:'c'.repeat(40),workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.now(),run:{id:123,conclusion:'success',headSha:'8'.repeat(40),results:registry.references.map(r=>({prearmSha256:r.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}},'6');
 intent.fundingReservation=await receipt({schema:1,kind:'operator-actual-funding-freeze',basisSha256:actual.sha256,oldAttempt:{id:'pilot',manifestSha256:prior.manifestSha256,startedAt:new Date(attempt.attempt.startedAt).toISOString(),originalAllocationCents:1000,supplementalRiskHoldCents:0,protectedShutdownReserveCents:0,hourlyCeilingCents:100},newIntent:{computeAllocationCents:300,protectedShutdownReserveCents:60,allInHourlyCeilingCents:100,host:m.phases[0].host.gpu,dataCenterId:m.phases[0].host.dataCenterId,diskGb:m.phases[0].host.diskGb,gpuCount:1,latestAdmission:new Date(f.now()+900000).toISOString(),maximumIntentMs:900000,latestWorkCutoff:new Date(m.deadline).toISOString(),responseUntil:new Date(intent.liabilityUntil).toISOString(),startupDeadline:m.deadline},aggregate:{runpodEncumberedCents:288,repairEncumberedCents:288,runpodCeilingCents:10000,repairCeilingCents:2000,cloudflareEncumberedCents:150,cloudflareCeilingCents:2000,githubPaidOverageAuthorized:false}},'7');
 const transition={schema:1,kind:'manual-public-timing-transition',scope:'public-original-incumbent-evaluation-cost',createdAt:f.now(),expiresAt:f.now()+900000,prior:runtimeUpgradeEndpoint(prior),next:publicTimingEndpoint((await core.load()).campaigns[m.id]),qualification:{campaignId:'qualified',manifestSha256:q.manifestSha256,resultSha256:result.sha256,runtimeArtifactSha256:runtime.sha256},publicInputs:{modelSha256:m.publicTiming.modelSha256,profilesSha256:m.publicTiming.profilesSha256,planSha256:m.publicTiming.planSha256,seed:m.seed},review:{sourceRevision:m.sourceRevision,proofInventorySha256:'4'.repeat(64),localEvidenceSha256:'6'.repeat(64),independentReviewSha256:'7'.repeat(64),qualificationReviewSha256:'8'.repeat(64)},historicalDisposition:'preserve-all-prior-failures-and-unknown-ownership'};
 const freeze=async()=>{intent.publicTimingTransition=await receipt(transition,'8');};await freeze();
 return {...fixture,f,core,m,prior,anchor,intent,transition,freeze};
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
