import {developmentWorkIds} from '../development-suite.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Fixture serializer matches Python's sorted ASCII JSON for these ASCII/integer records.
const py=x=>Array.isArray(x)?`[${x.map(py).join(', ')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}: ${py(x[k])}`).join(', ')}}`:JSON.stringify(x);
export async function comparisonFixture({missing=false,reverse=false,tie=false,bound='point',assessment=false}={}){
 const objects=new Map(),put=async x=>{const bytes=encode(py(x)+'\n'),digest=await sha256(bytes);objects.set(digest,bytes);return digest;},read=async b=>objects.get(b.sha256),hash=ch=>ch.repeat(64);
 const start={sourceRevision:'a'.repeat(40),dependencySha256:hash('b')};
 const rules={parameters:{minimumUsefulEffect:.2,maximumMissingFraction:1,confidenceLevel:.95},primaryScope:{metric:'score',profiles:['babs'],starts:['normal'],seats:['P1','P2']},uncertainty:{confidence:.95,seed:107,resamples:100}},rulesSha256=await put(rules),selectionRuleSha256=await put({rulesSha256,nomination:{minimumDelta:.2,bound}});
 const schedule=['f1','f2'].flatMap(familyId=>['P1','P2'].map(candidateSeat=>({id:`${familyId}-${candidateSeat}`,pairId:familyId,familyId,sourceFamily:familyId,candidateSeat,profile:'babs',role:'candidate',seed:107,partition:'validation',startKind:'normal',kind:'normal',startIdentity:{schema:1,startKind:'normal',kind:'normal',stateHash:hash('c'),constructionSha256:hash('d')}})));
 const suite=assessment?{cases:[{key:'synthetic-floor-case'}],profiles:[hash('c')]}:null,assessmentIds=suite?await developmentWorkIds(suite):[],suiteSha=suite?await put(suite):null;
 const scheduleSha256=await put(schedule),trainingPlans={control:await put({kind:'training-plan',arm:'control'}),treatment:await put({kind:'training-plan',arm:'treatment'})};
 const comparison={kind:'policy-target-exploratory-comparison',commonStart:start,rulesSha256,selectionRuleSha256,campaigns:['control','treatment'].flatMap(arm=>[{id:`train-${arm}`,stage:'training',arm,phasePlanSha256:trainingPlans[arm]},{id:`validate-${arm}`,stage:'evaluation',arm,scheduleSha256}])},comparisonSha256=await put(comparison),armResults={};
 for(const arm of ['control','treatment']){
  const modelSha=hash(arm==='control'?'e':'f'),trainingExecution={...start,campaign:`train-${arm}`,planSha256:trainingPlans[arm],scientific:{arm,experimentSha256:comparisonSha256}};
  const trainingProof={kind:'training-proof',execution:trainingExecution,modelSha256:modelSha,recoveryPassed:true,numericParityPassed:true};
  const trainingResultSha256=await put({schema:1,kind:'compute-result',disposition:'complete',allWorkComplete:true,execution:trainingExecution,artifacts:[{role:'model',sha256:modelSha},{role:'proof',sha256:await put(trainingProof)}]});
  const plan={kind:'prospective-public-profile-evaluation',models:{candidate:{sha256:modelSha},opponent:{sha256:'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f'}},candidateSha256:modelSha,...(assessment?{developmentAssessment:{indexSha256:suiteSha}}:{}),schedule,primaryScope:rules.primaryScope,uncertainty:rules.uncertainty},planSha256=await put(plan),manifestSha256=hash(arm==='control'?'1':'2'),execution={...start,campaign:`validate-${arm}`,planSha256,manifestSha256,scientific:{arm,experimentSha256:comparisonSha256}};
  const artifacts=[],workReceipts=[];for(const workId of assessmentIds){const evidenceSha256=await put({kind:'synthetic-floor-protocol-receipt'});artifacts.push({role:'attempt',sha256:evidenceSha256});workReceipts.push({workId,status:'complete',evidenceSha256});}for(const job of schedule){
   if(missing&&arm==='treatment'&&job.id==='f1-P1'){workReceipts.push({workId:job.id,status:'unstarted'});continue;}
   const wins=tie?false:(arm==='treatment')!==reverse,outcome=wins?(job.candidateSeat==='P1'?'p1_win':'p2_win'):(job.candidateSeat==='P1'?'p2_win':'p1_win');
   const base=Object.fromEntries(['pairId','candidateSeat','profile','familyId','sourceFamily','role','seed','startKind','startIdentity'].map(k=>[k,job[k]]));base.jobId=job.id;base.receiptId=manifestSha256+':'+job.id;
   const game={outcome:{status:outcome}},gameSha256=await sha256(encode(py(game))),raw={...base,status:'raw-complete',game,gameSha256},rawEvidenceSha256=await put(raw),rawSha256=await sha256(objects.get(rawEvidenceSha256).slice(0,-1));
   const verified={schema:1,kind:'prospective-replay-verification',rawSha256,startIdentity:job.startIdentity,verifier:{sourceRevision:start.sourceRevision,files:{}},engineReplayVerified:true,outcome},verificationEvidenceSha256=await put(verified);
   const row={...raw,status:'complete',outcome,engineReplayVerified:true,rawEvidenceSha256,verificationEvidenceSha256},evidenceSha256=await put(row);
   for(const digest of [rawEvidenceSha256,verificationEvidenceSha256,evidenceSha256])artifacts.push({role:'attempt',sha256:digest});workReceipts.push({workId:job.id,status:'complete',evidenceSha256});
  }
  const proof={kind:'evaluation-proof',execution,candidateSha256:modelSha,workReceipts};artifacts.push({role:'proof',sha256:await put(proof)});
  armResults[arm]={trainingResultSha256,evaluationResultSha256:await put({schema:1,kind:'compute-result',disposition:'complete',execution,artifacts,accountedWorkIds:[...assessmentIds,...schedule.map(j=>j.id)],completedWorkIds:workReceipts.filter(r=>r.status==='complete').map(r=>r.workId),allWorkComplete:workReceipts.every(r=>r.status==='complete')})};
 }
 const request={comparisonSha256,rulesSha256,selectionRuleSha256,armResults};
 async function write(){const directory=await mkdtemp(join(tmpdir(),'t132-comparison-')),store=join(directory,'.objects');await mkdir(store);for(const [digest,bytes]of objects)await writeFile(join(store,digest),bytes);const requestPath=join(directory,'request.json');await writeFile(requestPath,JSON.stringify(request));return {directory,store,requestPath,cleanup:()=>rm(directory,{recursive:true,force:true})};}
 return {objects,put,read,request,comparison,rules,schedule,write};
}
