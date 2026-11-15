import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,unlink,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {comparisonFixture} from './comparison-evidence-fixture.mjs';
import {validateComparisonEvidence} from '../comparison-evidence.mjs';
const run=promisify(execFile),python='python3';
async function native(f){const disk=await f.write();try{const output=await run(python,['-m','righelt_training.comparison_report','--objects',disk.store,'--request',disk.requestPath],{env:{PATH:process.env.PATH,PYTHONPATH:resolve('tools/ai-trainer')}});return JSON.parse(output.stdout);}finally{await disk.cleanup();}}
test('actual native paired producer and portable validator nominate only exact registered arm output',async()=>{
 const f=await comparisonFixture(),report=await native(f),result=await validateComparisonEvidence(report,{read:f.read,...f.request});assert.equal(result.eligibleArm,'treatment');assert.equal(result.candidateSha256,'f'.repeat(64));assert.deepEqual(result.primaryDeltaBounds,[1,1]);
 const reverse=await comparisonFixture({reverse:true});assert.equal((await validateComparisonEvidence(await native(reverse),{read:reverse.read,...reverse.request})).eligibleArm,'control');
});
test('missing work remains a bound and undefined point cannot force a winner',async()=>{
 const f=await comparisonFixture({missing:true}),report=await native(f),result=await validateComparisonEvidence(report,{read:f.read,...f.request});assert.equal(result.pointDelta,null);assert.equal(result.eligibleArm,null);assert.deepEqual(result.primaryDeltaBounds,[.75,1]);
 const forged=structuredClone(report);forged.pairedReport.primaryPairedDelta=1;await assert.rejects(validateComparisonEvidence(forged,{read:f.read,...f.request}),/primary result differs/);
});
test('changed scores, source, raw-only evidence and foreign training result reject',async()=>{
 const f=await comparisonFixture(),report=await native(f),bad=structuredClone(report);bad.sourceRevision='0'.repeat(40);await assert.rejects(validateComparisonEvidence(bad,{read:f.read,...f.request}),/source differs/);
 const forged=structuredClone(report);forged.pairedReport.primaryPairedDeltaBounds=[0,0];await assert.rejects(validateComparisonEvidence(forged,{read:f.read,...f.request}),/primary result differs/);
 const wrong=structuredClone(report);wrong.armResults.treatment.trainingResultSha256=wrong.armResults.control.trainingResultSha256;await assert.rejects(validateComparisonEvidence(wrong,{read:f.read,...f.request}),/registered comparison/);
 const evalResult=JSON.parse(new TextDecoder().decode(f.objects.get(f.request.armResults.treatment.evaluationResultSha256))),proofArtifact=evalResult.artifacts.find(a=>a.role==='proof'),proof=JSON.parse(new TextDecoder().decode(f.objects.get(proofArtifact.sha256))),row=JSON.parse(new TextDecoder().decode(f.objects.get(proof.workReceipts[0].evidenceSha256)));row.status='raw-complete';
 const changedSha=await f.put(row);proof.workReceipts[0].evidenceSha256=changedSha;evalResult.artifacts.push({role:'attempt',sha256:changedSha});proofArtifact.sha256=await f.put(proof);const rawOnly=structuredClone(report);rawOnly.armResults.treatment.evaluationResultSha256=await f.put(evalResult);await assert.rejects(validateComparisonEvidence(rawOnly,{read:f.read,...f.request}),/row differs/);
});
test('native flat store rejects checksum corruption, missing object despite outside copy, and object symlink',async()=>{
 const f=await comparisonFixture(),disk=await f.write(),digest=f.request.armResults.control.trainingResultSha256,path=join(disk.store,digest);
 const args=['-m','righelt_training.comparison_report','--objects',disk.store,'--request',disk.requestPath],opts={env:{PATH:process.env.PATH,PYTHONPATH:resolve('tools/ai-trainer')}};
 try{await writeFile(path,'{}');await assert.rejects(run(python,args,opts));await unlink(path);const outside=join(disk.directory,'original.json');await writeFile(outside,f.objects.get(digest));await assert.rejects(run(python,args,opts));await symlink(outside,path);await assert.rejects(run(python,args,opts));}finally{await disk.cleanup();}
});

test('conservative-lower nomination uses raw missing bounds; diagnostic intervals cannot change nomination',async()=>{
 for(const reverse of [false,true]){const f=await comparisonFixture({bound:'conservative-lower',reverse}),r=await validateComparisonEvidence(await native(f),{read:f.read,...f.request});assert.equal(r.eligibleArm,reverse?'control':'treatment');}
 const tied=await comparisonFixture({tie:true,bound:'conservative-lower'}),tiedReport=await native(tied);tiedReport.pairedReport.familyUncertainty.interval=[.5,.5];assert.equal((await validateComparisonEvidence(tiedReport,{read:tied.read,...tied.request})).eligibleArm,null);
 const positive=await comparisonFixture({bound:'conservative-lower'}),positiveReport=await native(positive);positiveReport.pairedReport.familyUncertainty.interval=[-1,-1];const result=await validateComparisonEvidence(positiveReport,{read:positive.read,...positive.request});assert.equal(result.eligibleArm,'treatment');assert.equal(result.uncertaintyClassification,'diagnostic-only-not-controller-recomputed');
});
test('verified attempt must match exact authoritative frozen start identity',async()=>{
 const f=await comparisonFixture(),report=await native(f),arm=report.armResults.treatment,result=JSON.parse(new TextDecoder().decode(f.objects.get(arm.evaluationResultSha256))),proofArtifact=result.artifacts.find(a=>a.role==='proof'),proof=JSON.parse(new TextDecoder().decode(f.objects.get(proofArtifact.sha256))),receipt=proof.workReceipts[0],row=JSON.parse(new TextDecoder().decode(f.objects.get(receipt.evidenceSha256)));
 row.startIdentity.stateHash='0'.repeat(64);receipt.evidenceSha256=await f.put(row);result.artifacts.push({role:'attempt',sha256:receipt.evidenceSha256});proofArtifact.sha256=await f.put(proof);arm.evaluationResultSha256=await f.put(result);
 await assert.rejects(validateComparisonEvidence(report,{read:f.read,...f.request}),/row differs from schedule/);
});
