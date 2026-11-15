import {activeDecisionLineage} from '../shell/decision-history.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMovePreview,buildTurnPreview,createHistoryDestructionAnimationOwner,shouldAnimateHistoryDestruction} from '../shell/history-preview.js';
import {applyHistoryIntent} from '../shell/recovery-view.js';
import {presentationDestroyedPiecesForMove,withCausalDestructionPresentation} from '../shell/destruction-presentation.js';
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

test('causal move inspection keeps the casualty present while completed turn inspection shows settlement',()=>{
 const cut=move(0,'project',{row:1,col:1},{row:1,col:2});
 const close=move(1,'move',{row:2,col:1},{row:2,col:2});
 const casualty=piece('casualty','P2',4,4);
 cut.snapshot=snapshot([...cut.snapshot.pieces,casualty]);
 close.inspectionSnapshot=snapshot([...close.snapshot.pieces,{...casualty,supplied:false,displaySupplied:false}]);
 close.snapshot=snapshot([],1);
 close.destroyedPieces=[{pieceId:'casualty',position:{row:4,col:4},ownerSeat:'p2',reason:'loss_of_supply',
  removalPhase:'turn_settlement',causalMoveId:'m0',piece:casualty}];
 const inspected=buildMovePreview(withCausalDestructionPresentation([cut,close])[0]),turn=buildTurnPreview([cut,close]);
 assert.equal(inspected.snapshot.pieces.some(entry=>entry.id==='casualty'),true);
 assert.equal(inspected.overlay.destroyedPieces[0].piece.id,'casualty');
 assert.deepEqual(inspected.overlay.animatedDestroyedPieces,[]);
 assert.equal(inspected.overlay.staticDestroyedPieces[0].piece.id,'casualty');
 assert.deepEqual(turn.snapshot,snapshot([],1));
 assert.equal(turn.overlay.destroyedPieces[0].piece.id,'casualty');
 assert.equal(turn.overlay.animatedDestroyedPieces[0].piece.id,'casualty');
 assert.deepEqual(turn.overlay.staticDestroyedPieces,[]);
 assert.equal(presentationDestroyedPiecesForMove(cut,[cut,close])[0].pieceId,'casualty');
 assert.deepEqual(presentationDestroyedPiecesForMove(close,[cut,close]),[]);
});

test('completed turn preview animates all settlement casualties together while move preview keeps them static',()=>{
 const cut=move(0,'rush',{row:3,col:7},{row:4,col:7});
 const close=move(1,'end_turn',{row:4,col:7},{row:4,col:7});
 const casualties=[piece('lost-1','P2',5,4),piece('lost-2','P2',6,4)];
 cut.snapshot=snapshot([...cut.snapshot.pieces,...casualties.map(value=>({...value,supplied:false,commanded:false}))]);
 close.snapshot=snapshot([],1);
 close.destroyedPieces=casualties.map(value=>({pieceId:value.id,position:value.position,ownerSeat:'p2',reason:'loss_of_supply',
  removalPhase:'turn_settlement',causalMoveId:cut.moveId,piece:value}));
 const causal=withCausalDestructionPresentation([cut,close])[0];
 const movePreview=buildMovePreview(causal),turnPreview=buildTurnPreview([cut,close]);
 assert.deepEqual(movePreview.overlay.staticDestroyedPieces.map(value=>value.piece.id),['lost-1','lost-2']);
 assert.deepEqual(movePreview.overlay.animatedDestroyedPieces,[]);
 assert.deepEqual(turnPreview.overlay.animatedDestroyedPieces.map(value=>value.piece.id),['lost-1','lost-2']);
 assert.deepEqual(turnPreview.overlay.staticDestroyedPieces,[]);
});

test('history destruction animation is owned only by the matching deliberate selection episode',()=>{
 const selectedMove=move(3,'project',{row:1,col:1},{row:1,col:2});
 const moveGame={id:'game',inHistoryMode:true,historyIndex:3,inspectedDecision:selectedMove,moves:[selectedMove]};
 assert.equal(shouldAnimateHistoryDestruction(moveGame,{scope:'game:move:m3'}),true);
 assert.equal(shouldAnimateHistoryDestruction(moveGame,{scope:'game:archive:m3'}),true);
 assert.equal(shouldAnimateHistoryDestruction(moveGame,{scope:'game:move:other'}),false);
 assert.equal(shouldAnimateHistoryDestruction(moveGame,null),false,'quiet refresh has no deliberate owner');
 const turnGame={...moveGame,historyTurnIndex:63};
 assert.equal(shouldAnimateHistoryDestruction(turnGame,{scope:'game:turn:63'}),true);
 assert.equal(shouldAnimateHistoryDestruction(turnGame,{scope:'game:turn:62'}),false);
 assert.equal(shouldAnimateHistoryDestruction({...turnGame,inHistoryMode:false},{scope:'game:turn:63'}),false);
});

test('history destruction owner consumes one matching user episode without turning quiet rerenders into replay requests',()=>{
 const owner=createHistoryDestructionAnimationOwner();
 const game={id:'game',inHistoryMode:true,historyTurnIndex:63};
 const first={scope:'game:turn:63',key:'history-selection:1:game:turn:63'};
 assert.equal(owner.claim(game,first,true),true);
 assert.equal(owner.claim(game,first,true),false,'the same render episode is consumed once');
 assert.equal(owner.claim(game,null,true),false,'quiet rerenders have no presentation owner');
 assert.equal(owner.claim(game,{scope:'game:turn:62',key:'history-selection:2:game:turn:62'},true),false);
 assert.equal(owner.claim(game,{scope:'game:turn:63',key:'history-selection:3:game:turn:63'},false),false,'an empty effect set never forces a reload');
 assert.equal(owner.claim(game,{scope:'game:turn:63',key:'history-selection:4:game:turn:63'},true),true,'a later user re-selection owns one new presentation');
});

test('partial retained context keeps unresolved causal destruction on its durable removal move',()=>{
 const close=move(3,'move',{row:2,col:1},{row:2,col:2});
 close.destroyedPieces=[{pieceId:'casualty',position:{row:4,col:4},ownerSeat:'p2',reason:'loss_of_supply',
  removalPhase:'turn_settlement',causalMoveId:'unavailable-cut'}];
 assert.deepEqual(presentationDestroyedPiecesForMove(close,[close]),close.destroyedPieces);

 const cut=move(0,'project',{row:1,col:1},{row:1,col:2});
 cut.clientCommandId='unavailable-cut';
 assert.deepEqual(presentationDestroyedPiecesForMove(cut,[cut,close]),close.destroyedPieces);
 assert.deepEqual(presentationDestroyedPiecesForMove(close,[cut,close]),[]);
});

test('undone destruction attribution stays inside its proved Undo lineage',()=>{
 const cut={...move(0,'project',{row:1,col:1},{row:1,col:2}),undone:true,undoEventSeq:12};
 const close={...move(1,'move',{row:2,col:1},{row:2,col:2}),undone:true,undoEventSeq:12};
 close.destroyedPieces=[{pieceId:'casualty',position:{row:4,col:4},ownerSeat:'p2',reason:'loss_of_supply',
  removalPhase:'turn_settlement',causalMoveId:cut.moveId}];
 assert.deepEqual(presentationDestroyedPiecesForMove(cut,[cut,close]),close.destroyedPieces);
 assert.deepEqual(presentationDestroyedPiecesForMove(close,[cut,close]),[]);

 const otherLineage={...close,undoEventSeq:13};
 assert.deepEqual(presentationDestroyedPiecesForMove(cut,[cut,otherLineage]),[]);
 assert.deepEqual(presentationDestroyedPiecesForMove(otherLineage,[cut,otherLineage]),otherLineage.destroyedPieces);

 const legacy={...close,undoEventSeq:undefined};
 assert.deepEqual(presentationDestroyedPiecesForMove(legacy,[cut,legacy]),legacy.destroyedPieces);
 assert.equal(withCausalDestructionPresentation([cut,close]).length,2);
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
