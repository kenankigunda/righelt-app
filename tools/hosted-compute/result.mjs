import { assert, artifact, canonical, sha256 } from './policy.mjs';

export function executionIdentity(manifest, manifestSha256, phase, generation) {
  return { campaign: manifest.id, phase: phase.id, manifestSha256, generation, seed: manifest.seed,
    sourceRevision: manifest.sourceRevision, dependencySha256: manifest.dependencySha256,
    recipeSha256: manifest.recipeSha256, executionRecipeSha256: manifest.executionRecipeSha256,
    inputCheckpointSha256: manifest.checkpointSha256, dataSha256: manifest.corpusSha256 };
}
// A completed receipt from a prior host is valid only through an exact durable
// snapshot membership. Consumed but unsettled game claims are never successes.
export async function verifyResult(result, { manifest, manifestSha256, phase, generation, snapshot, rawSha256, read, expect = {} }) {
  assert(result?.schema === 1 && result.kind === 'compute-result' && result.disposition === 'complete', 'typed completed result required');
  for (const [key,value] of Object.entries(expect)) assert(canonical(result[key]) === canonical(value), 'phase evidence failed');
  const origin = result.execution?.generation;
  assert(Number.isSafeInteger(origin) && origin > 0 && origin <= generation, 'invalid original execution');
  if (origin !== generation) assert(snapshot && snapshot.phaseIndex === manifest.phases.findIndex(p => p.id === phase.id) && snapshot.files.some(f => f.sha256 === rawSha256 && (f.originGeneration ?? snapshot.generation) === origin), 'result lacks durable recovery chain');
  assert(canonical(result.execution) === canonical(executionIdentity(manifest, manifestSha256, phase, origin)), 'result execution identity mismatch');
  assert(canonical(result.completedWorkIds) === canonical(phase.workIds), 'scheduled work not complete');
  assert(result.artifacts?.length >= 2 && result.artifacts.some(a => a.role === 'model') && result.artifacts.some(a => a.role === 'proof'), 'model and proof identities required');
  for (const a of result.artifacts) {
    artifact(a);
    assert(a.path?.startsWith(phase.runDir + '/'), 'result artifact outside phase');
    const bytes = await read(a);
    assert(bytes.length === a.bytes && await sha256(bytes) === a.sha256, 'result artifact checksum mismatch');
  }
  const model = result.artifacts.find(a => a.role === 'model');
  const proofArtifact = result.artifacts.find(a => a.role === 'proof');
  const proof = JSON.parse(new TextDecoder().decode(await read(proofArtifact)));
  assert(proof.kind === 'pipeline-proof' && canonical(proof.execution) === canonical(result.execution) && proof.export?.sha256 === model.sha256, 'proof refers to different model or execution');
  if (phase.kind === 'training' || phase.kind === 'rehearsal') assert(Number.isSafeInteger(result.updates) && result.updates > 0 && Number.isFinite(result.parameterDelta) && result.parameterDelta > 0, 'zero actual training updates');
  if (phase.kind === 'training' || phase.kind === 'rehearsal') {
    const checkpoint = result.artifacts.find(a => a.role === 'checkpoint');
    assert(checkpoint && proof.checkpointSha256 === checkpoint.sha256 && proof.training?.recoveryPassed === true && proof.recoveredUpdates === result.updates && proof.training.updates === result.updates && proof.parity?.numericPassed === true, 'training/recovery/export proof incomplete');
  }
  return result;
}
