import {renderHistoryResult} from '../shell/game-result.js';
import {historyTurnSide} from '../shell/history-preview.js';
import {icon} from '../shell/ui.js';
import {renderHistorySlots} from '../shell/panel-loading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const renderHistoryPanel ='),source.indexOf('const renderBoardPanel ='));
test('history shows actor names only with their moves and puts result access after history',()=>{
 const context={renderHistoryResult,icon,renderHistorySlots,renderTurnHistory:()=>'<li>Horus · Move 1: Rush</li>',renderAdditionalHistory:()=>'<div>Earlier moves</div>',getGameResult:()=>({winner:'p2'}),transport:{getAuthoritativeGame:()=>({}),getIdentityId:()=> 'owner'},escapeHtml:value=>String(value),participantName:()=>{throw Error('Standalone participant identity must not render in History');}};
 vm.runInNewContext(`${declaration};globalThis.render=renderHistoryPanel;`,context);
 const html=context.render({id:'game',player1:{computerProfile:'babs'},player2:{computerProfile:'horus'}});
 assert.match(html,/Horus · Move 1/);
 assert.doesNotMatch(html,/history-player-names|history-player-name|Computer/);
 assert(html.includes(`${icon('history')}View result</button>`));
 assert(html.indexOf('data-action="view-result"')>html.indexOf('</ol>'));
 assert(!html.slice(0,html.indexOf('<ol')).includes('<button'));
});

test('history hydration retains the selected view and exposes scoped retry before the move list',()=>{
 const context={renderHistoryResult,renderHistorySlots,renderTurnHistory:()=>'<li>Selected move</li>',renderAdditionalHistory:()=>'',getGameResult:()=>null,transport:{getAuthoritativeGame:()=>({}),getIdentityId:()=> 'owner'},escapeHtml:String};
 vm.runInNewContext(`${declaration};globalThis.render=renderHistoryPanel;`,context);
 const loading=context.render({id:'game',historyLoading:true,historyLoadIndex:3});
 assert.match(loading,/Loading this move/);assert.doesNotMatch(loading,/data-action="jump-history"/);
 const failed=context.render({id:'game',historyLoadError:'unavailable',historyLoadIndex:3});
 assert.match(failed,/Your current view is still available/);
 assert.match(failed,/data-action="jump-history" data-move-index="3" data-game-id="game"/);
 assert(failed.indexOf('history-load-status')<failed.indexOf('<ol'));
 assert.match(failed,/<li>Selected move<\/li>/);
 assert.doesNotMatch(context.render({id:'game'}),/history-load-status|data-action="jump-history"/);
});

test('actual history action icons preserve labels, selected-move guards and viewer permissions',()=>{
 const context={renderHistoryResult,icon,escapeHtml:String,getControlSeatForTurn:(_state,seat)=>seat,
  renderHistoryPreview:()=>'',buildMovePreview:()=>({}),buildTurnPreview:()=>({}),historyTurnSide,COMPUTER_PROFILES:{},playerDisplayName:()=> 'You',playerToneClassForSide:()=>'',playerToneClassForSeat:()=>'',formatClientDateTime:String,
  expandedUndoneGroups:new Set(),historyActorLabel:()=> 'You',transport:{getIdentityId:()=> 'me'},getShellLayoutMode:()=> 'wide'};
 const declaration=source.slice(source.indexOf('const renderTurnHistory ='),source.indexOf('const renderHeader ='));
 vm.runInNewContext(`${declaration};globalThis.history=renderTurnHistory;`,context);
 const game={id:'g',inHistoryMode:true,historyIndex:0,myRoles:['Player 1'],turns:[],moves:[{index:0,moveId:'m',notation:'Pass',at:'date'}]};
 const html=context.history(game);
 for(const [action,label,glyph]of[['launch-history-branch','New game before this move','play'],['revert-to-move','Undo before this move','back'],['return-live','Return to live view','board']]){
  assert.match(html,new RegExp(`data-action="${action}"[^>]*>`));
  assert(html.includes(`${icon(glyph)}${label}</button>`));
 }
 assert.match(html,/data-move-id="m"/);
 const viewer=context.history({...game,myRoles:['Viewer']});
 assert.doesNotMatch(viewer,/data-action="revert-to-move"/);
 assert.match(viewer,/data-action="launch-history-branch"/);
 const undone=context.history({...game,moves:[{...game.moves[0],undone:true}]});
 assert.doesNotMatch(undone,/data-action="(?:launch-history-branch|revert-to-move)"/);
 const unselected=context.history({...game,historyIndex:1});
 assert.doesNotMatch(unselected,/data-action="(?:launch-history-branch|revert-to-move)"/);
});
