import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareNumeric, verifyCurrentCorpus } from '../bootstrap-proof.mjs';

test('all 1000 frozen state hashes, encodings and legal masks are checked', async () => {
  let familyId;
  for (let i=0; ;i++) {
    const candidate = `family-${i}`, bucket = parseInt(createHash('sha256').update(candidate).digest('hex').slice(0,8),16)%100;
    if (bucket >= 80 && bucket < 90) { familyId=candidate;break; }
  }
  const corpus = {kind:'export-validation',states:Array.from({length:1000},(_,i)=>({
    id:String(i),hash:`h${i}`,state:{index:i},encoded:[i],legal:[i],familyId,partition:'validation',
  }))};
  const calls=[];
  const engine={deterministicStateHash:state=>`h${state.index}`,encodeState:state=>[state.index],
    legalActionMap:state=>{calls.push(state.index);return new Map([[state.index,{}]]);}};
  assert.deepEqual(await verifyCurrentCorpus(corpus,engine),{passed:true,states:1000});
  assert.equal(calls.length,1000);assert.equal(calls.at(-1),999);
  for (const field of ['hash','encoded','legal']) {
    const changed=structuredClone(corpus);changed.states[999][field]=field==='hash'?'changed':[-1];
    await assert.rejects(verifyCurrentCorpus(changed,engine));
  }
  await assert.rejects(verifyCurrentCorpus({...corpus,states:corpus.states.slice(0,20)},engine));
});

test('browser numeric proof requires 1000 exact IDs/masks and the existing tolerance', () => {
  const policy=Array(2801).fill(.1);
  const states=Array.from({length:1000},(_,i)=>({id:String(i),legal:[0,2800],policyLogits:policy,value:.5}));
  const reference={referenceDevice:'mps',modelSha256:'model',corpusSha256:'corpus',states};
  const actual={modelVersion:'model',threads:1,results:states};
  assert.equal(compareNumeric(reference,actual).numericParityPassed,true);
  assert.throws(()=>compareNumeric(reference,{...actual,results:states.slice(0,20)}));
  for (const change of [{id:'wrong'},{legal:[0]},{value:.51},{value:NaN},{policyLogits:policy.slice(1)}]) {
    const results=[...states];results[999]={...states[999],...change};
    assert.throws(()=>compareNumeric(reference,{...actual,results}));
  }
  const results=[...states];results[999]={...states[999],value:.500001};
  assert.equal(compareNumeric(reference,{...actual,results}).numericParityPassed,true);
});
