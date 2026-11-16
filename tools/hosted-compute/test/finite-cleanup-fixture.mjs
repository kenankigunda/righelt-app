import {canonical,encode,sha256} from '../policy.mjs';
const hash=value=>sha256(encode(canonical(value)));

export async function includeRetainedOwner(f,{makeUncertain=true,retainedStatus='cleanup-uncertain'}={}){
 const db=await f.core.load(),owner=db.campaigns.ui;
 if(makeUncertain){owner.status=retainedStatus;owner.cleanupVerified=false;owner.attempts[0].uncertain=true;delete owner.attempts[0].endedAt;delete owner.attempts[0].resourceId;await f.core.save(db);}
 const store=f.core.externalControl(f.m).store,record=await store.readPrearm(owner.manifest.externalControl);
 f.control.fences.set(record.nonce,{kind:'terminal',prearmSha256:owner.manifest.externalControl.sha256});
 const registry={schema:1,kind:'runpod-finite-cleanup-registry',runtimeRevision:'c'.repeat(40),references:[f.manifest.externalControl,owner.manifest.externalControl,f.m.externalControl]};
 const ref={...f.intent.registry,path:`control/prearms/${'c'.repeat(32)}.json`,sha256:await hash(registry)};
 f.control.records.set(`${ref.path}@${ref.commit}`,registry);f.intent.registry=ref;
 const ready={schema:1,kind:'finite-cleanup-readiness',registry:ref,runtimeRevision:registry.runtimeRevision,workflowSourceSha256:'9'.repeat(64),workflowCommit:'8'.repeat(40),observedAt:f.now(),run:{id:123,conclusion:'success',headSha:'8'.repeat(40),results:registry.references.map((r,i)=>({prearmSha256:r.sha256,state:i===2?'waiting':'terminal',failures:0,cleanupObservedAbsent:i!==2,durableReceiptConfirmed:i!==2,usageReviewRequired:false}))}};
 const freezeRegistry=async()=>{ref.sha256=await hash(registry);f.control.records.set(`${ref.path}@${ref.commit}`,registry);ready.registry=ref;f.intent.cleanupReady=await f.receipt(ready,'8');};
 await freezeRegistry();
 const binding=await f.core.actualSpendBinding();f.observation.ledgerSha256=binding.ledgerSha256;f.observation.priorBasisSha256=binding.priorBasisSha256;
 const basis=await f.freeze();f.intent.actualSpendBasisSha256=basis.sha256;f.funding.basisSha256=basis.sha256;await f.freezeFunding();
 return {registry,ref,ready,owner:structuredClone(owner),record,basis,freezeRegistry};
}
