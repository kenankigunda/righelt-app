import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticEndingCorpus} from '../helpers/automatic-ending-corpus.mjs';
import {proveRelevantContinuation} from '../../src/early-ending-proof.ts';

for(const entry of automaticEndingCorpus())test(`${entry.name}: cached and uncached proof preserve the answer and input`,()=>{
 const before=structuredClone(entry.state);
 const cached=proveRelevantContinuation(entry.state,'P1',entry.options);
 const uncached=proveRelevantContinuation(entry.state,'P1',{...entry.options,cache:false});
 assert.equal(cached.kind,entry.expected);
 assert.equal(uncached.kind,cached.kind);
 assert.deepEqual(cached.witness,uncached.witness);
 assert.deepEqual(cached.candidateOutcome,uncached.candidateOutcome);
 assert.deepEqual(entry.state,before);
 if(entry.outcome){assert.equal(cached.candidateOutcome.status,entry.outcome);assert.equal(cached.settlement.frame.occupancy.outcome.status,entry.outcome);}
 if(entry.name==='wide winning rush'){
  assert.equal(cached.endpointCount,1);assert.equal(cached.optionalEndpointCount,0);
  assert.equal(cached.visitedNodes,2);assert.equal(cached.settlementCalls,2);
  assert.equal(cached.rootLegalActions,undefined,'ordinary callers pay no diagnostic action enumeration');
  cached.settlement.frame.occupancy.pieces[0].position.row=99;
  assert.deepEqual(entry.state,before,'returned settlement never aliases input');
  assert.equal(proveRelevantContinuation(entry.state,'P1',{maxExpansions:1}).kind,'unknown');
  assert.equal(proveRelevantContinuation(entry.state,'P1').kind,'proven-terminal','interruption cannot poison a later proof');
 }
});
