import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isOngoingGame} from '../shell/game-lifecycle.js';
import {renderHistoryResult,getGameResult} from '../shell/game-result.js';
import {renderHistorySlots} from '../shell/panel-loading.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const fixture=status=>({id:'g',myRole:'Player 1',player1:{identityId:'me'},player2:{identityId:'other'},board:{state:{outcome:{status}}},canRecordMove:true,canEndTurn:true,control:'turn-owner'});
test('actual board admission rejects stale permissions and historical ongoing views after completion',()=>{
 const statement=source.slice(source.indexOf('const canControlLiveBoard ='),source.indexOf('const getVisibleHomeSectionKeys ='));
 const context={isOngoingGame,account:{canPlay:()=>true}};runInNewContext(`${statement};globalThis.canAct=canControlLiveBoard;`,context);
 assert.equal(context.canAct(fixture('ongoing')),true);
 for(const status of ['p1_win','p2_win','draw']){
  const game=fixture(status);assert.equal(context.canAct(game),false);
  assert.equal(context.canAct({...game,board:{state:{outcome:{status:'ongoing'}}},liveCurrentSnapshot:game.board.state}),false);
 }
});
test('actual History panel places the authoritative winner before moves even during old-position review',()=>{
 const start=source.indexOf('const renderHistoryPanel ='),end=source.indexOf('const renderBoardPanel =',start);
 for(const status of ['p1_win','p2_win','draw']){
  const game=fixture(status),context={renderHistoryResult,renderHistorySlots,getGameResult,transport:{getAuthoritativeGame:()=>game,getIdentityId:()=> 'me'},renderTurnHistory:()=>'<li>recorded move</li>',renderAdditionalHistory:()=>'',icon:()=>'',escapeHtml:value=>value};
  runInNewContext(`${source.slice(start,end)};globalThis.history=renderHistoryPanel;`,context);
  for(const view of [game,{...game,inHistoryMode:true,board:{state:{outcome:{status:'ongoing'}}}}]){
   const html=context.history(view);assert.match(html,/history-result-summary/);assert.ok(html.indexOf('history-result-summary')<html.indexOf('recorded move'));assert.match(html,/View result/);
  }
 }
});

test('pending confirmed winning frames expose neither the result button nor a stale result action',()=>{
 const authoritative=fixture('p1_win'),view={...fixture('ongoing'),confirmedPlayback:{playing:true}};let rendered=0,cleared=0;
 const context={renderHistoryResult,renderHistorySlots,getGameResult,transport:{getAuthoritativeGame:()=>authoritative,getGameViewModel:()=>view,getIdentityId:()=> 'me'},renderTurnHistory:()=>'<li>recorded move</li>',renderAdditionalHistory:()=>'',icon:()=>'',escapeHtml:value=>value};
 const start=source.indexOf('const renderHistoryPanel ='),end=source.indexOf('const renderBoardPanel =',start);runInNewContext(`${source.slice(start,end)};globalThis.history=renderHistoryPanel;`,context);
 assert.doesNotMatch(context.history(view),/history-result-summary|View result/);
 const action=source.split('\n').find(line=>line.includes('if (action === "view-result")'));Object.assign(context,{action:'view-result',actionGameId:'g',resultPresentation:{clear:()=>cleared++},activeResultGameId:null,render:()=>rendered++});
 runInNewContext(`(()=>{${action}})();`,context);assert.equal(rendered,0);assert.equal(cleared,0);assert.equal(context.activeResultGameId,null);
 delete view.confirmedPlayback;runInNewContext(`(()=>{${action}})();`,context);assert.equal(rendered,1);assert.equal(context.activeResultGameId,'g');
});
