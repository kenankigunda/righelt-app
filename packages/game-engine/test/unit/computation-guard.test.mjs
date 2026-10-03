import test from 'node:test';
import assert from 'node:assert/strict';
import { withEngineComputationGuard, checkEngineComputation, buildContinuationSuccessorState,
  isContinuationCompletable, listLegalActions } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';

function recursiveRush() {
  const state=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,4),unit('B','P1',5,5),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)]});
  return buildContinuationSuccessorState(state,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
}

test('recursive continuation expansion stops without returning a false rule answer or poisoning memo',()=>{
  const state=recursiveRush(),original=structuredClone(state),memo=new Map();
  const exhausted=new Error('bounded expansion');let used=0;
  assert.throws(()=>withEngineComputationGuard(expansion=>{
    if(expansion){if(used>=2)throw exhausted;used++;}
  },()=>isContinuationCompletable(state,memo)),error=>error===exhausted);
  assert.equal(used,2);assert.ok(![...memo.values()].includes('visiting'));
  assert.deepEqual(state,original);
  assert.equal(isContinuationCompletable(state,memo),true);
  assert.equal(isContinuationCompletable(state),true);
});

test('interrupted legal enumeration returns no partial list and leaves unguarded authoritative output unchanged',()=>{
  const state=recursiveRush(),expected=listLegalActions(state);let checks=0;
  const deadline=new Error('deadline');let returned=false;
  assert.throws(()=>withEngineComputationGuard(()=>{if(++checks>4)throw deadline;},()=>{
    listLegalActions(state);returned=true;
  }),error=>error===deadline);
  assert.equal(returned,false);assert.deepEqual(listLegalActions(state),expected);
  assert.deepEqual(withEngineComputationGuard(()=>{},()=>listLegalActions(state)),expected);
});

test('nested guards restore outer scope and neither thrown nor Promise-returning operations leak context',async()=>{
  const calls=[];
  withEngineComputationGuard(()=>calls.push('outer'),()=>{
    assert.throws(()=>withEngineComputationGuard(()=>calls.push('inner'),()=>{throw new Error('nested');}),/nested/);
    const begin=calls.length;checkEngineComputation();assert.deepEqual(calls.slice(begin),['outer']);
  });
  const count=calls.length;checkEngineComputation(true);assert.equal(calls.length,count);
  assert.throws(()=>withEngineComputationGuard(()=>calls.push('async'),()=>Promise.resolve()),/synchronous/);
  const after=calls.length;await Promise.resolve();checkEngineComputation(true);assert.equal(calls.length,after);
});
