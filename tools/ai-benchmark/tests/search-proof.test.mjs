import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSearchParity } from '../search-proof.mjs';
function fixture() {
  const row = { id: 'held-out', seed: 7, result: { status: 'ready', stopped: 'complete', simulations: 8, actionIndex: 1, reason: 'search', policyMask: true, fallback: null,
    actions: [{ index: 1, visits: 4, value: .1, immediate: 'eligible', tactical: 'horizon' },
      { index: 2, visits: 4, value: .100001, immediate: 'eligible', tactical: 'horizon' }] } };
  return [{ complete: true, modelSha256: 'model', referenceDevice: 'mps', states: [row] },
    { modelVersion: 'model', results: [structuredClone(row)] }];
}
test('ready moves from deadline-censored work cannot establish parity', () => {
  const [reference, actual] = fixture();
  reference.states[0].result.stopped = 'deadline';
  assert.throws(() => compareSearchParity(reference, actual), /deadline-censored/);
});
test('bounded visited ties are distinct from unvisited or materially different choices', () => {
  const [reference, actual] = fixture(); actual.results[0].result.actionIndex = 2;
  assert.equal(compareSearchParity(reference, actual).nearTies, 1);
  reference.states[0].result.actions[1].visits = 0;
  assert.throws(() => compareSearchParity(reference, actual), /unvisited/);
  reference.states[0].result.actions[1].visits = 4;reference.states[0].result.actions[1].value = .3;
  assert.throws(() => compareSearchParity(reference, actual), /numerical bound/);
});


function fallbackFixture(reason = 'safety-incomplete') {
  const [reference, actual] = fixture();
  const result=reference.states[0].result;
  Object.assign(result,{reason:'model-fallback',policyMask:false,policy:[],value:.25,simulations:0,stopped:'node-limit',
    fallback:{schemaVersion:1,reason,selectionBasis:'model-policy',selectedActionSafety:reason==='search-incomplete'?'eligible':'incomplete',
      valueSource:'root-model',checkedEligibleCount:reason==='search-incomplete'?2:0,uncheckedCount:reason==='search-incomplete'?0:2,provenLosingCount:0}});
  result.actions=result.actions.map((action,index)=>({...action,visits:0,value:null,policyLogit:index===0?1:.999999,
    immediate:reason==='search-incomplete'?'eligible':'incomplete',tactical:'incomplete'}));
  actual.results[0]=structuredClone(reference.states[0]);
  return [reference,actual];
}

test('matching explicit fallbacks verify parity without claiming completed safety or phone acceptance',()=>{
  for(const reason of ['search-incomplete','safety-incomplete']){
    const [reference,actual]=fallbackFixture(reason);const report=compareSearchParity(reference,actual);
    assert.equal(report.fallbackStates,1);assert.equal(report.nearTies,0);assert.equal(report.acceptancePassed,false);
  }
});

test('fallback provenance, masks, policy targets and safety counts must agree exactly',()=>{
  const mutations=[
    result=>result.policyMask=true,
    result=>result.policy=[{index:1,probability:1}],
    result=>result.fallback.valueSource='search',
    result=>result.fallback.schemaVersion=2,
    result=>result.fallback.selectedActionSafety='eligible',
    result=>result.fallback.checkedEligibleCount=1,
    result=>result.fallback.uncheckedCount=-1,
    result=>result.fallback.extra='unknown',
    result=>result.actions[0].visits=1,
    result=>result.actions[0].value=.25,
    result=>result.fallback=null,
  ];
  for(const mutate of mutations){const [reference,actual]=fallbackFixture();mutate(actual.results[0].result);assert.throws(()=>compareSearchParity(reference,actual));}
  const [reference,actual]=fixture();delete actual.results[0].result.policyMask;assert.throws(()=>compareSearchParity(reference,actual),/provenance/);
});

test('fallback root value and raw logits obey numerical export bounds',()=>{
  const [reference,actual]=fallbackFixture();actual.results[0].result.value+=.000001;
  assert.equal(compareSearchParity(reference,actual).fallbackStates,1);
  actual.results[0].result.value=.5;assert.throws(()=>compareSearchParity(reference,actual),/root value/);
  actual.results[0].result.value=.25;actual.results[0].result.actions[0].policyLogit=2;
  assert.throws(()=>compareSearchParity(reference,actual),/raw policy logits/);
  actual.results[0].result.actions[0].policyLogit=NaN;assert.throws(()=>compareSearchParity(reference,actual),/raw policy/);
});

test('fallback numerical near-ties use raw ranking in both runtimes, not visited values',()=>{
  const [reference,actual]=fallbackFixture();actual.results[0].result.actionIndex=2;
  // Observed runtime must really rank its own choice first.
  assert.throws(()=>compareSearchParity(reference,actual),/highest model logit/);
  actual.results[0].result.actions[1].policyLogit=1.000001;
  assert.equal(compareSearchParity(reference,actual).nearTies,1);
  reference.states[0].result.actions[1].policyLogit=.9;
  assert.throws(()=>compareSearchParity(reference,actual),/numerical bound/);
});

test('equal seeded tie sets require identical fallback selection',()=>{
  const [reference,actual]=fallbackFixture();
  reference.states[0].result.actions[1].policyLogit=1;actual.results[0].result.actions[1].policyLogit=1;
  actual.results[0].result.actionIndex=2;
  assert.throws(()=>compareSearchParity(reference,actual),/seeded exact-tie/);
});

test('underflowed priors cannot make distinct fallback logits look tied',()=>{
  const [reference,actual]=fallbackFixture();
  for(const result of [reference.states[0].result,actual.results[0].result]){
    result.actions[0].policyLogit=-1000;result.actions[1].policyLogit=-1001;
    result.actions[0].prior=0;result.actions[1].prior=0;
  }
  assert.equal(compareSearchParity(reference,actual).nearTies,0);
  actual.results[0].result.actionIndex=2;
  assert.throws(()=>compareSearchParity(reference,actual),/highest model logit/);
  actual.results[0].result.actions[0].policyLogit=-1001;actual.results[0].result.actions[1].policyLogit=-1000;
  assert.throws(()=>compareSearchParity(reference,actual),/numerical bound/);
});

test('fallback cannot select a proven immediate loss or a tactically excluded checked action',()=>{
  const [reference,actual]=fallbackFixture('search-incomplete');
  for(const result of [reference.states[0].result,actual.results[0].result])result.actions[0].tactical='proven-loss';
  assert.throws(()=>compareSearchParity(reference,actual),/selection evidence/);
  const pair=fallbackFixture();
  for(const result of [pair[0].states[0].result,pair[1].results[0].result]){
    result.actions[0].immediate='losing';result.fallback.uncheckedCount=1;result.fallback.provenLosingCount=1;
  }
  assert.throws(()=>compareSearchParity(...pair),/selection evidence/);
});
