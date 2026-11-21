import limits from './cloud-repair-20261120.json' with {type:'json'};
import {assert} from './policy.mjs';
export const CLOUD_REPAIR=Object.freeze(limits);
export const isCloudRepair=m=>m.exploratory?.schema===2&&m.exploratory.episodeId===CLOUD_REPAIR.id;
export const exploratoryWindowFor=(db,c)=>isCloudRepair(c.manifest)?db.exploratoryEpisodes?.[CLOUD_REPAIR.id]:db.exploratoryWindow;
export function validateCloudRepairWindow(e){
 assert(e.schema===2&&e.episodeId===CLOUD_REPAIR.id&&e.maximumSameAllocationResumes===0&&e.artifactAfterTrainingMs===CLOUD_REPAIR.artifactAfterTrainingMs,'explicit new cloud repair episode required');
 assert(Number.isSafeInteger(e.allocationStart)&&e.allocationStart>=CLOUD_REPAIR.repairStartedAt&&e.allocationStart<CLOUD_REPAIR.repairDeadline&&e.trainingStop<=e.allocationStart+CLOUD_REPAIR.maximumAllocationMs,'conservative allocation start differs');
 assert(Number.isSafeInteger(e.trainingStop)&&e.trainingStop>CLOUD_REPAIR.repairStartedAt&&e.trainingStop<=CLOUD_REPAIR.repairDeadline+CLOUD_REPAIR.maximumAllocationMs&&e.artifactDeadline===e.trainingStop+CLOUD_REPAIR.artifactAfterTrainingMs,'new episode training/artifact ceiling differs');
}
