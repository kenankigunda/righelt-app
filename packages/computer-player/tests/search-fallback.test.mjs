import test from "node:test";
import assert from "node:assert/strict";
import { core } from "./search-graph-helper.mjs";

const evaluate=(preferences={})=>async()=>{const policyLogits=new Float32Array(2801);for(const [index,value]of Object.entries(preferences))policyLogits[index]=value;return {policyLogits,value:.375};};
const run=(graph,preferences={},request={})=>{core.configure(graph);return core.selectMove({state:core.start(),seed:7,simulations:1,...request},evaluate(preferences));};
function masked(result,reason) {
  assert.equal(result.status,'ready');assert.equal(result.reason,'model-fallback');
  assert.equal(result.policyMask,false);assert.deepEqual(result.policy,[]);
  assert.equal(result.fallback.schemaVersion,1);assert.equal(result.fallback.reason,reason);
  assert.equal(result.fallback.selectionBasis,'model-policy');assert.equal(result.fallback.valueSource,'root-model');
  assert.equal(result.value,.375);assert.equal(result.simulations,0);
  assert.ok(result.actions.every(a=>a.visits===0&&a.value===null));
}

test('candidate-local enumeration failure leaves a checked alternative available without retrying failed operation',async()=>{
  const result=await run({root:{actions:[{index:1,to:'expensive'},{index:2,to:'safe'}]},expensive:{controller:'P2',legalLimit:true},safe:{controller:'P2',actions:[{index:3,to:'leaf'}]},leaf:{}},{1:10});
  assert.equal(result.status,'ready');assert.equal(result.actionIndex,2);assert.equal(result.reason,'search');
  assert.equal(result.actions.find(a=>a.index===1).immediate,'incomplete');
  assert.equal(result.actions.find(a=>a.index===2).immediate,'eligible');
  assert.equal(core.calls.get('legal:expensive'),1);assert.equal(result.policyMask,true);assert.equal(result.fallback,null);
  assert.ok(result.nodes<=2048);assert.equal(result.engineBudget.peakExpansions,16384);
});

test('candidate-local transition failure cannot hide a later immediate win',async()=>{
  const result=await run({root:{actions:[{index:1,to:'unused',limit:true},{index:2,to:'won'}]},won:{terminal:1}},{1:100});
  assert.equal(result.reason,'immediate-win');assert.equal(result.actionIndex,2);
  assert.equal(core.calls.get('transition:root:1'),1);assert.equal(result.fallback,null);
});

test('executable losing move is a masked last resort when other transitions cannot finish',async()=>{
  const result=await run({root:{actions:[{index:1,to:'lost'},{index:2,to:'a',limit:true},{index:3,to:'b',limit:true}]},lost:{terminal:-1}},{1:100,2:3,3:2});
  assert.equal(result.status,'ready');assert.equal(result.actionIndex,1);
  assert.equal(result.reason,'model-fallback');assert.equal(result.policyMask,false);
  assert.equal(result.fallback.selectedActionSafety,'losing');assert.equal(result.fallback.schemaVersion,2);
  assert.equal(core.calls.get('transition:root:2'),1);
});

test('checked same-controller alternative with interrupted first visit uses search-incomplete fallback',async()=>{
  const result=await run({root:{actions:[{index:1,to:'continuation'}]},continuation:{legalLimit:true}},{1:1});
  masked(result,'search-incomplete');assert.equal(result.fallback.selectedActionSafety,'eligible');
  assert.equal(result.fallback.checkedEligibleCount,1);assert.equal(result.fallback.uncheckedCount,0);
  // First visit and tactical proof cannot repeat the failed enumeration.
  assert.equal(core.calls.get('legal:continuation'),1);
});

test('all profiles use highest-prior fallback with reproducible exact ties',async()=>{
  const graph={root:{actions:[{index:1,to:'a'},{index:2,to:'b'},{index:3,to:'c'}]},a:{controller:'P2',legalLimit:true},b:{controller:'P2',legalLimit:true},c:{controller:'P2',legalLimit:true}};
  for(const temperature of [1,.5,.1,0]){
    const result=await run(graph,{1:3,2:3,3:2},{temperature});const repeated=await run(graph,{1:3,2:3,3:2},{temperature});
    masked(result,'safety-incomplete');assert.ok([1,2].includes(result.actionIndex));assert.equal(result.actionIndex,repeated.actionIndex);
  }
});

test('fallback never changes all-proven-losing handling',async()=>{
  const result=await run({root:{actions:[{index:1,to:'lost'},{index:2,to:'lost'}]},lost:{terminal:-1}},{2:4});
  assert.equal(result.reason,'unavoidable-loss');assert.equal(result.actionIndex,2);assert.equal(result.fallback,null);
});

test('root enumeration failure cannot produce a model fallback or partial legal list',async()=>{
  core.configure({root:{legalLimit:true,actions:[{index:1,to:'leaf'}]},leaf:{}});let evaluated=false;
  const result=await core.selectMove({state:core.start(),seed:1},async()=>{evaluated=true;return evaluate()();});
  assert.equal(result.status,'recovery');assert.equal(evaluated,false);assert.deepEqual(result.actions,[]);
});

test('global tree cap and deadline remain global; invalid output and cancellation cannot fall back',async()=>{
  const graph={root:{actions:[{index:1,to:'a'},{index:2,to:'b'}]},a:{controller:'P2',legalLimit:true,actions:[{index:4,to:'leaf'}]},b:{controller:'P2',legalLimit:true,actions:[{index:4,to:'leaf'}]},leaf:{}};
  const limited=await run(graph,{2:5},{maxNodes:1});masked(limited,'safety-incomplete');assert.equal(limited.nodes,1);assert.equal(limited.actionIndex,2);
  const expired=await run(graph,{}, {deadlineMs:0});assert.equal(expired.status,'recovery');assert.equal(expired.stopped,'deadline');
  core.configure(graph);await assert.rejects(core.selectMove({state:core.start(),seed:1},async()=>({policyLogits:new Float32Array(2801),value:NaN})),/Invalid model/);
  const control=new AbortController();core.configure(graph);
  await assert.rejects(core.selectMove({state:core.start(),seed:1,signal:control.signal},async()=>{control.abort();return evaluate()();}),{name:'AbortError'});
});


test('fallback ranking preserves model order when excluded dominant logits underflow every remaining prior',async()=>{
  const result=await run({root:{actions:[{index:1,to:'lost'},{index:2,to:'a'},{index:3,to:'b'}]},lost:{terminal:-1},a:{controller:'P2',legalLimit:true},b:{controller:'P2',legalLimit:true}},{1:1000,2:-1001,3:-1000});
  masked(result,'safety-incomplete');assert.equal(result.actionIndex,3);
  assert.equal(result.actions.find(a=>a.index===2).prior,0);assert.equal(result.actions.find(a=>a.index===3).prior,0);
  assert.equal(result.actions.find(a=>a.index===2).policyLogit,-1001);
  assert.equal(result.actions.find(a=>a.index===3).policyLogit,-1000);
});

test('post-root deadline returns a masked root estimate, but post-root cancellation still rejects',async()=>{
  const graph={root:{actions:[{index:1,to:'continuation'}]},continuation:{}};
  core.configure(graph);let evaluated=0;const request={state:core.start(),seed:9};
  const deadline=await core.selectMove(request,async()=>{if(++evaluated===2)request.deadlineMs=0;return evaluate()();});
  masked(deadline,'search-incomplete');assert.equal(deadline.stopped,'deadline');
  core.configure(graph);evaluated=0;const control=new AbortController();
  await assert.rejects(core.selectMove({state:core.start(),seed:9,signal:control.signal},async()=>{if(++evaluated===2)control.abort();return evaluate()();}),{name:'AbortError'});
});

test('partial root retains later cheap legal candidates without claiming an unavoidable loss',async()=>{
  const result=await run({root:{actions:[{index:1,to:'lost'},{index:2,to:'unknown',legalLimit:true},{index:3,to:'safe'}]},lost:{terminal:-1},safe:{controller:'P2',actions:[]}},{3:5});
  assert.equal(result.status,'ready');assert.equal(result.actionIndex,3);
  assert.equal(result.legality.complete,false);assert.deepEqual(result.legality.indices,[1,3]);
  assert.equal(result.fallback.reason,'legality-incomplete');assert.equal(result.fallback.schemaVersion,2);
  assert.equal(result.policyMask,false);assert.deepEqual(result.policy,[]);
  const losing=await run({root:{actions:[{index:1,to:'lost'},{index:2,to:'unknown',legalLimit:true}]},lost:{terminal:-1}});
  assert.equal(losing.status,'ready');assert.equal(losing.reason,'model-fallback');
  assert.equal(losing.fallback.selectedActionSafety,'losing');
});

test('fallback skips an action whose authoritative transition cannot finish',async()=>{
  const result=await run({root:{actions:[{index:1,to:'blocked',limit:true},{index:2,to:'legal'}]},legal:{controller:'P2',legalLimit:true}},{1:10,2:5});
  assert.equal(result.status,'ready');assert.equal(result.actionIndex,2);
  assert.equal(result.actions.find(a=>a.index===1).executable,false);
  assert.equal(result.nextState.key,'legal');assert.equal(core.calls.get('transition:root:1'),1);
});


test('root soft cutoff reports unvisited candidates and reserves executable fallback work',async()=>{
  const request={seed:7,deadlineMs:performance.now()+10000};
  core.configure({root:{actions:[{index:1,to:'safe'},
    {index:2,to:'unknown',onValidate:()=>{request.deadlineMs=performance.now()+100;}},
    {index:3,to:'unknown'}]},safe:{}});
  request.state=core.start();
  const result=await core.selectMove(request,evaluate({1:5}));
  assert.equal(result.status,'ready');assert.equal(result.actionIndex,1);
  assert.equal(result.legality.complete,false);assert.equal(result.legality.checked,1);
  assert.equal(result.legality.unknown,2);assert.deepEqual(result.legality.indices,[1]);
  assert.equal(result.fallback.reason,'legality-incomplete');assert.equal(result.stopped,'deadline');
  assert.equal(core.calls.has('candidate:3'),false);
});
