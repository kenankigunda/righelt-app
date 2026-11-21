import {CLOUD_REPLACEMENT,isCloudRepair} from './cloud-repair-policy.mjs';
export function resourceOutcome(manifest,result){
 if(isCloudRepair(manifest)&&result.planSha256===manifest.exploratory.canonicalPlanSha256&&CLOUD_REPLACEMENT.resourceInterruptionReasons.includes(result.reason))
  return {kind:'resource-interrupted',resourceReason:result.reason};
 return null;
}
