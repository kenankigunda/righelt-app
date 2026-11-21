import {CLOUD_REPAIR} from './cloud-repair-policy.mjs';
import {assert,canonical,encode,sha256,POLICY} from './policy.mjs';
import {validateReference} from './external-control.mjs';

export const CLEANUP_CONTRACTS=Object.freeze({
  'runpod-dual-cleanup-registry':Object.freeze({owners:2,readinessKind:'dual-cleanup-readiness',resultKind:'dual-cleanup-result',state:'dual-cleanup'}),
  'runpod-finite-cleanup-registry':Object.freeze({owners:3,readinessKind:'finite-cleanup-readiness',resultKind:'finite-cleanup-result',state:'finite-cleanup'}),
});
const registries=new WeakSet();
const digest=/^[a-f0-9]{64}$/;
const revision=/^[a-f0-9]{40}$/;
export const MANUAL_INTENT_MS=300000;
export const MANUAL_PUBLIC_ADMISSION_END=Date.UTC(2026,10,16,19);
export const MANUAL_REPAIR_END=Date.UTC(2026,10,16,18);
export const MANUAL_STARTUP_MS=POLICY.startupMs;
export function manualStartupUntil(c){
  return c.manual.intent.startup?c.manual.startupDeadline??c.manual.intent.expiresAt:Math.min(c.manual.intent.createdAt+MANUAL_INTENT_MS,c.manual.intent.expiresAt);
}
export async function readOperatorReceipt(store,reference){
  assert(reference?.repository===store.repository&&revision.test(reference.commit)&&digest.test(reference.sha256)&&/^control\/receipts\/[a-f0-9]{32}\/[a-f0-9]{32}\.json$/.test(reference.path),'immutable operator receipt required');
  const value=await store.read(reference.path,reference.commit);
  assert(value&&await sha256(encode(canonical(value)))===reference.sha256,'operator receipt bytes differ');return value;
}
export function sameReference(a,b){return canonical(a)===canonical(b);}
export function operatorAttemptBinding(c){
  const a=c.attempts.at(-1),launch=c.events.find(e=>e.type==='launch-requested'&&e.generation===c.generation);
  return {campaignId:c.manifest.id,manifestSha256:c.manifestSha256,generation:c.generation,status:c.status,
    attempt:a?{generation:c.generation,name:a.name,prearmSha256:a.prearmSha256,startedAt:a.startedAt,hourlyCents:a.hourlyCents}:null,
    repairStartedAt:launch?.at??null};
}
export async function readCleanupRegistry(store,reference){
  assert(reference&&revision.test(reference.commit)&&digest.test(reference.sha256)&&/^control\/prearms\/[a-f0-9]{32}\.json$/.test(reference.path),'pinned cleanup registry required');
  assert(reference.repository===store.repository,'cleanup registry repository differs');
  const registry=await store.read(reference.path,reference.commit);
  assert(registry&&await sha256(encode(canonical(registry)))===reference.sha256,'cleanup registry bytes differ');
  assert(Object.keys(registry).sort().join(',')==='kind,references,runtimeRevision,schema'&&registry.schema===1&&Object.hasOwn(CLEANUP_CONTRACTS,registry.kind)&&revision.test(registry.runtimeRevision),'typed cleanup registry required');
  const contract=CLEANUP_CONTRACTS[registry.kind];
  assert(Array.isArray(registry.references)&&registry.references.length===contract.owners&&new Set(registry.references.map(canonical)).size===contract.owners,'exact finite distinct cleanup references required');
  const records=[];const names=new Set();
  for(const ref of registry.references){
    assert(ref.repository===reference.repository,'cleanup registry crosses repositories');
    const record=await store.readPrearm(ref);await validateReference(ref,record);
    for(const launch of record.launches){assert(!names.has(launch.name),'cleanup ownership sets overlap');names.add(launch.name);}
    records.push(record);
  }
  assert(records.every(record=>record.accountId===records[0].accountId),'cleanup accounts differ');
  const authority=Object.freeze({kind:registry.kind,runtimeRevision:registry.runtimeRevision,references:Object.freeze(registry.references.map(r=>Object.freeze({...r}))),records:Object.freeze(records),sha256:reference.sha256});
  registries.add(authority);return authority;
}
export function registryAuthorizes(authority,reference,runtimeRevision){
  return registries.has(authority)&&authority.runtimeRevision===runtimeRevision&&authority.references.some(r=>sameReference(r,reference));
}

export function validateManualIntent(intent){
  const keys=['accountId','campaignId','cleanupReady','createdAt','expiresAt','fundingReservation','fundingSha256','id','kind','liabilityUntil','manifestSha256','name','priorAttempt','priorCampaignId','priorManifestSha256','priorRiskReserveCents','registry','repairDeadline','repairMaxCents','repairStartedAt','runtimeWindowMs','schema','sourceRevision'];
  if(Object.hasOwn(intent??{},'runtimeUpgrade'))keys.push('runtimeUpgrade');
  if(Object.hasOwn(intent??{},'actualSpendBasisSha256'))keys.push('actualSpendBasisSha256');
  if(Object.hasOwn(intent??{},'startup'))keys.push('startup');
  if(Object.hasOwn(intent??{},'publicWorkAuthority'))keys.push('publicWorkAuthority');
  if(Object.hasOwn(intent??{},'publicTimingTransition'))keys.push('publicTimingTransition');
  if(Object.hasOwn(intent??{},'exploratoryWindow'))keys.push('exploratoryWindow');
  if(Object.hasOwn(intent??{},'exploratoryEpisode')){keys.push('exploratoryEpisode');assert(intent.exploratoryWindow&&intent.exploratoryEpisode===CLOUD_REPAIR.id,'unknown cloud repair episode');}
  assert(intent&&Object.keys(intent).sort().join(',')===keys.sort().join(',')&&intent.schema===1&&intent.kind==='manual-ui-admission'&&/^[a-f0-9]{32}$/.test(intent.id),'typed manual intent required');
  assert(digest.test(intent.manifestSha256)&&digest.test(intent.priorManifestSha256)&&digest.test(intent.fundingSha256)&&revision.test(intent.sourceRevision),'manual source and funding identities required');
  assert(typeof intent.accountId==='string'&&intent.accountId.length>=3&&typeof intent.name==='string'&&intent.name.length>0,'manual account and name required');
  assert([intent.createdAt,intent.expiresAt,intent.liabilityUntil,intent.repairStartedAt,intent.repairDeadline,intent.runtimeWindowMs].every(Number.isSafeInteger)&&intent.liabilityUntil>=intent.expiresAt,'manual absolute clocks required');
  assert(intent.expiresAt>intent.createdAt&&intent.expiresAt-intent.createdAt<=MANUAL_INTENT_MS&&intent.runtimeWindowMs===(intent.exploratoryEpisode?CLOUD_REPAIR.maximumAllocationMs:86400000),'bounded admission and run window required');
  if(Object.hasOwn(intent,'startup')){const s=intent.startup;assert(s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).sort().join(',')==='deadline,kind,maximumMs,schema'&&s.schema===1&&s.kind==='confirmed-pod-startup'&&s.maximumMs===MANUAL_STARTUP_MS&&Number.isSafeInteger(s.deadline)&&s.deadline>intent.createdAt&&s.deadline<=intent.expiresAt+MANUAL_STARTUP_MS&&s.deadline<=(intent.publicWorkAuthority?MANUAL_PUBLIC_ADMISSION_END:intent.repairDeadline),'typed finite confirmed-Pod startup required');}
  // Explicitly scoped authorization for this repair. It does not alter worker
  // policy or extend any old manifest, prearm, lease or campaign deadline.
  assert(intent.repairDeadline>intent.repairStartedAt&&intent.repairDeadline<=(intent.exploratoryEpisode?CLOUD_REPAIR.repairDeadline:intent.exploratoryWindow?Date.UTC(2026,10,20,13):MANUAL_REPAIR_END)&&Number.isSafeInteger(intent.repairMaxCents)&&intent.repairMaxCents>0&&intent.repairMaxCents<=POLICY.pilotCents&&Number.isSafeInteger(intent.priorRiskReserveCents)&&intent.priorRiskReserveCents>=0,'manual repair authorization exceeded');
  const a=intent.priorAttempt;
  assert(a&&Object.keys(a).sort().join(',')==='generation,name,prearmSha256,startedAt'&&Number.isSafeInteger(a.generation)&&Number.isSafeInteger(a.startedAt)&&typeof a.name==='string'&&digest.test(a.prearmSha256),'exact prior attempt binding required');
  return intent;
}

export function validateRepairAllowance(intent,authorizedCents){
  assert(Number.isSafeInteger(authorizedCents)&&intent.repairMaxCents<=Math.min(authorizedCents,POLICY.pilotCents),'manual repair allowance exceeds deployed authorization');
}
