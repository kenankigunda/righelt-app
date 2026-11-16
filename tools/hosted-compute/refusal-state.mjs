// Controller state only. Historical attempts are never relabelled or erased.
export function refusalFor(db,c){return db.providerRefusalResolution?.campaignId===c.manifest.id?db.providerRefusalResolution:null;}
export function refusalHeld(db,resolution){return !!resolution&&!!db.providerRefusalContradictions?.some(r=>r.receiptSha256===resolution.receiptSha256);}
export function effectiveRefusal(db,c){
 const r=refusalFor(db,c);
 return !!r&&!refusalHeld(db,r)&&!db.actualSpendBasis?.activeResources.some(x=>x.campaignId===c.manifest.id)
   &&!c.attempts.some(a=>a.resourceId!=null&&(!Number.isSafeInteger(a.endedAt)||c.cleanupVerified!==true));
}
export function needsOwnershipWatch(db,c,a,index){
 if(effectiveRefusal(db,c))return false;
 const observed=db.actualSpendBasis?.activeResources.some(r=>r.campaignId===c.manifest.id&&r.generation===index+1&&!(a.endedAt>db.actualSpendBasis.observedAt&&c.cleanupVerified));
 return a.uncertain===true||!Number.isSafeInteger(a.endedAt)||c.cleanupVerified!==true||observed;
}
export function latchRefusalContradiction(core,db,c,{source,evidenceSha256,resourceIds}){
 const r=refusalFor(db,c);if(!r||!resourceIds.length)return false;
 if(!refusalHeld(db,r)){
  db.providerRefusalContradictions??=[];
  db.providerRefusalContradictions.push({campaignId:c.manifest.id,receiptSha256:r.receiptSha256,observedAt:core.now(),source,evidenceSha256,resourceIds:[...resourceIds]});
  core.event(c,'provider-refusal-contradicted',{receiptSha256:r.receiptSha256,source});
 }
 c.status='cleanup-uncertain';c.cleanupVerified=false;c.failure='provider-refusal-contradicted';
 return true;
}
