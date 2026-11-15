import { assert, canonical, encode, sha256 } from './policy.mjs';

// Price/expiry are checked at each admission, independently of reusable
// operational evidence for exactly the same image/runtime/placement.
export function qualificationIdentity(manifest, host, runtimeSha256) {
  assert(/^[a-f0-9]{64}$/.test(runtimeSha256), 'qualified CUDA/driver/runtime binding required');
  const {provider,image,gpu,minRamGb,minVcpu,dataCenterId,diskGb,minCudaVersion} = host;
  return { sourceRevision:manifest.sourceRevision, dependencySha256:manifest.dependencySha256,
    backend:'cuda', runtimeSha256, host:{provider,image,gpu,minRamGb,minVcpu,dataCenterId,diskGb,minCudaVersion} };
}
export const QUALIFICATION_CHECKS = Object.freeze(['correctness','recovery','cleanup','cuda','mac-disconnected','host-loss','backup-restore']);
export async function verifyQualificationReceipts(report) {
  const identity = qualificationIdentity(report, report.host, report.runtimeSha256);
  const checks = new Set();
  assert(Array.isArray(report.receipts) && report.receipts.length === QUALIFICATION_CHECKS.length, 'raw qualification drill receipts required');
  for (const receipt of report.receipts) {
    assert(typeof receipt.raw === 'string' && new TextEncoder().encode(receipt.raw).byteLength <= 1048576 && await sha256(encode(receipt.raw)) === receipt.sha256, 'qualification receipt checksum differs');
    const value = JSON.parse(receipt.raw);
    assert(value.schema === 1 && value.kind === 'qualification-drill' && QUALIFICATION_CHECKS.includes(value.check) && !checks.has(value.check), 'duplicate or unknown qualification drill');
    assert(value.passed === true && value.fixtureOnly === false && value.environment === 'runpod-secure-cuda' && canonical(value.qualification) === canonical(identity), 'qualification drill execution differs or is fixture-only');
    assert(typeof value.campaign === 'string' && /^[a-f0-9]{64}$/.test(value.manifestSha256) && Number.isSafeInteger(value.startedAt) && Number.isSafeInteger(value.completedAt) && value.completedAt >= value.startedAt && Array.isArray(value.evidenceSha256) && value.evidenceSha256.length > 0 && value.evidenceSha256.every(h => /^[a-f0-9]{64}$/.test(h)), 'qualification drill raw evidence bindings incomplete');
    checks.add(value.check);
  }
  return identity;
}
