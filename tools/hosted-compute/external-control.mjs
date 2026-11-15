import { canonical, sha256, encode, assert, safeName, POLICY } from './policy.mjs';
import { freezeGithubUsage,verifyGithubUsage,assertGithubUsageCurrent,projectGithubUsage } from './github-usage.mjs';

const digest = /^[a-f0-9]{64}$/;
const revision = /^[a-f0-9]{40}$/;
export const controlRepositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const noncePattern = /^[a-f0-9]{32}$/;
export const prearmPath = nonce => `control/prearms/${nonce}.json`;
export const fencePath = nonce => `control/fences/${nonce}.json`;

// The separately content-addressed control reference cannot be part of its own
// launch digest. The controller's normal full-manifest digest is unchanged.
export async function launchManifestSha256(manifest) {
  const { externalControl, ...launch } = manifest;
  return sha256(encode(canonical(launch)));
}
export async function buildPrearm(manifest, { accountId, accountEvidenceReference, createdAt = Date.now(),
  fundedCutoff, workflowRevision, controlRepository, githubUsage, nonce = crypto.randomUUID().replaceAll('-', '') } = {}) {
  assert(noncePattern.test(nonce), 'random campaign nonce required');
  assert(safeName(manifest.id) && manifest.id.length <= 40 && Array.isArray(manifest.phases) && manifest.phases.length > 0 && manifest.phases.length <= POLICY.maxPhases, 'bounded campaign phases required');
  const launches = manifest.phases.flatMap((phase, index) => Array.from({length:POLICY.maxReplacementAttempts+1},(_,i)=>i+1).map(extra => ({
    phaseIndex:index, phaseId:phase.id, generation:index + extra,
    name:`righelt-${manifest.id}-${nonce}-${index + extra}-${index}`, image:phase.host.image,
  })));
  const record = { schema:1, kind:'runpod-cleanup-prearm', campaignId:manifest.id, nonce,
    launchSha256:await launchManifestSha256(manifest), accountId, accountEvidenceReference,
    createdAt, originalDeadline:manifest.deadline, fundedCutoff,
    cutoff:Math.min(manifest.deadline, fundedCutoff), controlRepository, workflowRevision,
    maximumReplacements:POLICY.maxReplacementAttempts, maximumGeneration:manifest.phases.length + POLICY.maxReplacementAttempts, launches };
  record.githubUsage=await freezeGithubUsage(githubUsage,{createdAt,cutoff:record.cutoff,repository:controlRepository});
  validatePrearm(record); return record;
}
export function validatePrearm(record) {
  assert(record?.schema === 1 && record.kind === 'runpod-cleanup-prearm' && safeName(record.campaignId) && noncePattern.test(record.nonce), 'invalid external prearm');
  assert(digest.test(record.launchSha256) && revision.test(record.workflowRevision) && controlRepositoryName.test(record.controlRepository), 'pinned control identities required');
  assert(typeof record.accountId === 'string' && record.accountId.length >= 3 && record.accountId.length <= 120 && typeof record.accountEvidenceReference === 'string' && record.accountEvidenceReference.length >= 8, 'verified Runpod account binding required');
  assert([record.createdAt,record.originalDeadline,record.fundedCutoff,record.cutoff].every(Number.isSafeInteger) && record.originalDeadline > record.createdAt && record.originalDeadline - record.createdAt <= POLICY.campaignMs && record.fundedCutoff > record.createdAt && record.cutoff === Math.min(record.originalDeadline, record.fundedCutoff), 'fixed original deadline and funded cutoff required');
  const githubProjection=projectGithubUsage(record.githubUsage?.record,{createdAt:record.createdAt,cutoff:record.cutoff,repository:record.controlRepository});
  assert(digest.test(record.githubUsage.sha256) && canonical(record.githubUsage.projection)===canonical(githubProjection),'reviewed GitHub usage forecast missing or differs');
  const replacements=POLICY.maxReplacementAttempts;
  assert(record.maximumReplacements === replacements && Number.isSafeInteger(record.maximumGeneration) && record.maximumGeneration >= replacements+1 && record.maximumGeneration <= POLICY.maxPhases+replacements && Array.isArray(record.launches) && record.launches.length === (record.maximumGeneration - replacements) * (replacements+1), 'bounded prearmed generation inventory required');
  const names = new Set();
  for (const item of record.launches) {
    assert(Number.isSafeInteger(item.phaseIndex) && item.phaseIndex >= 0 && item.phaseIndex < record.maximumGeneration - replacements && safeName(item.phaseId) && Number.isSafeInteger(item.generation) && item.generation >= item.phaseIndex + 1 && item.generation <= item.phaseIndex + 1+replacements && item.generation <= record.maximumGeneration, 'invalid prearmed phase/generation');
    assert(item.name === `righelt-${record.campaignId}-${record.nonce}-${item.generation}-${item.phaseIndex}` && !names.has(item.name) && typeof item.image === 'string' && /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(item.image), 'invalid exact launch ownership');
    names.add(item.name);
  }
  return record;
}
export async function validateReference(reference, record) {
  assert(reference && controlRepositoryName.test(reference.repository) && revision.test(reference.commit) && reference.path === prearmPath(record.nonce) && digest.test(reference.sha256), 'pinned external control reference required');
  validatePrearm(record);
  await verifyGithubUsage(record.githubUsage,{createdAt:record.createdAt,cutoff:record.cutoff,repository:record.controlRepository});
  assert(reference.repository === record.controlRepository && await sha256(encode(canonical(record))) === reference.sha256, 'external prearm identity mismatch');
  return record;
}
export class PrimaryControl {
  constructor({store, reference, clock = Date.now}) { Object.assign(this,{store,reference,clock}); }
  async authorizeLaunch(manifest, {phaseIndex,generation}) {
    assert(canonical(manifest.externalControl) === canonical(this.reference), 'manifest control reference differs');
    const record = await this.store.readPrearm(this.reference);
    await validateReference(this.reference,record);
    assert(record.launchSha256 === await launchManifestSha256(manifest) && manifest.deadline === record.originalDeadline, 'prearm does not bind this launch manifest');
    assert(this.clock() < record.cutoff && this.clock() >= record.createdAt, 'external launch cutoff reached');
    assertGithubUsageCurrent(record.githubUsage,this.clock());
    const fence = await this.store.readFence(record.nonce,this.reference);
    assert(fence === null, 'external campaign terminal fence blocks new work');
    const item = record.launches.find(x => x.phaseIndex === phaseIndex && x.generation === generation);
    assert(item && manifest.phases[phaseIndex]?.id === item.phaseId && manifest.phases[phaseIndex]?.host.image === item.image, 'launch not in exact prearmed inventory');
    assert(this.clock()<record.cutoff,'external launch cutoff reached');
    assertGithubUsageCurrent(record.githubUsage,this.clock());
    return {name:item.name,prearmSha256:this.reference.sha256,cutoff:record.cutoff};
  }
}
