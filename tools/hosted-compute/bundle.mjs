import { POLICY, assert } from './policy.mjs';
// Whole-tree snapshots are deliberate. Measure growth/transfer before admission.
export function bundlePreflight(files, { projectedFiles, projectedObjects, projectedBytes, bytesPerSecond, checkpointAgeMs, copyMs, requestOverheadMs }) {
  assert(files.length > 0 && files.every(f => Number.isSafeInteger(f.bytes) && f.bytes >= 0 && f.bytes <= POLICY.maxObjectBytes), 'oversized portable object');
  assert(Number.isSafeInteger(projectedFiles) && projectedFiles >= files.length && projectedFiles <= POLICY.maxArtifacts, 'infeasible projected artifact count');
  assert(Number.isSafeInteger(projectedObjects) && projectedObjects >= projectedFiles && projectedObjects <= POLICY.maxArtifacts, 'infeasible cumulative object count');
  const bytes = files.reduce((n,f) => n+f.bytes, 0);
  assert(Number.isSafeInteger(projectedBytes) && projectedBytes >= bytes && Number.isFinite(bytesPerSecond) && bytesPerSecond > 0, 'measured transfer rate and projected bundle required');
  assert([checkpointAgeMs, copyMs, requestOverheadMs].every(n => Number.isFinite(n) && n >= 0), 'measured checkpoint/copy/request overhead required');
  const publicationMs = copyMs + projectedBytes / bytesPerSecond * 1000 + projectedFiles * requestOverheadMs;
  assert(publicationMs < POLICY.snapshotEveryMs && checkpointAgeMs + publicationMs < POLICY.checkpointMs, 'whole-tree publication cannot meet durability window');
  return { files: files.length, bytes, projectedFiles, projectedObjects, projectedBytes, publicationMs, worstLossMs: checkpointAgeMs + publicationMs, qualified: true };
}
