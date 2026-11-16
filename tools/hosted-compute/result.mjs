import { POLICY,assert, artifact, canonical, sha256 } from './policy.mjs';

export function executionIdentity(manifest, manifestSha256, phase, generation) {
  return { campaign: manifest.id, phase: phase.id, manifestSha256, generation, seed: manifest.seed,
    ...(phase.planSha256?{planSha256:phase.planSha256}:{}),
    sourceRevision: manifest.sourceRevision, dependencySha256: manifest.dependencySha256,
    recipeSha256: manifest.recipeSha256, executionRecipeSha256: manifest.executionRecipeSha256,
    ...(manifest.developmentEvidence?{developmentEvidence:manifest.developmentEvidence}:{}),
    ...(manifest.scientific?{scientific:manifest.scientific}:{}),
    ...(manifest.purpose===POLICY.publicTiming.purpose?{publicTiming:manifest.publicTiming}:{inputCheckpointSha256:manifest.checkpointSha256,dataSha256:manifest.corpusSha256}) };
}
// A completed receipt from a prior host is valid only through an exact durable
// snapshot membership. Consumed but unsettled game claims are never successes.
export async function verifyResult(result, { manifest, manifestSha256, phase, generation, snapshot, rawSha256, read, phaseDeadline,expect = {} }) {
  assert(result?.schema === 1 && result.kind === (manifest.purpose===POLICY.publicTiming.purpose?POLICY.publicTiming.resultKind:'compute-result') && result.disposition === 'complete', 'typed completed result required');
  for (const [key,value] of Object.entries(expect)) assert(canonical(result[key]) === canonical(value), 'phase evidence failed');
  const origin = result.execution?.generation;
  assert(Number.isSafeInteger(origin) && origin > 0 && origin <= generation, 'invalid original execution');
  if (origin !== generation) assert(snapshot && snapshot.phaseIndex === manifest.phases.findIndex(p => p.id === phase.id) && snapshot.files.some(f => f.sha256 === rawSha256 && (f.originGeneration ?? snapshot.generation) === origin), 'result lacks durable recovery chain');
  assert(canonical(result.execution) === canonical(executionIdentity(manifest, manifestSha256, phase, origin)), 'result execution identity mismatch');
  if(manifest.purpose===POLICY.publicTiming.purpose)return verifyPublicTimingResult(result,{manifest,phase,read,phaseDeadline});
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

async function verifyPublicTimingResult(result,{manifest,phase,read,phaseDeadline}){
  assert(result.accountingComplete===true&&result.strengthEstablished===false&&result.scientificAdmission===false,'public timing accounting is not a scientific result');
  assert(canonical(result.accountedWorkIds)===canonical(phase.workIds)&&Array.isArray(result.artifacts)&&result.artifacts.length>=4,'public timing work inventory missing');
  const objects=new Map();
  for(const a of result.artifacts){artifact(a);assert(a.path?.startsWith(phase.runDir+'/')&&!objects.has(a.sha256),'public timing artifact identity differs');const bytes=await read(a);assert(bytes.length===a.bytes&&await sha256(bytes)===a.sha256,'public timing artifact bytes differ');objects.set(a.sha256,bytes);}
  const load=role=>{const a=result.artifacts.filter(x=>x.role===role);assert(a.length===1,'one public timing '+role+' required');return {artifact:a[0],value:JSON.parse(new TextDecoder().decode(objects.get(a[0].sha256)))};};
  const {value:proof}=load('proof'),{artifact:planArtifact,value:plan}=load('plan'),{artifact:recipeArtifact,value:recipe}=load('execution-recipe'),{artifact:runtimeArtifact,value:runtime}=load('runtime'),{artifact:reportArtifact,value:report}=load('report');
  const t=manifest.publicTiming;
  assert(reportArtifact.sha256===proof.reportSha256,'public timing report differs from bound proof');
  assert(Number.isSafeInteger(phaseDeadline)&&proof.originalDeadline===phaseDeadline&&Number.isFinite(plan.accountingReserveSeconds)&&plan.accountingReserveSeconds>0&&plan.accountingReserveSeconds<phase.seconds&&proof.originalWorkDeadline===phaseDeadline-plan.accountingReserveSeconds*1000,'public timing original deadline or publication reserve differs');
  assert(proof.schema===1&&proof.kind===POLICY.publicTiming.proofKind&&canonical(proof.execution)===canonical(result.execution)&&canonical(proof.publicTiming)===canonical(t)&&canonical(proof.originalIncumbent)===canonical(POLICY.publicTiming.incumbent),'public timing proof binding differs');
  assert(planArtifact.sha256===t.planSha256&&plan.schema===1&&plan.kind===POLICY.publicTiming.planKind&&plan.purpose===POLICY.publicTiming.purpose&&plan.model.sha256===t.modelSha256&&await sha256(new TextEncoder().encode(canonical(plan.profiles)))===t.profilesSha256,'public timing plan input differs');
  assert(recipeArtifact.sha256===manifest.executionRecipeSha256&&recipe.schema===1&&recipe.kind===POLICY.publicTiming.recipeKind&&recipe.sourceRevision===manifest.sourceRevision&&recipe.dependencySha256===manifest.dependencySha256&&recipe.producerSha256===t.producerSha256&&recipe.planSha256===t.planSha256&&recipe.modelSha256===t.modelSha256&&recipe.profilesSha256===t.profilesSha256&&recipe.qualifiedRuntimeSha256===t.qualifiedRuntimeSha256,'public timing execution recipe differs');
  assert(runtimeArtifact.sha256===proof.runtimeArtifactSha256&&runtime.runtimeSha256===t.qualifiedRuntimeSha256&&await sha256(new TextEncoder().encode(canonical(runtime.record)))===t.qualifiedRuntimeSha256&&runtime.record.kernelPassed===true,'public timing runtime is not the qualified cohort');
  const unavailable=canonical(proof.inferenceRuntime)===canonical({kind:'unavailable',reason:'model-load-failed'});
  assert(unavailable||(typeof proof.inferenceRuntime?.onnxruntime==='string'&&proof.inferenceRuntime.onnxruntime.length>0&&proof.inferenceRuntime?.kind==='exported-onnx'&&proof.inferenceRuntime.artifactSha256===t.modelSha256&&canonical(proof.inferenceRuntime.providers)===canonical(['CPUExecutionProvider'])&&proof.inferenceRuntime.inferenceDevice==='cpu'&&proof.inferenceRuntime.hostedGpuUsedForInference===false),'public timing must use actual original CPU ORT');
  const receipts=proof.workReceipts;
  assert(Array.isArray(plan.schedule)&&canonical(plan.schedule.map(j=>j.id))===canonical(phase.workIds)&&Array.isArray(receipts)&&canonical(receipts.map(r=>r.workId))===canonical(phase.workIds),'public timing planned IDs differ');
  const completed=[],attempts=[];
  for(const [index,r]of receipts.entries()){
    const job=plan.schedule[index];
    assert(['complete','unfinished','failed','unstarted'].includes(r.status)&&objects.has(r.evidenceSha256),'public timing attempt evidence missing');
    const attempt=JSON.parse(new TextDecoder().decode(objects.get(r.evidenceSha256)));
    assert(attempt.workId===job.id&&attempt.status===r.status&&attempt.profile===job.profile&&attempt.referenceSeat===job.referenceSeat&&attempt.seed===job.seed&&attempt.originalDeadline===proof.originalDeadline,'public timing attempt binding differs');
    attempts.push(attempt);
    assert(Number.isFinite(attempt.elapsedMs)&&attempt.elapsedMs>=0&&Number.isFinite(attempt.inferenceMs)&&attempt.inferenceMs>=0,'public timing elapsed work missing');
    if(r.status==='complete'){
      assert(attempt.inferenceCalls&&['P1','P2'].every(seat=>Number.isSafeInteger(attempt.inferenceCalls[seat])&&attempt.inferenceCalls[seat]>=0)&&attempt.inferenceCalls.P1+attempt.inferenceCalls.P2>0,'completed public timing game did not execute inference');
      assert(attempt.engineReplayVerified===true&&attempt.startVerified===true&&attempt.termination==='terminal'&&['p1_win','p2_win','draw'].includes(attempt.outcome)&&objects.has(attempt.rawEvidenceSha256)&&objects.has(attempt.verificationEvidenceSha256),'completed public timing game lacks terminal/start/replay proof');const raw=JSON.parse(new TextDecoder().decode(objects.get(attempt.rawEvidenceSha256))),verification=JSON.parse(new TextDecoder().decode(objects.get(attempt.verificationEvidenceSha256))),game=raw.game;
      assert(raw.workId===job.id&&raw.sourceRevision===manifest.sourceRevision&&game?.purpose===POLICY.publicTiming.purpose&&game.id===job.id&&game.seed===job.seed&&game.kind==='normal'&&!Object.hasOwn(game,'partition')&&!Object.hasOwn(game,'familyId')&&!Object.hasOwn(game,'sourceFamily')&&Array.isArray(game.warmupActions)&&game.warmupActions.length===0&&game.rootState&&game.initialState&&game.termination==='terminal'&&game.outcome?.status===attempt.outcome,'public timing raw game identity differs');
      assert(canonical(game.modelVersions)===canonical({P1:t.modelSha256,P2:t.modelSha256})&&canonical(game.profileVersions)===canonical({P1:plan.profiles.profiles[job.profile].version,P2:plan.profiles.profiles[job.profile].version})&&canonical(game.evaluationProfile)===canonical({name:job.profile,sourceSha256:plan.profiles.sourceSha256,definition:plan.profiles.profiles[job.profile],artifactSha256:t.profilesSha256}),'public timing actual seat model or profile differs');
      assert(verification.kind==='public-timing-verification'&&verification.rawEvidenceSha256===attempt.rawEvidenceSha256&&canonical(verification.startIdentity)===canonical(job.startIdentity)&&verification.verifier?.sourceRevision===manifest.sourceRevision&&verification.engineReplayVerified===true&&verification.outcome===attempt.outcome,'public timing replay/start verification differs');
      if(attempt.timingComplete===true){assert(objects.has(attempt.measurementEvidenceSha256),'original timing measurement missing');const measurement=JSON.parse(new TextDecoder().decode(objects.get(attempt.measurementEvidenceSha256)));assert(measurement.kind==='public-timing-measurement'&&measurement.workId===job.id&&measurement.status===attempt.status&&measurement.rawEvidenceSha256===attempt.rawEvidenceSha256&&measurement.verificationEvidenceSha256===attempt.verificationEvidenceSha256&&measurement.elapsedMs===attempt.elapsedMs&&measurement.inferenceMs===attempt.inferenceMs&&canonical(measurement.inferenceCalls)===canonical(attempt.inferenceCalls),'original timing measurement differs');}
      completed.push(job.id);
    }else assert(attempt.completedWholeGame!==true,'unfinished timing cannot count as a completed whole game');
  }
  if(unavailable)assert(completed.length===0&&attempts.every(a=>a.status==='unstarted'&&a.completedWholeGame===false&&a.elapsedMs===0&&a.inferenceMs===0&&Object.values(a.inferenceCalls??{}).every(n=>n===0)&&a.timingComplete!==true)&&report.inferenceMs===0&&report.scopeCoverageComplete===false&&report.timingCoverageComplete===false,'unavailable runtime permits only zero-inference unstarted accounting');
  assert(canonical(result.completedWorkIds)===canonical(completed)&&report.schema===1&&report.kind===POLICY.publicTiming.reportKind&&report.accountingComplete===true&&report.strengthEstablished===false&&report.scientificAdmission===false&&report.completedWholeGames===completed.length&&result.scopeCoverageComplete===report.scopeCoverageComplete,'public timing summary differs from attempts');
  const cells=[];for(const profile of Object.keys(plan.profiles.profiles).sort())for(const referenceSeat of ['P1','P2']){const rows=attempts.filter(a=>a.profile===profile&&a.referenceSeat===referenceSeat);cells.push({profile,referenceSeat,planned:rows.length,...Object.fromEntries(['complete','unfinished','failed','unstarted'].map(status=>[status,rows.filter(a=>a.status===status).length]))});}
  const calls=Object.fromEntries(['P1','P2'].map(seat=>[seat,attempts.reduce((n,a)=>n+(a.inferenceCalls?.[seat]??0),0)])),finished=attempts.filter(a=>a.status==='complete');
  assert(canonical(report.scopeCells)===canonical(cells)&&canonical(report.inferenceCalls)===canonical(calls)&&report.scopeCoverageComplete===(cells.every(c=>c.complete>0)&&calls.P1>0&&calls.P2>0),'public timing scope coverage differs');
  assert(report.timingCoverageComplete===(finished.length>0&&finished.every(a=>a.timingComplete===true))&&canonical(report.completedWholeGameMs)===canonical(finished.filter(a=>a.timingComplete===true).map(a=>a.elapsedMs))&&canonical(report.completedTimeLowerBoundMs)===canonical(finished.filter(a=>a.timingComplete!==true).map(a=>a.elapsedMs)),'public timing cannot turn missing original timing into optimistic throughput');
  assert(canonical(report.unknownOriginalCostWorkIds)===canonical(attempts.filter(a=>['unfinished','failed'].includes(a.status)&&!a.publicTimingMeasurements).map(a=>a.workId))&&report.inferenceMs===attempts.reduce((n,a)=>n+a.inferenceMs,0)&&canonical(report.unfinishedLowerBoundMs)===canonical(attempts.filter(a=>['unfinished','failed'].includes(a.status)).map(a=>a.elapsedMs)),'public timing aggregate work cost differs');
  assert(report.allInCost?.status==='pending-operator-cleanup-and-billing'&&report.exportPerformed===false,'public timing cannot invent closed cleanup or billing cost');
  return result;
}
