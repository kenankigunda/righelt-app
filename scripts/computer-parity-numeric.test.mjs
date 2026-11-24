import test from 'node:test';
import assert from 'node:assert/strict';
import {numericMarginForModel,assessNumericCell} from './computer-parity-numeric.mjs';
const tolerance={atol:1e-5,rtol:1e-4};
test('minor value exception is explicit and never changes strict classification',()=>{
 assert.equal(assessNumericCell('value',4e-5,0,tolerance).accepted,false);
 const result=assessNumericCell('value',4e-5,0,tolerance,5e-5);
 assert.equal(result.accepted,true);assert.equal(result.strictPassed,false);assert.equal(result.acceptedByOwner,true);
 assert.equal(assessNumericCell('value',6e-5,0,tolerance,5e-5).accepted,false);
 assert.equal(assessNumericCell('policy',4e-5,0,tolerance,5e-5).accepted,false);
 assert.equal(assessNumericCell('value',1.00001,1,tolerance,5e-5).accepted,false);
 for(const value of [NaN,Infinity,-Infinity]){
  assert.equal(assessNumericCell('value',value,0,tolerance,5e-5).accepted,false);
  assert.equal(assessNumericCell('value',0,value,tolerance,5e-5).accepted,false);
 }
});
test('owner exception binds the immutable model identity',()=>{
 const model={id:'candidate',sha256:'a'.repeat(64)},receipt={schema:1,kind:'owner-numeric-margin-release-acceptance',authority:'explicit owner choice',valueAbsoluteErrorMaximum:5e-5,models:[{modelId:model.id,onnxSha256:model.sha256}]};
 assert.equal(numericMarginForModel(receipt,model),5e-5);
 for(const other of [{...model,id:'incumbent'},{...model,sha256:'b'.repeat(64)}])assert.throws(()=>numericMarginForModel(receipt,other));
 assert.throws(()=>numericMarginForModel({...receipt,authority:''},model));
 assert.throws(()=>numericMarginForModel({...receipt,valueAbsoluteErrorMaximum:Infinity},model));
});
