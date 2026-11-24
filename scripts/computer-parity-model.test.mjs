import test from 'node:test';
import assert from 'node:assert/strict';
import {computerParityModel,computerParityModelFromArgs} from './computer-parity-model.mjs';

test('default browser proof selects the existing incumbent',()=>{
  assert.equal(computerParityModel().id,'trained-20261029-1086');
});
test('explicit candidate browser proof retains its own immutable identity',()=>{
  const model=computerParityModel('candidate-a-20261120-2323');
  assert.equal(model.id,'candidate-a-20261120-2323');
  assert.equal(model.sha256,'1229c22869d8122a5b3b2add4bdd4e0d0e0dcd82df063cf7ff31b20cab179c0e');
  assert.equal(model.url,'/computer/models/candidate-a-20261120-2323.onnx');
});
test('an unknown requested candidate never substitutes the incumbent',()=>{
  assert.throws(()=>computerParityModel('unpublished-candidate'),/Unknown computer model/);
});
test('command arguments default only when the model flag is absent',()=>{
  assert.equal(computerParityModelFromArgs(['--corpus','states.json']).id,'trained-20261029-1086');
  assert.equal(computerParityModelFromArgs(['--model-id','candidate-a-20261120-2323','--out','proof.json']).id,'candidate-a-20261120-2323');
  for(const args of [['--model-id'],['--model-id','--out','proof.json'],['--model-id',' ']])
    assert.throws(()=>computerParityModelFromArgs(args),/Missing value for --model-id/);
  assert.throws(()=>computerParityModelFromArgs(['--model-id','candidate-a-20261120-2323','--model-id','trained-20261029-1086']),/Duplicate --model-id/);
  assert.throws(()=>computerParityModelFromArgs(['--model-id','unpublished-candidate']),/Unknown computer model/);
});
