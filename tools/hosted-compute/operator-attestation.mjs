import { assert, canonical, encode, sha256 } from './policy.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// This validates an authenticated operator assertion. It does not claim that
// the controller can independently inspect the operator-only backup bucket.
export function validateOperatorAttestation(a, expected) {
  assert(a?.schema === 1 && a.kind === 'operator-backup-attestation' && a.verified === true && a.allocationResumed === false, 'verified operator backup attestation required');
  for (const key of ['campaign', 'manifestSha256', 'inventorySha256']) assert(a[key] === expected[key], 'backup attestation identity mismatch');
  assert(Array.isArray(a.roots) && a.roots.length > 0 && a.roots.length <= 2 && new Set(a.roots.map(r => r.id)).size === a.roots.length, 'complete retained backup roots required');
  for (const r of a.roots) assert(typeof r.id === 'string' && /^[a-zA-Z0-9-]+$/.test(r.id) && hash(r.rootSha256) && hash(r.restoreProofSha256) && (r.checkpointSha256 === null || hash(r.checkpointSha256)), 'invalid backup root attestation');
  if (expected.recoveryPoints) {
    const wanted = expected.recoveryPoints.map(p => p.id).sort();
    const actual = a.roots.map(r => r.snapshotId).filter(x => x !== null).sort();
    assert(canonical(wanted) === canonical(actual), 'backup attestation omits a recovery point');
  }
  return a;
}

export async function operatorAttestation(vault, inventory) {
  const inventorySha256 = await sha256(encode(canonical(inventory))), catalog = await vault.catalog();
  const roots = catalog.roots.filter(r => r.campaign === inventory.id && r.inventorySha256 === inventorySha256);
  const records = [];
  for (const r of roots) {
    const proof = (await vault.state()).restored?.[r.id];
    assert(proof && proof.allocationResumed === false, 'cloud-only restore proof required');
    records.push({ id:r.id, snapshotId:r.snapshotId, checkpointSha256:r.checkpointSha256,
      rootSha256:await sha256(encode(canonical(r))), restoreProofSha256:await sha256(encode(canonical(proof))) });
  }
  return validateOperatorAttestation({schema:1,kind:'operator-backup-attestation',campaign:inventory.id,
    manifestSha256:inventory.manifestSha256,inventorySha256,roots:records,verified:true,allocationResumed:false},
  {campaign:inventory.id,manifestSha256:inventory.manifestSha256,inventorySha256,recoveryPoints:inventory.recoveryPoints});
}
