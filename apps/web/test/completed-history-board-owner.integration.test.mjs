import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {historyBoardMessage} from '../shell/history-narration.js';
import {historyBoardRuntimeMessage} from '../shell/playback-presentation.js';

const terminal={sideToMove:'P2',turnIndex:5,outcome:{status:'p1_win',reason:'p2_commander_destroyed'},pieces:[]};
const action={type:'push',actorId:'winner',from:{row:8,col:2},to:{row:9,col:2}};
const decisive={moveId:'final',index:0,displayMoveNumber:18,turnIndex:4,turnMoveIndex:0,actorSide:'P1',clientCommandId:'v2:final',action,selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:terminal,destroyedPieces:[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2'}]};
const completed=()=>({id:'completed',gameplayRevision:7,inHistoryMode:true,historyIndex:null,historyTurnIndex:4,historyTurnMoves:[decisive],inspectedDecision:null,moves:[decisive],turns:[{index:4,playerSeat:'Player 1',status:'complete',endedAt:'terminal',moveIndexes:[0]}],player1:{identityId:'me'},player2:{identityId:'other'},board:{state:terminal},currentSnapshot:terminal,terminalOutcome:{version:1,decisive:{action,actorSide:'P1',decisionId:'final',clientCommandId:'v2:final',turnIndex:4},board:structuredClone(terminal),result:terminal.outcome,removals:structuredClone(decisive.destroyedPieces),cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},commit:{eventSeq:9,gameplayRevision:7,clientCommandId:'v2:final'},lineage:{version:1,complete:true,importedMoveCount:0,sources:[]},activeActionCount:18,activeActionCountComplete:true}});

const runtimeFor=view=>{
 let html='',context;
 const label={dataset:{},hidden:false,get innerHTML(){return html;},set innerHTML(value){html=value;},get textContent(){return html;},set textContent(value){html=value;},addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]};
 const runtime=createBoardRuntime({
  boardAdapter:{mount(){},render(){},getPieceById:()=>null,getSelectedPieceSummary:()=>null},
  host:{canSelect:()=>false,canInteract:()=>false,canPresentActions:()=>false,loadPieceMoves:async()=>({actions:[],previewActions:[]})},
  controls:{getBoardMessage:selection=>historyBoardRuntimeMessage(view,selection,{identityId:'me'}),onBoardContext:value=>{context=value;}},
 });
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 return {runtime,get html(){return html;},get context(){return context;}};
};

test('direct completed decisive-turn entry gives the semantic outcome sole Board-message ownership',async()=>{
 const game=completed(),acknowledged=historyBoardMessage(game,{identityId:'me'}),fixture=runtimeFor(game);
 assert.match(renderBoardMessageHtml(acknowledged.context),/You won in 18 moves/);
 await fixture.runtime.loadSnapshot(terminal,{legalActions:[],overlayMode:'recorded-turn'});
 assert.equal(fixture.html,'');
 assert.equal(fixture.context,null,'runtime does not publish a competing placeholder context');
});

test('empty History keeps its actionable guidance when no semantic owner exists',async()=>{
 const game={...completed(),historyTurnIndex:null,historyTurnMoves:[],moves:[],turns:[],terminalOutcome:null,board:{state:{...terminal,outcome:{status:'ongoing'}}}},fixture=runtimeFor(game);
 await fixture.runtime.loadSnapshot(game.board.state,{legalActions:[],overlayMode:'recorded-turn'});
 assert.equal(fixture.html,'Choose a move in History');
});
