import {assert,canonical,encode,sha256,POLICY} from './policy.mjs';

// Historical product identities. The research starting point may advance only
// through the separately frozen common calibration rule and its typed result.
export const ORIGINAL_INCUMBENT=Object.freeze({
  checkpointSha256:'fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44',
  publicOnnxSha256:'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f',
});
export const COMPARISON_METHOD='policy-only-search-refresh-v1';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const cents=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const fields=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...names].sort());
const identityFields=['sourceRevision','dependencySha256','seed','recipeSha256','methodSha256','corpusSha256','familyInventorySha256','hostConfigurationSha256','runtimeSha256'];
const rowCore=['id','stage','arm','computeCents','cloudflareCents','seconds'];
const reserveNames=['qualification','preparation','cleanup','repair','retention'];

export async function hostConfigurationSha256(host){
  const selected={};for(const key of ['provider','image','gpu','minRamGb','minVcpu','minCudaVersion','dataCenterId','hourlyCents','diskGb']){assert(host?.[key]!==undefined,'complete qualified host configuration required');selected[key]=host[key];}
  return sha256(encode(canonical(selected)));
}

function identity(value){
  assert(identityFields.every(k=>k==='seed'?Number.isSafeInteger(value?.[k])&&value[k]>=0&&value[k]<2**32:k==='sourceRevision'?/^[a-f0-9]{40}$/.test(value?.[k]):hash(value?.[k])),'complete frozen scientific start identity required');
  return value;
}
function row(value,{preparation=false}={}){
  assert(fields(value,[...rowCore,value?.stage==='evaluation'?'scheduleSha256':'phasePlanSha256'])&&typeof value.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value.id)&&['calibration','teacher-screen','training','evaluation'].includes(value.stage)&&['shared','control','treatment'].includes(value.arm),'unsupported frozen campaign');
  assert(positive(value.computeCents)&&positive(value.cloudflareCents)&&positive(value.seconds)&&value.seconds<=POLICY.campaignMs/1000,'finite campaign budgets and runtime required');
  assert(value.stage==='evaluation'?hash(value.scheduleSha256):hash(value.phasePlanSha256)||preparation&&value.stage==='training'&&value.phasePlanSha256===null,'known plan hash or narrowly deferred training plan required');
  return value;
}
function calibration(value){
  assert(value?.schema===1&&value.kind==='common-calibration'&&value.methodKind===COMPARISON_METHOD&&value.autoPromotion===false,'unsupported common calibration method');
  assert(value.endpointRule==='latest-durable-at-fixed-allocation-end'&&Number.isSafeInteger(value.originalDeadline),'preregistered fixed calibration endpoint required');
  assert(canonical(value.originalIncumbent)===canonical(ORIGINAL_INCUMBENT),'calibration must start from actual original 1086 identities');
  identity(value.identity);row(value.campaign);
  assert(value.campaign.stage==='calibration'&&value.campaign.arm==='shared','calibration must be a shared allocation');
  return value;
}

function reserves(value){
  assert(fields(value,reserveNames),'complete shared qualification, preparation, cleanup, repair and retention reserves required');
  for(const name of reserveNames)assert(fields(value[name],['runpodCents','cloudflareCents'])&&cents(value[name].runpodCents)&&cents(value[name].cloudflareCents),'invalid shared reserve');
  assert(value.qualification.runpodCents>0&&value.preparation.runpodCents>0&&value.cleanup.runpodCents>0&&value.repair.runpodCents>0&&value.retention.cloudflareCents>0,'zero qualification, preparation, cleanup, repair or retention reserve');
  assert(value.repair.runpodCents<=POLICY.repairCents&&value.retention.runpodCents===0,'unsupported repair allowance or retention compute');
}

export function projectExperimentBudget(record,rule){
  calibration(rule);reserves(record.reserves);
  assert(Array.isArray(record.campaigns)&&record.campaigns.length>=4&&record.campaigns.length<=POLICY.maxPhases,'finite comparison campaign inventory required');
  record.campaigns.forEach(c=>row(c,{preparation:record.kind==='policy-target-preparation'}));assert(new Set(record.campaigns.map(c=>c.id)).size===record.campaigns.length&&!record.campaigns.some(c=>c.id===rule.campaign.id),'duplicate scientific campaign identity');
  const training=arm=>record.campaigns.filter(c=>c.stage==='training'&&c.arm===arm);
  assert(training('control').length>0&&training('treatment').length>0,'both unchanged and policy treatment training required');
  const teachers=record.campaigns.filter(c=>c.stage==='teacher-screen');
  assert(teachers.length===1&&teachers[0].arm==='treatment','one paid treatment target-generation campaign required');
  assert(['control','treatment'].every(arm=>record.campaigns.some(c=>c.stage==='evaluation'&&c.arm===arm)),'paired arm evaluation must be reserved before training');
  assert(record.campaigns.every(c=>c.stage!=='calibration'&&(c.stage!=='training'||c.arm!=='shared')),'calibration charged separately once, training arms explicit');
  const total=(arm,key='computeCents')=>record.campaigns.filter(c=>c.arm===arm).reduce((n,c)=>n+c[key],0);
  assert(total('control')===total('treatment'),'control and treatment TOTAL compute caps must be equal, including teacher generation');
  assert(total('control','cloudflareCents')===total('treatment','cloudflareCents'),'control and treatment TOTAL Cloudflare caps must be equal, including teacher generation');
  const runpodCents=rule.campaign.computeCents+record.campaigns.reduce((n,c)=>n+c.computeCents,0)+Object.values(record.reserves).reduce((n,r)=>n+r.runpodCents,0);
  const cloudflareCents=rule.campaign.cloudflareCents+record.campaigns.reduce((n,c)=>n+c.cloudflareCents,0)+Object.values(record.reserves).reduce((n,r)=>n+r.cloudflareCents,0);
  assert(cents(runpodCents)&&runpodCents<=POLICY.pilotCents&&cents(cloudflareCents)&&cloudflareCents<=POLICY.cloudflareCents,'scientific campaign and shared reserves exceed separate provider ceilings');
  const continuation=record.continuation;
  assert(continuation&&[0,1].includes(continuation.maximum)&&Array.isArray(continuation.campaignIds)&&continuation.condition==='preregistered-inconclusive-and-funded-only','at most one preregistered funded continuation');
  // A true continuation must inherit each arm's own descendant checkpoint.
  // That transfer is intentionally not implemented by this initial MVP.
  assert(continuation.maximum===0,'paired descendant continuation is not implemented; freeze maximum zero');
  assert(continuation.campaignIds.length===(continuation.maximum?2:0)&&new Set(continuation.campaignIds).size===continuation.campaignIds.length,'paired continuation campaign inventory differs');
  const continued=continuation.campaignIds.map(id=>record.campaigns.find(c=>c.id===id));
  assert(continued.every(c=>c?.stage==='training')&&(!continued.length||new Set(continued.map(c=>c.arm)).size===2&&continued.every(c=>['control','treatment'].includes(c.arm))),'continuation must be prebudgeted in both training arms');
  assert(training('control').length===1+continuation.maximum&&training('treatment').length===1+continuation.maximum,'unregistered additional training continuation');
  const armBudget=arm=>({runpodCents:total(arm),cloudflareCents:total(arm,'cloudflareCents'),totalCents:total(arm)+total(arm,'cloudflareCents')});
  return {runpodCents,cloudflareCents,control:armBudget('control'),treatment:armBudget('treatment'),
    calibration:{runpodCents:rule.campaign.computeCents,cloudflareCents:rule.campaign.cloudflareCents}};
}

function reviewedRules(value,record){
  assert(value?.schema===1&&value.kind==='reviewed-exploratory-comparison-rules'&&value.reviewed===true&&value.calibrated===true&&typeof value.reviewReference==='string'&&value.reviewReference.length>=8,'calibrated, independently reviewed preregistered parameters required');
  assert(value.calibrationResultSha256===record.commonStart.calibrationResultSha256&&value.qualificationRuleSha256===record.qualificationRuleSha256,'parameter review uses different calibration or teacher qualification rule');
  const p=value.parameters;
  assert(fields(p,['pairsPerProfile','normalStartPairsPerProfile','minimumUsefulEffect','confidenceLevel','maximumMissingFraction','gameSeconds'])&&positive(p.pairsPerProfile)&&p.pairsPerProfile<=10000&&positive(p.normalStartPairsPerProfile)&&p.normalStartPairsPerProfile<=p.pairsPerProfile&&positive(p.gameSeconds)&&p.gameSeconds<=3600,'bounded preregistered evaluation sample required');
  assert(Number.isFinite(p.minimumUsefulEffect)&&p.minimumUsefulEffect>0&&p.minimumUsefulEffect<=1&&Number.isFinite(p.confidenceLevel)&&p.confidenceLevel>0&&p.confidenceLevel<1&&Number.isFinite(p.maximumMissingFraction)&&p.maximumMissingFraction>=0&&p.maximumMissingFraction<=1,'calibrated numeric effect, uncertainty and missing thresholds required');
  assert(value.missingPolicy==='retain-all-scheduled-bounds'&&value.criticalRegressionPolicy==='reject'&&value.candidateLockPolicy==='one-candidate-before-final'&&value.stopPolicy==='diagnostic-stop-at-budget-or-unqualified-method','frozen missing, lock, regression and stop rules required');
}

async function loadInputs(manifest,read){
  const cache=new Map();
  return async hashValue=>{
    assert(hash(hashValue),'frozen scientific object hash required');
    if(!cache.has(hashValue)){
      const a=manifest.inputs.find(a=>a.sha256===hashValue);assert(a,'scientific prerequisite is not a frozen input');
      const bytes=new Uint8Array(await read(a));assert(bytes.length===a.bytes&&await sha256(bytes)===hashValue,'scientific prerequisite checksum mismatch');
      cache.set(hashValue,JSON.parse(new TextDecoder().decode(bytes)));
    }
    return cache.get(hashValue);
  };
}

async function matchManifest(manifest,start,campaign){
  identity(start);assert(manifest.id===campaign.id&&manifest.scientific.stage===campaign.stage&&manifest.scientific.arm===campaign.arm,'campaign is not in the frozen stage/arm inventory');
  for(const [m,s]of [['sourceRevision','sourceRevision'],['dependencySha256','dependencySha256'],['seed','seed'],['recipeSha256','recipeSha256'],['corpusSha256','corpusSha256'],['runtimeSha256','runtimeSha256']])assert(manifest[m]===start[s],'scientific starting source, data, recipe, seed or runtime differs');
  assert(manifest.scientific.methodSha256===start.methodSha256&&manifest.scientific.familyInventorySha256===start.familyInventorySha256,'scientific method or held-out family inventory differs');
  assert(manifest.maxCents===campaign.computeCents&&manifest.cash.cloudflareUsageCapCents===campaign.cloudflareCents,'scientific campaign allocation differs from frozen caps');
  assert(manifest.phases.length===1&&manifest.phases[0].seconds===campaign.seconds,'one exact bounded scientific phase required');
  assert(await hostConfigurationSha256(manifest.phases[0].host)===start.hostConfigurationSha256,'scientific qualified host configuration differs');
  const phase=manifest.phases[0];
  for(const args of [phase.argv,phase.resumeArgv]){
    assert(args.filter(x=>x==='--plan').length===1,'one frozen scientific plan argument required');
    const input=manifest.inputs.find(a=>a.path===args[args.indexOf('--plan')+1]);assert(input&&phase.planSha256===input.sha256&&(campaign.stage==='evaluation'||input.sha256===campaign.phasePlanSha256),'actual scientific phase plan differs from freeze');
  }
  return phase;
}

export const scientificRecordSha256=value=>sha256(encode(canonical(value)));

async function resultProof(result,load,kind){
  assert(result?.schema===1&&result.kind==='compute-result'&&result.disposition==='complete'&&result.allWorkComplete===true,'complete actual scientific result required');
  const ref=result.artifacts?.find(a=>a.role==='proof');assert(ref,'typed scientific proof missing');
  const proof=await load(ref.sha256);assert(proof.schema===1&&proof.kind===kind&&canonical(proof.execution)===canonical(result.execution),'typed source proof identity differs');return proof;
}

function executedStart(execution,start){
  for(const [key,value]of Object.entries({sourceRevision:start.sourceRevision,dependencySha256:start.dependencySha256,seed:start.seed,recipeSha256:start.recipeSha256,dataSha256:start.corpusSha256,inputCheckpointSha256:start.checkpointSha256}))assert(execution?.[key]===value,'executed source does not share frozen starting state');
  assert(execution.scientific?.methodSha256===start.methodSha256&&execution.scientific.familyInventorySha256===start.familyInventorySha256,'executed method or family inventory differs');
}

async function commonEvidence(record,load){
  const start=identity(record.commonStart),rule=calibration(await load(start.calibrationRuleSha256));
  assert(record.originalDeadline===rule.originalDeadline,'calibration deadline cannot reset for arms or final evaluation');
  for(const key of identityFields.filter(k=>k!=='methodSha256'))assert(start[key]===rule.identity[key],'comparison changed common calibration source or settings');
  assert(record.publicOpponentSha256===ORIGINAL_INCUMBENT.publicOnnxSha256&&hash(start.checkpointSha256),'original public 1086 opponent and common checkpoint required');
  const originalMethod=await load(rule.identity.methodSha256),method=await load(start.methodSha256);
  const invariant=value=>{const {transferReceipt,replayProof,...fixed}=value;return fixed;};
  assert(method.schema===1&&method.kind==='attention-incumbent-method-v1'&&canonical(invariant(method))===canonical(invariant(originalMethod)),'unsupported or changed incumbent architecture, loss, guards or teacher settings');
  const source=await load(start.calibrationResultSha256),proof=await resultProof(source,load,'training-proof');
  assert(source.execution?.campaign===rule.campaign.id&&source.execution.scientific?.experimentSha256===start.calibrationRuleSha256&&source.execution.scientific.stage==='calibration'&&source.execution.scientific.arm==='shared'&&source.execution.inputCheckpointSha256===ORIGINAL_INCUMBENT.checkpointSha256&&source.execution.planSha256===rule.campaign.phasePlanSha256,'common start lacks actual frozen shared calibration execution');
  for(const [key,value]of Object.entries({sourceRevision:start.sourceRevision,dependencySha256:start.dependencySha256,seed:start.seed,recipeSha256:start.recipeSha256,dataSha256:start.corpusSha256}))assert(source.execution[key]===value,'calibration execution identity differs');
  executedStart(source.execution,{...rule.identity,checkpointSha256:ORIGINAL_INCUMBENT.checkpointSha256});
  assert(source.artifacts.some(a=>a.role==='checkpoint'&&a.sha256===start.checkpointSha256)&&proof.checkpointSha256===start.checkpointSha256&&proof.recoveryPassed===true,'common checkpoint not in calibration proof');
  const endpoint=proof.calibrationEndpoint;
  assert(endpoint?.rule===rule.endpointRule&&endpoint.deadlineWall===rule.originalDeadline/1000&&endpoint.planSha256===rule.campaign.phasePlanSha256&&endpoint.checkpointSha256===start.checkpointSha256&&source.artifacts.some(a=>a.sha256===endpoint.runnerResultSha256),'common checkpoint was not the preregistered calibration endpoint');
  const runner=await load(endpoint.runnerResultSha256);assert(runner.status==='stopped'&&['budget-or-resource-stop','insufficient-generation-runway'].includes(runner.reason),'handoff or failed calibration cannot select a research start');
  return {start,rule,method};
}

function normalizedCampaigns(campaigns){return campaigns.map(c=>c.stage==='training'?{...c,phasePlanSha256:null}:c);}

async function preparationEvidence(record,load){
  assert(record.schema===1&&record.kind==='policy-target-preparation'&&record.methodKind===COMPARISON_METHOD&&record.autoPromotion===false,'reviewed policy preparation preregistration required');
  const common=await commonEvidence(record,load),totals=projectExperimentBudget(record,common.rule);
  const teacher=record.campaigns.find(c=>c.stage==='teacher-screen'),plan=await load(teacher.phasePlanSha256);
  assert(plan.kind==='policy-only-teacher-refresh'&&plan.mode==='refresh'&&plan.pool?.sourceCheckpoint?.sha256===common.start.checkpointSha256&&plan.pool.sourceResult?.sha256===common.start.calibrationResultSha256&&plan.pool.guards?.sha256===common.method.guardsSha256,'teacher pool must use exact guarded shared calibration');
  const qualification=await load(record.qualificationRuleSha256);
  assert(qualification.schema===1&&qualification.kind==='reviewed-policy-teacher-qualification-rule'&&qualification.reviewed===true&&qualification.methodKind===COMPARISON_METHOD&&qualification.teacherPlanSha256===teacher.phasePlanSha256&&qualification.policyOnly===true&&qualification.observedValuesUnchanged===true&&positive(qualification.minimumCompletedRows)&&qualification.minimumCompletedRows<=plan.pool.selections?.length,'reviewed teacher eligibility rule required before outcomes');
  const rules=await load(record.rulesSha256);reviewedRules(rules,record);
  const selection=await load(record.selectionRuleSha256);
  assert(selection.schema===1&&selection.kind==='reviewed-candidate-selection-rule'&&selection.reviewed===true&&selection.rulesSha256===record.rulesSha256&&selection.policy==='preregistered-primary-metric-and-critical-regression-floor','reviewed candidate selection rule required');
  assert(hash(record.publicProfilesSha256)&&hash(record.evaluationFamilyInventorySha256),'evaluation profile and sealed family inventories must be frozen before outcomes');
  const profiles=await load(record.publicProfilesSha256);assert(profiles.schema===1&&profiles.profiles&&['babs','tau','horus'].every(p=>profiles.profiles[p]),'public evaluation profile catalog required');
  for(const c of record.campaigns.filter(c=>c.stage==='evaluation')){
    const schedule=await load(c.scheduleSha256);assert(Array.isArray(schedule)&&schedule.length>0&&schedule.length<=10000,'bounded frozen evaluation schedule required');
    const groups=new Map();
    for(const job of schedule){assert(job.gameSeconds===rules.parameters.gameSeconds&&['babs','tau','horus'].includes(job.profile)&&['candidate','baseline-diagnostic'].includes(job.role)&&['validation','final'].includes(job.partition),'schedule differs from calibrated sample or public profiles');
      if(job.role==='candidate'){const key=`${job.profile}/${job.pairId}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);}
    }
    for(const jobs of groups.values())assert(jobs.length===2&&new Set(jobs.map(j=>j.candidateSeat)).size===2&&jobs.every(j=>['P1','P2'].includes(j.candidateSeat))&&new Set(jobs.map(j=>`${j.familyId}/${j.seed}/${j.kind}`)).size===1,'frozen evaluation must retain paired seats and starts');
    for(const profile of ['babs','tau','horus']){const pairs=[...groups.values()].filter(g=>g[0].profile===profile);assert(pairs.length===rules.parameters.pairsPerProfile&&pairs.filter(g=>g[0].kind==='normal').length>=rules.parameters.normalStartPairsPerProfile,'schedule does not execute preregistered profile sample');}
  }
  return {...common,totals,teacher,teacherPlan:plan,qualification};
}

async function teacherEvidence(record,prep,load){
  const t=record.teacher,result=await load(t?.resultSha256),proof=await resultProof(result,load,'teacher-proof');
  executedStart(result.execution,prep.start);
  assert(result.execution.campaign===prep.teacher.id&&result.execution.scientific?.experimentSha256===record.preparationSha256&&result.execution.scientific.stage==='teacher-screen'&&result.execution.scientific.arm==='treatment'&&result.execution.planSha256===prep.teacher.phasePlanSha256&&result.execution.inputCheckpointSha256===prep.start.checkpointSha256,'teacher result differs from preregistered preparation');
  assert(result.interventionReady===true&&result.policyTargetsChanged===true&&proof.mode==='refresh'&&proof.policyOnly===true&&proof.observedValuesUnchanged===true&&proof.originalMasksUnchanged===true&&proof.actualSearchEvidence===true&&proof.policyRefreshSha256===t.policyRefreshSha256&&result.policyRefreshSha256===t.policyRefreshSha256&&result.artifacts.some(a=>a.sha256===t.policyRefreshSha256),'actual changed teacher output and unchanged label proof required');
  const overlay=await load(t.policyRefreshSha256);
  assert(Array.isArray(overlay)&&overlay.length>=prep.qualification.minimumCompletedRows&&overlay.length===prep.teacherPlan.pool.selections.length&&new Set(overlay.map(r=>r.id)).size===overlay.length,'all preregistered teacher targets must be complete');
  for(const r of overlay)assert(r.partition==='train'&&r.targetOrigin==='fresh-self-play'&&r.policyMask===true&&r.sourceQualification?.kind==='executed-shared-calibration-row'&&r.sourceQualification.checkpointSha256===prep.start.checkpointSha256&&r.sourceQualification.sourceResultSha256===prep.start.calibrationResultSha256,'teacher output is not actual fresh shared self-play');
  const cost=await load(t.costReceiptSha256);
  assert(cost.schema===1&&cost.kind==='campaign-usage-receipt'&&['controller-upper-bound','provider-reconciled'].includes(cost.classification)&&cost.campaign===prep.teacher.id&&cost.manifestSha256===result.execution.manifestSha256&&cost.cleanupVerified===true&&cents(cost.providerUsageCents)&&cost.providerUsageCents<=prep.teacher.computeCents&&cents(cost.cloudflareUsageCents)&&cost.cloudflareUsageCents<=prep.teacher.cloudflareCents,'actual teacher cost and cleanup receipt required');
  const qualification=await load(t.qualificationSha256);
  assert(qualification.schema===1&&qualification.kind==='reviewed-policy-teacher-qualification'&&qualification.qualified===true&&qualification.preparationSha256===record.preparationSha256&&qualification.ruleSha256===record.qualificationRuleSha256&&qualification.teacherResultSha256===t.resultSha256&&qualification.policyRefreshSha256===t.policyRefreshSha256,'teacher qualification does not apply to actual preregistered output');
}

async function trainingPlan(manifest,plan,start,method,load,{overlay,arm}={}){
  assert(plan.kind==='attention-ordinary-training-stage'&&plan.checkpoint?.sha256===start.checkpointSha256&&plan.seed===start.seed&&plan.deadlineWall===manifest.deadline/1000&&plan.nativeManifest?.evaluationGuards?.sha256===method.guardsSha256&&plan.nativeManifest.seed===start.seed&&plan.nativeManifest.sourceRevision===start.sourceRevision&&plan.nativeManifest.warmStart?.sha256===start.checkpointSha256&&canonical(plan.nativeManifest.modelArchitecture)===canonical(method.architecture),'training arm start, architecture, guards, seed or original deadline differs');
  const recipe=await load(manifest.executionRecipeSha256);
  assert(recipe.kind==='execution-recipe'&&recipe.incumbent?.checkpointSha256===start.checkpointSha256&&recipe.dataSha256===start.corpusSha256&&canonical(recipe.settings?.attentionMethod)===canonical(method),'actual execution recipe differs from common start');
  if(arm==='control')assert(recipe.settings.policyRefresh===undefined,'unchanged control cannot refresh policies');
  if(arm==='treatment')assert(recipe.settings.policyRefresh?.sha256===overlay,'treatment does not consume exact completed teacher overlay');
}

export async function validateScientificAdmission(manifest,{read}){
  assert(manifest?.purpose==='scientific-comparison'&&manifest.scientific?.schema===1&&typeof read==='function','explicit scientific admission inputs required');
  const load=await loadInputs(manifest,read),record=await load(manifest.scientific.experimentSha256);
  assert(record.schema===1&&record.methodKind===COMPARISON_METHOD,'unsupported scientific comparison method');
  assert(record.autoPromotion===false&&Number.isSafeInteger(record.originalDeadline)&&manifest.deadline===record.originalDeadline,'original scientific deadline or owner promotion boundary differs');
  if(record.kind==='common-calibration'){
    calibration(record);await matchManifest(manifest,record.identity,record.campaign);
    assert(manifest.checkpointSha256===ORIGINAL_INCUMBENT.checkpointSha256,'calibration does not start at original 1086');
    const method=await load(record.identity.methodSha256);assert(method.schema===1&&method.kind==='attention-incumbent-method-v1','unsupported incumbent method');
    await trainingPlan(manifest,await load(record.campaign.phasePlanSha256),{...record.identity,checkpointSha256:manifest.checkpointSha256},method,load);
    return {qualified:true,kind:record.kind,experimentSha256:manifest.scientific.experimentSha256,stage:'calibration',arm:'shared',commonCheckpointSha256:manifest.checkpointSha256};
  }
  const preparing=record.kind==='policy-target-preparation';
  assert(preparing||record.kind==='policy-target-exploratory-comparison','unsupported scientific freeze kind');
  const preregistered=preparing?record:await load(record.preparationSha256),prep=await preparationEvidence(preregistered,load);
  if(!preparing){
    assert(record.originalDeadline===preregistered.originalDeadline,'original scientific deadline cannot reset after teacher preparation');
    assert(canonical(record.commonStart)===canonical(preregistered.commonStart)&&canonical(normalizedCampaigns(record.campaigns))===canonical(preregistered.campaigns),'post-teacher freeze changed common state, campaigns, budgets or schedules');
    for(const key of ['rulesSha256','qualificationRuleSha256','selectionRuleSha256','publicProfilesSha256','evaluationFamilyInventorySha256','publicOpponentSha256'])assert(record[key]===preregistered[key],'post-teacher freeze changed preregistered rules or evaluation');
    assert(canonical(record.reserves)===canonical(preregistered.reserves)&&canonical(record.continuation)===canonical(preregistered.continuation),'post-teacher freeze changed reserves or continuation');
    projectExperimentBudget(record,prep.rule);await teacherEvidence(record,prep,load);
  }
  const campaign=record.campaigns.find(c=>c.id===manifest.id);assert(campaign,'unregistered campaign');const phase=await matchManifest(manifest,prep.start,campaign);
  assert(manifest.checkpointSha256===prep.start.checkpointSha256,'arms must use exactly the common calibrated checkpoint');
  const plan=await load(phase.planSha256);
  if(preparing){assert(campaign.stage==='teacher-screen'&&campaign.arm==='treatment','arm training cannot start before actual teacher freeze');assert(canonical(phase.workIds)===canonical(plan.pool.selections.map(s=>s.workId)),'teacher work IDs differ from preregistered source pool');}
  else if(campaign.stage==='training')await trainingPlan(manifest,plan,prep.start,prep.method,load,{overlay:record.teacher.policyRefreshSha256,arm:campaign.arm});
  else if(campaign.stage==='evaluation'){
    const lock=await load(manifest.scientific.candidateLockSha256);
    assert(lock.schema===1&&lock.kind==='locked-comparison-candidate'&&lock.comparisonSha256===manifest.scientific.experimentSha256&&lock.selectionRuleSha256===record.selectionRuleSha256&&lock.selectionReviewed===true&&lock.allScheduledArmsAccounted===true&&lock.candidateSha256===manifest.scientific.candidateSha256,'candidate selection is not locked to this comparison');
    const selected=await load(lock.sourceTrainingResultSha256),proof=await resultProof(selected,load,'training-proof');
    executedStart(selected.execution,prep.start);
    const selectedCampaign=record.campaigns.find(c=>c.stage==='training'&&c.id===selected.execution.campaign);
    assert(selectedCampaign&&selected.execution.scientific?.stage==='training'&&selected.execution.scientific.arm===selectedCampaign.arm&&selected.execution.planSha256===selectedCampaign.phasePlanSha256&&selected.execution.scientific.experimentSha256===manifest.scientific.experimentSha256&&(campaign.arm==='shared'||selected.execution.scientific.arm===campaign.arm)&&selected.artifacts.some(a=>a.role==='model'&&a.sha256===lock.candidateSha256)&&proof.modelSha256===lock.candidateSha256,'locked candidate is not an actual registered training output');
    assert(plan.kind==='prospective-public-profile-evaluation'&&plan.models?.candidate?.sha256===lock.candidateSha256&&plan.models.opponent?.sha256===ORIGINAL_INCUMBENT.publicOnnxSha256&&plan.candidateSha256===lock.candidateSha256&&canonical(plan.schedule)===canonical(await load(campaign.scheduleSha256))&&canonical(plan.profiles)===canonical(await load(record.publicProfilesSha256))&&plan.familyInventory?.sha256===record.evaluationFamilyInventorySha256,'evaluation changed candidate, public opponent, frozen schedule, profiles or families');
  }else throw Error('teacher generation cannot rerun under a comparison freeze');
  return {qualified:true,kind:record.kind,experimentSha256:manifest.scientific.experimentSha256,stage:campaign.stage,arm:campaign.arm,commonCheckpointSha256:prep.start.checkpointSha256,totals:prep.totals};
}
