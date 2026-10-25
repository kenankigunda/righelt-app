import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentModelContract} from '../source-contract.mjs';
const declaration = (id='initial-1554') => `export const CURRENT_COMPUTER_MODEL=Object.freeze({id:'${id}',sha256:'${'a'.repeat(64)}',bytes:411327,checkpoint:'${'b'.repeat(64)}',url:'/computer/models/${id}.onnx',experimental:true});`;
test('current model is read statically from the authoritative literal, including promoted IDs',()=>{
 for(const id of ['initial-1554','trained-2026-10']) {
  const model=currentModelContract(declaration(id)+`\nthrow Error('candidate must never execute');`);
  assert.equal(model.id,id);assert.equal(model.url,`/computer/models/${id}.onnx`);assert.equal(model.bytes,411327);assert.equal(Object.isFrozen(model),true);
 }
});
test('current model fails closed on absent, dynamic, malformed or ambiguous source',()=>{
 const valid=declaration();
 const invalid=['',`// ${valid}`,`function nested(){${valid.replace('export ','')}}`,valid.replace('export const','export let'),valid+valid,
  valid.replace('Object.freeze','factory'),valid.replace('id:\'initial-1554\'','id:choose()'),valid.replace('bytes:411327','bytes:0'),valid.replace('bytes:411327','bytes:1.5'),
  valid.replace('experimental:true','experimental:true,...extra'),valid.replace('experimental:true','experimental:true,unknown:1'),valid.replace('experimental:true','experimental:true,id:\'other\''),
  valid.replace('/computer/models/initial-1554.onnx','https://example.com/model.onnx'),valid.replace('id:\'initial-1554\'','id:123'),valid.replace('a'.repeat(64),'a'.repeat(63))];
 for(const source of invalid) assert.throws(()=>currentModelContract(source),/Unsupported current computer model contract/);
});


test('real computer proof binds decisions to each created game model without an initial-model dependency',async()=>{
 const source=await readFile(new URL('../computer-proof.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/initial-1554/);
 assert.match(source,/assert\.equal\(initial\.computer\.modelId, capabilities\.currentComputerModel\.id\)/);
 assert.match(source,/move\.computerProof\?\.modelId === initial\.computer\.modelId/);
 assert.match(source,/assert\.equal\(decision\.computerProof\.modelId, initial\.computer\.modelId\)/);
 assert.match(source,/assert\.equal\(branched\.computer\.modelId, capabilities\.currentComputerModel\.id\)/);
 assert.match(source,/assert\.equal\(finished\.moves\.at\(-1\)\.computerProof\?\.modelId, branched\.computer\.modelId\)/);
 assert.match(source,/assert\.equal\(fresh\.computer\.modelId, capabilities\.currentComputerModel\.id\)/);
});
