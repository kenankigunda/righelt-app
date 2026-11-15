import { assert, artifact, canonical, sha256 } from './policy.mjs';

export function executionIdentity(manifest, manifestSha256, phase, generation) {
  return { campaign: manifest.id, phase: phase.id, manifestSha256, generation, seed: manifest.seed,
    ...(phase.planSha256?{planSha256:phase.planSha256}:{}),
    sourceRevision: manifest.sourceRevision, dependencySha256: manifest.dependencySha256,
    recipeSha256: manifest.recipeSha256, executionRecipeSha256: manifest.executionRecipeSha256,
    ...(manifest.developmentEvidence?{developmentEvidence:manifest.developmentEvidence}:{}),
    ...(manifest.scientific?{scientific:manifest.scientific}:{}),
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
  if(manifest.scientific) return verifyScientificResult(result,{manifest,phase,read});
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

// Scientific accounting distinguishes finished execution from a successful
// learning result. A timeout remains unfinished, even when its report is valid.
async function verifyScientificResult(result,{manifest,phase,read}){
  assert(canonical(result.accountedWorkIds)===canonical(phase.workIds),'scheduled scientific work not accounted');
  assert(Array.isArray(result.artifacts)&&result.artifacts.length>0,'scientific artifacts required');
  const verified=new Map();
  for(const a of result.artifacts){
    artifact(a);assert(a.path?.startsWith(phase.runDir+'/'),'scientific artifact outside phase');
    const bytes=await read(a);assert(bytes.length===a.bytes&&await sha256(bytes)===a.sha256,'scientific artifact checksum mismatch');
    assert(!verified.has(a.sha256),'duplicate scientific artifact');verified.set(a.sha256,bytes);
  }
  const proofArtifact=result.artifacts.find(a=>a.role==='proof');assert(proofArtifact,'scientific proof required');
  const proof=JSON.parse(new TextDecoder().decode(verified.get(proofArtifact.sha256)));
  assert(proof.schema===1&&proof.kind===`${phase.kind}-proof`&&canonical(proof.execution)===canonical(result.execution),'scientific proof identity mismatch');
  const receipts=proof.workReceipts;
  assert(Array.isArray(receipts)&&canonical(receipts.map(r=>r.workId))===canonical(phase.workIds),'scientific receipt inventory mismatch');
  assert(receipts.every(r=>['complete','unfinished','failed','unstarted'].includes(r.status)),'invalid scientific work disposition');
  assert(result.allWorkComplete===receipts.every(r=>r.status==='complete'),'scientific completion differs from executed receipts');
  for(const r of receipts)if(r.status!=='unstarted')assert(verified.has(r.evidenceSha256),'scientific attempt lacks retained evidence');
  assert(canonical(result.completedWorkIds)===canonical(receipts.filter(r=>r.status==='complete').map(r=>r.workId)),'scientific completed work differs from executed receipts');
  if(phase.kind==='training'){
    const cp=result.artifacts.find(a=>a.role==='checkpoint'),model=result.artifacts.find(a=>a.role==='model');
    assert(cp&&model&&Number.isSafeInteger(result.updates)&&result.updates>0&&Number.isFinite(result.parameterDelta)&&result.parameterDelta>0,'scientific training lacks actual updates');
    assert(proof.checkpointSha256===cp.sha256&&proof.modelSha256===model.sha256&&proof.recoveryPassed===true&&proof.numericParityPassed===true,'scientific training recovery/export proof incomplete');
    if(result.execution.scientific.arm==='treatment'){
      const adopted=proof.policyRefreshAdoption,qualified=proof.policyRefreshInputQualified;
      assert(adopted?.complete===true&&adopted.positions>0&&adopted.ids?.length>0&&adopted.missing?.length===0,'treatment policy adoption incomplete');
      assert(qualified?.inputCheckpointSha256===result.execution.inputCheckpointSha256&&qualified.bindingSha256===adopted.bindingSha256&&
        manifest.inputs?.some(a=>a.sha256===adopted.bindingSha256)&&Array.isArray(qualified.ids)&&canonical([...qualified.ids].sort())===canonical([...adopted.ids].sort()),'treatment adopted different shared-replay policy input');
    }
  }else if(phase.kind==='evaluation'){
    assert(result.execution.scientific.candidateSha256&&proof.candidateSha256===result.execution.scientific.candidateSha256,'evaluation candidate not locked');
    assert(proof.unfinishedIsDraw===false&&proof.prospective===true,'prospective evaluation accounting required');
    assert(proof.inferenceRuntime?.candidate?.kind==='exported-onnx'&&proof.inferenceRuntime.candidate.artifactSha256===proof.candidateSha256,'evaluation must execute the locked exported artifact');
  }else if(phase.kind==='teacher'){
    assert(['screen','refresh'].includes(proof.mode),'explicit teacher proof mode required');
    assert(proof.policyOnly===true&&proof.observedValuesUnchanged===true&&proof.originalMasksUnchanged===true,'teacher cannot replace observed values or masks');
    assert(proof.actualSearchEvidence===true&&proof.publicSearchBudgetsUnchanged===true,'actual qualified offline teaching evidence required');
    if(proof.mode==='refresh')assert(result.policyRefreshSha256===proof.policyRefreshSha256&&verified.has(proof.policyRefreshSha256),'teacher policy output binding missing');
  }else if(phase.kind==='export'){
    const model=result.artifacts.find(a=>a.role==='model');
    assert(model&&proof.modelSha256===model.sha256&&proof.numericParityPassed===true,'export numeric proof incomplete');
  }
  return result;
}
