import {createBoardContextReceiver} from '../shell/board-context-receiver.js';
import {activeRevertRequest,activePendingRevertRequest} from '../shell/undo-request-presentation.js';
import {createGameAlertItems,renderGameAlertStackCard} from '../shell/game-alert-presentation.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationStack,recoveryActivity} from '../shell/notification-state.js';
import {createBoardContextStore,renderBoardContext,renderBoardContextDetails} from '../shell/board-context.js';
import {renderGameAlertCard} from '../shell/game-alert.js';
import {renderComputerProgress} from '../shell/computer-view.js';
import {activityActorSide,undoApprovalActorSide} from '../shell/activity-affiliation.js';
import {icon} from '../shell/ui.js';
import {CURRENT_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';
function fixture(){
 let held=null,failures=[],phase='idle';
 const game={id:'g',gameplayRevision:1,moves:[{moveId:'m',notation:'MOVE'}],currentSnapshot:{sideToMove:'P1'},board:{state:{outcome:{status:'ongoing'}}},player1:{identityId:'requester'},player2:{identityId:'approver'}};
 const stack=createNotificationStack({getInteractionKey:()=>held}),store=createBoardContextStore();
 const ctx={SYNC_TIMING,viewingScope:()=> 'fixture',recoveryPresentationOptions:()=>({}),playbackRecoveryWait:{update:()=>0},liveBoardVisible:()=>true,boardContexts:store,renderBoardContext,renderGameAlertCard,renderComputerProgress,recoveryActivity,activityActorSide,undoApprovalActorSide,icon,notificationStack:stack,
  boardContextScope:()=> 'fixture',boardContextOwner:{commit(){}},displayedReplayFrame:()=>game,
  appEl:{contains:()=>false,querySelector:()=>null},document:{activeElement:null},queueBoardContextRefresh(){},
  contextReplayEnabled:()=>false,transport:{ensureRecoveryIncident:()=>null,getFailedOperations:()=>failures},
  maybeUpdateUndoRequestOutcomeFeedback(){},issueDiagnostics:{list:()=>[],capture:()=> 'incident',resolve(){}},
  recoveryPresentationOptions:()=>({}),presentedRecoveryMessage:value=>value.recovery?'Reload game':'',needsRecoveryAction:value=>Boolean(value.recovery),
  dismissedRecoveryNotices:new Map(),ignoredRevertRequests:new Set(),isDiagnosticOpen:()=>false,
  computerSession:{snapshot:()=>({phase})},undoRequestFeedback:null,undoRequestFeedbackGameId:null,escapeHtml:String};
 ctx.getGameAlertItems=createGameAlertItems(()=>ctx);
 ctx.getActiveRevertRequest=game=>activeRevertRequest(game,ctx.ignoredRevertRequests);ctx.getActivePendingRevertRequest=activePendingRevertRequest;
 ctx.items=ctx.getGameAlertItems;ctx.receive=createBoardContextReceiver(()=>ctx);
 const refresh=()=>ctx.receive({kind:'piece',mandatory:false,message:{text:'Piece help'}},{selectedPieceId:'piece',intentVersion:1,phase:null,continuationPhase:null,transient:false});
 const order=()=>stack.order(game.id,ctx.items(game));
 refresh();assert.deepEqual(order(),[]);assert.match(renderBoardContextDetails(store.items('g')),/Piece help/);
 return {game,ctx,stack,store,refresh,order,hold:value=>{held=value;},fail:value=>{failures=value;},phase:value=>{phase=value;}};
}
const request=id=>({requestId:id,targetMoveId:'m',requesterIdentityId:'requester'});
for(const [field,actions]of [['approvableRevertRequest',['accept-revert-request','reject-revert-request']],['myPendingRevertRequest',['rescind-revert-request']]])test(`${field} becomes actionable ahead of a selected Board context`,()=>{
 const f=fixture();f.game[field]=request('r1');const active=f.order()[0];assert.equal(active.key,'undo-request:r1');
 for(const action of actions)assert.match(active.html,new RegExp('data-action="'+action+'"'));
 assert.match(active.html,/data-request-id="r1"/);f.refresh();assert.equal(f.order()[0].key,'undo-request:r1');
});
for(const blocker of ['failed-operation','sync-recovery','computer-recovery'])test(`${blocker} keeps urgency until cleared before actionable undo`,()=>{
 const f=fixture();
 if(blocker==='failed-operation')f.fail([{id:'failed',error:{message:'Failed'}}]);
 if(blocker==='sync-recovery'){f.game.recovery=true;f.game.storageBlocked=true;}
 if(blocker==='computer-recovery'){f.game.computer={seats:{p1:null,p2:'babs'},modelId:CURRENT_COMPUTER_MODEL.id,takeoverTurn:null};f.game.canControlComputer=true;f.phase('recovery');}
 const prior=f.order()[0];assert.equal(prior.priority,'urgent');assert.doesNotMatch(prior.key,/undo-request/);
 f.game.approvableRevertRequest=request('r');const items=f.ctx.items(f.game);assert.equal(items.find(item=>item.key==='undo-request:r').priority,'normal');assert.equal(f.order()[0].key,prior.key);
 f.fail([]);f.game.recovery=false;f.game.storageBlocked=false;f.phase('idle');delete f.game.computer;
 assert.equal(f.order()[0].key,'undo-request:r');
});
test('focused Board detail cannot conceal Undo while actual focused notices retain explicit cycling',()=>{
 const f=fixture();f.hold(`board-context:${f.store.channel('piece').key}`);f.game.approvableRevertRequest=request('r');assert.equal(f.order()[0].key,'undo-request:r');
 assert.match(renderBoardContextDetails(f.store.items('g')),/Piece help/);f.hold(null);
 f.game.historyNotice='History changed';const contextKey='history-change:g';f.order();
 assert.equal(f.stack.advance('g',f.ctx.items(f.game)),true);assert.equal(f.order()[0].key,contextKey);
 f.hold(contextKey);f.refresh();assert.equal(f.order()[0].key,contextKey,'a quiet Board refresh cannot undo an explicit notice cycle');
 f.hold(null);assert.equal(f.order()[0].key,contextKey);
});
test('replacement and removal retain request identity and never stale action attributes',()=>{
 const f=fixture();f.game.myPendingRevertRequest=request('first');assert.equal(f.order()[0].key,'undo-request:first');
 f.game.myPendingRevertRequest=request('second');const active=f.order()[0];assert.equal(active.key,'undo-request:second');assert.match(active.html,/data-request-id="second"/);assert.doesNotMatch(active.html,/data-request-id="first"/);
 delete f.game.myPendingRevertRequest;assert.deepEqual(f.order(),[]);assert.match(renderBoardContextDetails(f.store.items('g')),/Piece help/);assert(!f.ctx.items(f.game).some(item=>item.key.startsWith('undo-request:')));
});
