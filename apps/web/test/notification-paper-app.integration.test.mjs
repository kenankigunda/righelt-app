import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGameAlertCard} from '../shell/game-alert.js';
import {createNotificationPaper,paperInformationEligible} from '../shell/notification-paper.js';
import {createBoardContextStore,renderBoardContext} from '../shell/board-context.js';
import {createGameAlertItems,renderGameAlertStackCard,createNotificationPatchLifecycle} from '../shell/game-alert-presentation.js';
import {PaperNode,paperCard,paperDocument} from './fixtures/paper-dom.mjs';
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('actual app stack renderer carries only closed source-kind eligibility, with existing native active/inert ownership',()=>{
 const render=options=>renderGameAlertStackCard(options,escapeHtml);
 for(const paperKind of ['history-change','undo-outcome','untrusted-kind']){
  const html=render({gameId:'g',item:{key:'same',paperKind,html:renderGameAlertCard({body:'Actual information'})},stackIndex:0,totalAlerts:1});
  assert.match(html,/data-notification-id="same"/);assert.match(html,new RegExp(`data-paper-kind="${paperKind==='untrusted-kind'?'':paperKind}"`));assert.doesNotMatch(html,/data-action="cycle-game-alert-stack"/);
 }
 const inactive=render({gameId:'g',item:{key:'same',paperKind:'history-change',priority:'urgent',html:''},stackIndex:1,totalAlerts:2});assert.match(inactive,/data-paper-priority="urgent"/);assert.match(inactive,/aria-hidden="true" tabindex="-1" inert/);
 const active=render({gameId:'g',item:{key:'same',paperKind:'history-change',html:''},stackIndex:0,totalAlerts:2});assert.match(active,/data-action="cycle-game-alert-stack"/);assert.match(active,/tabindex="0"/);
});
test('actual app patch wrapper executes current keyed patch then coalesces paper without replacing controls or restarting an incident',()=>{
 const document=paperDocument(),frames=new Map();let id=0,time=0,generation=1;const cues=[];
 const presentation=createNotificationPaper({document,sound:{paper:(...a)=>cues.push(a),cancelPaper(){}},scope:()=>`${generation}:game:g`,active:()=>true,reduced:()=>false,now:()=>time,requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:i=>frames.delete(i)});
 const patches=createNotificationPatchLifecycle(presentation);
 const patch=cards=>{const next=new PaperNode('div',{id:'shell-game-alerts'});next.append(...cards);patches.patchTree(document.region,next);};
 patch([]);patch([paperCard()]);assert.equal(cues.length,1);const card=document.region.children[0];time=200;patch([paperCard({copy:'Same incident updated'})]);assert.equal(document.region.children[0],card);assert.equal(cues.length,1);
 patch([paperCard({action:true})]);const button=card.querySelector('button');let count=0;button.addEventListener('click',()=>count++);button.click();assert.equal(count,1);assert.equal(card.querySelector('.shell-game-alert').style.clipPath,undefined);
 generation=2;patch([paperCard()]);assert.equal(cues.length,1,'new account baselines current notice without replay');presentation.retire();assert.equal(frames.size,0);
});
test('actual item owner reaches eligible history-change and Undo outcome after real acknowledged context dismissal',()=>{
 const boardContexts=createBoardContextStore();boardContexts.update('acknowledged',{key:'ack:g:m1',gameId:'g',message:{text:'Acknowledged move'},mandatory:false});
 const names={renderGameAlertCard,renderBoardContext,contextReplayEnabled:()=>false,escapeHtml,transport:{getFailedOperations:()=>[]},maybeUpdateUndoRequestOutcomeFeedback(){},presentedRecoveryMessage:()=>null,needsRecoveryAction:()=>false,recoveryPresentationOptions:()=>({}),issueDiagnostics:{list:()=>[]},dismissedRecoveryNotices:new Map(),playbackRecoveryWait:{update:()=>0},viewingScope:()=> 'g:1',liveBoardVisible:()=>true,SYNC_TIMING:{reconnectAlertMs:4000,confirmationBudgetMs:15000},renderComputerProgress:()=>'',computerSession:{snapshot:()=>({})},getActiveRevertRequest:()=>null,getActivePendingRevertRequest:()=>null,undoRequestFeedback:null,undoRequestFeedbackGameId:'g',boardContextScope(){},boardContexts};
 const owner=overrides=>createGameAlertItems(()=>({...names,...overrides}));
 assert.equal(owner()({id:'g'}).length,1,'real acknowledged context occupies the stack before source-owned dismissal');
 assert.equal(boardContexts.dismiss('ack:g:m1'),true);assert.equal(boardContexts.items('g').length,0);
 for(const [get,game,kind]of [[owner(),{id:'g',historyNotice:'History changed'},'history-change'],[owner({undoRequestFeedback:'Undo request cancelled'}),{id:'g'},'undo-outcome']]){
  const items=get(game);assert.equal(items.length,1);const [item]=items;assert.equal(item.paperKind,kind);assert.doesNotMatch(item.html,/data-action=/);
  assert.equal(paperInformationEligible({kind:item.paperKind,priority:item.priority,count:items.length}),true,'actual ordinary source item can receive full selected motion; no demo-only kind');
 }
 let feedback=null;
 const liveOwner=createGameAlertItems(()=>({...names,undoRequestFeedback:feedback,maybeUpdateUndoRequestOutcomeFeedback(){feedback='Updated during this render';}}));
 assert.match(liveOwner({id:'g'})[0].html,/Updated during this render/,'live feedback must be read after its source updater, not snapshotted at factory entry');
 assert.equal(boardContexts.isDismissed('ack:g:m1'),true,'presentation qualification never acknowledges or revives source context');
});


test('actual full-render replacement path captures current geometry before preserved-header patch, replacement or first markup assignment',()=>{
 for(const path of ['header','replace','markup','home','unchanged']){
  const calls=[],nextMain={},currentMain=path==='markup'?null:{replaceWith:node=>{assert.equal(node,nextMain);calls.push('replace');}};
  const appEl={querySelector:()=>currentMain,set innerHTML(value){assert.equal(value,'next');calls.push('markup');}};
  const inputs={nextMarkup:'next',lastRenderedMarkup:path==='unchanged'?'next':'old',routeName:path==='home'?'home':'game',patchHomeAroundCreateControl:()=>{assert.equal(path,'home');calls.push('home');return true;},appEl,createMarkupRoot:()=>({querySelector:()=>nextMain}),updateMountedFlyouts:()=>calls.push('flyouts')};
  const patches=createNotificationPatchLifecycle({captureBeforePatch:()=>calls.push('capture')},{replaceMain:(a,b)=>{assert.equal(a,currentMain);assert.equal(b,nextMain);calls.push('header');return path==='header';}});
  assert.equal(patches.patchMainMarkup(inputs),path!=='unchanged');
  assert.equal(calls[0],'capture');if(!['home','unchanged'].includes(path))assert.ok(calls.includes(path));assert.equal(calls.filter(c=>c==='capture').length,1);
  assert.deepEqual(calls,({header:['capture','header','flyouts'],replace:['capture','header','replace','flyouts'],markup:['capture','markup'],home:['capture','home'],unchanged:['capture']})[path]);
 }
});
