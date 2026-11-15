import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../ai-trainer/tests/fixtures/tactical-learning-v1.json' with {type:'json'};
import {legalActionMap,transition} from '../../../packages/computer-player/src/index.ts';
import {deterministicStateHash} from '../../../packages/game-engine/src/index.ts';
import {sourceQualification} from '../data-contract.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {developmentDigest,developmentScope,validateDevelopmentSuite,validateDevelopmentSuiteReport} from '../development-suite.mjs';
import {assessDevelopmentCase,assessmentBridge} from '../development-suite-assessment.mjs';
import {verifyWitness} from '../../ai-trainer/tactical-evidence.mjs';
const bounds={maxActions:8,milliseconds:1000,maxOperations:2000};
import {developmentSuiteFixture as setup} from './development-suite-fixture.mjs';
test('actual common-engine before/after complete-turn behavior produces selected useful correction',async()=>{
 const f=await setup(),result=await validateDevelopmentSuiteReport(f.index,f.report,{read:f.read,expectedCoverageSha256:f.index.coverageSha256,expectedPurpose:'teacher-qualification',expectedModelSha256:f.identity.modelSha256});
 assert.equal(f.before.goalSatisfied,false);assert.equal(f.after.goalSatisfied,true);assert.equal(result.qualified,true);assert.equal(result.criticalPassed,true);assert.equal(result.families[0].improvedCases,1);assert.equal(result.dose.length,0);
 assert.equal(f.after.actualWitness.steps.length,2);assert(f.after.actualWitness.steps.every(s=>s.controller==='P2'));
});
test('coverage omissions, stale scope, wrong model and forged probability mass reject',async()=>{
 const f=await setup();for(const mutate of [x=>x.cases.pop(),x=>x.cases[0].scopeSha256='0'.repeat(64),x=>x.packets.pop()]){const bad=structuredClone(f.index);mutate(bad);await assert.rejects(validateDevelopmentSuite(bad,{read:f.read}));}
 await assert.rejects(validateDevelopmentSuiteReport(f.index,f.report,{read:f.read,expectedModelSha256:'0'.repeat(64)}),/model differs/);
 const forged={...f.after,acceptableActionMass:1},r={...f.report,rows:[{...f.report.rows[0],afterSha256:await f.put(forged)}]};await assert.rejects(validateDevelopmentSuiteReport(f.index,r,{read:f.read}),/mass differs/);
});
test('unknown/reference-only and missing cases stay visible, critical floor fails, unchanged mass is not correction',async()=>{
 const f=await setup(),missing={...f.after,disposition:'missing',reason:'budget exhausted'},r={...f.report,purpose:'candidate-regression',arm:'control',rows:[{...f.report.rows[0],afterSha256:await f.put(missing)}]};
 const result=await validateDevelopmentSuiteReport(f.index,r,{read:f.read});assert.equal(result.qualified,false);assert.equal(result.families[0].missing,1);
 const unchanged={...f.report,rows:[{...f.report.rows[0],beforeSha256:f.report.rows[0].afterSha256}]};assert.equal((await validateDevelopmentSuiteReport(f.index,unchanged,{read:f.read})).usefulCorrection,false);
 const ref=await assessDevelopmentCase({caseIndex:{...f.c,disposition:'reference-only',reason:'forced loss has no safe-action label'},prepared:f.prepared,identity:f.identity,bounds});assert.equal(ref.disposition,'reference-only');assert.equal(ref.historicalTrainingPositions,0);
});
test('forged goal/continuation, omitted profiles and unproven treatment dose fail closed',async()=>{
 const f=await setup(),forged={...f.before,goalSatisfied:true};let r={...f.report,rows:[{...f.report.rows[0],afterSha256:await f.put(forged)}]};await assert.rejects(validateDevelopmentSuiteReport(f.index,r,{read:f.read}),/goal differs/);
 await assert.rejects(validateDevelopmentSuiteReport(f.index,{...f.report,rows:[]},{read:f.read}),/dispositions/);
 await assert.rejects(validateDevelopmentSuiteReport(f.index,{...f.report,purpose:'candidate-regression',arm:'treatment'},{read:f.read}),/recovered dose/);
 await assert.rejects(assessDevelopmentCase({caseIndex:f.c,prepared:f.prepared,identity:f.identity,search:{rootSha256:f.prepared.stateHash,...f.identity,disposition:'complete',distribution:[{action:{type:'pass'},probability:1}]},actions:[{type:'pass'}],bounds}),/search record/);
});
test('treatment floor consumes positive recovered per-family dose bound to actual candidate',async()=>{
 const f=await setup(),proof={schema:1,kind:'training-proof',recoveryPassed:true,modelSha256:f.identity.modelSha256,execution:{phase:'treatment',sourceRevision:f.identity.sourceRevision,dependencySha256:f.identity.dependencySha256},policyRefreshDose:{schema:1,phase:'treatment',byFamily:[{familyId:'fresh-game-family',sourceFamily:'actual-calibration-family',sampledPositions:3,uniquePositions:2}],totalPositions:3}};
 const r={...f.report,purpose:'candidate-regression',arm:'treatment',dose:{historicalAssessmentPositions:0,trainingProofs:[{sha256:await f.put(proof)}]}};
 const result=await validateDevelopmentSuiteReport(f.index,r,{read:f.read});assert.equal(result.qualified,true);assert.equal(result.dose[0].totalPositions,3);
 for(const changed of [{...proof,modelSha256:'0'.repeat(64)},{...proof,policyRefreshDose:{...proof.policyRefreshDose,totalPositions:100}}])await assert.rejects(validateDevelopmentSuiteReport(f.index,{...r,dose:{...r.dose,trainingProofs:[{sha256:await f.put(changed)}]}},{read:f.read}),/differs/);
 await assert.rejects(validateDevelopmentSuiteReport(f.index,{...f.report,dose:r.dose},{read:f.read}),/teacher assessment/);
 const wrongPhase={...proof,policyRefreshDose:{...proof.policyRefreshDose,phase:'other'}};await assert.rejects(validateDevelopmentSuiteReport(f.index,{...r,dose:{...r.dose,trainingProofs:[{sha256:await f.put(wrongPhase)}]}},{read:f.read}),/positive actual dose/);
 await assert.rejects(validateDevelopmentSuiteReport(f.index,{...r,dose:{...r.dose,trainingProofs:[...r.dose.trainingProofs,...r.dose.trainingProofs]}},{read:f.read}),/duplicate dose/);
});
test('every frozen public profile requires its own assessment, teacher before-profile is separately bound',async()=>{
 const f=await setup(),other='9'.repeat(64),index={...f.index,profiles:[...f.index.profiles,other]},r={...f.report,indexSha256:await developmentDigest(index)};
 await assert.rejects(validateDevelopmentSuiteReport(index,r,{read:f.read}),/all case\/profile/);
 const mapped={...f.index,beforeProfiles:{[f.identity.profileSha256]:other}},mappedReport={...f.report,indexSha256:await developmentDigest(mapped)};
 await assert.rejects(validateDevelopmentSuiteReport(mapped,mappedReport,{read:f.read}),/profileSha256 differs/);
 const before={...f.before,profileSha256:other};
 const raw=JSON.parse(new TextDecoder().decode(f.objects.get(before.searchResultSha256)));raw.profileSha256=other;before.stepSearches=before.stepSearches.map(s=>({...s,profileSha256:other}));before.stepSearchesSha256=await developmentDigest(before.stepSearches);before.searchResultSha256=await f.put(raw);
 mappedReport.rows=[{...mappedReport.rows[0],beforeSha256:await f.put(before)}];
 assert.equal((await validateDevelopmentSuiteReport(mapped,mappedReport,{read:f.read})).qualified,true);
});
test('every model-controlled continuation choice needs matching state-bound executed search',async()=>{
 const f=await setup(),args={caseIndex:f.c,prepared:f.prepared,identity:f.identity,search:f.after.stepSearches[0],stepSearches:f.after.stepSearches,actions:f.original.winningLine,bounds};
 await assert.rejects(assessDevelopmentCase({...args,stepSearches:args.stepSearches.slice(0,1)}),/every actual model choice/);
 const wrongAction=structuredClone(args.stepSearches);wrongAction[1].action={type:'pass'};
 await assert.rejects(assessDevelopmentCase({...args,stepSearches:wrongAction}),/step selected action differs/);
 const fabricated=structuredClone(args.stepSearches);fabricated[1].rootSha256=f.prepared.stateHash;
 await assert.rejects(assessDevelopmentCase({...args,stepSearches:fabricated}),/step state\/controller/);
 const wrongModel=structuredClone(args.stepSearches);wrongModel[1].modelSha256='0'.repeat(64);
 await assert.rejects(assessDevelopmentCase({...args,stepSearches:wrongModel}),/step model\/profile/);
 const bounded=await assessDevelopmentCase({...args,bounds:{...bounds,maxOperations:1}});assert.equal(bounded.disposition,'incomplete');
 const metadataOnly={...f.after,stepSearches:f.after.stepSearches.slice(0,1)};metadataOnly.stepSearchesSha256=await developmentDigest(metadataOnly.stepSearches);
 await assert.rejects(validateDevelopmentSuiteReport(f.index,{...f.report,rows:[{...f.report.rows[0],afterSha256:await f.put(metadataOnly)}]},{read:f.read}),/complete model-choice trace/);
});
test('canonical case roster and hash-read guard supplements cannot be omitted or altered',async()=>{
 const f=await setup(),supplement={id:'guard',kind:'guard-graph',sha256:await f.put({schema:1,kind:'synthetic-reference-guard',edges:[]})},coverage={...f.coverage,caseIds:{canonical:[f.prepared.id]},supplements:[supplement]},index={...f.index,coverageSha256:await f.put(coverage),supplements:[supplement]};
 await validateDevelopmentSuite(index,{read:f.read});
 await assert.rejects(validateDevelopmentSuite({...index,supplements:[]},{read:f.read}),/supplements differ/);
 const wrongRoster={...coverage,caseIds:{canonical:['omitted-real-case']}};await assert.rejects(validateDevelopmentSuite({...index,coverageSha256:await f.put(wrongRoster)},{read:f.read}),/case roster/);
 f.objects.set(supplement.sha256,encode('{"tampered":true}'));await assert.rejects(validateDevelopmentSuite(index,{read:f.read}),/checksum/);
});

test('native step bridge binds chosen action, applied profile, legal policy and actual transition',async()=>{
 const f=await setup(),legal=legalActionMap(f.prepared.state),action=f.original.winningLine[0],actionIndex=[...legal].find(([,a])=>canonical(a)===canonical(action))[0],profile={simulations:1,temperature:0,maxValueGap:0};
 const answer={status:'ready',stopped:'complete',policyMask:true,fallback:null,seed:107,action,actionIndex,nextState:transition(f.prepared.state,action),searchIdentity:{stateHash:f.prepared.stateHash,controller:f.prepared.state.sideToMove,valuePerspective:'P1',requestedProfile:profile},legality:{complete:true,indices:[...legal.keys()]},policy:[{index:actionIndex,probability:1}]};
 const job={mode:'step',state:f.prepared.state,answer,identity:f.identity,profile,seed:107,bounds:{milliseconds:1000,maxOperations:100}};
 const proof=await assessmentBridge(job);assert.equal(proof.search.controller,'P2');assert.equal(proof.search.distribution.length,legal.size);assert.equal(proof.search.action.type,'rush');assert(Object.keys(proof.objectStrings).includes(proof.search.nativeAnswerSha256));
 await assert.rejects(assessmentBridge({...job,answer:{...answer,nextState:f.prepared.state}}),/next state differs/);
 await assert.rejects(assessmentBridge({...job,answer:{...answer,searchIdentity:{...answer.searchIdentity,requestedProfile:{...profile,simulations:2}}}}),/search identity differs/);
 await assert.rejects(assessmentBridge({...job,bounds:{...job.bounds,maxOperations:1}}),/budget exhausted/);
});
