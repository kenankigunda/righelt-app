import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

export async function actualFixture(){
  const f=await setup();f.config.authorizedCents=2000;
  await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();await f.core.work('ui',1);
  f.advance(1000);await f.core.finish('ui',1,{kind:'correctness'});await f.core.reconcile();await f.core.reconcile();
  f.advance(12*3600000); // A large legacy unknown-create estimate is not a debit.
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

test('explicit actual balance reconciliation releases unused allocations once without rewriting ownership, receipts or clocks',async()=>{
  const f=await actualFixture(),before=await f.core.load();assert.equal(before.pilotReservedCents,2000);assert(f.core.cost(before.campaigns.pilot)>1000);
  const result=await f.core.reconcileActualSpend('pilot',f.ref),db=await f.core.load();
  const binding=await f.core.actualSpendBinding();assert.equal(binding.financialBasis,'verified-account-observation');assert.equal(binding.observedDebitCents,3);assert.equal(binding.pilotReservedCents,3);assert.equal(binding.creditAllocatedCents,3);
  assert.equal(result.observedDebitCents,3);assert.equal(db.pilotReservedCents,3);assert.equal(db.creditAllocatedCents,3);assert.deepEqual(db.manualRiskHolds,{});
  assert.deepEqual(db.campaigns.pilot,f.old);assert.deepEqual(db.campaigns.ui,f.ended);assert.deepEqual(db.manualProgram,f.anchor);assert.deepEqual(db.manualFundingReservations,before.manualFundingReservations);
  assert.equal(db.actualSpendReconciliations[0].releasedPilotReservationCents,1997);assert.deepEqual(db.actualSpendReconciliations[0].before.manualRiskHolds,{pilot:700});
  await f.core.reconcileActualSpend('pilot',f.ref);assert.deepEqual(await f.core.load(),db);assert.equal(f.providers.creates,1);
  await assert.rejects(f.core.reconcileActualSpend('ui',f.ref),/campaign differs/);assert.deepEqual(await f.core.load(),db);
});
test('actual three-cent debit plus bounded new-resource forecast fits unchanged twenty-dollar authority despite old elapsed estimates',async()=>{
  const f=await actualFixture();await f.core.reconcileActualSpend('pilot',f.ref);await f.core.manualPrepare('actual-next',f.intent);
  let db=await f.core.load();assert.equal(db.pilotReservedCents,3);assert.equal(db.creditAllocatedCents,3);assert.equal(db.actualSpendBasis.admissions['actual-next'].forecastCents,227);
  f.advance(20000);assert.equal(f.core.cost(db.campaigns['actual-next']),0); // Pending UI creation is not running spend.
  f.providers.resources.set('new',{id:'new',name:f.intent.name,host:f.m.phases[0].host});
  await f.core.manualAttach('actual-next',{intentSha256:await hash(f.intent),podId:'new',acceptedAt:f.now(),accountId:f.intent.accountId});
  await f.core.work('actual-next',1);await f.core.heartbeat('actual-next',1);
  db=await f.core.load();assert.deepEqual(db.manualProgram,f.anchor);assert.deepEqual(db.campaigns.pilot,f.old);assert.deepEqual(db.campaigns.ui,f.ended);assert.equal(f.config.authorizedCents,2000);assert.equal(f.providers.creates,1);
});
test('stale, changed, incomplete or invented observations cannot release allocations',async()=>{
  for(const mutate of [r=>r.balance.currentCreditCents++,r=>r.balance.creditsCents=1,r=>r.balance.autoPay=true,r=>r.inventory.queued.complete=false,r=>r.inventory.ordinary.resourceIds=['foreign'],r=>r.balance.currentHourlyCents=1,r=>r.accountId='other',r=>r.ledgerSha256='0'.repeat(64),r=>r.validUntil=r.observedAt,r=>r.authority.repairCeilingCents=3000]){
    const f=await actualFixture();mutate(f.observation);const reference=await f.freeze(),before=await f.core.load();
    await assert.rejects(f.core.reconcileActualSpend('pilot',reference));assert.deepEqual(await f.core.load(),before);assert.equal(f.providers.creates,1);
  }
});
test('an observation expiring during asynchronous ownership lookup cannot change counters',async()=>{
  const f=await actualFixture(),before=await f.core.load(),external=f.core.externalControl;
  f.core.externalControl=manifest=>{const control=external(manifest),store=control.store;control.store={...store,readPrearm:async(...args)=>{const value=await store.readPrearm(...args);f.advance(900001);return value;}};return control;};
  await assert.rejects(f.core.reconcileActualSpend('pilot',f.ref),/expired during/);assert.deepEqual(await f.core.load(),before);
});
test('new actual funding rejects old full-cap receipts, omitted forecasts and oversized tails before issuing authority',async()=>{
  for(const mutate of [f=>{f.funding.kind='operator-additive-funding-freeze';},f=>{f.funding.basisSha256='0'.repeat(64);},f=>{f.funding.aggregate.runpodEncumberedCents=3;},f=>{f.funding.aggregate.repairEncumberedCents=3;},f=>{f.intent.priorRiskReserveCents=700;},f=>{f.intent.actualSpendBasisSha256='0'.repeat(64);},f=>{f.intent.liabilityUntil+=24*3600000;}]){
    const f=await actualFixture();await f.core.reconcileActualSpend('pilot',f.ref);mutate(f);await f.freezeFunding();const before=await f.core.load();let tokens=0;f.core.token=async()=>{tokens++;return 'forbidden';};
    await assert.rejects(f.core.manualPrepare('actual-next',f.intent));assert.deepEqual(await f.core.load(),before);assert.equal(tokens,0);
  }
});
test('reconciliation binds the exact durable ledger and cannot reset an in-flight admission or use direct paid start',async()=>{
  const f=await actualFixture(),db=await f.core.load();db.campaigns.ui.failure='changed';await f.core.save(db);await assert.rejects(f.core.reconcileActualSpend('pilot',f.ref),/ledger binding/);
  const g=await actualFixture();await g.core.reconcileActualSpend('pilot',g.ref);await assert.rejects(g.core.start('actual-next'),/explicit manual funding/);
  await g.core.manualPrepare('actual-next',g.intent);const binding=await g.core.actualSpendBinding();g.observation.id='a'.repeat(32);g.observation.ledgerSha256=binding.ledgerSha256;g.observation.priorBasisSha256=binding.priorBasisSha256;
  await assert.rejects(g.core.reconcileActualSpend('pilot',await g.freeze()),/in-flight/);
});

test('observed owned resources retain their real rate and forward cleanup coverage without fabricating create resolution',async()=>{
  const f=await actualFixture();f.observation.inventory.ordinary.resourceIds=['late-owned'];f.observation.balance.currentHourlyCents=100;
  f.observation.activeResources=[{id:'late-owned',campaignId:'pilot',generation:1,name:f.old.attempts[0].name,hourlyCents:100}];
  const ref=await f.freeze();await f.core.reconcileActualSpend('pilot',ref);
  f.intent.actualSpendBasisSha256=ref.sha256;f.funding.basisSha256=ref.sha256;f.funding.oldAttempt.protectedShutdownReserveCents=200;
  Object.assign(f.funding.aggregate,{runpodEncumberedCents:655,repairEncumberedCents:655});await f.freezeFunding();await f.core.manualPrepare('actual-next',f.intent);
  const db=await f.core.load();assert.equal(db.actualSpendBasis.activeResources[0].hourlyCents,100);assert.deepEqual(db.campaigns.pilot,f.old);assert.equal(db.campaigns.pilot.attempts[0].uncertain,true);
  const bad=await actualFixture();bad.observation.inventory.ordinary.resourceIds=['foreign'];bad.observation.balance.currentHourlyCents=100;bad.observation.activeResources=[{id:'foreign',campaignId:'pilot',generation:1,name:'unrelated',hourlyCents:100}];
  const before=await bad.core.load();await assert.rejects(bad.core.reconcileActualSpend('pilot',await bad.freeze()),/ownership/);assert.deepEqual(await bad.core.load(),before);
});
test('a freshly observed resource still needs forward coverage when an older ledger says it was cleaned up',async()=>{
  const f=await actualFixture();f.observation.inventory.ordinary.resourceIds=['manual'];f.observation.balance.currentHourlyCents=74;
  f.observation.activeResources=[{id:'manual',campaignId:'ui',generation:1,name:f.ended.attempts[0].name,hourlyCents:74}];
  const ref=await f.freeze();await f.core.reconcileActualSpend('pilot',ref);f.intent.actualSpendBasisSha256=ref.sha256;f.funding.basisSha256=ref.sha256;
  await f.freezeFunding();await assert.rejects(f.core.manualPrepare('actual-next',f.intent),/aggregate funding/);
  Object.assign(f.funding.aggregate,{runpodEncumberedCents:457,repairEncumberedCents:457});await f.freezeFunding();await f.core.manualPrepare('actual-next',f.intent);
  assert.deepEqual((await f.core.load()).campaigns.ui,f.ended);
});
test('after a known attempt ends, fresh observed debits replace its unused prospective coverage instead of consuming its full cap forever',async()=>{
  const f=await actualFixture();await f.core.reconcileActualSpend('pilot',f.ref);await f.core.manualPrepare('actual-next',f.intent);
  f.providers.resources.set('new',{id:'new',name:f.intent.name,host:f.m.phases[0].host});
  await f.core.manualAttach('actual-next',{intentSha256:await hash(f.intent),podId:'new',acceptedAt:f.now(),accountId:f.intent.accountId});await f.core.work('actual-next',1);await f.core.heartbeat('actual-next',1);
  f.advance(1000);await f.core.finish('actual-next',1,{kind:'correctness'});await f.core.reconcile();await f.core.reconcile();
  const binding=await f.core.actualSpendBinding(),next=structuredClone(f.observation);
  const stale={...structuredClone(f.observation),id:'b'.repeat(32),ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256};
  const before=await f.core.load();await assert.rejects(f.core.reconcileActualSpend('pilot',await f.receipt(stale,'b')),/predates known resource consumption/);assert.deepEqual(await f.core.load(),before);assert.equal(before.actualSpendBasis.admissions['actual-next'].forecastCents,227);
  Object.assign(next,{id:'a'.repeat(32),ledgerSha256:binding.ledgerSha256,priorBasisSha256:binding.priorBasisSha256,observedAt:f.now(),validUntil:f.now()+900000});Object.assign(next.balance,{currentCreditCents:9994,debitsCents:6});
  const ref=await f.receipt(next,'a');await f.core.reconcileActualSpend('pilot',ref);
  const db=await f.core.load();assert.equal(db.pilotReservedCents,6);assert.equal(db.creditAllocatedCents,6);assert.deepEqual(db.actualSpendBasis.admissions,{});assert.equal(db.actualSpendReconciliations.length,2);assert.equal(db.campaigns['actual-next'].manifest.maxCents,300);assert.deepEqual(db.manualProgram,f.anchor);
  await f.core.reconcileActualSpend('pilot',f.ref);assert.deepEqual(await f.core.load(),db);
});

test('actual admin routes and private CLI reconcile once while worker access stays forbidden',async t=>{
  const [{build},{createRequire},{promises:fs},path,os,{createHmac},{Client},{main}]=await Promise.all([
    import('esbuild'),import('node:module'),import('node:fs'),import('node:path'),import('node:os'),import('node:crypto'),import('../client.mjs'),import('../cli.mjs')]);
  const require=createRequire(import.meta.url),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
  const f=await actualFixture(),oldRecord=await f.core.externalControl(f.manifest).store.readPrearm(f.manifest.externalControl);
  const bundle=await build({stdin:{contents:`import app,{ComputeController} from './apps/compute-controller/index.mjs';export class SeedableControl extends ComputeController{constructor(ctx,env){super(ctx,env);this.core.now=()=>Number(env.FIXTURE_NOW);}async fetch(request){const p=new URL(request.url).pathname;if(p==='/fixture-seed')return this.serialize(async()=>{await this.core.save(await request.json());return Response.json({ok:true});});if(p==='/fixture-ledger')return Response.json(await this.core.load());return super.fetch(request);}}export default app;`,resolveDir:process.cwd(),sourcefile:'actual-spend-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
  let outboundPosts=0;
  const signing='private-signing-'.repeat(4),mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-09',durableObjects:{CONTROL:{className:'SeedableControl',useSQLite:true}},r2Buckets:['ARTIFACTS'],bindings:{FIXTURE_NOW:String(f.now()),ADMIN_TOKEN:'private-admin',WORKER_SIGNING_KEY:signing,COMPUTE_ENABLED:'true',AUTHORIZED_PILOT_CENTS:'2000',CONTROLLER_URL:'https://compute.example',COMPUTE_CONTROL_REPOSITORY:'fixture/private-control',COMPUTE_CONTROL_READ_TOKEN:'private-reader'},outboundService:async req=>{
    if(req.method==='POST')outboundPosts++;assert.equal(req.method,'GET');const u=new URL(req.url);assert.equal(u.origin,'https://api.github.com');
    if(u.pathname==='/repos/fixture/private-control')return Response.json({private:true,full_name:'fixture/private-control',default_branch:'main'});
    const key=u.pathname.split('/contents/')[1],value=key===f.manifest.externalControl.path?oldRecord:f.control.records.get(`${key}@${u.searchParams.get('ref')}`);
    if(!value)return new Response(null,{status:404});const bytes=Buffer.from(JSON.stringify(value));return Response.json({type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});
  }});t.after(()=>mf.dispose());
  await mf.dispatchFetch('https://compute.example/fixture-seed',{method:'POST',body:JSON.stringify(await f.core.load())});
  const fetcher=(...args)=>mf.dispatchFetch(...args),env={COMPUTE_URL:'https://compute.example',COMPUTE_ADMIN_TOKEN:'private-admin'};
  const binding=await main(['actual-spend-binding','pilot'],env,{fetcher});assert.equal(binding.ledgerSha256,f.observation.ledgerSha256);
  const directory=await fs.mkdtemp(path.default.join(os.default.tmpdir(),'actual-spend-private-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const referenceFile=path.default.join(directory,'reference.json');await fs.writeFile(referenceFile,JSON.stringify(f.ref),{mode:0o600});
  const result=await main(['actual-spend-reconcile','pilot','--receipt',referenceFile],env,{fetcher});assert.deepEqual(result,{receiptSha256:f.ref.sha256,reconciled:true,observedDebitCents:3});
  const after=await(await mf.dispatchFetch('https://compute.example/fixture-ledger')).json();assert.equal(after.pilotReservedCents,3);assert.deepEqual(after.campaigns.pilot,f.old);
  const readback=await main(['actual-spend-binding','pilot'],env,{fetcher});assert.equal(readback.financialBasis,'verified-account-observation');assert.equal(readback.pilotReservedCents,3);assert.equal(readback.creditAllocatedCents,3);assert.equal(readback.observedActiveResourceCount,0);
  await main(['actual-spend-reconcile','pilot','--receipt',referenceFile],env,{fetcher});assert.deepEqual(await(await mf.dispatchFetch('https://compute.example/fixture-ledger')).json(),after);
  const worker=new Client({url:'https://compute.example',id:'pilot',generation:1,token:createHmac('sha256',signing).update('pilot/1').digest('hex'),fetcher});
  await assert.rejects(worker.json('actual-spend-binding'),/409/);await assert.rejects(worker.json('actual-spend-reconcile',f.ref),/409/);assert.equal(outboundPosts,0);
  await fs.chmod(referenceFile,0o644);await assert.rejects(main(['actual-spend-reconcile','pilot','--receipt',referenceFile],env,{fetcher}),/private regular/);
});
