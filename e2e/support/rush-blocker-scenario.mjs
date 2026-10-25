import assert from 'node:assert/strict';
import {createInitialState,resolveToStability,validateAction,applyAction,listLegalActions,canCloseContinuationNow,getRushContinuationBlockingPiece} from '../../apps/web/generated/packages/game-engine/src/index.js';

const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:false,commanded:false});
export function assertRushBlockerState(state){
 assert.equal(canCloseContinuationNow(state),false);
 assert.deepEqual(getRushContinuationBlockingPiece(state)?.position,{row:4,col:3});
 const legal=listLegalActions(state);assert.ok(legal.some(action=>action.type==='rush'));assert.ok(!legal.some(action=>action.type==='end_turn'));
 return legal;
}
export function createRushBlockerScenario(){
 const before=resolveToStability({...createInitialState(),sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[
  piece('A','P1','unit',4,4),piece('B','P1','unit',5,5),piece('D','P1','unit',6,5),
  piece('F','P1','unit',3,5),piece('C1','P1','commander',3,6),piece('C2','P2','commander',7,1),
  piece('E0','P2','unit',0,4),piece('E1','P2','unit',9,4),piece('E2','P2','unit',4,2),piece('E3','P2','unit',6,3),
 ]},{artifactMode:'full'});
 for(const id of ['A','B','D','F','C1']){
  const actor=before.pieces.find(piece=>piece.id===id);assert.equal(actor.supplied,true,`${id} must be truly supplied before the first rush`);assert.equal(actor.commanded,true,`${id} must be truly commanded before the first rush`);
 }
 const firstRush={type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}};
 assert.equal(validateAction(before,firstRush).ok,true,'First rush must be legal in the resolved pre-state');
 const state=resolveToStability(applyAction(before,firstRush).state,{artifactMode:'full'});
 assert.equal(state.continuation?.frozenOwner,'P1');
 assert.deepEqual(state.continuation.frozenPieceStatesById,Object.fromEntries(before.pieces.filter(piece=>piece.owner==='P1').map(piece=>[piece.id,{supplied:piece.supplied,commanded:piece.commanded}])));
 assertRushBlockerState(state);
 const reconnect={type:'rush',actorId:'B',from:{row:5,col:5},to:{row:5,col:4}};
 assert.equal(validateAction(state,reconnect).ok,true,'The remaining actor must have a real reconnecting rush');
 const reconnected=resolveToStability(applyAction(state,reconnect).state,{artifactMode:'full'});
 assert.equal(canCloseContinuationNow(reconnected),true);assert.equal(getRushContinuationBlockingPiece(reconnected),null);
 return {before,firstRush,reconnect,state,reconnected,scenario:{formatVersion:2,id:'5e4b7ef0-2ab6-4ee7-9b1f-7c81f4088e3f',title:'Rush blocker preview',description:'Real resolved first rush leaves a resuppliable blocker',incorrect:false,initialState:state,moves:[],resultingState:structuredClone(state),expectedFinalStateHash:'hash-placeholder',expectedOutcome:'ongoing'}};
}
