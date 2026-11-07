import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyAction,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {finalizeResolvedTurn,getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';
import {createSequenceStatusProjector} from '../board/sequence-status-preview.js';

const fixture=JSON.parse(readFileSync(new URL('../../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url)));
const duringRush=()=>resolveToStability(applyAction(structuredClone(fixture.initialState),fixture.action).state,{artifactMode:'full'});
const finish=state=>finalizeResolvedTurn({state:structuredClone(state),activeTurn:{index:state.turnIndex,playerSeat:getTurnOwnerSideForState(state)==='P1'?'Player 1':'Player 2'},endedAt:0,resolveToStability}).nextState;

test('sequence status projects real end-turn removals without changing live authority or frozen eligibility',()=>{
 const state=duringRush(),before=structuredClone(state),legal=listLegalActions(state);
 const projected=createSequenceStatusProjector()(state),final=finish(state);
 assert.deepEqual([...projected.destroyedPieceIds].sort(),['U1-2','U1-3']);
 for(const piece of state.pieces){
  const actual=final.pieces.find(row=>row.id===piece.id);
  assert.equal(projected.destroyedPieceIds.has(piece.id),!actual);
  if(actual)assert.deepEqual(projected.statusByPieceId.get(piece.id),{supplied:actual.displaySupplied??actual.supplied,commanded:actual.displayCommanded??actual.commanded});
 }
 assert.deepEqual(state,before);
 assert.deepEqual(listLegalActions(state),legal);
 assert(state.pieces.some(piece=>piece.id==='U1-2'),'the projected loss remains a real piece until End turn');
 assert.equal(projected.destroyedPieceIds.has('U1-4'),false,'loss of command alone is not destruction');
 assert.deepEqual(projected.statusByPieceId.get('U1-4'),{supplied:true,commanded:false});
});

test('a later real rush can rescue projected losses and refresh their displayed status',()=>{
 const state=duringRush(),project=createSequenceStatusProjector();
 assert(project(state).destroyedPieceIds.has('U1-2'));
 const rescue={type:'rush',actorId:'U2-5',from:{row:8,col:3},to:{row:7,col:3}};
 assert(listLegalActions(state).some(action=>JSON.stringify(action)===JSON.stringify(rescue)));
 const rescued=resolveToStability(applyAction(structuredClone(state),rescue).state,{artifactMode:'full'});
 assert.equal(project(rescued).destroyedPieceIds.size,0);
 assert.equal(project(rescued).statusByPieceId.get('U1-2').supplied,true);
 assert.equal(project(state).destroyedPieceIds.has('U1-2'),true,'returning to an older position recomputes its own status');
});

test('projection cache reuses unchanged snapshots but detects in-place position changes',()=>{
 const state=duringRush(),project=createSequenceStatusProjector(),first=project(state);
 assert.equal(project(state),first);
 const rescue={type:'rush',actorId:'U2-5',from:{row:8,col:3},to:{row:7,col:3}};
 Object.assign(state,resolveToStability(applyAction(structuredClone(state),rescue).state,{artifactMode:'full'}));
 assert.notEqual(project(state),first);
 assert.equal(project(state).destroyedPieceIds.size,0);
});

test('ordinary, recorded-final and completed positions do not acquire a live sequence projection',()=>{
 const project=createSequenceStatusProjector(),state=duringRush();
 assert.equal(project(null),null);
 assert.equal(project({...state,continuation:null}),null);
 assert.equal(project({...state,outcome:{status:'p1_win'}}),null);
});

test('push, retreat and follow projections include both affiliations and preserve the real mandatory continuation',()=>{
 const capture=JSON.parse(readFileSync(new URL('../../../packages/game-engine/test/fixtures/completion-preserving-retreat.json',import.meta.url)));
 const project=createSequenceStatusProjector();
 for(const [name,ids] of [['afterPush',['U1-28','U2-15']],['afterRetreat',['U1-28','U2-11','U2-15']]]){
  const state=capture.states[name],before=structuredClone(state),legal=listLegalActions(state);
  assert.deepEqual([...project(state).destroyedPieceIds].sort(),ids);
  assert.deepEqual(state,before);
  assert.deepEqual(listLegalActions(state),legal);
  assert.equal(state.continuation.type,'push');
 }
});
