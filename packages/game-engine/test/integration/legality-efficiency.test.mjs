import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAction, buildContinuationSuccessorState, canCloseContinuationNow, listLegalActions,
  normalizeState, resolveToStability, withEngineComputationGuard } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';
import { bruteLegalActions } from '../helpers/brute-legal-actions.mjs';

test('a rush that cannot close stabilizes without searching for optional legal successors',()=>{
  const root=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,4),unit('B','P1',5,5),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)]});
  const rush=buildContinuationSuccessorState(root,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  assert.equal(canCloseContinuationNow(rush),false);
  const expected=resolveToStability(structuredClone(rush));
  const actual=withEngineComputationGuard(expansion=>{
    if(expansion)throw new Error('unnecessary continuation search');
  },()=>resolveToStability(structuredClone(rush)));
  assert.deepEqual(actual,expected);
  assert.equal(actual.continuation?.type,'rush');
  assert.equal(actual.sideToMove,'P1');
  assert.equal(actual.turnIndex,0);
  assert.equal(actual.outcome.status,'ongoing');
  assert.ok(listLegalActions(actual).some(action=>action.type==='rush'));
});

test('closable rush remains optional when a rush is legal and ends exactly once otherwise',()=>{
  const root=makeState({pieces:[commander('C1','P1',0,9),commander('C2','P2',9,0),
    unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)]});
  const open=buildContinuationSuccessorState(root,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  assert.equal(canCloseContinuationNow(open),true);
  const optional=resolveToStability(open);
  assert.equal(optional.continuation?.type,'rush');
  assert.ok(listLegalActions(optional).some(action=>action.type==='end_turn'));
  const noMore=structuredClone(optional);
  noMore.continuation.rushedPieceIds=noMore.pieces.filter(piece=>piece.owner==='P1').map(piece=>piece.id);
  const closed=resolveToStability(noMore);
  assert.equal(closed.continuation,null);
  assert.equal(closed.sideToMove,'P2');
  assert.equal(closed.turnIndex,1);
  assert.deepEqual(resolveToStability(structuredClone(closed)),closed);
});

test('complete action ordering agrees with brute enumeration throughout catalog replays',()=>{
  const catalog=JSON.parse(readFileSync('apps/web/scenarios/catalog.json','utf8'));
  for(const scenario of catalog.scenarios.slice(0,8)){
    let state=resolveToStability(normalizeState(scenario.initialState));
    for(const move of scenario.moves){
      // The catalog records explicit rush endings in the next move's turn index.
      if(state.continuation?.type==='rush'&&move.turnIndex>state.turnIndex){
        state=resolveToStability(applyAction(state,{type:'end_turn'}).state);
      }
      assert.deepEqual(listLegalActions(state),bruteLegalActions(state),scenario.title);
      state=resolveToStability(applyAction(state,move.action).state);
    }
    assert.deepEqual(listLegalActions(state),bruteLegalActions(state),scenario.title);
  }
});

// Production game game-6a7fa3, revision 51, reduced to rules inputs only.
test('mobile End Turn enumerates the complete next turn without exploring a trapped rush', () => {
  const saved = JSON.parse(readFileSync('packages/game-engine/test/fixtures/mobile-end-turn-rush.json', 'utf8'));
  let expansions = 0;
  const next = resolveToStability(applyAction(saved, { type: 'end_turn' }).state);
  const actions = withEngineComputationGuard(expansion => {
    if (expansion && ++expansions > 1000) throw new Error('trapped rush search regressed');
  }, () => listLegalActions(next));
  assert.equal(next.sideToMove, 'P1');
  assert.equal(next.turnIndex, 30);
  assert.equal(next.continuation, null);
  assert.equal(actions.length, 46);
  assert.ok(!actions.some(a => a.type === 'rush' && a.actorId === 'U1-7' && a.to.row === 9 && a.to.col === 0));
  assert.deepEqual(actions, bruteLegalActions(next));
});
