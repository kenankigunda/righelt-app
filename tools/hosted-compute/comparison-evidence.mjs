// Portable admission over retained native proof, without engine or statistics subprocesses.
import {assert,canonical,sha256} from './policy.mjs';
import {developmentDigest,readSuiteObject} from './development-suite.mjs';
const equal=(a,b)=>canonical(a)===canonical(b);
const pairKey=j=>canonical([j.role,j.pairId,j.profile,j.startKind,j.candidateSeat]);
const identityKeys=['pairId','candidateSeat','profile','familyId','sourceFamily','role','seed','startKind','startIdentity'];
const publicOpponent='f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f';
export async function loadComparisonArm(comparison,arm,bindings,{read,comparisonSha256}){
 const load=sha256=>readSuiteObject({sha256},read),training=await load(bindings.trainingResultSha256),evaluation=await load(bindings.evaluationResultSha256);
 const registered=stage=>comparison.campaigns.find(c=>c.arm===arm&&c.stage===stage);
 for(const [result,stage]of [[training,'training'],[evaluation,'evaluation']]){
  const e=result.execution,c=registered(stage);
  assert(result.schema===1&&result.kind==='compute-result'&&result.disposition==='complete'&&c&&e?.campaign===c.id&&e.scientific?.arm===arm&&e.scientific.experimentSha256===comparisonSha256,'arm result not registered comparison output');
  for(const k of ['sourceRevision','dependencySha256'])assert(e[k]===comparison.commonStart[k],'arm result source differs');
  if(stage==='training')assert(e.planSha256===c.phasePlanSha256&&result.allWorkComplete===true,'training result changed registered plan');
 }
 const models=training.artifacts.filter(a=>a.role==='model');assert(models.length===1,'one actual training model required');const modelSha256=models[0].sha256;
 const trainingProofs=training.artifacts.filter(a=>a.role==='proof');assert(trainingProofs.length===1,'training proof required');const trainingProof=await load(trainingProofs[0].sha256);
 assert(trainingProof.kind==='training-proof'&&equal(trainingProof.execution,training.execution)&&trainingProof.modelSha256===modelSha256&&trainingProof.recoveryPassed===true&&trainingProof.numericParityPassed===true,'actual recovered exported training model required');
 const plan=await load(evaluation.execution.planSha256),schedule=await load(registered('evaluation').scheduleSha256);
 assert(plan.kind==='prospective-public-profile-evaluation'&&plan.models?.candidate?.sha256===modelSha256&&plan.candidateSha256===modelSha256&&plan.models?.opponent?.sha256===publicOpponent&&equal(plan.schedule,schedule),'validation changed arm model/opponent/schedule');
 const proofs=evaluation.artifacts.filter(a=>a.role==='proof');assert(proofs.length===1,'evaluation proof required');const proof=await load(proofs[0].sha256);
 assert(proof.kind==='evaluation-proof'&&equal(proof.execution,evaluation.execution)&&proof.candidateSha256===modelSha256,'evaluation proof identity differs');
 assert(Array.isArray(schedule)&&schedule.length>0&&new Set(schedule.map(j=>j.id)).size===schedule.length&&schedule.every(j=>j.partition==='validation'),'only unique preregistered validation work allowed');
 assert(equal(evaluation.accountedWorkIds,schedule.map(j=>j.id))&&equal(proof.workReceipts.map(r=>r.workId),schedule.map(j=>j.id)),'all validation IDs must be accounted');
 const rows=[];for(const [i,r]of proof.workReceipts.entries()){
  const j=schedule[i];assert(['complete','unfinished','failed','unstarted'].includes(r.status),'invalid work disposition');
  if(r.status==='unstarted'){rows.push({jobId:j.id,status:'unstarted'});continue;}
  assert(evaluation.artifacts.some(a=>a.role==='attempt'&&a.sha256===r.evidenceSha256),'work receipt lacks retained attempt');const row=await load(r.evidenceSha256);
  assert(row.jobId===j.id&&row.status===r.status&&row.receiptId===evaluation.execution.manifestSha256+':'+j.id&&identityKeys.every(k=>equal(row[k],j[k])),'verified row differs from schedule');
  if(row.status==='complete')assert(row.engineReplayVerified===true&&['p1_win','p2_win','draw'].includes(row.outcome)&&row.game?.outcome?.status===row.outcome&&/^[a-f0-9]{64}$/.test(row.gameSha256),'raw-complete is not verified scoring evidence');
  if(row.status==='complete'){
   for(const sha of [row.rawEvidenceSha256,row.verificationEvidenceSha256])assert(evaluation.artifacts.some(a=>a.role==='attempt'&&a.sha256===sha),'qualified row lacks exact raw/verification artifacts');
   const raw=await load(row.rawEvidenceSha256),verified=await load(row.verificationEvidenceSha256),rawBytes=await read({sha256:row.rawEvidenceSha256});
   assert(rawBytes[rawBytes.length-1]===10&&verified.rawSha256===await sha256(rawBytes.slice(0,-1)),'verification raw bytes binding differs');
   assert(raw.status==='raw-complete'&&raw.jobId===j.id&&raw.receiptId===row.receiptId&&equal(raw.game,row.game)&&raw.gameSha256===row.gameSha256&&verified.schema===1&&verified.kind==='prospective-replay-verification'&&verified.engineReplayVerified===true&&verified.outcome===row.outcome&&equal(verified.startIdentity,j.startIdentity)&&verified.verifier?.sourceRevision===evaluation.execution.sourceRevision,'qualified replay proof differs from raw/start/source');
  }

  rows.push(row);
 }
 assert(equal(evaluation.completedWorkIds,proof.workReceipts.filter(r=>r.status==='complete').map(r=>r.workId))&&evaluation.allWorkComplete===proof.workReceipts.every(r=>r.status==='complete'),'typed result completion differs');
 return {modelSha256,plan,schedule,rows};
}
export async function validateComparisonEvidence(report,{read,comparisonSha256,rulesSha256,selectionRuleSha256}={}){
 const load=sha256=>readSuiteObject({sha256},read),comparison=await load(comparisonSha256),rules=await load(rulesSha256),selection=await load(selectionRuleSha256);
 assert(comparison.kind==='policy-target-exploratory-comparison'&&comparison.rulesSha256===rulesSha256&&comparison.selectionRuleSha256===selectionRuleSha256,'comparison/rules/selection ancestry differs');
 assert(report?.schema===1&&report.kind==='executed-paired-arm-comparison'&&report.comparisonSha256===comparisonSha256&&report.rulesSha256===rulesSha256&&report.selectionRuleSha256===selectionRuleSha256,'actual paired report binding required');
 for(const k of ['sourceRevision','dependencySha256'])assert(report[k]===comparison.commonStart[k],'paired report source differs');
 const nomination=selection.nomination;assert(selection.rulesSha256===rulesSha256&&nomination&&['point','conservative-lower'].includes(nomination.bound)&&Number.isFinite(nomination.minimumDelta)&&nomination.minimumDelta>0&&nomination.minimumDelta===rules.parameters.minimumUsefulEffect,'frozen nomination threshold required');
 const arms={};for(const arm of ['control','treatment']){arms[arm]=await loadComparisonArm(comparison,arm,report.armResults?.[arm],{read,comparisonSha256});assert(equal(arms[arm].plan.primaryScope,rules.primaryScope)&&equal(arms[arm].plan.uncertainty,rules.uncertainty),'validation scope/settings changed');if(comparison.publicProfilesSha256)assert(equal(arms[arm].plan.profiles,await load(comparison.publicProfilesSha256)),'validation public profiles changed');}
 const left=new Map(arms.control.schedule.map(j=>[pairKey(j),j])),right=new Map(arms.treatment.schedule.map(j=>[pairKey(j),j]));assert(left.size===arms.control.schedule.length&&right.size===arms.treatment.schedule.length&&left.size===right.size,'matched paired schedules required');
 const receipts=new Set();for(const arm of Object.values(arms))for(const r of arm.rows)if(r.receiptId){assert(!receipts.has(r.receiptId),'receipt reused across arms');receipts.add(r.receiptId);}
 const scoped=j=>j.role==='candidate'&&rules.primaryScope.profiles.includes(j.profile)&&rules.primaryScope.starts.includes(j.startKind)&&rules.primaryScope.seats.includes(j.candidateSeat);
 const bounds=(j,rows)=>{const r=rows.find(x=>x.jobId===j.id);if(r.status!=='complete')return [0,1];const win=r.outcome===(j.candidateSeat==='P1'?'p1_win':'p2_win');const score=win?1:r.outcome==='draw'&&rules.primaryScope.metric==='score'?.5:0;return [score,score];};
 const deltas=[],families=new Set();let missing=0;
 for(const [key,j]of left){const other=right.get(key);assert(other&&['familyId','sourceFamily','seed','profile','startKind','candidateSeat','kind','initialState','startIdentity'].every(k=>equal(j[k],other[k])),'paired authoritative start identity differs');assert(j.startIdentity?.schema===1&&j.startIdentity.startKind===j.startKind&&j.startIdentity.kind===j.kind&&/^[a-f0-9]{64}$/.test(j.startIdentity.stateHash)&&/^[a-f0-9]{64}$/.test(j.startIdentity.constructionSha256),'authoritative frozen start identity required');if(!scoped(j))continue;const a=bounds(j,arms.control.rows),b=bounds(other,arms.treatment.rows);deltas.push([b[0]-a[1],b[1]-a[0]]);families.add(j.sourceFamily);missing+=Number(a[0]!==a[1])+Number(b[0]!==b[1]);}
 assert(deltas.length>0,'empty primary scope');const delta=[0,1].map(i=>deltas.reduce((n,d)=>n+d[i],0)/deltas.length),point=delta[0]===delta[1]?delta[0]:null,p=report.pairedReport;
 assert(equal(p?.primaryScope,rules.primaryScope)&&equal(p.primaryPairedDeltaBounds,delta)&&p.primaryPairedDelta===point&&p.strengthEstablished===false&&p.independentTrainingReplications===null&&p.uncertaintyClassification==='diagnostic-only-not-controller-recomputed','paired primary result differs from verified rows');
 const u=p.familyUncertainty;assert(u&&['confidence','seed','resamples'].every(k=>u[k]===rules.uncertainty[k])&&equal(u.sourceFamilies,[...families].sort())&&u.missingOutcomesImputed===false,'family uncertainty settings/source differ');
 const interval=u.interval;assert(interval===null||Array.isArray(interval)&&interval.length===2&&interval.every(x=>Number.isFinite(x)&&x>=-1&&x<=1)&&interval[0]<=interval[1],'invalid source-family uncertainty interval');
 let eligibleArm=null;const score=nomination.bound==='point'?point:delta[0],opposite=nomination.bound==='point'?(point===null?null:-point):-delta[1];
 if(missing/(2*deltas.length)<=rules.parameters.maximumMissingFraction){if(score!==null&&score>=nomination.minimumDelta)eligibleArm='treatment';else if(opposite!==null&&opposite>=nomination.minimumDelta)eligibleArm='control';}
 return {uncertaintyClassification:'diagnostic-only-not-controller-recomputed',eligibleArm,candidateSha256:eligibleArm?arms[eligibleArm].modelSha256:null,primaryDeltaBounds:delta,pointDelta:point,reportSha256:await developmentDigest(report)};
}
