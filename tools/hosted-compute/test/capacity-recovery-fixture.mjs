import {publicTransitionFixture} from './public-transition-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));
export async function capacityRecoveryFixture(t,options={}){
 const f=await publicTransitionFixture(t,options),core=f.core,db=await core.load();
 // Consumer boundary: exact producer resolution is covered separately by
 // provider-refusal.test, including native evidence and fresh CAS adoption.
 const failed=structuredClone(db.campaigns[f.m.id]);failed.manifest.id='public-timing-20261116-1c3a839f';failed.manifestSha256='1'.repeat(64);failed.generation=1;failed.status='cancelled';failed.cleanupVerified=true;
 failed.attempts=[{manual:true,provider:'runpod',name:'refused-short',hourlyCents:100,startedAt:f.f.now()-10000,cutoff:f.f.now()-1,uncertain:true}];failed.manual={intentSha256:'2'.repeat(64),intent:{priorCampaignId:'pilot'}};
 db.campaigns[failed.manifest.id]=failed;db.providerRefusalResolution={campaignId:failed.manifest.id,receiptSha256:'3'.repeat(64),appliedAt:f.f.now()-1};
 // A second unresolved status-only owner retains its terminal independent watch.
 const b6=structuredClone(db.campaigns.pilot);b6.manifest.id='public-timing-b6';b6.manifest.deadline=f.f.now()+900000;
 const prearm=await f.f.arm(b6.manifest,'6'.repeat(32));b6.manifestSha256=await hash(b6.manifest);b6.attempts[0].name=prearm.launches[0].name;b6.attempts[0].prearmSha256=b6.manifest.externalControl.sha256;b6.status='cleanup-uncertain';b6.cleanupVerified=false;db.campaigns[b6.manifest.id]=b6;
 f.f.control.fences.set(prearm.nonce,{kind:'terminal',prearmSha256:b6.manifest.externalControl.sha256});
 const registry={schema:1,kind:'runpod-finite-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[db.campaigns.pilot.manifest.externalControl,b6.manifest.externalControl,f.m.externalControl]};
 const registryRef={...f.intent.registry,path:`control/prearms/${'7'.repeat(32)}.json`,sha256:await hash(registry)};f.f.control.records.set(`${registryRef.path}@${registryRef.commit}`,registry);f.intent.registry=registryRef;
 f.intent.cleanupReady=await f.receipt({schema:1,kind:'finite-cleanup-readiness',registry:registryRef,runtimeRevision:registry.runtimeRevision,workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.f.now(),run:{id:123,conclusion:'success',headSha:'8'.repeat(40),results:registry.references.map((r,i)=>({prearmSha256:r.sha256,state:i===2?'waiting':'terminal',failures:0,cleanupObservedAbsent:i!==2,durableReceiptConfirmed:i!==2,usageReviewRequired:false}))}},'9');
 await core.save(db);for(const [key,value]of [...f.f.bucket.data])if(key.startsWith(f.m.id+'/'))await f.f.bucket.put(failed.manifest.id+'/'+key.slice(f.m.id.length+1),value);
 if(!options.long&&!options.diagnostic){
  f.transition.kind='manual-capacity-recovery-public-timing-transition';f.transition.capacityRecovery={refusalReceiptSha256:'3'.repeat(64),actualSpendBasisSha256:f.intent.actualSpendBasisSha256,capacity:{observedAt:f.f.now(),validUntil:f.f.now()+900000,gpu:f.m.phases[0].host.gpu,dataCenterId:f.m.phases[0].host.dataCenterId,priorAvailability:'LOW',availability:'HIGH',evidenceSha256:'4'.repeat(64)}};
  await f.freeze();
 }
 return {...f,failed,b6,registry,registryRef};
}
