import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameAlertItems} from '../shell/game-alert-presentation.js';
import {boardContextPlacement} from '../shell/board-context-purpose.js';
import {createBoardContextStore,renderBoardContextDetails} from '../shell/board-context.js';

const fixture = () => {
 const store=createBoardContextStore();
 const dependencies={transport:{getFailedOperations:()=>[{id:'failure',error:{message:'Keep this failure actionable'}}]},maybeUpdateUndoRequestOutcomeFeedback(){},
  presentedRecoveryMessage:()=>null,needsRecoveryAction:()=>false,recoveryPresentationOptions:()=>({}),
  issueDiagnostics:{list:()=>[],capture:()=> 'incident',resolve(){}},isDiagnosticOpen:()=>false,dismissedRecoveryNotices:new Map(),escapeHtml:String,
  playbackRecoveryWait:{update:()=>0},viewingScope:()=> 'scope',liveBoardVisible:()=>true,SYNC_TIMING:{reconnectAlertMs:4000,confirmationBudgetMs:15000},renderComputerProgress:()=>'',computerSession:null,
  getActiveRevertRequest:()=>null,getActivePendingRevertRequest:()=>null,boardContextScope:()=> 'scope',boardContexts:store,contextReplayEnabled:()=>false};
 return {store,items:createGameAlertItems(()=>dependencies)};
};

test('actual notice producer keeps urgent errors while typed Board details use their independent host',()=>{
 const f=fixture();
 f.store.update('acknowledged',{key:'incoming',gameId:'g',purpose:'incoming-narration',message:{purpose:'selected-history',text:'Maya passed'}});
 f.store.update('piece',{key:'required',gameId:'g',purpose:'required-continuation',mandatory:true,message:{text:'Required Follow'}});
 const items=f.items({id:'g'});assert.deepEqual(items.map(item=>item.key),['failed:failure']);
 assert.match(items[0].html,/Keep this failure actionable/);assert.match(items[0].html,/dismiss-failed-operation/);assert.match(renderBoardContextDetails(f.store.items('g')),/Required Follow/);
 f.store.update('acknowledged',{key:'unknown',gameId:'g',message:{purpose:'incoming-narration',text:'Incoming move'}});
 assert.deepEqual(f.items({id:'g'}).map(item=>item.key),['failed:failure','board-context:unknown'],'unknown outer purpose cannot be silently moved with a mixed channel');
});

for(const purpose of ['selected-history','piece-inspection','required-continuation','replay-progress','local-sequence','board-context']) {
 test(`outer ${purpose} remains a scrollable Board detail with native actions`,()=>{
  const f=fixture();const context={key:'detail',gameId:'g',purpose,mandatory:purpose==='required-continuation',replay:{moveIds:['record']},message:{purpose:'incoming-narration',text:'Recorded & inspected (2, 3)',action:'must-not-submit'}};
  f.store.update('piece',context);
  assert.equal(boardContextPlacement(context),'board');assert.deepEqual(f.items({id:'g'}).map(item=>item.key),['failed:failure']);
  const html=renderBoardContextDetails(f.store.items('g'),{replayEnabled:()=>true});
  assert.match(html,/class="board-context-detail"/);assert.match(html,/data-context-active-host="true"/);assert.match(html,/class="board-context-body" role="region"/);
  assert.match(html,/Recorded &amp; inspected/);assert.match(html,/data-action="replay-board-context"/);assert.doesNotMatch(html,/shell-game-alert|notice-paper|must-not-submit| disabled/);
  if(context.mandatory)assert.doesNotMatch(html,/dismiss-board-context/);else assert.match(html,/dismiss-board-context/);
 });
}
test('completed-game gameplay activity remains Board-owned and never becomes a notification',()=>{
 const f=fixture(),context={key:'completed-activity',gameId:'g',purpose:'board-context',message:{text:'Maya completed the winning turn'}};
 f.store.update('acknowledged',context);
 assert.equal(boardContextPlacement(context),'board');
 assert.deepEqual(f.items({id:'g'}).map(item=>item.key),['failed:failure']);
 assert.match(renderBoardContextDetails(f.store.items('g')),/Maya completed the winning turn/);
});
test('final outer classification never promotes unknown or incoming contexts to Board details',()=>{
 const contexts=[{key:'unknown',gameId:'g',message:{purpose:'piece-inspection',text:'Unknown'}},{key:'incoming',gameId:'g',purpose:'incoming-narration',message:{purpose:'selected-history',text:'Incoming'}}];
 assert.deepEqual(contexts.map(boardContextPlacement),['notice','incoming']);assert.equal(renderBoardContextDetails(contexts),'');
});
