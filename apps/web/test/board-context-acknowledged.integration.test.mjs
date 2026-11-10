import {createRecoveryPresentation} from '../shell/recovery-presentation.js';
import {publishAcknowledgedBoardMessage} from '../shell/playback-presentation.js';
import {renderResultPanel} from '../shell/result-panel.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
import {withPushSequenceMessage} from '../shell/push-sequence-replay.js';
import {historyBoardMessage} from '../shell/history-narration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNotificationStack,recoveryActivity} from '../shell/notification-state.js';
import {createBoardContextStore,renderBoardContext} from '../shell/board-context.js';
import {renderGameAlertCard} from '../shell/game-alert.js';
import {renderComputerProgress} from '../shell/computer-view.js';
import {activityActorSide,undoApprovalActorSide} from '../shell/activity-affiliation.js';
import {icon} from '../shell/ui.js';
import {opponentBoardMessage} from '../shell/opponent-narration.js';
import {captureDisplayedReplay} from '../shell/displayed-replay.js';
import {CURRENT_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';
import {createForegroundRecoveryWait} from '../shell/foreground-recovery.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const declaration=name=>{const start=source.indexOf('const '+name+' =');assert(start>=0);const end=source.indexOf('\nconst ',start+6);assert(end>start);return source.slice(start,end);};
function fixture(){
 let held=null,failures=[],phase='idle';
 const game={id:'g',gameplayRevision:1,myRoles:['Player 2'],controlSeat:'Player 2',
  currentSnapshot:{sideToMove:'P2'},board:{state:{turnIndex:1,sideToMove:'P2',outcome:{status:'ongoing'}}},
  player1:{identityId:'other'},player2:{identityId:'me'},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],
  computer:{seats:{p1:'tau',p2:null},modelId:'old-model',takeoverTurn:null},canControlComputer:true,
  moves:[{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',selectionSnapshot:{pieces:[],sideToMove:'P1'},snapshot:{pieces:[],sideToMove:'P2'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:3}}}]};
 const stack=createNotificationStack({getInteractionKey:()=>held}),store=createBoardContextStore();
 const ctx={SYNC_TIMING,viewingScope:()=> 'fixture',recoveryPresentationOptions:()=>({}),playbackRecoveryWait:{update:()=>0},liveBoardVisible:()=>true,historyBoardMessage,opponentBoardMessage,withPushSequenceMessage,captureDisplayedReplay,structuredClone,boardContexts:store,renderBoardContext,renderGameAlertCard,renderComputerProgress,recoveryActivity,activityActorSide,undoApprovalActorSide,icon,notificationStack:stack,
  boardContextScope:()=> 'fixture',boardContextOwner:{commit(){}},displayedReplayFrame:()=>game,
  appEl:{querySelector:()=>null},document:{activeElement:null,hidden:false},queueBoardContextRefresh(){},
  contextReplayEnabled:()=>false,transport:{ensureRecoveryIncident:()=>null,getFailedOperations:()=>failures,getIdentityId:()=> 'me'},
  maybeUpdateUndoRequestOutcomeFeedback(){},issueDiagnostics:{list:()=>[],capture:()=> 'incident',resolve(){}},
  recoveryPresentationOptions:()=>({}),presentedRecoveryMessage:value=>value.recovery?'Reload game':'',needsRecoveryAction:value=>Boolean(value.recovery),
  dismissedRecoveryNotices:new Map(),ignoredRevertRequests:new Set(),isDiagnosticOpen:()=>false,
  computerSession:{snapshot:()=>({phase})},undoRequestFeedback:null,undoRequestFeedbackGameId:null,escapeHtml:String};
 ctx.recoveryPresentation=createRecoveryPresentation(()=>({transport:ctx.transport}));
 runInNewContext(`${declaration('getRevertRequestKey')}${declaration('getActiveRevertRequest')}${declaration('getActivePendingRevertRequest')}${declaration('getGameAlertItems')}${source.slice(source.indexOf('const acknowledgedBoardMessage='),source.indexOf('const dispatchBoardMessageAction='))};globalThis.items=getGameAlertItems;globalThis.receive=receiveBoardContext;globalThis.ack=acknowledgedBoardMessage;`,Object.assign(ctx,{publishAcknowledgedBoardMessage,renderResultPanel}));
 const refresh=()=>ctx.receive({kind:'piece',mandatory:false,message:{text:'Piece help'}},{selectedPieceId:'piece',intentVersion:1,phase:null,continuationPhase:null,transient:false});
 const order=()=>stack.order(game.id,ctx.items(game));
 assert.equal(order()[0].key,'computer:g');
 return {game,ctx,stack,store,refresh,order,ack:()=>ctx.ack(game,{phase:'idle'},{canInteract:true,identityId:'me'}),clearPiece:()=>ctx.receive(null,{selectedPieceId:null,intentVersion:2,phase:null,continuationPhase:null,transient:false}),hold:value=>{held=value;},fail:value=>{failures=value;},phase:value=>{phase=value;}};
}

test('new acknowledged summary becomes visible over a persistent normal opponent update',()=>{
 const f=fixture();f.ack();const active=f.order()[0],ack=f.store.channel('acknowledged');
 assert.equal(active.key,`board-context:${ack.key}`);assert.match(active.html,/Show me again/);
 assert.deepEqual(Array.from(ack.replay.moveIds),['a']);assert.equal(ack.replay.owner,f.ctx.transport);
 f.clearPiece();f.ack();assert.equal(f.order()[0].key,active.key);
});
test('quiet renders and changed copy do not defeat an explicit cycle',()=>{
 const f=fixture();f.ack();f.order();assert(f.stack.advance('g',f.ctx.items(f.game)));assert.equal(f.order()[0].key,'computer:g');
 f.game.moves[0].action.to.row=3;f.ack();f.clearPiece();assert.equal(f.order()[0].key,'computer:g');
});
test('explicit piece help takes precedence then acknowledged context returns when selection clears',()=>{
 const f=fixture();f.refresh();const piece=f.order()[0].key;f.ack();assert.equal(f.order()[0].key,piece);
 f.clearPiece();assert.equal(f.order()[0].key,`board-context:${f.store.channel('acknowledged').key}`);
});
test('focused notice holds a new acknowledged summary until interaction ends',()=>{
 const f=fixture();f.hold('computer:g');f.ack();assert.equal(f.order()[0].key,'computer:g');
 f.hold(null);assert.equal(f.order()[0].key,`board-context:${f.store.channel('acknowledged').key}`);
});
test('urgent recovery and undo remain ahead of normal acknowledged context',()=>{
 for(const blocker of ['recovery','undo']){
  const f=fixture();f.ack();f.order();
  if(blocker==='recovery'){f.game.recovery=true;f.game.storageBlocked=true;}
  else f.game.approvableRevertRequest={requestId:'r',targetMoveId:'a',requesterIdentityId:'other'};
  const active=f.order()[0];assert.equal(active.priority,'urgent');assert.doesNotMatch(active.key,/^board-context:/);
 }
});
test('dismissed context stays dismissed on quiet renders and a genuinely new accepted key can surface',()=>{
 const f=fixture();f.ack();const old=f.store.channel('acknowledged').key;assert(f.store.dismiss(old));
 f.clearPiece();f.ack();assert.equal(f.order()[0].key,'computer:g');assert(f.store.isDismissed(old));
 f.game.gameplayRevision=2;f.game.moves[0].moveId='b';f.ack();const next=f.store.channel('acknowledged');
 assert.notEqual(next.key,old);assert.equal(f.order()[0].key,`board-context:${next.key}`);assert.deepEqual(Array.from(next.replay.moveIds),['b']);
});

for(const kind of ['placeholder','dismissed'])test(`a ${kind} piece entry cannot hide a new accepted summary`,()=>{
 const f=fixture();
 if(kind==='placeholder')f.ctx.receive(null,{selectedPieceId:'piece',intentVersion:1,phase:null,continuationPhase:null,transient:false});
 else {f.refresh();assert(f.store.dismiss(f.store.channel('piece').key));}
 f.ack();
 if(kind==='placeholder')f.ctx.receive(null,{selectedPieceId:'piece',intentVersion:1,phase:null,continuationPhase:null,transient:false});
 else f.refresh();
 assert.equal(f.order()[0].key,`board-context:${f.store.channel('acknowledged').key}`);
});

test('selected recorded History detail uses acknowledged context without replay authority or Board-sized copy',()=>{
 const f=fixture();
 f.game.inHistoryMode=true;f.game.historyIndex=0;
 f.game.inspectedDecision={...f.game.moves[0],index:0,displayMoveNumber:17};
 f.ack();const context=f.store.channel('acknowledged');
 assert.equal(context.message.text,'Tau rushed from (1, 2) to (2, 3)');
 assert.equal(context.replay,null);
 assert.equal(f.store.channel('piece'),null);
 assert.deepEqual(context.message.coordinates,[{row:1,col:2},{row:2,col:3}]);
 assert(f.store.dismiss(context.key));f.ack();
 assert.equal(f.store.items('g').length,0,'quiet renders do not revive selected narration');
});

test('automatic frame context uses pinned recorded identity and shared closure narration without History intent',()=>{
 const f=fixture(),record={...f.game.moves[0],index:16,displayMoveNumber:17,computerProof:{profile:'babs'},destroyedPieces:[]};
 f.game.moves=[record,{moveId:'closure',index:17,turnIndex:0,turnMoveIndex:1,actorSide:'P1',action:{type:'end_turn'},snapshot:{pieces:[],turnIndex:1},destroyedPieces:[{pieceId:'lost',ownerSeat:'P1',position:{row:3,col:4}}]}];
 const before=JSON.stringify(f.game);
 f.ctx.ack(f.game,{phase:'idle'},{identityId:'me',presentationMove:record});const first=f.store.channel('acknowledged');
 assert.equal(first.message.text,'Babs rushed from (1, 2) to (2, 3) and lost piece at (3, 4)');assert.equal(first.replay,null);assert(first.key.includes('real')||first.key.includes(record.moveId));
 assert.equal(JSON.stringify(f.game),before,'presentation must not change authoritative or personal History state');
 f.ctx.ack(f.game,{phase:'idle'},{identityId:'me',presentationMove:record});assert.equal(f.store.channel('acknowledged').key,first.key);
 const next={...record,moveId:'next'};f.ctx.ack(f.game,{phase:'idle'},{identityId:'me',presentationMove:next});assert.notEqual(f.store.channel('acknowledged').key,first.key);
});

function playbackRecoveryFixture(){
 const f=fixture(),timers=new Map();let now=0,nextTimer=0,visible=true;
 f.ctx.playbackRecoveryWait=createForegroundRecoveryWait({clock:()=>now,
  setTimer:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),onChange:()=>f.order()});
 f.ctx.liveBoardVisible=()=>visible;
 f.game.confirmedPlayback={retrying:true,canRetry:true};f.ack();
 const acknowledged=`board-context:${f.store.channel('acknowledged').key}`;
 assert.equal(f.order()[0].key,acknowledged,'Seed the actual preferred acknowledged context');
 runInNewContext(`${declaration('renderGameAlertStackCard')};globalThis.card=renderGameAlertStackCard;`,f.ctx);
 return {...f,acknowledged,recoveryKey:`confirmed-playback-recovery:${f.game.id}`,
  advance(to){assert(to>=now);for(;;){const due=[...timers].filter(([,timer])=>timer.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=to;return f.order();},
  visible(value){visible=value;return f.order();},blocked(value){f.game.confirmedPlayback.retrying=value;return f.order();},
  cardFor(key){const items=f.order(),index=items.findIndex(item=>item.key===key);assert(index>=0);return f.ctx.card({gameId:f.game.id,item:items[index],stackIndex:index,totalAlerts:items.length});}};
}

test('overdue playback Retry becomes an active accessible notice only at the real foreground boundary',()=>{
 const f=playbackRecoveryFixture();
 assert.equal(f.advance(3999).some(item=>item.key===f.recoveryKey),false);
 for(const time of [4000,14999]){
  const items=f.advance(time),notice=items.find(item=>item.key===f.recoveryKey);
  assert.equal(notice.priority??'normal','normal');assert.equal(items[0].key,f.acknowledged);
  assert.match(notice.html,/Loading the move\./);assert.doesNotMatch(notice.html,/retry-confirmed-playback/);
 }
 const items=f.advance(15000),notice=items.find(item=>item.key===f.recoveryKey);
 assert.equal(items[0].key,f.recoveryKey);assert.equal(notice.priority,'urgent');
 const card=f.cardFor(f.recoveryKey);assert.match(card,/is-active/);assert.match(card,/data-stack-index="0"/);
 assert.doesNotMatch(card,/aria-hidden="true"|\sinert(?:\s|>)/);
 assert.match(card,/<button class="secondary mini-button" data-action="retry-confirmed-playback" >Retry<\/button>/);
 assert.match(card,/Still loading the move\. Retrying in the background\./);
});

test('a focused context holds overdue playback Retry until interaction ends',()=>{
 const f=playbackRecoveryFixture();f.hold(f.acknowledged);
 const held=f.advance(15000);assert.equal(held.find(item=>item.key===f.recoveryKey).priority,'urgent');assert.equal(held[0].key,f.acknowledged);
 assert.match(f.cardFor(f.recoveryKey),/aria-hidden="true" tabindex="-1" inert/);
 f.hold(null);assert.equal(f.order()[0].key,f.recoveryKey);
 assert.doesNotMatch(f.cardFor(f.recoveryKey),/aria-hidden="true"|\sinert(?:\s|>)/);
});

test('hidden time and settled playback cannot carry an old Retry deadline into a new foreground wait',()=>{
 const f=playbackRecoveryFixture();f.advance(14999);
 assert.equal(f.visible(false).some(item=>item.key===f.recoveryKey),false);
 f.advance(600000);assert.equal(f.visible(true).some(item=>item.key===f.recoveryKey),false);
 assert.equal(f.advance(603999).some(item=>item.key===f.recoveryKey),false);
 assert.equal(f.advance(604000).find(item=>item.key===f.recoveryKey).priority??'normal','normal');
 assert.equal(f.advance(614999).find(item=>item.key===f.recoveryKey).priority??'normal','normal');
 assert.equal(f.advance(615000)[0].key,f.recoveryKey);
 assert.equal(f.blocked(false).some(item=>item.key===f.recoveryKey),false);
 f.advance(900000);assert.equal(f.blocked(true).some(item=>item.key===f.recoveryKey),false);
 assert.equal(f.advance(914999).find(item=>item.key===f.recoveryKey).priority??'normal','normal');
 assert.equal(f.advance(915000)[0].key,f.recoveryKey);
});
