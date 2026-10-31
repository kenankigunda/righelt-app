import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedHistoryPresentation,recordedHistoryView} from '../shell/history-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
const from={row:4,col:3},to={row:4,col:4};
const move=(type,actorSide='P1')=>({moveId:type,index:40,displayMoveNumber:41,turnIndex:4,turnMoveIndex:0,actorSide,action:{type,actorId:actorSide,from,to},selectionSnapshot:{sideToMove:actorSide,pieces:[]},snapshot:{pieces:[]}});
const game={inHistoryMode:true,historyIndex:40,player1:{identityId:'a',profile:{displayName:'Maya <(8, 8)>'}},player2:{identityId:'b',profile:{displayName:'Kenan'}}};
test('exact historical move keeps board-wide number, recorded defender name and safe coordinate rendering',()=>{
 const record=move('retreat','P2');record.displayMoveNumber=71;
 const selected=selectedHistoryPresentation({...game,inspectedDecision:record});
 assert.deepEqual(selected.caption,{text:'Move 71',side:'P2'});assert.equal(selected.message.text,'Kenan retreated from (4, 3) to (4, 4)');
 const hostile=selectedHistoryPresentation({...game,inspectedDecision:move('rush')});
 const html=renderBoardMessageHtml(hostile.message);
 assert.match(html,/Maya &lt;\(8, 8\)&gt;/);assert.equal((html.match(/board-preview-coordinate-chip /g)??[]).length,2);assert.doesNotMatch(html,/<\(8, 8\)>/);
});
test('turn summary names the turn owner while retaining distinct defender attribution in individual inspection',()=>{
 const push=move('push'),retreat={...move('retreat','P2'),turnMoveIndex:1},follow={...move('follow'),turnMoveIndex:2,action:{type:'follow',actorId:'follower',from,to}};
 const result=selectedHistoryPresentation({...game,historyTurnIndex:4,turns:[{index:4,playerSeat:'Player 1'}],historyTurnMoves:[push,retreat,follow]});
 assert.equal(result.caption.text,'Turn 5');assert.equal(result.message.text,'Maya <(8, 8)> pushed onto (4, 4) and had 1 piece follow');
 assert.equal(selectedHistoryPresentation({...game,inspectedDecision:retreat}).message.actorName,'Kenan');
});
test('unknown historical metadata does not briefly become a live turn caption or guessed move number',()=>{
 const result=selectedHistoryPresentation(game);assert.equal(result.caption.text,'Move unavailable');assert.equal(result.message.text,'Historical move details unavailable');
 assert.equal(selectedHistoryPresentation({...game,inHistoryMode:false}),null);
});

test('known closing record finalizes selected historical presentation without changing live authority',()=>{
 const action=move('rush'),final={pieces:[],outcome:{status:'ongoing'}},closure={...move('end_turn'),moveId:'closure',index:41,turnMoveIndex:1,snapshot:final,destroyedPieces:[{pieceId:'lost',ownerSeat:'p1',position:to}]};
 const selected={...game,inspectedDecision:action,moves:[action,closure],currentSnapshot:action.snapshot};const original=structuredClone(selected);
 const view=recordedHistoryView(selected);
 assert.deepEqual(view.currentSnapshot,final);assert.deepEqual(selected,original);
 assert.match(selectedHistoryPresentation(selected).message.text,/and lost piece at \(4, 4\)/);
 const live={...selected,inHistoryMode:false};assert.equal(recordedHistoryView(live),live);
});

test('selected archived action keeps its exact snapshot when the closure predecessor is absent',()=>{
 const action={...move('rush'),index:1,turnIndex:2,turnMoveIndex:0,snapshot:{label:'selected-only'}};
 const closure={...move('end_turn'),moveId:'closure',index:5,turnIndex:2,turnMoveIndex:4,snapshot:{label:'later-final'}};
 const selected={...game,inspectedDecision:action,moves:[closure],currentSnapshot:action.snapshot};
 assert.deepEqual(recordedHistoryView(selected).currentSnapshot,{label:'selected-only'});
});
