import test from 'node:test';
import assert from 'node:assert/strict';
import { withEngineComputationGuard, checkEngineComputation, buildContinuationSuccessorState,
  isContinuationCompletable, listLegalActions, withEngineComputationObserver,
  isEngineComputationObserved, observeEngineComputation } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';

function recursiveRush(b = { row: 5, col: 5 }) {
  const state=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,4),unit('B','P1',b.row,b.col),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)]});
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


test('completion stops constructing siblings once the first successful branch is found',()=>{
  // Eager sibling materialization previously consumed seven expansions here.
  // Authoritative depth-first order reaches the same true answer within five.
  const state=recursiveRush({row:5,col:3}), original=structuredClone(state);
  let expansions=0;
  const result=withEngineComputationGuard(expansion=>{
    if(expansion && ++expansions>5)throw new Error('constructed unused sibling');
  },()=>isContinuationCompletable(state));
  assert.equal(result,true);assert.equal(expansions,5);assert.deepEqual(state,original);
});

test('optional diagnostics distinguish expansions, unique keys, memo reuse and candidate outcomes without changing answers',()=>{
  const state=recursiveRush(),memo=new Map(),events=[];
  const observed=withEngineComputationObserver(event=>events.push(event),()=>{
    assert.equal(isContinuationCompletable(state,memo),true);
    assert.equal(isContinuationCompletable(state,memo),true);
    return listLegalActions(state);
  });
  assert.deepEqual(observed,listLegalActions(state));
  assert.ok(events.some(event=>event.type==='expansion'));
  assert.ok(events.some(event=>event.type==='successor'));
  assert.ok(events.some(event=>event.type==='continuation-key'));
  assert.ok(events.some(event=>event.type==='memo-hit'));
  assert.ok(events.some(event=>event.type==='candidate-result'&&event.status==='legal'));
  assert.ok(events.some(event=>event.type==='candidate-result'&&event.status==='illegal'));
  assert.equal(events.filter(event=>event.type==='supply-start').length,events.filter(event=>event.type==='supply-end').length);
  assert.equal(isEngineComputationObserved(),false);
});

test('diagnostic observer scopes restore nesting and reject asynchronous contexts',async()=>{
  const calls=[];
  withEngineComputationObserver(()=>calls.push('outer'),()=>{
    assert.equal(isEngineComputationObserved(),true);
    assert.throws(()=>withEngineComputationObserver(()=>calls.push('inner'),()=>{
      observeEngineComputation({type:'successor'});throw new Error('nested');
    }),/nested/);
    assert.deepEqual(calls,['inner','outer']);
    observeEngineComputation({type:'successor'});
    assert.deepEqual(calls,['inner','outer','outer']);
  });
  assert.equal(isEngineComputationObserved(),false);
  assert.throws(()=>withEngineComputationObserver(()=>{},()=>Promise.resolve()),/synchronous/);
  await Promise.resolve();
  assert.equal(isEngineComputationObserved(),false);
  observeEngineComputation({type:'successor'});
  assert.equal(calls.length,3);
});
