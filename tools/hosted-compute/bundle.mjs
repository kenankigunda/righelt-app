import { POLICY, assert } from './policy.mjs';
import { LEDGER_CHUNK_BYTES } from './storage.mjs';
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

export function projectCampaign(files,{observedHours,newFiles,newObjects,newBytes,largestProjectedObjectBytes,
  initialObjects,initialClaims,newClaims,initialStoredBytes,newStoredBytes,retryPublications,ledgerBytes,ledgerGrowthBytes,
  cloudReadPasses,rates,cloudflareReserveCents,...transfer}){
  assert(Number.isFinite(observedHours)&&observedHours>0&&[newFiles,newObjects,newBytes].every(n=>Number.isSafeInteger(n)&&n>=0),'measured short-run growth required');
  assert(Number.isSafeInteger(largestProjectedObjectBytes)&&largestProjectedObjectBytes<=POLICY.maxObjectBytes,'projected object exceeds 64 MiB');
  const scale=POLICY.campaignMs/3600000/observedHours;
  assert([initialObjects,initialClaims,newClaims,initialStoredBytes,newStoredBytes,retryPublications,ledgerBytes,ledgerGrowthBytes].every(n=>Number.isSafeInteger(n)&&n>=0) && initialObjects>=files.length && initialStoredBytes>=files.reduce((n,a)=>n+a.bytes,0) && ledgerBytes>0,'measured initial inventory, claims, stored growth, retries and ledger size required');
  assert(Number.isSafeInteger(cloudReadPasses)&&cloudReadPasses>=3,'collection and two cloud restore passes required');
  const projectedClaims=initialClaims+Math.ceil(newClaims*scale);
  assert(projectedClaims<=POLICY.maxArtifacts,'infeasible cumulative claim count');
  const projection=bundlePreflight(files,{...transfer,projectedFiles:files.length+Math.ceil(newFiles*scale),projectedObjects:initialObjects+Math.ceil(newObjects*scale),projectedBytes:files.reduce((n,a)=>n+a.bytes,0)+Math.ceil(newBytes*scale)});
  const publicationPasses=Math.ceil(POLICY.campaignMs/POLICY.snapshotEveryMs)+retryPublications;
  const repeatedTransferBytes=projection.projectedBytes*publicationPasses;
  const projectedLedgerBytes=ledgerBytes+Math.ceil(ledgerGrowthBytes*scale);
  const ledgerChunks=Math.ceil(projectedLedgerBytes/LEDGER_CHUNK_BYTES)+1;
  const newUploads=projection.projectedObjects-initialObjects;
  // Count conservative full-ledger writes at the largest projected size. The
  // duplicate fast path removes only committed-upload saves, not bytes/hash IO.
  const renewalSavesPerPublication=Math.max(1,Math.ceil(projection.publicationMs/POLICY.heartbeatMs));
  const ledgerSaves=2*newUploads+publicationPasses*(2+renewalSavesPerPublication)+Math.ceil(POLICY.campaignMs/POLICY.heartbeatMs)+projectedClaims*3+retryPublications*projection.projectedFiles*2;
  const doWriteOperations=ledgerSaves*ledgerChunks;
  // The authenticated route, core operation and post-request alarm check can
  // each load the complete ledger. Transactions additionally read their head.
  const doReadOperations=3*(publicationPasses*projection.projectedFiles+ledgerSaves)*ledgerChunks+ledgerSaves;
  const r2WriteOperations=projection.projectedObjects+2*projection.projectedFiles;
  const r2ReadOperations=cloudReadPasses*projection.projectedObjects;
  const retainedBytes=initialStoredBytes+Math.ceil(newStoredBytes*scale)+2*projection.projectedBytes;
  const rateKeys=['r2WritePerMillionCents','r2ReadPerMillionCents','doWritePerMillionCents','doReadPerMillionCents','storageGiBMonthCents','baseAndOtherCents'];
  assert(rates&&rateKeys.every(k=>Number.isFinite(rates[k])&&rates[k]>=0)&&typeof rates.evidenceReference==='string'&&rates.evidenceReference.length>=8,'reviewed all-in Cloudflare rates/headroom required');
  const cloudflareProjectedCents=Math.ceil(rates.baseAndOtherCents+(r2WriteOperations*rates.r2WritePerMillionCents+r2ReadOperations*rates.r2ReadPerMillionCents+doWriteOperations*rates.doWritePerMillionCents+doReadOperations*rates.doReadPerMillionCents)/1e6+retainedBytes/1073741824*rates.storageGiBMonthCents);
  assert(Number.isSafeInteger(cloudflareReserveCents)&&cloudflareReserveCents>0&&cloudflareReserveCents<=POLICY.cloudflareCents&&cloudflareProjectedCents<=cloudflareReserveCents,'projected thirty-day Cloudflare cost exceeds reserved funding');
  assert([repeatedTransferBytes,retainedBytes,doWriteOperations,doReadOperations].every(Number.isSafeInteger),'projection exceeds exact accounting range');
  return {...projection,projectedClaims,publicationPasses,repeatedTransferBytes,projectedLedgerBytes,ledgerSaves,doWriteOperations,doReadOperations,r2WriteOperations,r2ReadOperations,retainedBytes,cloudflareProjectedCents};
}
