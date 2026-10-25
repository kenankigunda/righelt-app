import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createInitialState, listLegalActions, validateAction, resolveToStability } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';

const optionalRush = () => resolveToStability(applyAction(resolveToStability(makeState({
  pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),unit('L','P1',3,3),
    unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)],
})), {type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}}).state);

test('Pass and End Turn are mutually exclusive semantic control actions', () => {
  const untouched = createInitialState();
  assert.equal(validateAction(untouched,{type:'pass'}).ok,true);
  assert.equal(validateAction(untouched,{type:'end_turn'}).ok,false);
  const started = optionalRush();
  assert.equal(started.continuation?.type,'rush');
  assert.equal(validateAction(started,{type:'pass'}).ok,false);
  assert.equal(validateAction(started,{type:'end_turn'}).ok,true);
  assert.deepEqual(listLegalActions(started).filter(a=>!a.from),[{type:'end_turn'}]);
  assert.throws(()=>applyAction(started,{type:'pass'}),/CONTINUATION_REQUIRED/);
});

test('End Turn closes a supplied rush once without mutating the input', () => {
  const state=optionalRush(); state.pieces.find(p=>p.id==='B').shifted=true;
  const original=structuredClone(state), next=resolveToStability(applyAction(state,{type:'end_turn'}).state);
  assert.deepEqual(state,original);
  assert.equal(next.sideToMove,'P2'); assert.equal(next.turnIndex,state.turnIndex+1);
  assert.equal(next.continuation,null); assert.ok(next.pieces.every(p=>!p.shifted));
  assert.deepEqual(resolveToStability(next),next);
});

test('End Turn never bypasses mandatory retreat, follow or unsupplied rush obligations', () => {
  const retreat=makeState({pieces:[commander('C1','P1',0,9),commander('C2','P2',9,0)],
    continuation:{type:'push',owner:'P2',attackerOwner:'P1',phase:'retreat',chainLength:1}});
  const follow=makeState({pieces:[commander('C1','P1',0,9),commander('C2','P2',9,0),unit('A','P1',4,3)],
    continuation:{type:'push',owner:'P1',attackerOwner:'P1',phase:'follow',followPoint:{row:4,col:4},followGroupPieceIds:['A'],chainLength:1}});
  const unsupplied=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,3),unit('B','P1',5,5),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)],
    continuation:{type:'rush',owner:'P1',rushedPieceIds:['A'],rushChainPieceIds:['A'],chainLength:1}});
  for(const state of [retreat,follow,unsupplied]) for(const type of ['pass','end_turn']) {
    assert.equal(validateAction(state,{type}).ok,false,`${state.continuation.type}:${type}`);
    assert.throws(()=>applyAction(state,{type}),/CONTINUATION_REQUIRED/);
  }
});

test('turn controls reject geometry and terminal positions', () => {
  for(const type of ['pass','end_turn']) {
    const state=type==='pass'?createInitialState():optionalRush();
    assert.equal(validateAction(state,{type,actorId:'C1'}).ok,false);
    assert.equal(validateAction(state,{type,from:{row:0,col:9}}).ok,false);
    assert.equal(validateAction({...state,outcome:{status:'p1_win'}},{type}).code,'TERMINAL_GAME');
  }
});
