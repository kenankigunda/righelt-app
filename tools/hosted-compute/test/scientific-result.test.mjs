import test from 'node:test';
import assert from 'node:assert/strict';
import {executionIdentity,verifyResult} from '../result.mjs';
import {sha256} from '../policy.mjs';
async function fixture(kind='evaluation',status='complete',mode='screen'){
 const manifest={id:'science',seed:1,sourceRevision:'a'.repeat(40),dependencySha256:'b'.repeat(64),recipeSha256:'c'.repeat(64),executionRecipeSha256:'d'.repeat(64),checkpointSha256:'e'.repeat(64),corpusSha256:'f'.repeat(64),scientific:{schema:1,stage:kind,arm:'treatment',experimentSha256:'1'.repeat(64),methodSha256:'2'.repeat(64),familyInventorySha256:'3'.repeat(64),candidateSha256:'4'.repeat(64)},phases:[]};
 const phase={id:'measure',kind,runDir:'.ai-runs/science/run',workIds:['one']};manifest.phases=[phase];
 const execution=executionIdentity(manifest,'5'.repeat(64),phase,1),bytes=new TextEncoder().encode(JSON.stringify({workId:'one',status})),hash=await sha256(bytes);
 const records=new Map([[hash,bytes]]),attempt={name:hash,sha256:hash,bytes:bytes.length,path:phase.runDir+'/one.json',role:'attempt'};
 const proof={schema:1,kind:kind+'-proof',execution,workReceipts:[{workId:'one',status,evidenceSha256:hash}],mode,candidateSha256:manifest.scientific.candidateSha256,unfinishedIsDraw:false,prospective:true,inferenceRuntime:{candidate:{kind:'exported-onnx',artifactSha256:manifest.scientific.candidateSha256}},policyOnly:true,observedValuesUnchanged:true,originalMasksUnchanged:true,actualSearchEvidence:true,publicSearchBudgetsUnchanged:true};
 if(mode==='refresh')proof.policyRefreshSha256=hash;
 const raw=new TextEncoder().encode(JSON.stringify(proof)),proofHash=await sha256(raw);records.set(proofHash,raw);
 const result={schema:1,kind:'compute-result',disposition:'complete',execution,accountedWorkIds:['one'],completedWorkIds:status==='complete'?['one']:[],allWorkComplete:status==='complete',...(mode==='refresh'?{policyRefreshSha256:hash}:{}),artifacts:[attempt,{name:proofHash,sha256:proofHash,bytes:raw.length,path:phase.runDir+'/proof.json',role:'proof'}]};
 return {result,args:{manifest,manifestSha256:'5'.repeat(64),phase,generation:1,read:a=>records.get(a.sha256)}};
}
test('scientific evaluation and teacher phases require honest evidence without fake model or training updates',async()=>{
 for(const kind of ['evaluation','teacher']){const f=await fixture(kind);assert.equal(await verifyResult(f.result,f.args),f.result);}
});
test('unfinished evaluation remains unfinished and cannot be reported completed',async()=>{
 const f=await fixture('evaluation','unfinished');await verifyResult(f.result,f.args);
 f.result.completedWorkIds=['one'];await assert.rejects(verifyResult(f.result,f.args),/completed work differs/);
});
test('candidate lock and exact scientific execution identity are checked',async()=>{
 const f=await fixture();f.result.execution=structuredClone(f.result.execution);delete f.result.execution.scientific.candidateSha256;
 await assert.rejects(verifyResult(f.result,f.args),/execution identity mismatch/);
});

test('a declared complete flag cannot promote unfinished scientific work',async()=>{const f=await fixture('evaluation','unfinished');f.result.allWorkComplete=true;await assert.rejects(verifyResult(f.result,f.args),/completion differs/);});

test('teacher refresh binds its actual policy artifact rather than an unrelated checksum',async()=>{const f=await fixture('teacher','complete','refresh');await verifyResult(f.result,f.args);f.result.policyRefreshSha256='0'.repeat(64);await assert.rejects(verifyResult(f.result,f.args),/policy output binding/);});
