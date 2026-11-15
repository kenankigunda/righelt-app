import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScientificAdmission,projectExperimentBudget,hostConfigurationSha256,ORIGINAL_INCUMBENT,COMPARISON_METHOD} from '../experiment.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {fixture as controllerFixture} from './helpers.mjs';

// Synthetic protocol records only. These numbers and model hashes are not a
// scientific freeze, teacher qualification, hosted run or spending authority.
async function fixture(){
 const objects=new Map(),inputs=[];
 const add=async(name,value)=>{const bytes=encode(canonical(value)),hash=await sha256(bytes),a={name,path:`.ai-runs/experiment/${name}.json`,sha256:hash,bytes:bytes.length};objects.set(hash,bytes);inputs.push(a);return a;};
 const digest=name=>sha256(encode(name)),original={checkpointSha256:'fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44',publicOnnxSha256:'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f'};
 const deadline=Date.UTC(2027,0,1),sourceRevision='a'.repeat(40),commonCheckpoint=await digest('common-checkpoint'),candidate=await digest('candidate-onnx');
 const host={provider:'runpod',image:`example/image@sha256:${'b'.repeat(64)}`,gpu:'Synthetic GPU',minRamGb:48,minVcpu:8,minCudaVersion:'12.8',dataCenterId:'US-TEST-1',hourlyCents:100,diskGb:80};
 const guards=await add('guards',{schema:1,encodingHashes:[],familyIds:['held-out-family']}),recipe=await add('root-recipe',{schema:1,kind:'synthetic-root-recipe'}),corpus=await add('corpus',{schema:1,kind:'guard-only-corpus'});
 const method={schema:1,kind:'attention-incumbent-method-v1',architecture:{id:'synthetic-same-attention'},pilotRecipe:{id:'unchanged-baseline'},guardsSha256:guards.sha256,transferReceipt:{path:'old.json',sha256:await digest('old-transfer')}};
 const oldMethod=await add('old-method',method),newMethodValue={...method,transferReceipt:{path:'new.json',sha256:await digest('new-transfer')}},newMethod=await add('common-method',newMethodValue);
 const identity={sourceRevision,dependencySha256:await digest('dependencies'),seed:107,recipeSha256:recipe.sha256,methodSha256:oldMethod.sha256,corpusSha256:corpus.sha256,familyInventorySha256:guards.sha256,hostConfigurationSha256:await hostConfigurationSha256(host),runtimeSha256:await digest('qualified-runtime')};
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
 const teacherPlan=await add('teacher-plan',{kind:'policy-only-teacher-refresh',mode:'refresh',profile:{simulations:512},pool:{sourceCheckpoint:{path:'.ai-runs/cp.pt',sha256:commonCheckpoint},sourceResult:{path:sourceResult.path,sha256:sourceResult.sha256},guards:{path:guards.path,sha256:guards.sha256},selections:[{workId:'policy-one'}]}});
 const qualificationRule=await add('qualification-rule',{schema:1,kind:'reviewed-policy-teacher-qualification-rule',reviewed:true,methodKind:COMPARISON_METHOD,teacherPlanSha256:teacherPlan.sha256,policyOnly:true,observedValuesUnchanged:true,minimumCompletedRows:1});
 const rulesValue={schema:1,kind:'reviewed-exploratory-comparison-rules',reviewed:true,calibrated:true,reviewReference:'synthetic-independent-review',calibrationResultSha256:sourceResult.sha256,qualificationRuleSha256:qualificationRule.sha256,
  parameters:{pairsPerProfile:1,normalStartPairsPerProfile:1,minimumUsefulEffect:.1,confidenceLevel:.95,maximumMissingFraction:0,gameSeconds:60},missingPolicy:'retain-all-scheduled-bounds',criticalRegressionPolicy:'reject',candidateLockPolicy:'one-candidate-before-final',stopPolicy:'diagnostic-stop-at-budget-or-unqualified-method'};
 const rules=await add('rules',rulesValue),selectionRule=await add('selection-rule',{schema:1,kind:'reviewed-candidate-selection-rule',reviewed:true,rulesSha256:rules.sha256,policy:'preregistered-primary-metric-and-critical-regression-floor'});
 const profiles={schema:1,profiles:{babs:{version:1},tau:{version:1},horus:{version:1}}},profileInput=await add('profiles',profiles);
 const schedule=['babs','tau','horus'].flatMap(profile=>['P1','P2'].map(candidateSeat=>({id:`${profile}-${candidateSeat}`,pairId:profile,profile,candidateSeat,role:'candidate',partition:'validation',familyId:`family-${profile}`,seed:107,kind:'normal',gameSeconds:60})));
 const scheduleInput=await add('schedule',schedule);
 const preparation={schema:1,kind:'policy-target-preparation',methodKind:COMPARISON_METHOD,autoPromotion:false,originalDeadline:deadline,commonStart,publicOpponentSha256:original.publicOnnxSha256,
  qualificationRuleSha256:qualificationRule.sha256,rulesSha256:rules.sha256,selectionRuleSha256:selectionRule.sha256,publicProfilesSha256:profileInput.sha256,evaluationFamilyInventorySha256:guards.sha256,
  campaigns:[{id:'control',stage:'training',arm:'control',computeCents:2000,cloudflareCents:150,seconds:1200,phasePlanSha256:null},{id:'teacher',stage:'teacher-screen',arm:'treatment',computeCents:500,cloudflareCents:50,seconds:300,phasePlanSha256:teacherPlan.sha256},{id:'treatment',stage:'training',arm:'treatment',computeCents:1500,cloudflareCents:100,seconds:900,phasePlanSha256:null},...['control','treatment'].map(arm=>({id:`evaluate-${arm}`,stage:'evaluation',arm,computeCents:500,cloudflareCents:50,seconds:600,scheduleSha256:scheduleInput.sha256}))],
  reserves:{qualification:{runpodCents:500,cloudflareCents:5},preparation:{runpodCents:200,cloudflareCents:5},cleanup:{runpodCents:200,cloudflareCents:5},repair:{runpodCents:1000,cloudflareCents:5},retention:{runpodCents:0,cloudflareCents:100}},continuation:{maximum:0,campaignIds:[],condition:'preregistered-inconclusive-and-funded-only'}};
 const preparationRecord=await add('preparation',preparation);
 const overlay=await add('overlay',[{id:'actual-row',partition:'train',targetOrigin:'fresh-self-play',policyMask:true,policy:[{index:2,probability:1}],originalPolicy:[{index:1,probability:1}],sourceQualification:{kind:'executed-shared-calibration-row',checkpointSha256:commonCheckpoint,sourceResultSha256:sourceResult.sha256}}]);
 const executedCommon={seed:107,sourceRevision,dependencySha256:identity.dependencySha256,recipeSha256:recipe.sha256,dataSha256:corpus.sha256,inputCheckpointSha256:commonCheckpoint};
 const teacherExecution={...executedCommon,campaign:'teacher',phase:'teacher',manifestSha256:await digest('teacher-manifest'),planSha256:teacherPlan.sha256,scientific:{stage:'teacher-screen',arm:'treatment',experimentSha256:preparationRecord.sha256,methodSha256:newMethod.sha256,familyInventorySha256:guards.sha256}};
 const teacherProof=await add('teacher-proof',{schema:1,kind:'teacher-proof',execution:teacherExecution,policyOnly:true,observedValuesUnchanged:true,originalMasksUnchanged:true,actualSearchEvidence:true,mode:'refresh',policyRefreshSha256:overlay.sha256});
 const teacherValue={schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,interventionReady:true,policyTargetsChanged:true,policyRefreshSha256:overlay.sha256,execution:teacherExecution,artifacts:[{...teacherProof,role:'proof'},{...overlay,role:'attempt'}]};
 const teacherResult=await add('teacher-result',teacherValue),cost=await add('teacher-cost',{schema:1,kind:'campaign-usage-receipt',classification:'controller-upper-bound',campaign:'teacher',manifestSha256:teacherExecution.manifestSha256,cleanupVerified:true,providerUsageCents:250,cloudflareUsageCents:10});
 const qualified=await add('teacher-qualified',{schema:1,kind:'reviewed-policy-teacher-qualification',qualified:true,preparationSha256:preparationRecord.sha256,ruleSha256:qualificationRule.sha256,teacherResultSha256:teacherResult.sha256,policyRefreshSha256:overlay.sha256});
 const executionRecipe=refresh=>({kind:'execution-recipe',incumbent:{checkpointSha256:commonCheckpoint},dataSha256:corpus.sha256,settings:{attentionMethod:newMethodValue,...(refresh?{policyRefresh:{path:overlay.path,sha256:overlay.sha256}}:{})}});
 const controlRecipe=await add('control-execution',executionRecipe(false)),treatmentRecipe=await add('treatment-execution',executionRecipe(true));
 const initialRecipe=await add('initial-execution',{kind:'execution-recipe',incumbent:{checkpointSha256:original.checkpointSha256},dataSha256:corpus.sha256,settings:{attentionMethod:method}});
 const controlPlan=await add('control-plan',nativePlan(commonCheckpoint)),treatmentPlan=await add('treatment-plan',{...nativePlan(commonCheckpoint),syntheticArm:'treatment'});
 const comparison={...preparation,kind:'policy-target-exploratory-comparison',preparationSha256:preparationRecord.sha256,teacher:{resultSha256:teacherResult.sha256,policyRefreshSha256:overlay.sha256,costReceiptSha256:cost.sha256,qualificationSha256:qualified.sha256},campaigns:preparation.campaigns.map(c=>c.stage==='training'?{...c,phasePlanSha256:c.arm==='control'?controlPlan.sha256:treatmentPlan.sha256}:c)};
 const comparisonRecord=await add('comparison',comparison);
 const selectedExecution={...executedCommon,campaign:'control',planSha256:controlPlan.sha256,scientific:{stage:'training',arm:'control',experimentSha256:comparisonRecord.sha256,methodSha256:newMethod.sha256,familyInventorySha256:guards.sha256}};
 const selectedProof=await add('selected-proof',{schema:1,kind:'training-proof',execution:selectedExecution,modelSha256:candidate});
 const selected=await add('selected-result',{schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,execution:selectedExecution,artifacts:[{...selectedProof,role:'proof'},{role:'model',sha256:candidate}]});
 const lock=await add('candidate-lock',{schema:1,kind:'locked-comparison-candidate',comparisonSha256:comparisonRecord.sha256,selectionRuleSha256:selectionRule.sha256,selectionReviewed:true,allScheduledArmsAccounted:true,candidateSha256:candidate,sourceTrainingResultSha256:selected.sha256});
 const evalPlanValue={kind:'prospective-public-profile-evaluation',models:{candidate:{sha256:candidate},opponent:{sha256:original.publicOnnxSha256}},candidateSha256:candidate,schedule,profiles,familyInventory:{sha256:guards.sha256}};
 const evalPlan=await add('evaluation-plan',evalPlanValue);
 function manifest(which='control'){
  const cal=which==='calibration',preparing=which==='teacher',record=cal?calibration:preparing?preparation:comparison,recordInput=cal?calibrationRecord:preparing?preparationRecord:comparisonRecord;
  const campaign=cal?calibration.campaign:record.campaigns.find(c=>c.id===which),start=cal?identity:commonStart;
  const plan=cal?calibrationPlan:preparing?teacherPlan:which==='control'?controlPlan:which==='treatment'?treatmentPlan:evalPlan;
  const args=['python','-m','righelt_training.hosted_science',campaign.stage==='teacher-screen'?'teacher':campaign.stage==='evaluation'?'evaluation':'training','--plan',plan.path];
  return {id:campaign.id,purpose:'scientific-comparison',sourceRevision,dependencySha256:start.dependencySha256,seed:107,recipeSha256:recipe.sha256,corpusSha256:corpus.sha256,runtimeSha256:start.runtimeSha256,checkpointSha256:cal?original.checkpointSha256:commonCheckpoint,executionRecipeSha256:cal?initialRecipe.sha256:which==='treatment'?treatmentRecipe.sha256:controlRecipe.sha256,maxCents:campaign.computeCents,deadline,
   cash:{cloudflareUsageCapCents:campaign.cloudflareCents},scientific:{schema:1,stage:campaign.stage,arm:campaign.arm,experimentSha256:recordInput.sha256,methodSha256:start.methodSha256,familyInventorySha256:guards.sha256,...(campaign.stage==='evaluation'?{candidateSha256:candidate,candidateLockSha256:lock.sha256}:{})},inputs:[...inputs],phases:[{id:'phase',kind:campaign.stage==='teacher-screen'?'teacher':campaign.stage==='evaluation'?'evaluation':'training',host,seconds:campaign.seconds,workIds:campaign.stage==='teacher-screen'?['policy-one']:campaign.stage==='evaluation'?schedule.map(s=>s.id):['train'],planSha256:plan.sha256,argv:args,resumeArgv:[...args,'--resume']}]};
 }
 const read=async a=>objects.get(a.sha256);
 const updated=async(m,name,value)=>{const input=await add(name,value);m.inputs=[...inputs];return input;};
 return {add,updated,read,manifest,calibration,preparation,comparison,comparisonRecord,preparationRecord,rulesValue,evalPlanValue,teacherValue,controlRecipe,treatmentRecipe,commonCheckpoint,candidate,inputs,objects};
}

test('original public identities are separate and all preregistered stages admit without future plan templates',async()=>{
 const f=await fixture();assert.notEqual(ORIGINAL_INCUMBENT.checkpointSha256,ORIGINAL_INCUMBENT.publicOnnxSha256);
 for(const name of ['calibration','teacher','control','treatment','evaluate-control'])assert.equal((await validateScientificAdmission(f.manifest(name),{read:f.read})).qualified,true);
 const result=await validateScientificAdmission(f.manifest(),{read:f.read});
 assert.deepEqual(result.totals,{runpodCents:7900,cloudflareCents:620,
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
 for(const change of [{checkpointSha256:'0'.repeat(64)},{seed:108},{sourceRevision:'b'.repeat(40)},{maxCents:1999},{deadline:f.comparison.originalDeadline+1000}])await assert.rejects(validateScientificAdmission({...f.manifest(),...change},{read:f.read}));
 for(const change of [{gpu:'Different GPU'},{minCudaVersion:'13.0'},{minRamGb:96},{image:`different/image@sha256:${'c'.repeat(64)}`}]){
  const m=f.manifest();m.phases[0].host={...m.phases[0].host,...change};await assert.rejects(validateScientificAdmission(m,{read:f.read}),/host configuration differs/);
 }
 const requoted=f.manifest();requoted.phases[0].host={...requoted.phases[0].host,quoteObservedAt:1,quoteExpires:2,quoteReference:'new-quote-metadata'};
 assert.equal((await validateScientificAdmission(requoted,{read:f.read})).qualified,true);
 const control=f.manifest();control.executionRecipeSha256=f.treatmentRecipe.sha256;await assert.rejects(validateScientificAdmission(control,{read:f.read}),/unchanged control/);
 const weak=f.manifest();weak.phases[0].host={...weak.phases[0].host,minCudaVersion:'11.0'};await assert.rejects(validateScientificAdmission(weak,{read:f.read}),/host configuration/);
 const altered=structuredClone(f.comparison);altered.originalDeadline+=1000;const m=f.manifest(),a=await f.updated(m,'extended-comparison',altered);m.scientific.experimentSha256=a.sha256;m.deadline=altered.originalDeadline;await assert.rejects(validateScientificAdmission(m,{read:f.read}),/deadline cannot reset/);
});

test('unknown method and uncalibrated parameters fail before teacher or arm work',async()=>{
 const f=await fixture(),m=f.manifest('teacher'),bad={...f.preparation,methodKind:'new-unapproved-method'};
 m.scientific.experimentSha256=(await f.updated(m,'unknown-method',bad)).sha256;await assert.rejects(validateScientificAdmission(m,{read:f.read}),/unsupported/);
 const r=await f.add('uncalibrated-rules',{...f.rulesValue,calibrated:false}),prep={...f.preparation,rulesSha256:r.sha256},n=f.manifest('teacher');n.scientific.experimentSha256=(await f.updated(n,'uncalibrated-preparation',prep)).sha256;
 await assert.rejects(validateScientificAdmission(n,{read:f.read}),/calibrated/);
 const premature=f.manifest();premature.scientific.experimentSha256=f.preparationRecord.sha256;await assert.rejects(validateScientificAdmission(premature,{read:f.read}),/before actual teacher freeze|plan/);
});

test('post-teacher freezes cannot improve caps or discard a no-op target result',async()=>{
 const f=await fixture(),changed=structuredClone(f.comparison);changed.campaigns.find(c=>c.id==='treatment').computeCents++;
 const m=f.manifest();m.scientific.experimentSha256=(await f.updated(m,'changed-budget-freeze',changed)).sha256;await assert.rejects(validateScientificAdmission(m,{read:f.read}),/changed common state/);
 const noop=await f.add('no-op-teacher',{...f.teacherValue,interventionReady:false,policyTargetsChanged:false}),bad={...f.comparison,teacher:{...f.comparison.teacher,resultSha256:noop.sha256}},n=f.manifest();n.scientific.experimentSha256=(await f.updated(n,'no-op-comparison',bad)).sha256;
 await assert.rejects(validateScientificAdmission(n,{read:f.read}),/changed teacher output/);
});

test('evaluation uses frozen schedule and original public ONNX opponent after candidate lock',async()=>{
 const f=await fixture();
 for(const mutate of [p=>p.models.opponent.sha256='0'.repeat(64),p=>p.schedule.pop(),p=>p.candidateSha256='0'.repeat(64)]){
  const value=structuredClone(f.evalPlanValue);mutate(value);const m=f.manifest('evaluate-control'),a=await f.updated(m,'bad-evaluation-'+f.inputs.length,value);m.phases[0].planSha256=a.sha256;
  for(const args of [m.phases[0].argv,m.phases[0].resumeArgv])args[args.indexOf('--plan')+1]=a.path;
  await assert.rejects(validateScientificAdmission(m,{read:f.read}),/evaluation changed/);
 }
 const m=f.manifest('evaluate-control');delete m.scientific.candidateLockSha256;await assert.rejects(validateScientificAdmission(m,{read:f.read}),/hash required/);
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
