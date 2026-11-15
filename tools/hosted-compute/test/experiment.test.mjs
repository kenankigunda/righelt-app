import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScientificAdmission,projectExperimentBudget,hostConfigurationSha256,ORIGINAL_INCUMBENT,COMPARISON_METHOD} from '../experiment.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {developmentSuiteFixture} from './development-suite-fixture.mjs';
import {expectedEvaluationStart} from '../../ai-trainer/evaluation-start.mjs';
import {developmentDigest,developmentWorkIds} from '../development-suite.mjs';
import {fixture as controllerFixture} from './helpers.mjs';

// Synthetic protocol records only. These numbers and model hashes are not a
// scientific freeze, teacher qualification, hosted run or spending authority.
async function fixture(options={}){
 const objects=new Map(),inputs=[];
 const add=async(name,value)=>{const bytes=encode(canonical(value)),hash=await sha256(bytes),a={name,path:`.ai-runs/experiment/${name}.json`,sha256:hash,bytes:bytes.length};objects.set(hash,bytes);inputs.push(a);return a;};
 const digest=name=>sha256(encode(name)),original={checkpointSha256:'fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44',publicOnnxSha256:'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f'};
 const deadline=Date.UTC(2027,0,1),sourceRevision='a'.repeat(40),commonCheckpoint=await digest('common-checkpoint'),candidate=await digest('candidate-onnx');
 const host={provider:'runpod',image:`example/image@sha256:${'b'.repeat(64)}`,gpu:'Synthetic GPU',minRamGb:48,minVcpu:8,minCudaVersion:'12.8',dataCenterId:'US-TEST-1',hourlyCents:100,diskGb:80};
 const guards=await add('guards',{schema:1,encodingHashes:[],familyIds:['held-out-family']}),recipe=await add('root-recipe',{schema:1,kind:'synthetic-root-recipe'}),corpus=await add('corpus',{schema:1,kind:'guard-only-corpus'});
 const method={schema:1,kind:'attention-incumbent-method-v1',architecture:{id:'synthetic-same-attention'},pilotRecipe:{id:'unchanged-baseline'},guardsSha256:guards.sha256,transferReceipt:{path:'old.json',sha256:await digest('old-transfer')}};
 const oldMethod=await add('old-method',method),newMethodValue={...method,transferReceipt:{path:'new.json',sha256:await digest('new-transfer')}},newMethod=await add('common-method',newMethodValue);
 const identity={sourceRevision,dependencySha256:await digest('dependencies'),seed:107,recipeSha256:recipe.sha256,methodSha256:oldMethod.sha256,corpusSha256:corpus.sha256,familyInventorySha256:guards.sha256,hostConfigurationSha256:await hostConfigurationSha256(host),runtimeSha256:await digest('qualified-runtime')};
 const teacherModel=await digest('synthetic-teacher-model'),teacherProfile={simulations:512};
 const teacherProfileInput=await add('teacher-profile',teacherProfile),beforeProfileInput=await add('teacher-before-profile',{simulations:128});
 const suite=await developmentSuiteFixture({identityOverrides:{sourceRevision,dependencySha256:identity.dependencySha256,modelSha256:teacherModel,profileSha256:teacherProfileInput.sha256}});
 suite.index.beforeProfiles={[teacherProfileInput.sha256]:beforeProfileInput.sha256};
 const teacherBeforeIdentity={...suite.identity,profileSha256:beforeProfileInput.sha256};
 const teacherBefore=await suite.assess(suite.original.nonwinningLine,.1,teacherBeforeIdentity);
 suite.report={...suite.report,indexSha256:await developmentDigest(suite.index),before:teacherBeforeIdentity,rows:[{...suite.report.rows[0],beforeSha256:await suite.put(teacherBefore)}]};
 const merge=map=>{for(const [hash,bytes] of map){if(!objects.has(hash)){objects.set(hash,bytes);inputs.push({name:'synthetic-evidence-'+hash.slice(0,16),path:`.ai-runs/experiment/${hash}.json`,sha256:hash,bytes:bytes.length});}}};
 merge(suite.objects);
 const teacherSuite=await add('teacher-suite',suite.index),teacherDevelopment=await add('teacher-development',suite.report);
 const profiles={schema:1,profiles:Object.fromEntries(['babs','tau','horus'].map(name=>[name,{version:1,name}]))},profileInput=await add('profiles',profiles);
 for(const [name,profile] of Object.entries(profiles.profiles))await add('public-profile-'+name,profile);
 const publicProfileHashes=await Promise.all(Object.values(profiles.profiles).map(developmentDigest));
 const candidateSuiteValue={...suite.index,profiles:publicProfileHashes,beforeProfiles:Object.fromEntries(publicProfileHashes.map(p=>[p,p]))},candidateSuite=await add('candidate-suite',candidateSuiteValue);
 const candidateWorkIds=await developmentWorkIds(candidateSuiteValue);
 const validationAssessment={schema:1,indexSha256:candidateSuite.sha256,seed:107,stepSeconds:1,maxActions:8,milliseconds:1000,maxOperations:2000,seconds:60,...(options.validationAssessment??{})};
 const candidateBefore={...suite.identity,modelSha256:original.publicOnnxSha256},candidateAfter={...suite.identity,modelSha256:candidate},candidateRows=[];
 for(const profileSha256 of publicProfileHashes){
  const before=await suite.assess(suite.original.nonwinningLine,.1,{...candidateBefore,profileSha256}),after=await suite.assess(suite.original.winningLine,.8,{...candidateAfter,profileSha256});
  candidateRows.push({caseKey:suite.c.key,profileSha256,beforeSha256:await suite.put(before),afterSha256:await suite.put(after)});
 }
 merge(suite.objects);
 const candidateDevelopmentValue={schema:1,kind:'development-suite-report',indexSha256:candidateSuite.sha256,purpose:'candidate-regression',arm:'treatment',before:candidateBefore,after:candidateAfter,rows:candidateRows,dose:{historicalAssessmentPositions:0,trainingProofs:[]}};
 const nativePlan=cp=>({kind:'attention-ordinary-training-stage',checkpoint:{path:'.ai-runs/cp.pt',sha256:cp},seed:107,deadlineWall:deadline/1000,nativeManifest:{sourceRevision,seed:107,modelArchitecture:method.architecture,warmStart:{path:'.ai-runs/cp.pt',sha256:cp},evaluationGuards:{path:guards.path,sha256:guards.sha256}}});
 const calibrationPlan=await add('calibration-plan',nativePlan(original.checkpointSha256));
 const calibration={schema:1,kind:'common-calibration',methodKind:COMPARISON_METHOD,autoPromotion:false,endpointRule:'latest-durable-at-fixed-allocation-end',originalDeadline:deadline,originalIncumbent:original,identity,
  campaign:{id:'calibration',stage:'calibration',arm:'shared',computeCents:1000,cloudflareCents:100,seconds:600,phasePlanSha256:calibrationPlan.sha256}};
 const calibrationRecord=await add('calibration-rule',calibration);
 const sourceExecution={campaign:'calibration',phase:'train',manifestSha256:await digest('calibration-manifest'),planSha256:calibrationPlan.sha256,seed:107,sourceRevision,dependencySha256:identity.dependencySha256,recipeSha256:recipe.sha256,dataSha256:corpus.sha256,inputCheckpointSha256:original.checkpointSha256,scientific:{stage:'calibration',arm:'shared',experimentSha256:calibrationRecord.sha256,methodSha256:oldMethod.sha256,familyInventorySha256:guards.sha256}};
 const runner=await add('calibration-runner',{status:'stopped',reason:'budget-or-resource-stop'});
 const sourceProof=await add('calibration-proof',{schema:1,kind:'training-proof',execution:sourceExecution,checkpointSha256:commonCheckpoint,recoveryPassed:true,calibrationEndpoint:{rule:calibration.endpointRule,deadlineWall:deadline/1000,planSha256:calibrationPlan.sha256,checkpointSha256:commonCheckpoint,runnerResultSha256:runner.sha256}});
 const sourceResult=await add('calibration-result',{schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,execution:sourceExecution,artifacts:[{role:'checkpoint',sha256:commonCheckpoint},{...sourceProof,role:'proof'},{...runner,role:'attempt'}]});
 const commonStart={...identity,methodSha256:newMethod.sha256,checkpointSha256:commonCheckpoint,calibrationResultSha256:sourceResult.sha256,calibrationRuleSha256:calibrationRecord.sha256};
 const teacherPlan=await add('teacher-plan',{kind:'policy-only-teacher-refresh',mode:'refresh',profile:options.planProfile??teacherProfile,teacher:{sha256:teacherModel},searchSeconds:5,developmentSuiteSha256:teacherSuite.sha256,...(options.omitDevelopmentAssessment?{}:{developmentAssessment:{schema:1,indexSha256:teacherSuite.sha256,beforeProfileSha256:beforeProfileInput.sha256,seed:107,stepSeconds:1,maxActions:8,milliseconds:1000,maxOperations:2000}}),pool:{sourceCheckpoint:{path:'.ai-runs/cp.pt',sha256:commonCheckpoint},sourceResult:{path:sourceResult.path,sha256:sourceResult.sha256},guards:{path:guards.path,sha256:guards.sha256},selections:[{workId:'policy-one'}]}});
 const qualificationRule=await add('qualification-rule',{schema:1,kind:'reviewed-policy-teacher-qualification-rule',reviewed:true,methodKind:COMPARISON_METHOD,teacherPlanSha256:teacherPlan.sha256,policyOnly:true,observedValuesUnchanged:true,minimumCompletedRows:1,developmentSuiteSha256:teacherSuite.sha256,beforeProfileSha256:options.ruleBeforeProfileSha256??beforeProfileInput.sha256});
 const rulesValue={schema:1,kind:'reviewed-exploratory-comparison-rules',reviewed:true,calibrated:true,reviewReference:'synthetic-independent-review',calibrationResultSha256:sourceResult.sha256,qualificationRuleSha256:qualificationRule.sha256,
  parameters:{pairsPerProfile:1,normalStartPairsPerProfile:1,minimumUsefulEffect:.1,confidenceLevel:.95,maximumMissingFraction:0,gameSeconds:60},missingPolicy:'retain-all-scheduled-bounds',criticalRegressionPolicy:'reject',candidateLockPolicy:'one-candidate-before-final',stopPolicy:'diagnostic-stop-at-budget-or-unqualified-method',primaryScope:{metric:'score',profiles:['babs','tau','horus'],starts:['normal'],seats:['P1','P2']},uncertainty:{confidence:.95,seed:107,resamples:100},finalSample:{pairsPerProfile:1,normalStartPairsPerProfile:1,gameSeconds:60}};
 const rules=await add('rules',rulesValue),selectionRule=await add('selection-rule',{schema:1,kind:'reviewed-candidate-selection-rule',reviewed:true,rulesSha256:rules.sha256,policy:'preregistered-primary-metric-and-critical-regression-floor',nomination:{minimumDelta:.1,bound:'conservative-lower'}});
 const schedule=['babs','tau','horus'].flatMap(profile=>['P1','P2'].map(candidateSeat=>({id:`${profile}-${candidateSeat}`,pairId:profile,profile,candidateSeat,role:'candidate',partition:'validation',familyId:`family-${profile}`,seed:107,startKind:'normal',sourceFamily:`source-${profile}`,kind:'normal',startIdentity:{schema:1,startKind:'normal',kind:'normal',stateHash:'1'.repeat(64),constructionSha256:'2'.repeat(64)},gameSeconds:60})));
 for(const job of schedule)job.startIdentity=expectedEvaluationStart(job);
 const scheduleInput=await add('schedule',schedule);
 const finalSchedule=schedule.map(j=>({...j,id:'final-'+j.id,pairId:'final-'+j.pairId,partition:'final'})),finalScheduleSha=await sha256(encode(canonical(finalSchedule)));
 const finalSummary={schema:1,candidateAttempts:6,...rulesValue.finalSample,publicProfilesSha256:profileInput.sha256,familyInventorySha256:guards.sha256};
 const preparation={schema:1,kind:'policy-target-preparation',methodKind:COMPARISON_METHOD,autoPromotion:false,originalDeadline:deadline,commonStart,publicOpponentSha256:original.publicOnnxSha256,
  qualificationRuleSha256:qualificationRule.sha256,rulesSha256:rules.sha256,selectionRuleSha256:selectionRule.sha256,publicProfilesSha256:profileInput.sha256,evaluationFamilyInventorySha256:guards.sha256,...(options.omitValidationAssessment?{}:{validationAssessment}),developmentSuites:{teacherSha256:teacherSuite.sha256,candidateSha256:candidateSuite.sha256},
  campaigns:[{id:'control',stage:'training',arm:'control',computeCents:2000,cloudflareCents:150,seconds:1200,phasePlanSha256:null},{id:'teacher',stage:'teacher-screen',arm:'treatment',computeCents:500,cloudflareCents:50,seconds:300,phasePlanSha256:teacherPlan.sha256},{id:'treatment',stage:'training',arm:'treatment',computeCents:1500,cloudflareCents:100,seconds:900,phasePlanSha256:null},...['control','treatment'].map(arm=>({id:`evaluate-${arm}`,stage:'evaluation',evaluationScope:'validation',arm,computeCents:500,cloudflareCents:50,seconds:600,scheduleSha256:scheduleInput.sha256})),{id:'final',stage:'evaluation',evaluationScope:'final',arm:'shared',computeCents:500,cloudflareCents:50,seconds:600,scheduleSha256:finalScheduleSha,scheduleSummary:finalSummary}],
  reserves:{qualification:{runpodCents:500,cloudflareCents:5},preparation:{runpodCents:200,cloudflareCents:5},cleanup:{runpodCents:200,cloudflareCents:5},repair:{runpodCents:1000,cloudflareCents:5},retention:{runpodCents:0,cloudflareCents:100}},continuation:{maximum:0,campaignIds:[],condition:'preregistered-inconclusive-and-funded-only'}};
 const preparationRecord=await add('preparation',preparation);
 const overlay=await add('overlay',[{id:'actual-row',partition:'train',targetOrigin:'fresh-self-play',policyMask:true,policy:[{index:2,probability:1}],originalPolicy:[{index:1,probability:1}],sourceQualification:{kind:'executed-shared-calibration-row',checkpointSha256:commonCheckpoint,sourceResultSha256:sourceResult.sha256}}]);
 const executedCommon={seed:107,sourceRevision,dependencySha256:identity.dependencySha256,recipeSha256:recipe.sha256,dataSha256:corpus.sha256,inputCheckpointSha256:commonCheckpoint};
 const teacherExecution={...executedCommon,campaign:'teacher',phase:'teacher',manifestSha256:await digest('teacher-manifest'),planSha256:teacherPlan.sha256,scientific:{stage:'teacher-screen',arm:'treatment',experimentSha256:preparationRecord.sha256,methodSha256:newMethod.sha256,familyInventorySha256:guards.sha256}};
 const teacherProof=await add('teacher-proof',{schema:1,kind:'teacher-proof',execution:teacherExecution,policyOnly:true,observedValuesUnchanged:true,originalMasksUnchanged:true,actualSearchEvidence:true,mode:'refresh',policyRefreshSha256:overlay.sha256,...(options.omitTeacherProofAssessment?{}:{developmentReportSha256:teacherDevelopment.sha256})});
 const teacherValue={schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,interventionReady:true,policyTargetsChanged:true,policyRefreshSha256:overlay.sha256,...(options.omitTeacherResultAssessment?{}:{developmentReportSha256:teacherDevelopment.sha256}),execution:teacherExecution,artifacts:[{...teacherProof,role:'proof'},{...overlay,role:'attempt'},{...teacherDevelopment,role:'attempt'}]};
 const teacherResult=await add('teacher-result',teacherValue),cost=await add('teacher-cost',{schema:1,kind:'campaign-usage-receipt',classification:'controller-upper-bound',campaign:'teacher',manifestSha256:teacherExecution.manifestSha256,cleanupVerified:true,providerUsageCents:250,cloudflareUsageCents:10});
 const qualified=await add('teacher-qualified',{schema:1,kind:'reviewed-policy-teacher-qualification',qualified:true,preparationSha256:preparationRecord.sha256,ruleSha256:qualificationRule.sha256,teacherResultSha256:teacherResult.sha256,policyRefreshSha256:overlay.sha256,developmentReportSha256:teacherDevelopment.sha256});
 const executionRecipe=refresh=>({kind:'execution-recipe',incumbent:{checkpointSha256:commonCheckpoint},dataSha256:corpus.sha256,settings:{attentionMethod:newMethodValue,...(refresh?{policyRefresh:{path:overlay.path,sha256:overlay.sha256}}:{})}});
 const controlRecipe=await add('control-execution',executionRecipe(false)),treatmentRecipe=await add('treatment-execution',executionRecipe(true));
 const initialRecipe=await add('initial-execution',{kind:'execution-recipe',incumbent:{checkpointSha256:original.checkpointSha256},dataSha256:corpus.sha256,settings:{attentionMethod:method}});
 const controlPlan=await add('control-plan',nativePlan(commonCheckpoint)),treatmentPlan=await add('treatment-plan',{...nativePlan(commonCheckpoint),syntheticArm:'treatment'});
 const comparison={...preparation,kind:'policy-target-exploratory-comparison',preparationSha256:preparationRecord.sha256,teacher:{resultSha256:teacherResult.sha256,policyRefreshSha256:overlay.sha256,costReceiptSha256:cost.sha256,qualificationSha256:qualified.sha256,developmentReportSha256:teacherDevelopment.sha256},campaigns:preparation.campaigns.map(c=>c.stage==='training'?{...c,phasePlanSha256:c.arm==='control'?controlPlan.sha256:treatmentPlan.sha256}:c)};
 const comparisonRecord=await add('comparison',comparison);
 // Acyclic order: preregistration -> teacher evidence -> fixed arm outputs ->
 // actual validation receipts -> paired comparison -> selected final lock.
 const armResults={},trainingResults={},trainingProofs={},evaluationPlans={},developmentReports={},trainingModels={control:await digest('control-output'),treatment:candidate};
 const py=x=>Array.isArray(x)?`[${x.map(py).join(', ')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}: ${py(x[k])}`).join(', ')}}`:JSON.stringify(x);
 const addPy=async(name,value)=>{const bytes=encode(py(value)+'\n'),hash=await sha256(bytes),a={name,path:`.ai-runs/experiment/${name}.json`,sha256:hash,bytes:bytes.length};objects.set(hash,bytes);inputs.push(a);return a;};
 for(const arm of ['control','treatment']){
  const selectedExecution={...executedCommon,campaign:arm,phase:'train-'+arm,planSha256:arm==='control'?controlPlan.sha256:treatmentPlan.sha256,scientific:{stage:'training',arm,experimentSha256:comparisonRecord.sha256,methodSha256:newMethod.sha256,familyInventorySha256:guards.sha256}};
  const selectedProof=await add(arm+'-selected-proof',{schema:1,kind:'training-proof',execution:selectedExecution,modelSha256:trainingModels[arm],recoveryPassed:true,numericParityPassed:true,...(arm==='treatment'?{policyRefreshDose:{schema:1,phase:selectedExecution.phase,byFamily:[{familyId:'synthetic-fresh-family',sourceFamily:'synthetic-calibration-family',sampledPositions:3,uniquePositions:2}],totalPositions:3}}:{})});
  trainingProofs[arm]=selectedProof;
  trainingResults[arm]=await add(arm+'-selected-result',{schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,execution:selectedExecution,artifacts:[{...selectedProof,role:'proof'},{role:'model',sha256:trainingModels[arm]}]});
  let rows=candidateRows,after=candidateAfter;
  if(arm==='control'){
   rows=[];after={...candidateAfter,modelSha256:trainingModels[arm]};
   for(const profileSha256 of publicProfileHashes){
    const before=await suite.assess(suite.original.nonwinningLine,.1,{...candidateBefore,profileSha256});
    const actualAfter=await suite.assess(suite.original.winningLine,.8,{...after,profileSha256});
    rows.push({caseKey:suite.c.key,profileSha256,beforeSha256:await suite.put(before),afterSha256:await suite.put(actualAfter)});
   }
   merge(suite.objects);
  }
  developmentReports[arm]=await add(arm+'-candidate-development',{...candidateDevelopmentValue,arm,after,rows,dose:{historicalAssessmentPositions:0,trainingProofs:arm==='treatment'?[selectedProof]:[]}});
  const evalPlanValue={kind:'prospective-public-profile-evaluation',evaluationScope:'validation',developmentAssessment:validationAssessment,developmentTrainingProofs:arm==='treatment'?[{sha256:selectedProof.sha256}]:[],models:{candidate:{sha256:trainingModels[arm]},opponent:{sha256:original.publicOnnxSha256}},candidateSha256:trainingModels[arm],schedule,profiles,familyInventory:{sha256:guards.sha256},primaryScope:rulesValue.primaryScope,uncertainty:rulesValue.uncertainty};
  evaluationPlans[arm]=await add(arm+'-evaluation-plan',evalPlanValue);
  const manifestSha256=await digest(arm+'-validation-manifest'),execution={...executedCommon,campaign:'evaluate-'+arm,planSha256:evaluationPlans[arm].sha256,manifestSha256,scientific:{stage:'evaluation',arm,experimentSha256:comparisonRecord.sha256}};
  const artifacts=[{...developmentReports[arm],role:'attempt'}],workReceipts=candidateWorkIds.map((workId,i)=>({workId,status:'complete',evidenceSha256:rows[i].afterSha256}));
  for(const row of rows)artifacts.push({role:'attempt',sha256:row.afterSha256});
  for(const job of schedule){
   const outcome=arm==='treatment'?(job.candidateSeat==='P1'?'p1_win':'p2_win'):(job.candidateSeat==='P1'?'p2_win':'p1_win');
   const base=Object.fromEntries(['pairId','candidateSeat','profile','familyId','sourceFamily','role','seed','startKind','startIdentity'].map(k=>[k,job[k]]));base.jobId=job.id;base.receiptId=manifestSha256+':'+job.id;
   const game={outcome:{status:outcome}},gameSha256=await sha256(encode(py(game))),raw={...base,status:'raw-complete',game,gameSha256},rawArtifact=await addPy(arm+'-raw-'+job.id,raw),rawSha256=await sha256(objects.get(rawArtifact.sha256).slice(0,-1));
   const verifiedArtifact=await addPy(arm+'-verified-'+job.id,{schema:1,kind:'prospective-replay-verification',rawSha256,startIdentity:job.startIdentity,verifier:{sourceRevision,files:{}},engineReplayVerified:true,outcome});
   const scored=await addPy(arm+'-scored-'+job.id,{...raw,status:'complete',outcome,engineReplayVerified:true,rawEvidenceSha256:rawArtifact.sha256,verificationEvidenceSha256:verifiedArtifact.sha256});
   for(const artifact of [rawArtifact,verifiedArtifact,scored])artifacts.push({...artifact,role:'attempt'});workReceipts.push({workId:job.id,status:'complete',evidenceSha256:scored.sha256});
  }
  artifacts.push({...await add(arm+'-evaluation-proof',{schema:1,kind:'evaluation-proof',execution,candidateSha256:trainingModels[arm],developmentReportSha256:developmentReports[arm].sha256,workReceipts}),role:'proof'});
  const evaluationResult=await add(arm+'-evaluation-result',{schema:1,kind:'compute-result',disposition:'complete',execution,artifacts,developmentReportSha256:developmentReports[arm].sha256,accountedWorkIds:workReceipts.map(r=>r.workId),completedWorkIds:workReceipts.map(r=>r.workId),allWorkComplete:true});
  armResults[arm]={trainingResultSha256:trainingResults[arm].sha256,evaluationResultSha256:evaluationResult.sha256};
 }
 const candidateDevelopment=developmentReports.treatment;
 const comparisonReport=await add('actual-paired-comparison',{schema:1,kind:'executed-paired-arm-comparison',comparisonSha256:comparisonRecord.sha256,rulesSha256:rules.sha256,selectionRuleSha256:selectionRule.sha256,sourceRevision,dependencySha256:identity.dependencySha256,armResults,
  pairedReport:{primaryScope:rulesValue.primaryScope,primaryPairedDeltaBounds:[1,1],primaryPairedDelta:1,strengthEstablished:false,independentTrainingReplications:null,uncertaintyClassification:'diagnostic-only-not-controller-recomputed',familyUncertainty:{...rulesValue.uncertainty,sourceFamilies:schedule.filter(j=>j.candidateSeat==='P1').map(j=>j.sourceFamily).sort(),missingOutcomesImputed:false,interval:null}}});
 const lockValue={schema:1,kind:'locked-comparison-candidate',comparisonSha256:comparisonRecord.sha256,selectionRuleSha256:selectionRule.sha256,selectionReviewed:true,candidateSha256:candidate,sourceTrainingResultSha256:trainingResults.treatment.sha256,comparisonReportSha256:comparisonReport.sha256,developmentSuiteSha256:candidateSuite.sha256,developmentReportSha256:candidateDevelopment.sha256};
 const lock=await add('candidate-lock',lockValue);
 const finalInput=await add('final-schedule',finalSchedule);assert.equal(finalInput.sha256,finalScheduleSha);
 const {developmentAssessment:unusedFinalAssessment,developmentTrainingProofs:unusedFinalDose,...validationPlan}=JSON.parse(new TextDecoder().decode(objects.get(evaluationPlans.treatment.sha256)));
 const finalPlanValue={...validationPlan,evaluationScope:'final',schedule:finalSchedule},finalPlan=await add('final-evaluation-plan',finalPlanValue);
 const protectedFinal=new Set([finalInput.sha256,finalPlan.sha256]);
 const teacherWorkIds=[...await developmentWorkIds(suite.index),'policy-one'];
 function manifest(which='control'){
  const cal=which==='calibration',preparing=which==='teacher',record=cal?calibration:preparing?preparation:comparison,recordInput=cal?calibrationRecord:preparing?preparationRecord:comparisonRecord;
  const campaign=cal?calibration.campaign:record.campaigns.find(c=>c.id===which),start=cal?identity:commonStart;
  const plan=cal?calibrationPlan:preparing?teacherPlan:which==='control'?controlPlan:which==='treatment'?treatmentPlan:which==='final'?finalPlan:evaluationPlans[campaign.arm];
  const args=['python','-m','righelt_training.hosted_science',campaign.stage==='teacher-screen'?'teacher':campaign.stage==='evaluation'?'evaluation':'training','--plan',plan.path];
  return {id:campaign.id,purpose:'scientific-comparison',sourceRevision,dependencySha256:start.dependencySha256,seed:107,recipeSha256:recipe.sha256,corpusSha256:corpus.sha256,runtimeSha256:start.runtimeSha256,checkpointSha256:cal?original.checkpointSha256:commonCheckpoint,executionRecipeSha256:cal?initialRecipe.sha256:which==='treatment'?treatmentRecipe.sha256:controlRecipe.sha256,maxCents:campaign.computeCents,deadline,
   cash:{cloudflareUsageCapCents:campaign.cloudflareCents},scientific:{schema:1,stage:campaign.stage,arm:campaign.arm,experimentSha256:recordInput.sha256,methodSha256:start.methodSha256,familyInventorySha256:guards.sha256,...(campaign.stage==='evaluation'?{evaluationScope:campaign.evaluationScope,candidateSha256:which==='final'?candidate:trainingModels[campaign.arm],...(which==='final'?{candidateLockSha256:lock.sha256}:{sourceTrainingResultSha256:trainingResults[campaign.arm].sha256})}:{})},inputs:inputs.filter(a=>which==='final'||!protectedFinal.has(a.sha256)),phases:[{id:'phase',kind:campaign.stage==='teacher-screen'?'teacher':campaign.stage==='evaluation'?'evaluation':'training',host,seconds:campaign.seconds,workIds:campaign.stage==='teacher-screen'?teacherWorkIds:campaign.stage==='evaluation'?(which==='final'?finalSchedule.map(s=>s.id):[...candidateWorkIds,...schedule.map(s=>s.id)]):['train'],planSha256:plan.sha256,argv:args,resumeArgv:[...args,'--resume']}]};
 }
 const read=async a=>objects.get(a.sha256);
 const updated=async(m,name,value)=>{const input=await add(name,value);m.inputs=inputs.filter(a=>m.id==='final'||!protectedFinal.has(a.sha256));return input;};
 return {add,updated,read,manifest,calibration,preparation,comparison,comparisonRecord,preparationRecord,rulesValue,evalPlanValue:JSON.parse(new TextDecoder().decode(objects.get(evaluationPlans.control.sha256))),teacherValue,controlRecipe,treatmentRecipe,commonCheckpoint,candidate,inputs,objects,coveragePolicy:suite.coverage,teacherSuite,candidateSuite,teacherDevelopment,candidateDevelopment,lockValue,lock,finalInput,finalPlan,trainingResults,comparisonReport,validationAssessment,developmentReports,candidateWorkIds};
}

test('original public identities are separate and all preregistered stages admit without future plan templates',async()=>{
 const f=await fixture();assert.notEqual(ORIGINAL_INCUMBENT.checkpointSha256,ORIGINAL_INCUMBENT.publicOnnxSha256);
 for(const name of ['calibration','teacher','control','treatment','evaluate-control','evaluate-treatment','final'])assert.equal((await validateScientificAdmission(f.manifest(name),{read:f.read,coveragePolicy:f.coveragePolicy})).qualified,true);
 const result=await validateScientificAdmission(f.manifest(),{read:f.read,coveragePolicy:f.coveragePolicy});
 assert.deepEqual(result.totals,{runpodCents:8400,cloudflareCents:670,
  control:{runpodCents:2500,cloudflareCents:200,totalCents:2700},treatment:{runpodCents:2500,cloudflareCents:200,totalCents:2700},calibration:{runpodCents:1000,cloudflareCents:100}});
});

test('equal TOTAL budgets include conservative teacher maximum and paid shared calibration',async()=>{
 const f=await fixture(),unequal=structuredClone(f.preparation);unequal.campaigns.find(c=>c.id==='treatment').computeCents++;
 assert.throws(()=>projectExperimentBudget(unequal,f.calibration),/TOTAL/);
 const missing=structuredClone(f.preparation);missing.campaigns=missing.campaigns.filter(c=>c.id!=='teacher');assert.throws(()=>projectExperimentBudget(missing,f.calibration),/target-generation/);
 const over=structuredClone(f.preparation);over.reserves.preparation.runpodCents=10000;assert.throws(()=>projectExperimentBudget(over,f.calibration),/ceilings/);
 const unequalCf=structuredClone(f.preparation);unequalCf.campaigns.find(c=>c.id==='teacher').cloudflareCents++;
 assert.throws(()=>projectExperimentBudget(unequalCf,f.calibration),/TOTAL Cloudflare/);
 const overCf=structuredClone(f.preparation);overCf.reserves.retention.cloudflareCents=2000;
 assert.throws(()=>projectExperimentBudget(overCf,f.calibration),/ceilings/);
 const free=structuredClone(f.calibration);free.campaign.computeCents=0;assert.throws(()=>projectExperimentBudget(f.preparation,free),/finite/);
 const continuation=structuredClone(f.preparation);continuation.continuation.maximum=1;assert.throws(()=>projectExperimentBudget(continuation,f.calibration),/not implemented/);
});

test('changed checkpoint, seed, source, allocation and deadline cannot silently start an arm',async()=>{
 const f=await fixture();
 for(const change of [{checkpointSha256:'0'.repeat(64)},{seed:108},{sourceRevision:'b'.repeat(40)},{maxCents:1999},{deadline:f.comparison.originalDeadline+1000}])await assert.rejects(validateScientificAdmission({...f.manifest(),...change},{read:f.read,coveragePolicy:f.coveragePolicy}));
 for(const change of [{gpu:'Different GPU'},{minCudaVersion:'13.0'},{minRamGb:96},{image:`different/image@sha256:${'c'.repeat(64)}`}]){
  const m=f.manifest();m.phases[0].host={...m.phases[0].host,...change};await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/host configuration differs/);
 }
 const requoted=f.manifest();requoted.phases[0].host={...requoted.phases[0].host,quoteObservedAt:1,quoteExpires:2,quoteReference:'new-quote-metadata'};
 assert.equal((await validateScientificAdmission(requoted,{read:f.read,coveragePolicy:f.coveragePolicy})).qualified,true);
 const control=f.manifest();control.executionRecipeSha256=f.treatmentRecipe.sha256;await assert.rejects(validateScientificAdmission(control,{read:f.read,coveragePolicy:f.coveragePolicy}),/unchanged control/);
 const weak=f.manifest();weak.phases[0].host={...weak.phases[0].host,minCudaVersion:'11.0'};await assert.rejects(validateScientificAdmission(weak,{read:f.read,coveragePolicy:f.coveragePolicy}),/host configuration/);
 const altered=structuredClone(f.comparison);altered.originalDeadline+=1000;const m=f.manifest(),a=await f.updated(m,'extended-comparison',altered);m.scientific.experimentSha256=a.sha256;m.deadline=altered.originalDeadline;await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/deadline cannot reset/);
});

test('unknown method and uncalibrated parameters fail before teacher or arm work',async()=>{
 const f=await fixture(),m=f.manifest('teacher'),bad={...f.preparation,methodKind:'new-unapproved-method'};
 m.scientific.experimentSha256=(await f.updated(m,'unknown-method',bad)).sha256;await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/unsupported/);
 const r=await f.add('uncalibrated-rules',{...f.rulesValue,calibrated:false}),prep={...f.preparation,rulesSha256:r.sha256},n=f.manifest('teacher');n.scientific.experimentSha256=(await f.updated(n,'uncalibrated-preparation',prep)).sha256;
 await assert.rejects(validateScientificAdmission(n,{read:f.read,coveragePolicy:f.coveragePolicy}),/calibrated/);
 const premature=f.manifest();premature.scientific.experimentSha256=f.preparationRecord.sha256;await assert.rejects(validateScientificAdmission(premature,{read:f.read,coveragePolicy:f.coveragePolicy}),/before actual teacher freeze|plan/);
});

test('post-teacher freezes cannot improve caps or discard a no-op target result',async()=>{
 const f=await fixture(),changed=structuredClone(f.comparison);changed.campaigns.find(c=>c.id==='treatment').computeCents++;
 const m=f.manifest();m.scientific.experimentSha256=(await f.updated(m,'changed-budget-freeze',changed)).sha256;await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/changed common state/);
 const noop=await f.add('no-op-teacher',{...f.teacherValue,interventionReady:false,policyTargetsChanged:false}),bad={...f.comparison,teacher:{...f.comparison.teacher,resultSha256:noop.sha256}},n=f.manifest();n.scientific.experimentSha256=(await f.updated(n,'no-op-comparison',bad)).sha256;
 await assert.rejects(validateScientificAdmission(n,{read:f.read,coveragePolicy:f.coveragePolicy}),/changed teacher output/);
});

test('validation uses its registered arm output and needs no final candidate lock',async()=>{
 const f=await fixture();
 for(const mutate of [p=>p.models.opponent.sha256='0'.repeat(64),p=>p.schedule.pop(),p=>p.candidateSha256='0'.repeat(64)]){
  const value=structuredClone(f.evalPlanValue);mutate(value);const m=f.manifest('evaluate-control'),a=await f.updated(m,'bad-evaluation-'+f.inputs.length,value);m.phases[0].planSha256=a.sha256;
  for(const args of [m.phases[0].argv,m.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=a.path;
  await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/evaluation changed|ordered assessment\/game work/);
 }
 const m=f.manifest('evaluate-control');assert.equal(m.scientific.candidateLockSha256,undefined);assert.equal((await validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy})).qualified,true);
 m.scientific.candidateLockSha256=f.lock.sha256;await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/not final candidate nomination/);
});

test('controller rejects invalid scientific prerequisites before queueing or reserving either provider budget',async()=>{
 const f=await controllerFixture(),bytesByHash=new Map(f.inputs.map((a,i)=>[a.sha256,[f.cp,f.corpus,f.recipe][i]]));
 const add=async(name,value)=>{const bytes=encode(canonical(value)),a={name,path:`.ai-runs/pilot/${name}.json`,sha256:await sha256(bytes),bytes:bytes.length};f.inputs.push(a);bytesByHash.set(a.sha256,bytes);return a;};
 const invalid=await add('invalid-freeze',{schema:1,kind:'unsupported',methodKind:'unapproved-method'}),plan=await add('scientific-plan',{kind:'attention-ordinary-training-stage'});
 f.manifest.purpose='scientific-comparison';f.manifest.scientific={schema:1,stage:'training',arm:'control',experimentSha256:invalid.sha256,methodSha256:f.inputs[2].sha256,familyInventorySha256:f.inputs[1].sha256};
 const phase=f.manifest.phases[0];phase.kind='training';phase.planSha256=plan.sha256;phase.expect.proof.allWorkComplete=true;
 phase.argv=['tools/ai-trainer/.venv/bin/python','-m','righelt_training.hosted_science','training','--plan',plan.path,'--run-dir',phase.runDir,'--seconds',String(phase.seconds)];phase.resumeArgv=[...phase.argv,'--resume'];
 await f.arm();await f.core.stage(f.manifest);for(const a of f.inputs)await f.core.putObject(f.manifest.id,a,bytesByHash.get(a.sha256));
 f.control.unavailable=true;
 await assert.rejects(f.core.start(f.manifest.id),/unsupported scientific comparison method/);
 await f.core.reconcile();const db=await f.core.load(),campaign=db.campaigns[f.manifest.id];
 assert.equal(campaign.status,'staged');assert.equal(campaign.generation,0);assert.equal(campaign.attempts.length,0);assert.equal(f.providers.creates,0);
 for(const key of ['creditAllocatedCents','cloudflareAllocatedCents','pilotReservedCents','cashCommittedCents'])assert.equal(db[key],undefined);
});

test('omitted tactical suite and claimed changed policies without actual useful assessments cannot qualify',async()=>{
 const f=await fixture(),missing=structuredClone(f.preparation);delete missing.developmentSuites;
 const m=f.manifest('teacher');m.scientific.experimentSha256=(await f.updated(m,'omitted-tactical-preregistration',missing)).sha256;
 await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/frozen teacher and candidate tactical suites/);
 const boolOnly=await f.add('claimed-useful-teacher',{schema:1,kind:'development-suite-report',qualified:true,usefulCorrections:true,policyTargetsChanged:true});
 const changed={...f.comparison,teacher:{...f.comparison.teacher,developmentReportSha256:boolOnly.sha256}},n=f.manifest();
 n.scientific.experimentSha256=(await f.updated(n,'bool-only-teacher',changed)).sha256;
 await assert.rejects(validateScientificAdmission(n,{read:f.read,coveragePolicy:f.coveragePolicy}),/actual aggregate suite report|omits actual assessment report/);
 // The test seam is opt-in. The production default never accepts synthetic coverage.
 await assert.rejects(validateScientificAdmission(f.manifest(),{read:f.read}),/canonical amendment inventory differs/);
});

test('guard-only final reservation neither requires nor exposes raw final material before selection',async()=>{
 const f=await fixture();
 for(const name of ['teacher','control','treatment','evaluate-control','evaluate-treatment']){
  const m=f.manifest(name);assert.equal(m.inputs.some(a=>a.sha256===f.finalInput.sha256),false);
  assert.equal((await validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy})).qualified,true);
  m.inputs.push(f.finalInput);
  await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/raw final schedule\/material is forbidden/);
 }
 const final=f.manifest('final');assert.equal(final.inputs.some(a=>a.sha256===f.finalInput.sha256),true);
 assert.equal((await validateScientificAdmission(final,{read:f.read,coveragePolicy:f.coveragePolicy})).qualified,true);
 const reserved=structuredClone(f.preparation);reserved.campaigns.find(c=>c.id==='final').scheduleSummary.candidateAttempts++;
 const bad=f.manifest('teacher');bad.scientific.experimentSha256=(await f.updated(bad,'changed-final-reservation',reserved)).sha256;
 await assert.rejects(validateScientificAdmission(bad,{read:f.read,coveragePolicy:f.coveragePolicy}),/guard-only final reservation/);
});

test('validation binds its own arm while final selection needs actual paired results and critical floor',async()=>{
 const f=await fixture(),admit=m=>validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy});
 const wrongArm=f.manifest('evaluate-control');wrongArm.scientific.sourceTrainingResultSha256=f.trainingResults.treatment.sha256;
 await assert.rejects(admit(wrongArm),/exact registered arm output/);
 for(const [change,reason] of [[{comparisonReportSha256:undefined,allScheduledArmsAccounted:true},/hash required/],[{developmentReportSha256:undefined,criticalRegressionPassed:true},/actual validation assessment/]]){
  const m=f.manifest('final'),lock={...f.lockValue,...change};m.scientific.candidateLockSha256=(await f.updated(m,'bool-only-lock-'+f.inputs.length,lock)).sha256;
  await assert.rejects(admit(m),reason);
 }
 const altered=structuredClone(f.evalPlanValue);altered.primaryScope.profiles=['horus'];
 const m=f.manifest('evaluate-control'),plan=await f.updated(m,'altered-primary-scope',altered);m.phases[0].planSha256=plan.sha256;
 for(const args of [m.phases[0].argv,m.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=plan.path;
 await assert.rejects(admit(m),/evaluation changed|ordered assessment\/game work/);
 const unregistered=f.manifest();unregistered.id='extra-training-arm';await assert.rejects(admit(unregistered),/unregistered campaign/);
 const changed=structuredClone(f.comparison);changed.reserves.repair.runpodCents--;
 const n=f.manifest();n.scientific.experimentSha256=(await f.updated(n,'post-teacher-reserve-change',changed)).sha256;
 await assert.rejects(admit(n),/changed reserves/);
});


test('teacher assessment freezes exact after and before effort and a bounded same-allocation component',async()=>{
 for(const [options,reason] of [
  [{planProfile:{simulations:1024}},/exact target-generation profile/],
  [{ruleBeforeProfileSha256:'0'.repeat(64)},/explicit frozen teacher comparator/],
  [{omitDevelopmentAssessment:true},/bounded same-allocation teacher assessment/],
 ]){
  const f=await fixture(options);
  await assert.rejects(validateScientificAdmission(f.manifest('teacher'),{read:f.read,coveragePolicy:f.coveragePolicy}),reason);
 }
 const f=await fixture(),m=f.manifest('teacher');
 assert.equal(m.phases[0].workIds.length,2);assert.match(m.phases[0].workIds[0],/^development-/);assert.equal(m.phases[0].workIds[1],'policy-one');
 m.phases[0].workIds.shift();
 await assert.rejects(validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy}),/assessment and source pool/);
 for(const name of ['teacher-profile','teacher-before-profile']){
  const missing=f.manifest('teacher');missing.inputs=missing.inputs.filter(a=>a.name!==name);
  await assert.rejects(validateScientificAdmission(missing,{read:f.read,coveragePolicy:f.coveragePolicy}),/not a frozen input/);
 }
});

test('teacher proof and result must both carry the actual assessment report',async()=>{
 for(const options of [{omitTeacherProofAssessment:true},{omitTeacherResultAssessment:true}]){
  const f=await fixture(options);
  await assert.rejects(validateScientificAdmission(f.manifest('control'),{read:f.read,coveragePolicy:f.coveragePolicy}),/teacher result omits actual assessment report/);
 }
});


test('both validation arms freeze the same assessment before games inside existing caps',async()=>{
 for(const options of [{omitValidationAssessment:true},{validationAssessment:{seconds:601}}]){
  const f=await fixture(options);
  await assert.rejects(validateScientificAdmission(f.manifest('teacher'),{read:f.read,coveragePolicy:f.coveragePolicy}),/validation.*assessment|assessment.*validation|suballocation/);
 }
 const f=await fixture(),admit=m=>validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy});
 for(const arm of ['control','treatment']){
  const m=f.manifest('evaluate-'+arm),plan=JSON.parse(new TextDecoder().decode(f.objects.get(m.phases[0].planSha256)));
  assert.deepEqual(plan.developmentAssessment,f.preparation.validationAssessment);
  assert.deepEqual(m.phases[0].workIds.slice(0,f.candidateWorkIds.length),f.candidateWorkIds);
  assert.equal(m.phases[0].seconds,600);assert.equal(m.maxCents,500);assert.equal(m.cash.cloudflareUsageCapCents,50);
  const omitted=f.manifest('evaluate-'+arm);omitted.phases[0].workIds.shift();await assert.rejects(admit(omitted),/work IDs|ordered assessment\/game work/);
  plan.developmentAssessment={...plan.developmentAssessment,maxActions:9};
  const changed=await f.updated(m,'changed-validation-component-'+arm,plan);m.phases[0].planSha256=changed.sha256;
  for(const args of [m.phases[0].argv,m.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=changed.path;
  await assert.rejects(admit(m),/validation.*assessment|assessment.*component|frozen.*assessment/);
 }
});

test('validation treatment dose is the registered proof and final floor comes from selected arm validation',async()=>{
 const f=await fixture(),admit=m=>validateScientificAdmission(m,{read:f.read,coveragePolicy:f.coveragePolicy});
 const m=f.manifest('evaluate-treatment'),plan=JSON.parse(new TextDecoder().decode(f.objects.get(m.phases[0].planSha256)));
 plan.developmentTrainingProofs=[];
 const bad=await f.updated(m,'missing-validation-dose',plan);m.phases[0].planSha256=bad.sha256;
 for(const args of [m.phases[0].argv,m.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=bad.path;
 await assert.rejects(admit(m),/training proof|training dose|dose differs from registered training/);
 const final=f.manifest('final');final.scientific.candidateLockSha256=(await f.updated(final,'wrong-arm-floor',{...f.lockValue,developmentReportSha256:f.developmentReports.control.sha256})).sha256;
 await assert.rejects(admit(final),/validation|report|tactical floor|suite model/);
 const sameCandidateReport=JSON.parse(new TextDecoder().decode(f.objects.get(f.developmentReports.treatment.sha256)));
 sameCandidateReport.evidenceNote='synthetic alternate valid report not produced by this validation';
 const alternate=await f.add('unbound-same-candidate-floor',sameCandidateReport),unbound=f.manifest('final');
 unbound.scientific.candidateLockSha256=(await f.updated(unbound,'unbound-final-floor',{...f.lockValue,developmentReportSha256:alternate.sha256})).sha256;
 await assert.rejects(admit(unbound),/validation|assessment report|evaluation.*report/);
 const alternateTraining=JSON.parse(new TextDecoder().decode(f.objects.get(f.trainingResults.treatment.sha256)));alternateTraining.evidenceNote='different result object with same exported model';
 const different=await f.add('unbound-training-result',alternateTraining),wrongTraining=f.manifest('final');
 wrongTraining.scientific.candidateLockSha256=(await f.updated(wrongTraining,'unbound-final-training',{...f.lockValue,sourceTrainingResultSha256:different.sha256})).sha256;
 await assert.rejects(admit(wrongTraining),/training result differs from paired validation/);
 const extra=f.manifest('final'),extraPlan={...JSON.parse(new TextDecoder().decode(f.objects.get(extra.phases[0].planSha256))),developmentAssessment:f.validationAssessment,developmentTrainingProofs:[]};
 extra.phases[0].workIds=[...f.candidateWorkIds,...extra.phases[0].workIds];
 const extraInput=await f.updated(extra,'unregistered-final-assessment',extraPlan);extra.phases[0].planSha256=extraInput.sha256;
 for(const args of [extra.phases[0].argv,extra.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=extraInput.path;
 await assert.rejects(admit(extra),/final evaluation contains unregistered assessment or work/);
});
