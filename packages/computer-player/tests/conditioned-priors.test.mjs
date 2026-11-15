import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionedRootPriors} from '../src/root-priors.ts';
import {applyRootExploration,explorationEvidence,trainingRecipe} from '../src/exploration.ts';
import {createInitialState,resolveToStability,validateAction} from '../../game-engine/src/index.ts';
import {selectMove} from '../src/search.ts';
import {SEARCH_POLICY_VERSION} from '../src/search.ts';
import {decisionProvenance,validateDecisionProvenance} from '../../../tools/ai-trainer/decision-provenance.mjs';

const items=[{index:1,policyLogit:0},{index:2,policyLogit:-3},{index:6,policyLogit:-6}];
const expected=[0.9503302116973793,0.04731415522182404,0.0023556330807966807];
const close=(a,b)=>assert(Math.abs(a-b)<1e-14);
test('one completed first visit records zero optional PUCT selections and remains replay-admissible',async()=>{
 const state=resolveToStability(createInitialState());
 for(const simulations of [1,8]){
  const r=await selectMove({state,seed:7,simulations,maxNodes:2048,onProgress:simulations===1?undefined:()=>{}},async()=>({policyLogits:new Float32Array(2801),value:0}));
  const record=decisionProvenance(r,SEARCH_POLICY_VERSION);assert.equal(validateDecisionProvenance(record),true);
  assert.equal(r.rootPriorConditioning.puctSelections,simulations-1);
  const altered=structuredClone(record);delete altered.search.rootPriorConditioning;assert.throws(()=>validateDecisionProvenance(altered),/Missing/);
 }
});
test('root conditioning preserves small eligible differences after partial or total underflow',()=>{
 for(const rejectedLogit of [0,3,6,740,744,745,746,1000]){
  // This rejected action is deliberately absent from the admitted set.
  const legal=[...items,{index:3,policyLogit:rejectedLogit}],admitted=legal.filter(x=>x.index!==3);
  const p=conditionedRootPriors(admitted);expected.forEach((value,i)=>close(p.get(items[i].index),value));assert(!p.has(3));
 }
 assert.deepEqual([...conditionedRootPriors([])],[]);
 assert.deepEqual([...conditionedRootPriors(items.slice(1,2))],[[2,1]]);
 const later=conditionedRootPriors(items.filter(x=>x.index!==1));close(later.get(2),0.9525741268224334);close(later.get(6),0.04742587317756679);
});

test('same seeded noise mixes with stable eligible logits and keeps raw underflow receipts honest',async()=>{
 for(const gap of [6,744,745,1000]){
  const actions=items.map(x=>({...x,prior:Math.exp(x.policyLogit-gap)/(1+items.reduce((s,x)=>s+Math.exp(x.policyLogit-gap),0))}));
  const e=explorationEvidence({purpose:'self-play',recipe:trainingRecipe('root-dirichlet-v1')},7),base=conditionedRootPriors(items);
  const mixed=await applyRootExploration(e,actions,127,true,undefined,base);
  assert(e.applied);assert.deepEqual(e.rawPriors,actions.map(x=>x.prior));assert.equal(e.selectionConditioning.version,'eligible-logits-v1');
  close([...mixed.values()].reduce((a,b)=>a+b,0),1);
  assert(mixed.get(2)>0&&mixed.get(6)>0);
  const after=conditionedRootPriors(items.slice(1),mixed);close([...after.values()].reduce((a,b)=>a+b,0),1);assert(!after.has(1));
 }
});

test('actual rules search records conditioned root selection for both seats with noise enabled and disabled',async()=>{
 for(const seat of ['P1','P2'])for(const noise of [false,true]){
  const state=resolveToStability(createInitialState());state.sideToMove=seat;
  const r=await selectMove({state,seed:7,simulations:8,maxNodes:2048,...(noise?{rootExploration:{purpose:'self-play',recipe:trainingRecipe('root-dirichlet-v1')}}:{})},async()=>({policyLogits:new Float32Array(2801),value:0}));
  assert.equal(r.status,'ready');assert.equal(r.reason,'search');assert(validateAction(state,r.action).ok);assert.equal(r.simulations,8);
  assert.equal(r.rootPriorConditioning.version,'eligible-logits-v1');close(r.rootPriorConditioning.priors.reduce((a,b)=>a+b,0),1);
  assert(r.rootPriorConditioning.indices.every(i=>r.actions.some(a=>a.index===i&&a.immediate==='eligible'&&a.tactical!=='proven-loss')));
  if(noise){assert.equal(r.rootExploration.applied,true);assert.equal(r.rootExploration.selectionConditioning.version,'eligible-logits-v1');}else assert.equal(r.rootExploration,undefined);
 }
});
