import {isCompletedGame} from '../shell/game-lifecycle.js';
import {historyTurnSide} from '../shell/history-preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildMovePreview,buildTurnPreview} from '../shell/history-preview.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const renderHistoryPreview ='),source.indexOf('const renderHeader ='));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const context={isCompletedGame,buildMovePreview,buildTurnPreview,escapeHtml:escape,getShellLayoutMode:()=> 'narrow',toStableKey:JSON.stringify,
 renderMiniBoardPreviewRoot:({overlay})=>`<div data-preview-mode="${overlay.mode}"></div>`,playerToneClassForSide:side=>`player-tone-${side}`,playerToneClassForSeat:()=>'',
 historyActorLabel:(_game,move)=>move.actorSide==='P2'?'Defender':'Attacker',historyTurnSide,COMPUTER_PROFILES:{},playerDisplayName:(_game,side)=>side==='Player 2'||side==='P2'?'Defender':'Attacker',
 transport:{getIdentityId:()=> 'me'},icon:()=>'',formatClientDateTime:String,expandedUndoneGroups:new Set(),liveHistoryLabel:()=> 'Waiting'};
vm.runInNewContext(`${declaration};globalThis.render=renderTurnHistory`,context);
const moves=[{index:0,turnIndex:0,turnMoveIndex:0,moveId:'a',actorSide:'P1',notation:'Push',snapshot:{pieces:[]}},
 {index:1,turnIndex:0,turnMoveIndex:1,moveId:'b',actorSide:'P2',notation:'Retreat',snapshot:{pieces:[]}},
 {index:2,turnIndex:1,turnMoveIndex:0,moveId:'c',actorSide:'P2',notation:'Move',snapshot:{pieces:[]}}];
const game={id:'g',moves,turns:[{index:0,playerSeat:'Player 1'},{index:1,playerSeat:'Player 2'}],myRoles:['Player 1']};
test('turn headings align attribution and preserve chronological defender actions inside attacker turn',()=>{
 const html=context.render({...game,pendingMoves:[{index:3,turnIndex:1,turnMoveIndex:1,actorSide:'P2',notation:'Pending'}]});
 assert(html.indexOf('Turn 2')<html.indexOf('Turn 1'));
 assert(html.indexOf('Push')<html.indexOf('Retreat'));
 assert.match(html,/Turn 1 · <span dir="auto">Attacker/);
 assert.match(html,/aria-label="Defender · Move 2: Retreat"/);
 assert.doesNotMatch(html,/class="history-actor"/);
 assert.match(html,/data-testid="history-pending-move-item"[^>]*aria-busy="true"/);
});
test('selected move is inert while individual actions remain buttons and preview uses action overlay',()=>{
 const html=context.render({...game,inHistoryMode:true,historyIndex:1});
 const selected=html.match(/<li class="history-item[^>]*is-selected[^>]*>/)[0];
 assert.doesNotMatch(selected,/data-action|role="button"|tabindex/);
 assert.match(html,/data-action="revert-to-move"/);assert.match(html,/data-action="launch-history-branch"/);
 assert.match(html,/data-preview-mode="recorded-action"/);
});
test('selected turn is inert, has aggregate preview and exposes no undo or branch actions',()=>{
 const html=context.render({...game,inHistoryMode:true,historyTurnIndex:0,historyTurnMoves:moves.slice(0,2)});
 const heading=html.match(/<div class="history-turn-heading is-selected"[^>]*>/)[0];
 assert.doesNotMatch(heading,/data-action|role="button"/);
 assert.match(html,/data-preview-mode="recorded-turn"/);
 assert.doesNotMatch(html,/data-action="(?:revert-to-move|launch-history-branch)"/);
});

context.canReadAdditionalHistory=()=>true;
context.account={snapshot:()=>({enabled:false})};
context.additionalHistory={snapshot:()=>context.archiveState};
const archiveDeclaration=source.slice(source.indexOf('const renderAdditionalHistory ='),source.indexOf('let revealedHistoryKey'));
vm.runInNewContext(`${archiveDeclaration};globalThis.archive=renderAdditionalHistory`,context);
test('archive entries share turn grouping, actor accessibility and inert selected action previews',()=>{
 context.archiveState={metadata:true,loaded:true,items:[{id:'b',move:moves[1],at:'date'},{id:'a',move:moves[0],at:'date'}]};
 const html=context.archive({...game,moves:[],inHistoryMode:true,inspectedDecision:moves[1]});
 assert.match(html,/Turn 1 · Attacker/);
 assert(html.indexOf('Push')<html.indexOf('Retreat'));
 assert.doesNotMatch(html,/history-actor/);
 assert.match(html,/aria-label="Defender"/);
 assert.match(html,/<div class="history-item-info history-archive-select"  data-game-id="g" data-decision-id="b" aria-current="true"/);
 assert.match(html,/data-preview-mode="recorded-action"/);
 assert.match(html,/data-action="inspect-history-archive"[^>]*data-decision-id="a"/);
});

test('completed history omits empty loser Turn48 while preserving final Turn47 and closed passes',()=>{
 const finalMove={...moves[0],turnIndex:46,index:24,displayMoveNumber:25,notation:'PUSH (5,4) → (5,3)'};
 const turns=[{index:45,playerSeat:'Player 2',endedAt:'passed',moveIndexes:[]},
  {index:46,playerSeat:'Player 1',endedAt:'done',moveIndexes:[24]},
  {index:47,playerSeat:'Player 2',endedAt:null,moveIndexes:[]}];
 const completed={...game,moves:[finalMove],turns,currentTurn:turns[2],board:{state:{outcome:{status:'p1_win'}}}};
 const html=context.render(completed);
 assert.doesNotMatch(html,/Turn 48/);assert.match(html,/Turn 47/);assert.match(html,/Move 25: PUSH/);assert.match(html,/Turn 46/);
 assert.match(context.render({...completed,board:{state:{outcome:{status:'ongoing'}}}}),/Turn 48/);
 assert.match(context.render({...completed,moves:[finalMove,{...moves[2],turnIndex:47,moveId:'ack-final'}]}),/Turn 48/);
 assert.doesNotMatch(context.render({...completed,inHistoryMode:true,currentSnapshot:{outcome:{status:'ongoing'}}}),/Turn 48/);
 assert.match(context.render({...completed,turns:[...turns.slice(0,2),{...turns[2],endedAt:'real-pass'}]}),/Turn 48/);
});
