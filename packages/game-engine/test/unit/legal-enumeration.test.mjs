import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, buildContinuationSuccessorState, enumerateLegalActions, legalActionCandidates,
  listLegalActions, validateAction, withEngineComputationGuard } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';
import { bruteLegalActions } from '../helpers/brute-legal-actions.mjs';

function normal(pieces = []) {
  return makeState({pieces:[commander('C1','P1',0,9),commander('C2','P2',9,0),...pieces]});
}

test('geometry preserves complete membership and order across every board square and both controllers', () => {
  for (const owner of ['P1','P2']) for (let row=0;row<10;row++) for (let col=0;col<10;col++) {
    // A single commander exercises bounds and all shape families without long
    // continuation trees obscuring a geometry regression.
    const state=makeState({sideToMove:owner,pieces:[commander(owner==='P1'?'C1':'C2',owner,row,col)]});
    const original=structuredClone(state);
    assert.deepEqual(listLegalActions(state),bruteLegalActions(state),`${owner}:${row},${col}`);
    assert.ok([...legalActionCandidates(state)].length <= 21);
    assert.deepEqual(state,original);
  }
});

test('enumeration preserves piece order, occupancy, inactive state and frozen continuation eligibility', () => {
  const states=[
    normal([unit('Z','P1',4,4),unit('A','P1',4,5,{commanded:false}),unit('E','P2',5,4)]),
    normal([unit('A','P1',0,8,{supplied:false}),unit('E','P2',1,8)]),
  ];
  const rushed=normal([unit('A','P1',4,4),unit('B','P1',5,5),unit('E','P2',4,2)]);
  const successor=buildContinuationSuccessorState(rushed,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  successor.pieces.find(piece=>piece.id==='B').commanded=false;
  successor.pieces.find(piece=>piece.id==='B').supplied=false;
  states.push(successor);
  for(const state of states){
    const original=structuredClone(state);
    assert.deepEqual(listLegalActions(state),bruteLegalActions(state));
    assert.deepEqual(enumerateLegalActions(state).actions,bruteLegalActions(state));
    assert.equal(enumerateLegalActions(state).complete,true);
    assert.deepEqual(state,original);
  }
});

test('push overlap, retreat ordering and follow group filtering retain complete-list semantics', () => {
  const state=normal([unit('A1','P1',4,1),unit('A2','P1',3,1),unit('D','P2',4,2)]);
  const pushed=applyAction(state,{type:'push',actorId:'A1',from:{row:4,col:1},to:{row:4,col:2}}).state;
  assert.equal(pushed.pieces.filter(piece=>piece.position.row===4&&piece.position.col===2).length,2);
  assert.deepEqual(listLegalActions(pushed),bruteLegalActions(pushed));
  for(const retreat of bruteLegalActions(pushed)){
    const follow=applyAction(pushed,retreat).state;
    assert.deepEqual(listLegalActions(follow),bruteLegalActions(follow));
  }
  assert.deepEqual(listLegalActions({...state,outcome:{status:'p1_win'}}),[]);
  assert.deepEqual(enumerateLegalActions({...state,outcome:{status:'p1_win'}}),{actions:[],results:[],complete:true});
});

test('unknown candidate evidence retains alternatives and cannot claim completeness', () => {
  const state=normal(),complete=listLegalActions(state), observed=[];
  const missing=complete.find(action=>action.type==='move');
  const result=enumerateLegalActions(state,{
    validate:(s,action)=>JSON.stringify(action)===JSON.stringify(missing)?undefined:validateAction(s,action),
    onResult:evidence=>observed.push(evidence),
  });
  assert.equal(result.complete,false);
  assert.equal(result.results.filter(item=>item.status==='unknown').length,1);
  assert.deepEqual(result.actions,complete.filter(action=>JSON.stringify(action)!==JSON.stringify(missing)));
  assert.deepEqual(observed,result.results);
  assert.ok(result.results.some(item=>item.status==='illegal'));
});

test('candidate-local interruption can be classified unknown, while global cancellation propagates with earlier evidence intact', () => {
  const state=normal([unit('A','P1',4,4),unit('E','P2',4,2)]),limit=new Error('candidate limit');
  const bounded=enumerateLegalActions(state,{validate:(s,action)=>{
    try{return withEngineComputationGuard(expansion=>{if(expansion)throw limit;},()=>validateAction(s,action));}
    catch(error){if(error===limit)return undefined;throw error;}
  }});
  assert.equal(bounded.complete,false);
  assert.ok(bounded.actions.some(action=>action.type==='pass'));
  assert.ok(bounded.results.some(item=>item.status==='unknown'));
  const before=[],cancel=new Error('cancel');let calls=0;
  assert.throws(()=>enumerateLegalActions(state,{
    validate:(s,action)=>{if(++calls===3)throw cancel;return validateAction(s,action);},
    onResult:evidence=>before.push(evidence),
  }),error=>error===cancel);
  assert.equal(before.length,2);
  assert.equal(before[0].status,'legal');
  // The original API remains all-or-nothing even if one candidate was known.
  assert.throws(()=>withEngineComputationGuard(expansion=>{if(expansion)throw limit;},()=>listLegalActions(state)),error=>error===limit);
});

test('candidate generation never enters recursive validation', () => {
  const state=normal([unit('A','P1',4,4),unit('E','P2',4,2)]);
  const candidates=withEngineComputationGuard(expansion=>{if(expansion)throw new Error('recursive validation called');},()=>[
    ...legalActionCandidates(state),
  ]);
  assert.ok(candidates.some(action=>action.type==='rush'));
});
