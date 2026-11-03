import {activeDecisionLineage} from '../shell/decision-history.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMovePreview,buildTurnPreview} from '../shell/history-preview.js';
import {applyHistoryIntent} from '../shell/recovery-view.js';
const piece=(id,owner,row,col)=>({id,owner,kind:'unit',position:{row,col},supplied:true,commanded:true});
const snapshot=(pieces,turnIndex=0)=>({pieces,turnIndex,sideToMove:'P1'});
const move=(index,type,from,to,owner='P1')=>({index,turnIndex:0,turnMoveIndex:index,moveId:`m${index}`,action:{type,actorId:owner,from,to},selectionSnapshot:snapshot([piece(owner,owner,from.row,from.col)]),snapshot:snapshot([piece(owner,owner,to.row,to.col)])});
test('move presentation carries the recorded action, original piece and destruction state',()=>{
 const m=move(0,'move',{row:1,col:2},{row:1,col:3});
 m.destroyedPieces=[{position:{row:1,col:2},ownerSeat:'p1',piece:m.selectionSnapshot.pieces[0]}];
 const preview=buildMovePreview(m);
 assert.equal(preview.snapshot,m.snapshot);
 assert.equal(preview.overlay.recordedAction,m.action);
 assert.equal(preview.overlay.recordedActionStartPiece.owner,'P1');
 assert.equal(preview.overlay.destroyedPieces[0].piece.id,'P1');
});
test('turn aggregation preserves defender retreats and projections while deduplicating attacker push/follow',()=>{
 const a={row:2,col:2},b={row:2,col:3},c={row:2,col:4};
 const push=move(0,'push',a,b),retreat=move(1,'retreat',b,c,'P2'),follow=move(2,'follow',a,b),project=move(3,'project',a,c);
 follow.action.from={col:a.col,row:a.row};follow.action.to={col:b.col,row:b.row};
 const preview=buildTurnPreview([project,follow,retreat,push,{...push,index:4,undone:true}]);
 assert.equal(preview.snapshot,project.snapshot);
 assert.deepEqual(preview.overlay.recordedActions.map(x=>x.recordedAction.type),['push','retreat','project']);
 assert.equal(preview.overlay.mode,'recorded-turn');
 assert.equal(preview.overlay.recordedActions[1].recordedActionStartPiece.owner,'P2');
});
test('frozen turn selection remains pinned across live updates and does not change authority',()=>{
 const frozen=[move(0,'move',{row:1,col:2},{row:1,col:3})];
 const game={board:{state:snapshot([piece('live','P2',8,8)],3)},gameplayRevision:8,canRecordMove:true,canEndTurn:true};
 applyHistoryIntent(game,{turn:{index:0,moves:frozen},revision:3},'me');
 assert.equal(game.historyTurnIndex,0);assert.equal(game.inspectedAtRevision,3);
 assert.equal(game.currentSnapshot.pieces[0].id,'P1');
 assert.equal(game.board.state.pieces[0].id,'live');
 assert.equal(game.canRecordMove,false);assert.equal(game.canEndTurn,false);
 frozen[0].snapshot.pieces[0].position.row=9;
 assert.equal(game.currentSnapshot.pieces[0].position.row,1);
});


test('aggregate includes end-turn finalization and destruction from durable archive amendments',()=>{
 const original=move(0,'move',{row:1,col:1},{row:1,col:2});
 const destroyed={position:{row:1,col:2},ownerSeat:'p1',piece:original.snapshot.pieces[0]};
 const final={...original,snapshot:snapshot([],1),destroyedPieces:[destroyed]};
 const lineage=activeDecisionLineage([{id:original.moveId,kind:'decision',move:original},{id:'finalize',kind:'finalization',targetDecisionId:original.moveId,finalizedMove:final}]);
 const preview=buildTurnPreview(lineage);
 assert.deepEqual(preview.snapshot,snapshot([],1));
 assert.equal(preview.overlay.destroyedPieces[0].piece.id,'P1');
 assert.equal(preview.overlay.recordedActions[0].recordedAction.type,'move');

});


test('History opts into endpoint roles while replay and live summary callers retain their appearance',()=>{
 const a={row:2,col:2},b={row:2,col:3},c={row:3,col:3};
 const push=move(0,'push',a,b),retreat=move(1,'retreat',b,c,'P2'),follow=move(2,'follow',a,b);
 const history=buildTurnPreview([follow,retreat,push],{context:'history'});
 assert.equal(history.overlay.presentationContext,'history');
 assert.deepEqual(history.overlay.endpointRoles,[{...a,source:true,target:false},{...b,source:true,target:true},{...c,source:false,target:true}]);
 assert.deepEqual(history.overlay.recordedActions.map(x=>x.recordedAction.type),['push','retreat']);
 assert.equal(history.snapshot,follow.snapshot);
 const single=buildMovePreview(push,{context:'history'});
 assert.deepEqual(single.overlay.endpointRoles,[{...a,source:true,target:false},{...b,source:false,target:true}]);
 for(const preview of [buildMovePreview(push),buildTurnPreview([push,retreat,follow])]){
  assert.equal(preview.overlay.presentationContext,undefined);assert.equal(preview.overlay.endpointRoles,undefined);
 }
});
