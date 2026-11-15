// Portable admission contracts. These records attest executed assessments, not training targets.
import {assert,canonical,encode,sha256} from './policy.mjs';
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const developmentScope = c => ({sourcePurpose:c.sourcePurpose,sourceFamily:c.sourceFamily,actorProvenance:c.actorProvenance,label:c.label,learnerEligibility:c.learnerEligibility});
export const developmentDigest = x => sha256(encode(canonical(x)));
export async function readSuiteObject(binding,read){
 assert(binding&&hash(binding.sha256),'suite object identity required');
 const value=await read(binding);assert(value!==undefined&&value!==null,'suite object missing');
 const bytes=typeof value==='string'?encode(value):value;
 assert(await sha256(bytes)===binding.sha256,'suite object checksum mismatch');
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('invalid suite JSON');}
}
export async function validateDevelopmentSuite(index,{read,expectedCoverageSha256}={}){
 assert(index?.schema===1&&index.kind==='development-suite-index'&&hash(index.coverageSha256),'versioned suite inventory required');
 if(expectedCoverageSha256!==undefined)assert(index.coverageSha256===expectedCoverageSha256,'canonical amendment inventory differs');
 const coverage=await readSuiteObject({sha256:index.coverageSha256},read);
 assert(coverage.schema===1&&coverage.kind==='development-suite-coverage'&&typeof coverage.version==='string'&&coverage.version.length>0&&Array.isArray(coverage.packets)&&coverage.packets.length>0,'versioned amendment coverage required');
 assert(new Set(coverage.packets.map(p=>p.id)).size===coverage.packets.length,'duplicate coverage packet');
 assert(Array.isArray(index.packets)&&canonical(index.packets.map(p=>({id:p.id,sourcePacketSha256:p.sourcePacketSha256})))===canonical(coverage.packets),'canonical/amendment packet coverage differs');
 assert(Array.isArray(index.cases)&&index.cases.length>0&&index.cases.length<=1000&&new Set(index.cases.map(c=>c.key)).size===index.cases.length,'unique bounded suite cases required');
 const supplements=coverage.supplements??[];
 assert(Array.isArray(supplements)&&canonical(index.supplements??[])===canonical(supplements)&&new Set(supplements.map(s=>s.id)).size===supplements.length,'required guard supplements differ');
 for(const supplement of supplements){assert(typeof supplement.id==='string'&&supplement.kind==='guard-graph'&&hash(supplement.sha256),'reference-only guard supplement identity required');await readSuiteObject(supplement,read);}
 const cases=new Map();
 for(const p of index.packets){
  assert(typeof p.id==='string'&&hash(p.sourcePacketSha256),'packet inventory identity required');
  const prepared=await readSuiteObject({sha256:p.preparedSha256},read),receipt=await readSuiteObject({sha256:p.preparationSha256},read);
  assert(prepared.schema===1&&prepared.kind==='prepared-development'&&prepared.sourcePacketSha256===p.sourcePacketSha256&&receipt.kind==='development-evidence'&&receipt.packetSha256===p.preparedSha256&&receipt.sourcePacketSha256===p.sourcePacketSha256,'prepared packet/receipt ancestry differs');
  const rows=index.cases.filter(c=>c.packetId===p.id);
  if(coverage.caseIds!==undefined)assert(Array.isArray(coverage.caseIds[p.id])&&canonical([...coverage.caseIds[p.id]].sort())===canonical(prepared.cases.map(c=>c.id).sort()),'canonical case roster differs');
  assert(rows.length===prepared.cases.length&&new Set(rows.map(c=>c.caseId)).size===rows.length,'case inventory omitted or duplicated');
  for(const c of rows){
   const actual=prepared.cases.find(x=>x.id===c.caseId),proof=receipt.cases.find(x=>x.id===c.caseId);
   assert(actual&&proof&&c.rootSha256===actual.stateHash&&proof.stateHash===actual.stateHash&&c.family===actual.sourceFamily&&c.scopeSha256===await developmentDigest(developmentScope(actual)),'suite case root/family/scope differs');
   assert(Object.values(actual.learnerEligibility??{}).length===3&&Object.values(actual.learnerEligibility).every(x=>x===false),'historical learner targets forbidden');
   assert(['admitted','reference-only','unresolved'].includes(c.disposition)&&typeof c.reason==='string'&&c.reason.length>0&&typeof c.critical==='boolean'&&['rules-proven','search-supported','reference-only'].includes(c.category),'explicit scoped case disposition required');
   if(c.critical)assert(Number.isFinite(c.minimumCriticalMass)&&c.minimumCriticalMass>=0&&c.minimumCriticalMass<=1,'frozen critical probability floor required');
   assert(Array.isArray(c.acceptableRequests)&&new Set(c.acceptableRequests).size===c.acceptableRequests.length,'explicit acceptable witness set required');
   if(c.disposition==='admitted'){
    assert(c.acceptableRequests.length>0&&c.category!=='reference-only','admission needs executable witness');
    for(const name of c.acceptableRequests){const req=actual.requests.find(x=>x.name===name),w=proof.witnesses.find(x=>x.name===name);assert(req&&w?.disposition==='complete'&&w.completedActions===req.actions.length&&(req.expectedOutcome===null||w.expectedOutcomeMatched===true)&&(!req.expectedEndpointHash||w.finalHash===req.expectedEndpointHash)&&(req.expectedOutcome!==null||req.expectedEndpointHash||req.predicates?.length),'admitted witness lacks verified goal');}
   }else assert(c.acceptableRequests.length===0,'reference/unknown case cannot define acceptable policy targets');
   cases.set(c.key,{index:c,prepared:actual,receipt:proof});
  }
 }
 assert(cases.size===index.cases.length,'case refers to unknown packet');
 assert(Array.isArray(index.profiles)&&index.profiles.length>0&&index.profiles.every(hash)&&new Set(index.profiles).size===index.profiles.length,'frozen profile identities required');
 if(index.beforeProfiles!==undefined)assert(Object.keys(index.beforeProfiles).length===index.profiles.length&&index.profiles.every(p=>hash(index.beforeProfiles[p])),'frozen before-profile mapping required');
 assert(index.criteria?.schema===1&&Array.isArray(index.criteria.families)&&index.criteria.families.length>0,'frozen useful correction criteria required');
 const seen=new Set();for(const f of index.criteria.families){assert(typeof f.family==='string'&&!seen.has(f.family)&&index.cases.some(c=>c.family===f.family&&c.disposition==='admitted'),'selected correction family unavailable');seen.add(f.family);assert(Number.isSafeInteger(f.minimumCases)&&f.minimumCases>0&&Number.isFinite(f.minimumMassGain)&&f.minimumMassGain>=0&&f.minimumMassGain<=1&&Number.isFinite(f.minimumAfterMass)&&f.minimumAfterMass>=0&&f.minimumAfterMass<=1,'bounded preregistered correction criteria required');}
 if(coverage.caseIds!==undefined)assert(Object.keys(coverage.caseIds).length===index.packets.length,'unknown canonical case roster');
 return {cases,coverage};
}
function assessment(a,identity,c){
 assert(a?.schema===1&&a.kind==='executed-development-assessment'&&a.caseKey===c.key&&a.rootSha256===c.rootSha256&&a.scopeSha256===c.scopeSha256&&a.family===c.family,'assessment case identity differs');
 for(const k of ['sourceRevision','dependencySha256','modelSha256','profileSha256'])assert(a[k]===identity[k],`assessment ${k} differs`);
 assert(a.observedValuesUnchanged===true&&a.historicalTrainingPositions===0&&a.acceptableActionSetComplete===false,'assessment cannot admit historical training or global optimality');
 assert(['complete','missing','incomplete','reference-only'].includes(a.disposition),'explicit assessment disposition required');
 if(a.disposition!=='complete'){assert(typeof a.reason==='string'&&a.reason.length>0,'missing assessment reason required');return null;}
 assert(c.disposition==='admitted'&&a.actualWitness?.kind==='tactical-witness'&&a.actualWitness.rootHash===c.rootSha256&&a.actualWitness.disposition==='complete'&&a.actualWitness.completedActions===a.actualWitness.requestedActions&&a.completeTurn===true&&(a.actualWitness.completedTurns>0||a.actualWitness.outcome!=='ongoing'),'actual complete-turn replay required');
 assert(hash(a.searchResultSha256)&&hash(a.distributionSha256)&&Array.isArray(a.distribution)&&a.distribution.length>0,'actual search/distribution evidence required');
 let sum=0,mass=0;const seen=new Set();for(const p of a.distribution){const key=canonical(p.action);assert(!seen.has(key)&&Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1,'normalized unique legal distribution required');seen.add(key);sum+=p.probability;if(a.acceptableActions.some(x=>canonical(x)===key))mass+=p.probability;}
 assert(Math.abs(sum-1)<1e-6&&Math.abs(mass-a.acceptableActionMass)<1e-8,'acceptable probability mass differs');
 assert(a.actualWitness.steps.length>0&&canonical(a.actualWitness.steps[0].action)===canonical(a.selectedAction)&&seen.has(canonical(a.selectedAction)),'actual selected action differs');
 assert(typeof a.goalSatisfied==='boolean'&&a.actualWitness.steps.every(s=>s.controller===a.actualWitness.steps[0].controller),'continuation must use actual root controller only');
 return a;
}
export async function validateDevelopmentSuiteReport(index,report,{read,expectedPurpose,expectedModelSha256,expectedCoverageSha256,expectedSourceRevision,expectedDependencySha256}={}){
 const validated=await validateDevelopmentSuite(index,{read,expectedCoverageSha256}),indexSha=await developmentDigest(index);
 assert(report?.schema===1&&report.kind==='development-suite-report'&&report.indexSha256===indexSha&&['teacher-qualification','candidate-regression'].includes(report.purpose)&&(!expectedPurpose||report.purpose===expectedPurpose),'actual aggregate suite report required');
 assert(Array.isArray(report.rows)&&report.rows.length===index.cases.length*index.profiles.length,'all case/profile dispositions required');
 for(const phase of ['before','after']){const id=report[phase];assert(id&&/^[a-f0-9]{40}$/.test(id.sourceRevision)&&hash(id.dependencySha256)&&hash(id.modelSha256),'actual assessment source/model identity required');}
 if(expectedSourceRevision)assert(report.after.sourceRevision===expectedSourceRevision,'suite source differs');
 if(expectedDependencySha256)assert(report.after.dependencySha256===expectedDependencySha256,'suite dependencies differ');
 if(expectedModelSha256)assert(report.after.modelSha256===expectedModelSha256,'suite model differs from candidate/teacher');
 const seen=new Set(),familyStats=new Map(index.criteria.families.map(f=>[f.family,{family:f.family,improvedCases:new Set(),missing:0}]));let criticalPassed=true;
 for(const row of report.rows){
  const c=validated.cases.get(row.caseKey)?.index,key=`${row.caseKey}:${row.profileSha256}`;
  assert(c&&index.profiles.includes(row.profileSha256)&&!seen.has(key),'unknown/duplicate case/profile result');seen.add(key);
  const b=await readSuiteObject({sha256:row.beforeSha256},read),a=await readSuiteObject({sha256:row.afterSha256},read);
  const before=assessment(b,{...report.before,profileSha256:index.beforeProfiles?.[row.profileSha256]??row.profileSha256},c),after=assessment(a,{...report.after,profileSha256:row.profileSha256},c);
  for(const record of [b,a])if(record.disposition==='complete'){
   assert(await developmentDigest(record.distribution)===record.distributionSha256,'distribution receipt hash differs');
   assert(Array.isArray(record.stepSearches)&&record.stepSearches.length===record.actualWitness.steps.length&&await developmentDigest(record.stepSearches)===record.stepSearchesSha256,'complete model-choice trace required');
   for(let i=0;i<record.stepSearches.length;i++){
    const search=record.stepSearches[i],step=record.actualWitness.steps[i];
    assert(search.disposition==='complete'&&search.rootSha256===step.beforeHash&&search.controller===step.controller&&canonical(search.action)===canonical(step.action),'step search/controller/action differs');
    for(const field of ['sourceRevision','dependencySha256','modelSha256','profileSha256'])assert(search[field]===record[field],'step search identity differs');
    assert(Array.isArray(search.distribution)&&search.distribution.length===step.legalAlternatives&&new Set(search.distribution.map(p=>canonical(p.action))).size===search.distribution.length&&search.distribution.every(p=>Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1)&&Math.abs(search.distribution.reduce((n,p)=>n+p.probability,0)-1)<1e-6&&search.distribution.some(p=>canonical(p.action)===canonical(step.action)),'step legal distribution differs');
    if(i)assert(step.beforeHash===record.actualWitness.steps[i-1].afterHash,'broken actual state chain');
   }
   assert(await developmentDigest(record.stepSearches[0])===record.searchResultSha256,'root search trace differs');
   const actualCase=validated.cases.get(c.key).prepared;
   assert(Array.isArray(record.goalChecks)&&record.goalChecks.length===c.acceptableRequests.length&&new Set(record.goalChecks.map(g=>g.name)).size===record.goalChecks.length,'every frozen goal disposition required');
   let goalSatisfied=false;
   for(const g of record.goalChecks){
    const req=actualCase.requests.find(r=>r.name===g.name&&c.acceptableRequests.includes(r.name));assert(req,'unknown goal assessment');
    let satisfied=false;if(g.witness){const w=g.witness;assert(w.rootHash===c.rootSha256&&w.finalHash===record.actualWitness.finalHash&&canonical(w.steps)===canonical(record.actualWitness.steps),'goal witness differs from actual continuation');
     const expected=[...(req.beforePredicates??[]).map(p=>({...p,when:'before'})),...(req.predicates??[]).map(p=>({...p,when:'after'}))];
     assert(canonical(w.checkedPredicates.map(({actual,verified,...p})=>p))===canonical(expected)&&w.checkedPredicates.every(p=>p.verified===true&&p.actual===p.expected),'goal predicate receipts differ');
     satisfied=w.disposition==='complete'&&(req.expectedOutcome===null||w.outcome===req.expectedOutcome)&&(!req.expectedEndpointHash||w.finalHash===req.expectedEndpointHash);
    }else assert(g.satisfied===false&&typeof g.reason==='string','missing goal check disposition');
    assert(g.satisfied===satisfied,'goal outcome differs');goalSatisfied ||= satisfied;
   }assert(record.goalSatisfied===goalSatisfied,'aggregate goal differs');
   const raw=await readSuiteObject({sha256:record.searchResultSha256},read);assert(canonical(raw.action)===canonical(record.selectedAction)&&raw.rootSha256===c.rootSha256&&raw.modelSha256===record.modelSha256&&raw.profileSha256===record.profileSha256&&raw.sourceRevision===record.sourceRevision&&raw.dependencySha256===record.dependencySha256&&canonical(raw.distribution)===canonical(record.distribution),'search receipt identity differs');
   assert(canonical(record.acceptableActions)===canonical(validated.cases.get(c.key).prepared.requests.filter(r=>c.acceptableRequests.includes(r.name)).map(r=>r.actions[0]).filter((x,i,all)=>all.findIndex(a=>canonical(a)===canonical(x))===i)),'acceptable actions differ from frozen witnesses');
  }
  if(c.critical&&(!after||!after.goalSatisfied||after.acceptableActionMass<c.minimumCriticalMass))criticalPassed=false;
  const stats=familyStats.get(c.family),criterion=index.criteria.families.find(f=>f.family===c.family);
  if(stats){if(!before||!after)stats.missing++;else if(after.goalSatisfied&&after.acceptableActionMass>=criterion.minimumAfterMass&&(after.acceptableActionMass>before.acceptableActionMass+1e-8||!before.goalSatisfied)&&after.acceptableActionMass-before.acceptableActionMass>=criterion.minimumMassGain)stats.improvedCases.add(c.key);}
 }
 const families=[...familyStats.values()].map(s=>({...s,improvedCases:s.improvedCases.size}));
 const usefulCorrection=families.every(s=>s.improvedCases>=index.criteria.families.find(f=>f.family===s.family).minimumCases);
 assert(report.dose?.historicalAssessmentPositions===0&&Array.isArray(report.dose.trainingProofs),'assessment is never training dose');
 if(report.purpose==='teacher-qualification')assert(report.dose.trainingProofs.length===0,'teacher assessment cannot claim training dose');
 if(report.purpose==='candidate-regression'){assert(['control','treatment'].includes(report.arm),'candidate arm required');assert(index.cases.some(c=>c.critical),'critical regression inventory required');}
 if(report.purpose==='candidate-regression'&&report.arm==='treatment')assert(report.dose.trainingProofs.length>0,'treatment candidate requires actual recovered dose');
 const dose=[],doseProofs=new Set();for(const binding of report.dose.trainingProofs){assert(!doseProofs.has(binding.sha256),'duplicate dose proof');doseProofs.add(binding.sha256);const proof=await readSuiteObject(binding,read);assert(proof.kind==='training-proof'&&proof.recoveryPassed===true&&proof.policyRefreshDose?.schema===1,'recovered actual training dose required');const d=proof.policyRefreshDose;assert(proof.modelSha256===report.after.modelSha256&&proof.execution?.sourceRevision===report.after.sourceRevision&&proof.execution?.dependencySha256===report.after.dependencySha256,'dose proof candidate/source differs');assert(typeof d.phase==='string'&&d.phase===proof.execution.phase&&Array.isArray(d.byFamily)&&d.byFamily.length>0&&Number.isSafeInteger(d.totalPositions)&&d.totalPositions>0,'positive actual dose required');let total=0;const families=new Set();for(const f of d.byFamily){assert(typeof f.familyId==='string'&&f.familyId.length>0&&typeof f.sourceFamily==='string'&&f.sourceFamily.length>0&&!families.has(f.familyId)&&Number.isSafeInteger(f.sampledPositions)&&f.sampledPositions>0&&Number.isSafeInteger(f.uniquePositions)&&f.uniquePositions>0&&f.uniquePositions<=f.sampledPositions,'actual per-family dose invalid');families.add(f.familyId);total+=f.sampledPositions;}assert(total===d.totalPositions,'actual dose total differs');dose.push(d);}
 return {schema:1,kind:'validated-development-suite-report',indexSha256:indexSha,reportSha256:await developmentDigest(report),purpose:report.purpose,usefulCorrection,criticalPassed,families,dose,qualified:report.purpose==='teacher-qualification'?usefulCorrection:criticalPassed};
}
export async function developmentWorkIds(index){
 return Promise.all(index.cases.flatMap(c=>index.profiles.map(async profile=>`development-${(await developmentDigest([c.key,profile])).slice(0,32)}`)));
}
