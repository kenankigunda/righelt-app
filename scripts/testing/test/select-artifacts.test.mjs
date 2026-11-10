import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSuiteArtifacts} from '../select-artifacts.mjs';
const expected={runId:7,headSha:'head'};
const artifact=(attempt,extra={})=>({name:`suite-e2e-2-${attempt}`,created_at:'2026-11-01T09:21:59Z',workflow_run:{id:7,head_sha:'head'},...extra});
test('numeric run attempt wins inverted timestamps and preserves untouched lanes in either order',()=>{
 const old=artifact(1,{created_at:'2026-11-01T09:38:15Z'}),fresh=artifact(2),untouched=artifact(1,{name:'suite-unit-1'});
 for(const input of [[old,fresh,untouched],[fresh,old,untouched]])assert.deepEqual(selectSuiteArtifacts(input,expected),[fresh,untouched]);
 assert.deepEqual(selectSuiteArtifacts([artifact(9),artifact(10)],expected),[artifact(10)]);
});
test('malformed attempts, foreign provenance and duplicate lane attempts fail closed',()=>{
 for(const name of ['suite-e2e-2-zero','suite-e2e-2-0','suite-e2e-2-01','suite-e2e-2-9007199254740992'])assert.throws(()=>selectSuiteArtifacts([artifact(1,{name})],expected));
 assert.throws(()=>selectSuiteArtifacts([artifact(1,{workflow_run:{id:8,head_sha:'head'}})],expected));
 assert.throws(()=>selectSuiteArtifacts([artifact(1,{workflow_run:{id:7,head_sha:'other'}})],expected));
 assert.throws(()=>selectSuiteArtifacts([artifact(1),artifact(1,{created_at:'2026-11-01T09:38:15Z'})],expected));
 assert.throws(()=>selectSuiteArtifacts([artifact(1),artifact(2,{expired:true})],expected));
 assert.throws(()=>selectSuiteArtifacts([artifact(1,{created_at:'invalid'})],expected));
 assert.throws(()=>selectSuiteArtifacts([],{}));
 assert.deepEqual(selectSuiteArtifacts([{name:'unrelated-debug'}],expected),[]);
});
test('a new first attempt never inherits a stale test retry from an older workflow rerun',()=>{
 const a=(testAttempt,workflowAttempt)=>artifact(workflowAttempt,{name:`suite-browser-contract-chromium-1-of-1-attempt-${testAttempt}-${workflowAttempt}`});
 assert.deepEqual(selectSuiteArtifacts([a(1,1),a(2,1),a(1,2)],expected),[a(1,2)]);
 assert.deepEqual(selectSuiteArtifacts([a(1,1),a(2,2)],expected),[a(1,1),a(2,2)]);
});
