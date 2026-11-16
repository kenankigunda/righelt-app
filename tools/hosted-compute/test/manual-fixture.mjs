import {fixture} from './helpers.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));
export async function setup({realTime=false,authorityDelay=0}={}){
 const f=await fixture({maxCents:1000});
 if(realTime){f.advance(Date.now()-3600000-f.now());f.manifest.deadline=f.now()+86400000;f.manifest.phases[0].host.quoteObservedAt=f.now();f.manifest.phases[0].host.quoteExpires=f.now()+172800000;}
 f.providers.create=async()=>{f.providers.creates++;throw Error('lost original response');};
 if(authorityDelay){const external=f.core.externalControl;f.core.externalControl=m=>{const control=external(m);if(m.id==='pilot'){const authorize=control.authorizeLaunch.bind(control);control.authorizeLaunch=async(...args)=>{const result=await authorize(...args);f.advance(authorityDelay);return result;};}return control;};}
 await f.stage();await f.core.start('pilot');await f.core.reconcile();await f.core.reconcile();
 const prior=await f.state(),old=structuredClone(prior.attempts[0]);f.advance(3600000);
 const m=structuredClone(f.manifest);m.id='ui';m.maxCents=300;m.cash.computeUsageCapCents=300;m.cash.cloudflareUsageCapCents=50;m.deadline=f.now()+900000;m.phases[0].seconds=600;m.phases[0].host.hourlyCents=74;
 const record=await f.arm(m,'a'.repeat(32));await f.core.stage(m);
 for(const [a,bytes]of [[f.inputs[0],f.cp],[f.inputs[1],f.corpus],[f.inputs[2],f.recipe]])await f.core.putObject('ui',a,bytes);
 const registry={schema:1,kind:'runpod-dual-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[f.manifest.externalControl,m.externalControl]};
 const ref={repository:'fixture/private-control',commit:'e'.repeat(40),path:`control/prearms/${'b'.repeat(32)}.json`,sha256:await hash(registry)};
 f.control.records=new Map([[`${ref.path}@${ref.commit}`,registry]]);
 f.control.fences=new Map([['f'.repeat(32),{kind:'terminal',prearmSha256:f.manifest.externalControl.sha256}]]);
 const intent={schema:1,kind:'manual-ui-admission',id:'1'.repeat(32),campaignId:'ui',manifestSha256:await hash(m),sourceRevision:m.sourceRevision,priorCampaignId:'pilot',priorManifestSha256:prior.manifestSha256,priorAttempt:{generation:1,name:old.name,prearmSha256:old.prearmSha256,startedAt:old.startedAt},accountId:'test-account',name:record.launches.find(x=>x.phaseIndex===0&&x.generation===1).name,registry:ref,createdAt:f.now(),expiresAt:f.now()+300000,liabilityUntil:f.now()+8100000,repairStartedAt:prior.events.find(e=>e.type==='launch-requested'&&e.generation===1).at,repairDeadline:Date.UTC(2026,10,16,18),repairMaxCents:2000,priorRiskReserveCents:700,runtimeWindowMs:86400000,fundingSha256:await hash(m.cash)};
 const receipt=async(value,n)=>{const r={repository:ref.repository,commit:'e'.repeat(40),path:`control/receipts/${n.repeat(32)}/${n.repeat(32)}.json`,sha256:await hash(value)};f.control.records.set(`${r.path}@${r.commit}`,value);return r;};
 const ready={schema:1,kind:'dual-cleanup-readiness',registry:ref,runtimeRevision:registry.runtimeRevision,workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.now(),run:{id:123,conclusion:'success',headSha:'8'.repeat(40),results:registry.references.map(r=>({prearmSha256:r.sha256,state:'waiting',failures:0,cleanupObservedAbsent:false,durableReceiptConfirmed:false}))}};
 intent.cleanupReady=await receipt(ready,'3');
 const funding={schema:1,kind:'operator-additive-funding-freeze',oldAttempt:{id:'pilot',manifestSha256:prior.manifestSha256,startedAt:new Date(old.startedAt).toISOString(),originalAllocationCents:1000,supplementalRiskHoldCents:700,protectedShutdownReserveCents:200,hourlyCeilingCents:100},newIntent:{computeAllocationCents:300,protectedShutdownReserveCents:60,allInHourlyCeilingCents:74,host:m.phases[0].host.gpu,dataCenterId:m.phases[0].host.dataCenterId,diskGb:m.phases[0].host.diskGb,gpuCount:1,latestAdmission:new Date(f.now()+900000).toISOString(),maximumIntentMs:900000,latestWorkCutoff:new Date(m.deadline).toISOString(),responseUntil:new Date(intent.liabilityUntil).toISOString()},aggregate:{runpodEncumberedCents:2000,runpodCeilingCents:10000,repairEncumberedCents:2000,repairCeilingCents:2000,cloudflareEncumberedCents:150,cloudflareCeilingCents:2000,githubPaidOverageAuthorized:false}};
 intent.fundingReservation=await receipt(funding,'4');
 const ui=async()=>(await f.core.load()).campaigns.ui;
 const addPod=()=>f.providers.resources.set('manual',{id:'manual',name:intent.name,host:m.phases[0].host});
 const attach=async()=>f.core.manualAttach('ui',{intentSha256:await hash(intent),podId:'manual',acceptedAt:intent.createdAt,accountId:intent.accountId});
 return {...f,m,old,intent,ui,addPod,attach,registry,record,ready,funding,receipt};
}
