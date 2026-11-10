import * as undoHistory from '../shell/history-undo-groups.js';
import {selectedHistoryPresentation,recordedHistoryView} from '../shell/history-narration.js';
import {recordedMoveNumber,visibleRecordedMoves} from '../shell/recorded-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {createBoardContextStore} from '../shell/board-context.js';
import {isCompletedGame} from '../shell/game-lifecycle.js';
import {historyTurnSide} from '../shell/history-preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildMovePreview,buildTurnPreview} from '../shell/history-preview.js';
import {buildComputerTurnReplay} from '../shell/computer-replay.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const renderHistoryPreview ='),source.indexOf('const renderHeader ='));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const context={undoHistory,selectedHistoryPresentation,recordedMoveNumber,visibleRecordedMoves,renderBoardMessageHtml,boardContexts:createBoardContextStore(),boardContextScope:()=>'fixture',isCompletedGame,buildMovePreview,buildTurnPreview,escapeHtml:escape,getShellLayoutMode:()=> 'narrow',toStableKey:JSON.stringify,
 renderMiniBoardPreviewRoot:({overlay})=>`<div data-preview-mode="${overlay.mode}"></div>`,playerToneClassForSide:side=>`player-tone-${side}`,playerToneClassForSeat:()=>'',
 historyActorLabel:(_game,move)=>move.actorSide==='P2'?'Defender':'Attacker',historyTurnSide,COMPUTER_PROFILES:{},playerDisplayName:(_game,side)=>side==='Player 2'||side==='P2'?'Defender':'Attacker',
 transport:{getIdentityId:()=> 'me'},icon:()=>'',formatClientDateTime:String,expandedUndoneGroups:new Set(),liveHistoryLabel:()=> 'Waiting'};
vm.runInNewContext(`${declaration};globalThis.render=renderTurnHistory`,context);
const moves=[{index:0,turnIndex:0,turnMoveIndex:0,moveId:'a',actorSide:'P1',notation:'Push',snapshot:{pieces:[]}},
 {index:1,turnIndex:0,turnMoveIndex:1,moveId:'b',actorSide:'P2',notation:'Retreat',snapshot:{pieces:[]}},
 {index:2,turnIndex:1,turnMoveIndex:0,moveId:'c',actorSide:'P2',notation:'Move',snapshot:{pieces:[]}}];
const game={id:'g',moves,turns:[{index:0,playerSeat:'Player 1'},{index:1,playerSeat:'Player 2'}],myRoles:['Player 1']};
test('turn headings retain ownership while displayed moves run newest first',()=>{
 const html=context.render({...game,pendingMoves:[{index:3,turnIndex:1,turnMoveIndex:1,actorSide:'P2',notation:'Pending'}]});
 assert(html.indexOf('Turn 2')<html.indexOf('Turn 1'));
 assert(html.indexOf('Retreat')<html.indexOf('Push'));
 assert.match(html,/aria-label="Turn 1 · Attacker"/);
 assert.match(html,/>Turn 1<\/div>/);
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
 assert(html.indexOf('Retreat')<html.indexOf('Push'));
 assert.doesNotMatch(html,/history-actor/);
 assert.match(html,/aria-label="Defender"/);
 assert.match(html,/<div class="history-item-info history-archive-select" aria-current="true"/);
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

test('mobile active and archived previews share the known closure final snapshot with narration',()=>{
 const before={pieces:[]},final={pieces:[],label:'closure-final'};
 const action={index:0,turnIndex:0,turnMoveIndex:0,moveId:'action',actorSide:'P1',notation:'Rush',action:{type:'rush',actorId:'A',from:{row:4,col:3},to:{row:4,col:4}},selectionSnapshot:before,snapshot:before};
 const closure={index:1,turnIndex:0,turnMoveIndex:1,moveId:'closure',actorSide:'P1',notation:'End turn',action:{type:'end_turn'},snapshot:final,destroyedPieces:[{pieceId:'lost',ownerSeat:'p1',position:{row:5,col:3}}]};
 const snapshots=[],original=context.renderMiniBoardPreviewRoot;
 const getter=source.slice(source.indexOf('const getBoardGame ='),source.indexOf('const decisionDebugStates ='));
 const desktopContext={recordedHistoryView,deriveBoardView:value=>value,getShellLayoutMode:()=> 'wide',transport:context.transport,additionalHistory:context.additionalHistory};
 vm.runInNewContext(`${getter};globalThis.get= getBoardGame`,desktopContext);
 context.renderMiniBoardPreviewRoot=preview=>{snapshots.push(preview.snapshot);return '<div data-preview-mode="recorded-action"></div>';};
 try{
  const selected={...game,inHistoryMode:true,historyIndex:0,inspectedDecision:action,moves:[action,closure]};
  assert.match(context.render(selected),/lost piece at/);
  context.archiveState={metadata:true,loaded:true,items:[{id:'closure',move:closure},{id:'action',move:action}]};
  assert.match(context.archive({...selected,moves:[]}),/lost piece at/);
  const desktop=desktopContext.get({...selected,moves:[]});
  assert.deepEqual(snapshots,[desktop.currentSnapshot,desktop.currentSnapshot]);
  assert.deepEqual(desktop.currentSnapshot,final);
 }finally{context.renderMiniBoardPreviewRoot=original;}
});

test('compact rail uses independent native turn and move targets without nested buttons',()=>{
 const html=context.render(game);
 assert.equal((html.match(/class="history-turn-hit secondary"/g)??[]).length,2);
 assert.equal((html.match(/class="history-move-hit secondary"/g)??[]).length,3);
 assert.match(html,/class="history-turn-hit secondary"[^>]*aria-label="Inspect Turn 1 · Attacker"/);
 assert.match(html,/class="history-move-hit secondary"[^>]*aria-label="Defender · Move 2: Retreat"/);
 assert.doesNotMatch(html,/<div class="history-turn-heading[^>]*>Turn \d+ ·/);
 assert.doesNotMatch(html,/<li class="history-item[^>]*(?:role="button"|tabindex=)/);
 let depth=0;for(const token of html.matchAll(/<\/?button\b[^>]*>/g)){depth+=token[0].startsWith('</')?-1:1;assert(depth>=0&&depth<=1,'native buttons must never nest');}assert.equal(depth,0);
 const selected=context.render({...game,inHistoryMode:true,historyIndex:1,inspectedDecision:moves[1]});
 assert.equal((selected.match(/class="history-move-hit secondary"/g)??[]).length,2);
 assert.match(selected,/data-action="revert-to-move"/);assert.match(selected,/data-action="launch-history-branch"/);
});

test('archived entries retain their known decision identity when old move payloads omit moveId',()=>{
 const {moveId,...legacy}=moves[0];context.archiveState={metadata:true,loaded:true,items:[{id:moveId,move:legacy,at:'date',historyStatus:'unknown'}]};
 const html=context.archive({...game,moves:[]});
 assert.match(html,/data-archive-move-id="a"/);assert.match(html,/Status unavailable/);
 assert.match(html,/data-decision-id="a"/);
});

const displayedIds=html=>[...html.matchAll(/ data-move-id="([^"]*)" [^>]*data-testid="history-(?:pending-)?move-item"/g)].map(match=>match[1]);
const archivedIds=html=>[...html.matchAll(/ data-archive-move-id="([^"]*)"/g)].map(match=>match[1]);
const replayRecords=()=>['push','retreat','follow'].map((type,index)=>({moveId:type,index,turnIndex:0,turnMoveIndex:index,actorSide:type==='retreat'?'P2':'P1',notation:type,action:{type,actorId:'A',from:{row:index,col:1},to:{row:index+1,col:1}},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]},...(type==='retreat'?{}:{computerProof:{}})}));
test('display reversal leaves stored decisions and replay frames chronological',()=>{
 const records=replayRecords(),before=structuredClone(records),view={...game,moves:records,turns:[{index:0,playerSeat:'Player 1'}]};
 assert.deepEqual(displayedIds(context.render(view)),['follow','retreat','push']);
 assert.deepEqual(records,before);
 const replay=buildComputerTurnReplay({moves:records,completedTurnIndex:0});
 assert.deepEqual(replay.frames.map(frame=>frame.decisionId),['push','retreat','follow']);
 assert.deepEqual(records,before);
});
test('archived rows display newest first without mutating source entries or turn ownership',()=>{
 const records=replayRecords(),items=[records[2],records[0],records[1]].map(move=>({id:move.moveId,move,at:'date'})),before=structuredClone(items);
 context.archiveState={metadata:true,loaded:true,items};
 const html=context.archive({...game,moves:[],turns:[{index:0,playerSeat:'Player 1'}]});
 assert.deepEqual(archivedIds(html),['follow','retreat','push']);
 assert.match(html,/aria-label="Turn 1 · Attacker"/);
 assert.deepEqual(items,before);
});
test('pending and expanded undone rows each display newest first without reordering records',()=>{
 const active=replayRecords(),undone=active.slice(0,2).map((move,index)=>({...move,moveId:'undone-'+index,index:index+3,turnMoveIndex:index+3,undone:true,undoEventSeq:42})),pending={...active[0],moveId:'pending',index:5,turnMoveIndex:5};
 const records=[...active,...undone],before=structuredClone({records,pending});
 context.expandedUndoneGroups.add('g:undo:accepted:42');
 try{assert.deepEqual(displayedIds(context.render({...game,moves:records,pendingMoves:[pending],turns:[{index:0,playerSeat:'Player 1'}]})),['pending','follow','retreat','push','undone-1','undone-0']);}
 finally{context.expandedUndoneGroups.delete('g:undo:accepted:42');}
 assert.deepEqual({records,pending},before);
});

test('actual live renderer collapses each accepted Undo once across turns and separates legacy records',()=>{
 const records=[{...moves[0],moveId:'active'},{...moves[1],moveId:'first-one',undone:true,undoEventSeq:10},{...moves[2],moveId:'first-two',index:3,undone:true,undoEventSeq:10},{...moves[2],moveId:'second',index:4,undone:true,undoEventSeq:11},{...moves[2],moveId:'legacy',index:5,undone:true}];
 const original=structuredClone(records);context.expandedUndoneGroups.clear();
 const collapsed=context.render({...game,moves:records});
 assert.equal((collapsed.match(/data-undo-boundary="accepted"/g)??[]).length,2);assert.match(collapsed,/Original Undo boundary unavailable/);assert.doesNotMatch(collapsed,/data-move-id="first-one"/);
 context.expandedUndoneGroups.add('g:undo:accepted:10');
 const expanded=context.render({...game,moves:records});assert.match(expanded,/data-move-id="first-one"/);assert.match(expanded,/data-move-id="first-two"/);assert.doesNotMatch(expanded,/data-move-id="second"/);assert(expanded.indexOf('data-move-id="first-two"')<expanded.indexOf('data-move-id="first-one"'));assert.deepEqual(records,original);context.expandedUndoneGroups.clear();
});
test('loaded archive members merge with the live operation without a second archive disclosure',()=>{
 const live={...moves[0],undone:true,undoEventSeq:12},archived={...moves[2],moveId:'evicted',index:3,undone:true,undoEventSeq:12};
 const entries=[{id:archived.moveId,move:archived,historyStatus:'undone'}];context.archiveState={metadata:true,loaded:true,items:entries};
 const view={...game,moves:[live],historyUndoArchiveEntries:entries};context.expandedUndoneGroups.clear();
 const combined=context.render(view)+context.archive(view);assert.equal((combined.match(/data-undo-event-seq="12"/g)??[]).length,1);assert.match(combined,/2 moves undone/);
 context.expandedUndoneGroups.add('g:undo:accepted:12');const open=context.render(view);assert.match(open,/data-move-id="a"/);assert.match(open,/data-archive-move-id="evicted"/);assert.match(open,/data-action="inspect-history-archive"/);context.expandedUndoneGroups.clear();
});

for(const mode of ['narrow','wide'])test(`actual ${mode} History preserves a selected-now-undone record without overriding explicit collapse`,()=>{
 const saved=context.getShellLayoutMode;context.getShellLayoutMode=()=>mode;context.expandedUndoneGroups.clear();
 try{
  const record={...moves[1],moveId:'chosen'},view={...game,moves:[record],inHistoryMode:true,historyIndex:record.index,inspectedDecision:record};
  context.render(view);const after={...view,moves:[{...record,undone:true,undoEventSeq:31}]};
  const revealed=context.render(after);assert.match(revealed,/data-undo-event-seq="31"/);assert.match(revealed,/aria-expanded="true"/);assert.match(revealed,/data-move-id="chosen"/);assert.match(revealed,/aria-current="true"/);assert.equal(after.inHistoryMode,true);
  if(mode==='narrow')assert.match(revealed,/data-testid="history-inline-preview"/);else assert.doesNotMatch(revealed,/data-testid="history-inline-preview"/);
  context.expandedUndoneGroups.delete('g:undo:accepted:31');const collapsed=context.render(after);assert.match(collapsed,/aria-expanded="false"/);assert.doesNotMatch(collapsed,/data-move-id="chosen"/);
  undoHistory.noteUndoHistorySelection(context.expandedUndoneGroups,'g','chosen',context.transport);assert.match(context.render(after),/data-move-id="chosen"/);
 }finally{context.getShellLayoutMode=saved;context.expandedUndoneGroups.clear();}
});
