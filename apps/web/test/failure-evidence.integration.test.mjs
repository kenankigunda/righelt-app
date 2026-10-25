import test from 'node:test';
import assert from 'node:assert/strict';
import {attachFailureAndRethrow} from '../../../e2e/support/failure-evidence.mjs';

const original=()=>Object.assign(new Error('Session failed: 503'),{code:'session_unavailable'});
test('failure evidence reads DOM once, retains the last verified projection and rethrows the exact operation error',async()=>{
 const error=original(),projection={id:'g',gameplayRevision:4,moves:[{moveId:'accepted'}]},dom={route:'#/game/g',boardMessage:'Babs is thinking'};
 const before=structuredClone(projection),attachments=[];let evaluations=0;
 const page={evaluate:async callback=>{evaluations++;assert.equal(typeof callback,'function');return dom;}};
 await assert.rejects(attachFailureAndRethrow(error,{page,testInfo:{attach:async(name,value)=>attachments.push({name,...value})},lastVerifiedProjection:projection,details:{phase:'play'}}),caught=>caught===error);
 assert.equal(evaluations,1);assert.equal(attachments.length,1);
 const evidence=JSON.parse(attachments[0].body);
 assert.deepEqual(evidence.lastVerifiedProjection,before);assert.deepEqual(projection,before);
 assert.deepEqual(evidence.dom,dom);assert.deepEqual(evidence.details,{phase:'play'});
 assert.equal(evidence.originalError.message,'Session failed: 503');assert.equal(evidence.domCaptureError,null);
});
test('a closed page and failed attachment cannot mask the exact original error',async()=>{
 const error=original();let evaluations=0,attachments=0;
 await assert.rejects(attachFailureAndRethrow(error,{
  page:{evaluate:async()=>{evaluations++;throw Error('Target page has been closed');}},
  testInfo:{attach:async(_name,value)=>{attachments++;const evidence=JSON.parse(value.body);assert.equal(evidence.lastVerifiedProjection,null);assert.equal(evidence.dom,null);assert.match(evidence.domCaptureError,/page has been closed/);throw Error('Reporter closed');}},
 }),caught=>caught===error);
 assert.equal(evaluations,1);assert.equal(attachments,1);
});
test('attachment failure after successful DOM capture still preserves the exact original error',async()=>{
 const error=original();
 await assert.rejects(attachFailureAndRethrow(error,{page:{evaluate:async()=>({route:'#/game/g'})},testInfo:{attach:async()=>{throw Error('Disk unavailable');}}}),caught=>caught===error);
});
