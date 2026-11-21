import limits from './cloud-repair-20261120.json' with {type:'json'};
import launch from './cloud-launch-20261121.json' with {type:'json'};
import replacement from './cloud-replacement-20261121.json' with {type:'json'};
import {assert} from './policy.mjs';
export const CLOUD_REPAIR=Object.freeze(limits);
export const CLOUD_LAUNCH=Object.freeze(launch);
export const CLOUD_REPLACEMENT=Object.freeze(replacement);
export const isCloudRepair=m=>m.exploratory?.schema===2&&m.exploratory.episodeId===CLOUD_REPAIR.id;
export const isProspectiveLaunch=e=>[CLOUD_LAUNCH.id,CLOUD_REPLACEMENT.id].includes(e?.launchAuthorityId);
export function admissionWindow(e){
 if(e?.launchAuthorityId===CLOUD_REPLACEMENT.id){
  const ready=e.repairReadyAt,end=Math.min(ready+CLOUD_REPLACEMENT.maximumQualificationMs,CLOUD_REPLACEMENT.qualificationDeadline);
  assert(Number.isSafeInteger(ready)&&ready>=CLOUD_REPLACEMENT.authorizedAt&&ready<=CLOUD_REPLACEMENT.repairDeadline&&e.launchAuthorizedAt===ready&&e.launchAdmissionDeadline===end&&e.additionalRepairMs===0&&e.memoryScope===CLOUD_REPLACEMENT.memoryScope,'verified bounded replacement readiness required');
  assert(/^[a-f0-9]{64}$/.test(e.repairReadyProof?.sha256)&&e.consumedWorkTransfer?.sha256===CLOUD_REPLACEMENT.consumptionEvidenceSha256,'replacement proof bindings required');
  return {start:ready,end};
 }
 if(e?.launchAuthorityId!==undefined){
  assert(isProspectiveLaunch(e)&&e.launchAuthorizedAt===CLOUD_LAUNCH.authorizedAt&&e.launchAdmissionDeadline===CLOUD_LAUNCH.admissionDeadline&&e.additionalRepairMs===0,'explicit prospective launch authority required');
  return {start:CLOUD_LAUNCH.authorizedAt,end:CLOUD_LAUNCH.admissionDeadline};
 }
 return {start:CLOUD_REPAIR.repairStartedAt,end:CLOUD_REPAIR.repairDeadline};
}
export function exploratoryWindowFor(db,c){
 if(!isCloudRepair(c.manifest))return db.exploratoryWindow;
 const episode=db.exploratoryEpisodes?.[CLOUD_REPAIR.id];
 if(!isProspectiveLaunch(c.manifest.exploratory))return episode;
 const schedule=episode?.scheduleAuthorities?.[c.manifest.exploratory.launchAuthorityId];
 return schedule?{...episode,...schedule}:undefined;
}
export function validateCloudRepairWindow(e){
 const window=admissionWindow(e);
 assert(e.schema===2&&e.episodeId===CLOUD_REPAIR.id&&e.maximumSameAllocationResumes===0&&e.artifactAfterTrainingMs===CLOUD_REPAIR.artifactAfterTrainingMs,'explicit new cloud repair episode required');
 assert(Number.isSafeInteger(e.allocationStart)&&e.allocationStart>=window.start&&e.allocationStart<window.end&&e.trainingStop<=e.allocationStart+CLOUD_REPAIR.maximumAllocationMs,'conservative allocation start differs');
 assert(Number.isSafeInteger(e.trainingStop)&&e.trainingStop>e.allocationStart&&e.artifactDeadline===e.trainingStop+CLOUD_REPAIR.artifactAfterTrainingMs,'new episode training/artifact ceiling differs');
}
