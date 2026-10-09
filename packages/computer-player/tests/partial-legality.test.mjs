import { replayDecision } from '../../../tools/ai-trainer/decision-replay.mjs';
import { createEngineOperationBudget } from '../../../tools/ai-trainer/engine-operation-budget.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectMove, verifyLegalSubset, transition, encodeAction } from '../src/index.ts';
import { deterministicStateHash, MAX_ENGINE_OPERATION_EXPANSIONS } from '../../game-engine/src/index.ts';
import { decisionProvenance, validateDecisionProvenance } from '../../../tools/ai-trainer/decision-provenance.mjs';
const state=JSON.parse(readFileSync(new URL('./fixtures/partial-root-legality.json',import.meta.url)));
const evaluator=async()=>{const policyLogits=new Float32Array(2801);policyLogits[2800]=5;return{policyLogits,value:.125};};

test('retained root failure yields a verified executable fallback with honest subset provenance',async()=>{
  const before=JSON.stringify(state);
  const result=await selectMove({state,seed:107,deadlineMs:performance.now()+4000},evaluator);
  assert.equal(result.status,'ready');assert.equal(result.legality.complete,false);
  assert.ok(result.legality.indices.length>1);assert.ok(result.legality.unknown>0);
  assert.equal(result.fallback.reason,'legality-incomplete');assert.equal(result.policyMask,false);
  assert.deepEqual(result.policy,[]);assert.ok(result.legality.indices.includes(encodeAction(result.action)));
  verifyLegalSubset(state,result.legality.indices);
  assert.equal(deterministicStateHash(transition(state,result.action)),deterministicStateHash(result.nextState));
  assert.equal(JSON.stringify(state),before);
  assert.ok(result.nodes<=2048);assert.ok(result.engineBudget.peakExpansions<=MAX_ENGINE_OPERATION_EXPANSIONS);
  const record={legal:result.legality.indices,...decisionProvenance(result,'model-fallback-v2')};
  assert.equal(validateDecisionProvenance(record),true);
  const replayRecord={...record,action:result.action,controller:state.sideToMove,
    beforeHash:deterministicStateHash(state),afterHash:deterministicStateHash(result.nextState)};
  const budget=createEngineOperationBudget('replay',2048,()=>{});
  assert.equal(deterministicStateHash(replayDecision(state,replayRecord,budget.bounded)),replayRecord.afterHash);
  assert.throws(()=>replayDecision(state,{...replayRecord,afterHash:'tampered'},budget.bounded),/after-state/);
  assert.throws(()=>replayDecision(state,{...replayRecord,controller:state.sideToMove==='P1'?'P2':'P1'},budget.bounded),/controller/);
  const forged={...replayRecord,legal:[2799],legality:{...record.legality,indices:[2799]}};
  assert.throws(()=>replayDecision(state,forged,budget.bounded),/Unknown|Illegal/);
  assert.throws(()=>validateDecisionProvenance({...record,policyMask:true}),/mask|fallback/i);
  assert.throws(()=>validateDecisionProvenance({...record,legality:{...record.legality,complete:true}}),/legality/i);
  assert.throws(()=>verifyLegalSubset(state,[2799]),/Unknown|Illegal/);
});

test('partial-root fallback never survives cancellation or invalid model output',async()=>{
  const controller=new AbortController();
  await assert.rejects(selectMove({state,seed:2,signal:controller.signal},async()=>{controller.abort();return evaluator();}),{name:'AbortError'});
  await assert.rejects(selectMove({state,seed:2},async()=>({policyLogits:new Float32Array(2801),value:Infinity})),/Invalid model/);
});
