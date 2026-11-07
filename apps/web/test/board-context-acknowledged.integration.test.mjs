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
 const ctx={opponentBoardMessage,captureDisplayedReplay,structuredClone,boardContexts:store,renderBoardContext,renderGameAlertCard,renderComputerProgress,recoveryActivity,activityActorSide,undoApprovalActorSide,icon,notificationStack:stack,
  boardContextScope:()=> 'fixture',boardContextOwner:{commit(){}},displayedReplayFrame:()=>game,
  appEl:{querySelector:()=>null},document:{activeElement:null,hidden:false},queueBoardContextRefresh(){},
  contextReplayEnabled:()=>false,transport:{getFailedOperations:()=>failures,getIdentityId:()=> 'me'},
  maybeUpdateUndoRequestOutcomeFeedback(){},issueDiagnostics:{list:()=>[],capture:()=> 'incident',resolve(){}},
  presentedRecoveryMessage:value=>value.recovery?'Reload game':'',needsRecoveryAction:value=>Boolean(value.recovery),
  dismissedRecoveryNotices:new Map(),ignoredRevertRequests:new Set(),isDiagnosticOpen:()=>false,
  computerSession:{snapshot:()=>({phase})},undoRequestFeedback:null,undoRequestFeedbackGameId:null,escapeHtml:String};
 runInNewContext(`${declaration('getRevertRequestKey')}${declaration('getActiveRevertRequest')}${declaration('getActivePendingRevertRequest')}${declaration('getGameAlertItems')}${source.slice(source.indexOf('const acknowledgedBoardMessage='),source.indexOf('const dispatchBoardMessageAction='))};globalThis.items=getGameAlertItems;globalThis.receive=receiveBoardContext;globalThis.ack=acknowledgedBoardMessage;`,ctx);
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
