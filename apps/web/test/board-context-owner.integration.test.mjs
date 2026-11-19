import {createBoardContextPresentation} from '../shell/board-context-presentation.js';
import {deriveBoardView} from '../shell/viewing-state.js';
import {createDisplayedReplayStarter,displayedReplayFocusTarget} from '../shell/displayed-replay-starter.js';
import {createRenderGestureGate} from '../shell/render-gesture.js';
import {createDestinationRouteOwner,destinationReadScope} from '../shell/destination-route-owner.js';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
import {publishAcknowledgedBoardMessage,contextReplayAvailable} from '../shell/playback-presentation.js';
import {withPushSequenceMessage} from '../shell/push-sequence-replay.js';
import {historyBoardMessage} from '../shell/history-narration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardContextStore} from '../shell/board-context.js';
import {createBoardContextOwner,createBoardContextFocus} from '../shell/board-context-owner.js';
import {captureDisplayedReplay,displayedReplayIsCurrent,replayArchiveMatches} from '../shell/displayed-replay.js';
import {createReplayRequest} from '../shell/replay-request.js';
import {opponentBoardMessage} from '../shell/opponent-narration.js';
import {syncRecoverySpace} from '../shell/recovery-space.js';
import {mountHoverTooltips} from '../shell/hover-tooltip.js';

// Execute imported production owners and replay lineage builders. Browser
// rendering, document events and geometry remain explicit controlled boundaries.
const events=()=>{
 const listeners=new Map();
 return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type,extra={}){for(const fn of [...listeners.get(type)??[]])fn({type,...extra});},count(){return [...listeners.values()].reduce((n,set)=>n+set.size,0);}};
};
const accepted=()=>({id:'game',gameplayRevision:4,myRoles:['Player 2'],player1:{identityId:'other'},player2:{identityId:'me'},board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{moveId:'move',turnIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:2}}}]});
test('displayed replay focus accepts every supported live replacement host and rejects unrelated controls',()=>{
 const acceptedSelectors=[];
 for(const selector of ['#shell-board-preview-label [data-action^="replay-"]','#shell-board-preview-label [data-board-message-action^="replay-"]','[data-incoming-context] [data-action="replay-board-context"]','.history-live-replay [data-action="replay-board-context"]']){
  const target={closest:query=>{acceptedSelectors.push(query);return query.split(',').includes(selector)?{}:null;}};
  assert.equal(displayedReplayFocusTarget(target),true);
 }
 assert.equal(displayedReplayFocusTarget({closest:()=>null}),false);
 assert.equal(acceptedSelectors.every(query=>query.includes('[data-incoming-context]')&&query.includes('.history-live-replay')),true);
});
function fixture(t){
 const queued=[],reveals=[],plays=[],admissions=[],renders=[],win=events(),doc={...events(),defaultView:win,hidden:false};
 const owners=[],observers=new Set();
 Object.assign(win,{setTimeout,clearTimeout,MutationObserver:class {
  constructor(callback){this.callback=callback;}
  observe(target,options){this.target=target;this.options=options;observers.add(this);}
  disconnect(){observers.delete(this);}
 }});
 const node=(kind)=>({kind,isConnected:true,disabled:false,dataset:{},setAttribute(){},append(){},closest(selector){return selector.includes('data-board-context')&&kind==='dismiss'?{contains:value=>value===this}:null;},focus(){doc.activeElement=this;doc.fire('focusin',{target:this});}});
 doc.body=node('body');doc.activeElement=doc.body;doc.createElement=()=>node('announcement');
 const board=node('board-guidance'),button=node('replay'),dismiss=node('dismiss');
 const root=node('root');
 const app={ownerDocument:doc,querySelectorAll:()=>[],contains:value=>[board,button,dismiss,root].includes(value),querySelector:selector=>selector==='[data-game-shell-root]'?{dataset:{gameId:'game'}}:selector==='[data-testid="game-board-wrap"]'?root:selector==='.board-message-live'?board:null};
 let resolveArchive;const archive=new Promise(resolve=>{resolveArchive=resolve;});
 const transport={getGameViewModel:()=>context.view,getAuthoritativeGame:()=>context.view,getIdentityId:()=>'me',decisionHistory:()=>archive};
 const requests=createReplayRequest();
 t.after(()=>{for(const owner of [...owners].reverse())owner.destroy();assert.equal(observers.size,0);assert.equal(doc.count(),0);assert.equal(win.count(),0);});
 const destinationRecovery=createDestinationRecovery({setTimer:()=>null,clearTimer(){}});
 t.after(()=>destinationRecovery.reset());
 const context={createDestinationRouteOwner,destinationReadScope,destinationRecovery,syncDestinationNotice(){},canHydrateRouteFromLocalState:()=>Boolean(context.transport.getGameViewModel(context.currentRoute.gameId)),mountHoverTooltips(root){const owner=mountHoverTooltips(root);owners.push(owner);return owner;},publishAcknowledgedBoardMessage,contextReplayAvailable,confirmedPlayback:null,forcedFollowWorking:()=>false,historyBoardMessage,view:accepted(),scopeGeneration:'accountA:storageA',document:doc,appEl:app,queueMicrotask:fn=>queued.push(fn),
 syncRecoverySpace(app){syncRecoverySpace(app);admissions.push('recovery');},
 createBoardContextStore,createBoardContextOwner,createBoardContextFocus(...args){const owner=createBoardContextFocus(...args);owners.push(owner);return owner;},createBoardContextLayout:()=>({sync(){admissions.push('layout');},reveal:(target,current)=>{if(current())reveals.push(target);}}),
 captureDisplayedReplay,displayedReplayIsCurrent,replayArchiveMatches,opponentBoardMessage,withPushSequenceMessage,transport,replayRequests:requests,
 window:win,captureRouteRead:()=>({route:context.currentRoute}),routeReadIsCurrent:()=>true,syncLiveChannels(){},render:options=>renders.push(options),syncRouteDataAndLiveChannels:async()=>{throw new Error('navigation failed');},issueDiagnostics:{resolve(){},capture(){}},invitationLoadFailureKind:()=> 'network',maybeRevealRouteTransition(){},
 routeHydrated:true,mountedBoardGameId:'game',getShellLayoutMode:()=>'narrow',getGamePanel:()=>context.currentRoute.panel??'board',getCurrentGameHashState:panel=>({panel}),buildGameHash:()=> '#/game/game/board',navigateTo:()=>{},
 currentRoute:{name:'game',gameId:'game'},getCurrentViewedGameId:()=>'game',getBoardGame:game=>game,viewingScope:()=>context.scopeGeneration,
 notificationStack:{prefer(){}},updateMountedHeader:()=>false,renderHistoryPanel:()=>'',patchToolHtml(){},syncRenderedMarkupSnapshot(){},boardRuntime:{refreshStatus(){},setInteractionBlocked(){}},

 createEngineBoardAdapter(){},prefersReducedMotion:()=>false,
 createComputerReplay:options=>({play:async payload=>{plays.push(payload);context.beforeReplayFinish?.();options.onFinish({reason:context.replayFinishReason??'completed'});},destroy(){},snapshot:()=>({playing:false}),stop(){}}),CSS:{escape:value=>value},
 };
 context.boardContextVisit=0;context.replayController=null;
 context.renderGesture=createRenderGestureGate({render:context.render,schedule:fn=>{queued.push(fn);return fn;},cancel:fn=>{const index=queued.indexOf(fn);if(index>=0)queued.splice(index,1);}});owners.push(context.renderGesture);
 const presentation=createBoardContextPresentation({appEl:app,document:doc,getDependencies:()=>context,enqueue:fn=>queued.push(fn),createLayout:context.createBoardContextLayout});
 owners.push(presentation);context.presentation=presentation;
 context.startComputerReplay=createDisplayedReplayStarter(()=>({...context,setReplayController:value=>{context.replayController=value;}}),{createReplay:context.createComputerReplay});
 const routeState={routeSyncRequestId:0,inviteLoadState:null,resolvedInvite:null,homeSectionsHydrated:false,destinationLoadPresentation:null,
  get routeHydrated(){return context.routeHydrated;},set routeHydrated(value){context.routeHydrated=value;}};
 const destinationOwner=createDestinationRouteOwner(()=>({...context,state:routeState,cancelPendingBoardContextReplay:presentation.cancel}));
 const c={receive:presentation.receive,ack:presentation.ack,scope:presentation.scope,owner:presentation.owner,store:presentation.store,replay:context.startComputerReplay,dismiss:presentation.dismiss,
  replayAction:presentation.replayAction,previousDescriptor:presentation.previousTurnReplayDescriptor,replayPrevious:presentation.replayPreviousTurn,dispatch:presentation.dispatch,routeSync:destinationOwner.start,resume:presentation.resume,pending:()=>presentation.state.pendingBoardContextReplay,focus:presentation.focus,
  retire:()=>{context.boardContextVisit++;presentation.owner.retire();}};
 const meta=(intentVersion=0)=>({selectedPieceId:null,phase:null,continuationPhase:null,intentVersion,transient:false});
 c.receive(null,meta());
 const flush=async()=>{
  // The app-render queue is controlled, but the imported focus owner's native
  // microtask queue stays native. Run the earlier UI patch before yielding to
  // its real queued return, matching production FIFO ordering.
  while(queued.length)queued.shift()();await Promise.resolve();
  while(queued.length)queued.shift()();await Promise.resolve();
 };while(queued.length)queued.shift()();admissions.length=0;
 return {c,doc,win,context,board,button,dismiss,root,requests,plays,reveals,admissions,renders,meta,flush,observerCount:()=>observers.size,notifyMutations:()=>{for(const observer of [...observers])observer.callback([]);},releaseArchive:()=>resolveArchive({items:[{id:context.view.moves[0].moveId,move:{...context.view.moves[0],index:0,turnMoveIndex:0,selectionSnapshot:{pieces:[],sideToMove:'P1'},snapshot:{pieces:[],sideToMove:'P2'}}}],nextCursor:null}),descriptor:()=>captureDisplayedReplay({game:context.view,owner:transport,scope:c.scope(),identityId:'me'})};
}

test('actual queued context refresh invokes the real recovery helper before layout and coalesces changes',async t=>{
 const f=fixture(t);
 f.c.receive({message:{text:'First explanation'}},{...f.meta(1),selectedPieceId:'first'});
 f.c.receive({message:{text:'Current explanation'}},{...f.meta(2),selectedPieceId:'second'});
 assert.deepEqual(f.admissions,[],'presentation remains in the original queue');
 await f.flush();assert.deepEqual(f.admissions,['recovery','layout']);
 assert.equal(f.c.store.channel('piece').message.text,'Current explanation');
});

test('production callback retires a pending archive on the first committed selection before response release',async t=>{
 const f=fixture(t);f.button.focus();
 const pending=f.c.replay(f.descriptor(),f.button);assert.equal(f.requests.snapshot().phase,'loading');
 f.c.receive({message:{text:'No supply'}},{...f.meta(1),selectedPieceId:'piece'});
 assert.equal(f.requests.snapshot(),null);
 f.releaseArchive();await pending;await f.flush();assert.equal(f.plays.length,0);assert.equal(f.reveals.length,0);
});
test('mobile previous-turn activation reuses the exact current acknowledged replay owner',async t=>{
 const f=fixture(t);f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});
 const episode=`account:game:0:move`,descriptor=f.c.previousDescriptor(episode);
 assert.equal(descriptor?.key,f.c.store.channel('acknowledged').replay.key);
 assert.equal(f.c.previousDescriptor('account:game:1:move'),null);
 assert.equal(f.c.replayPrevious(episode,f.button),true);assert.equal(f.requests.snapshot().phase,'loading');
 assert.equal(f.c.replayPrevious(episode,f.button),false,'the pending replay remains single-owner');
 f.releaseArchive();for(let i=0;i<4;i++)await Promise.resolve();await f.flush();assert.equal(f.plays.length,1);
});
test('production scope retires both context channels on account and same-game history view changes',t=>{
 const f=fixture(t),notice={message:{text:'Reason'}};
 f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});
 f.c.receive(notice,{...f.meta(1),selectedPieceId:'piece'});
 const a=f.c.store.channel('acknowledged'),piece=f.c.store.channel('piece');assert(a&&piece);
 f.c.store.dismiss(a.key);f.c.store.dismiss(piece.key);assert.equal(f.c.store.takeAnnouncement(a.key),null);
 f.context.scopeGeneration='accountB:storageB';f.c.scope();assert.equal(f.c.store.get(a.key),null);assert.equal(f.c.store.channel('piece'),null);
 f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});
 const b=f.c.store.channel('acknowledged');assert.notEqual(b.key,a.key);assert(!f.c.store.isDismissed(b.key));assert(f.c.store.takeAnnouncement(b.key));
 const token=f.c.owner.capture();f.context.view={...f.context.view,inHistoryMode:true,historyIndex:0};f.c.scope();assert(!f.c.owner.current(token));assert.equal(f.c.store.get(b.key),null);
 f.context.view={...f.context.view,inHistoryMode:false};f.c.scope();assert.notEqual(f.c.scope(),token.scope);
});
test('actual queued dismissal reaches informational Board guidance and loses to a later native outside focus',async t=>{
 const f=fixture(t);f.c.receive({message:{text:'Observer context'}},f.meta());const key=f.c.store.channel('piece').key;
 f.dismiss.dataset.boardContextKey=key;f.dismiss.focus();const removed=f.c.dismiss(f.dismiss);f.dismiss.isConnected=false;f.doc.activeElement=f.doc.body;
 await f.flush();await removed;assert.equal(f.doc.activeElement,f.board);assert.deepEqual(f.reveals,[f.board]);
 f.c.receive({message:{text:'Completed context'}},{...f.meta(1),selectedPieceId:'other'});f.dismiss.dataset.boardContextKey=f.c.store.channel('piece').key;f.dismiss.isConnected=true;f.dismiss.focus();const dismissed=f.c.dismiss(f.dismiss);
 const outside={isConnected:true};f.doc.activeElement=outside;f.doc.fire('focusin',{target:outside});await f.flush();await dismissed;assert.equal(f.doc.activeElement,outside);assert.equal(f.reveals.length,1);
});
for(const boundary of ['blank pointer','blur','hidden','replacement body','new account','new view'])test(`replay focus return loses to ${boundary} during the actual pending archive`,async t=>{
 const f=fixture(t);f.button.focus();const pending=f.c.replay(f.descriptor(),f.button);
 if(boundary==='blank pointer')f.doc.fire('pointerdown',{target:{}});
 if(boundary==='blur')f.win.fire('blur');
 if(boundary==='hidden'){f.doc.hidden=true;f.doc.fire('visibilitychange');f.doc.hidden=false;}
 if(boundary==='replacement body'){f.button.isConnected=false;f.doc.activeElement=f.doc.body;}
 if(boundary==='new account'){f.context.scopeGeneration='new';f.c.scope();}
 if(boundary==='new view')f.c.retire();
 f.releaseArchive();await pending;await f.flush();assert.equal(f.reveals.length,0);
 if(['new account','new view'].includes(boundary))assert.equal(f.plays.length,0);
});
test('same-intent replay completion returns focus with explicit pointer-mode visibility correction',async t=>{
 const f=fixture(t);f.button.focus();const pending=f.c.replay(f.descriptor(),f.button);f.releaseArchive();await pending;await f.flush();assert.equal(f.plays.length,1);assert.deepEqual(f.plays[0].frames.map(frame=>frame.decisionId),['move']);assert.deepEqual(f.plays[0].frames[0].after,{pieces:[],sideToMove:'P2'});assert.equal(f.doc.activeElement,f.button);assert.deepEqual(f.reveals,[f.button]);
});

test('incoming replay completion prefers its current keyed action over a stale connected trigger',async t=>{
 const f=fixture(t),descriptor=f.descriptor(),replacement={...f.button,isConnected:true,dataset:{action:'replay-board-context',boardContextKey:descriptor.key},getClientRects:()=>[{}],focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 f.button.dataset={...replacement.dataset};f.button.closest=selector=>selector.includes('[data-incoming-context]')?{}:null;f.button.focus();
 const querySelectorAll=f.context.appEl.querySelectorAll.bind(f.context.appEl);
 let replacementSelector=null;f.button.getClientRects=()=>[];f.context.appEl.querySelectorAll=selector=>{if(selector.includes(`[data-board-context-key="${descriptor.key}"]`)){replacementSelector=selector;return [f.button,replacement];}return querySelectorAll(selector);};
 f.context.beforeReplayFinish=()=>{f.button.closest=selector=>selector.includes('[data-incoming-context]')||selector.includes('[inert]')?{}:null;f.doc.activeElement=f.doc.body;};
 const pending=f.c.replay(descriptor,f.button);f.releaseArchive();await pending;await f.flush();
 assert.equal(f.plays.length,1);assert.match(replacementSelector,/^\[data-incoming-context\]/);assert.equal(f.doc.activeElement,replacement);assert.deepEqual(f.reveals,[replacement]);
});

test('a newer replay retires an older deferred focus return before its mutation or timeout can steal focus',async t=>{
 const f=fixture(t),descriptor=f.descriptor();f.button.dataset={action:'replay-board-context',boardContextKey:descriptor.key};f.button.closest=selector=>selector.includes('[data-incoming-context]')?{}:null;f.button.focus();
 f.context.beforeReplayFinish=()=>{f.button.disabled=true;f.button.closest=selector=>selector.includes('[data-incoming-context]')||selector.includes('[inert]')?{}:null;f.doc.activeElement=f.doc.body;};
 const first=f.c.replay(descriptor,f.button);f.releaseArchive();await first;assert.equal(f.observerCount(),1);assert(f.context.presentation.state.activeReplayFocusCleanup);
 const next={isConnected:true,disabled:false,dataset:{...f.button.dataset},getClientRects:()=>[{}],closest:selector=>selector.includes('#shell-board-preview-label')?{}:null,focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 f.context.beforeReplayFinish=null;next.focus();await f.c.replay(descriptor,next);await f.flush();assert.equal(f.observerCount(),0);assert.equal(f.doc.activeElement,next);assert.equal(f.context.presentation.state.activeReplayFocusCleanup,null);
 f.notifyMutations();assert.equal(f.doc.activeElement,next);
});

test('keyboard-owned Stop replay returns to the visible live incoming action after synchronous removal',async t=>{
 const f=fixture(t),reasons=[],descriptor=f.descriptor(),replacement={isConnected:true,disabled:false,dataset:{action:'replay-board-context',boardContextKey:descriptor.key},closest:selector=>selector.includes('[data-incoming-context]')?{}:null,focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 f.context.presentation.state.activeDisplayedReplay={...descriptor,key:'retired-replay-key'};f.context.appEl.querySelectorAll=()=>[replacement];
 f.button.dataset.boardMessageAction='replay-stop';f.button.closest=selector=>selector.includes('#shell-board-preview-label')&&f.button.dataset.boardMessageAction?.startsWith('replay-')?{}:null;f.button.focus();
 f.context.replayController={stop(reason){reasons.push(reason);f.button.isConnected=false;f.doc.activeElement=f.doc.body;}};
 f.c.dispatch('replay-stop',{trigger:f.button,returnFocus:true});await f.flush();assert.deepEqual(reasons,['stopped']);assert.equal(f.doc.activeElement,replacement);assert.deepEqual(f.reveals,[]);f.context.replayController=null;
});

test('keyboard-owned Stop replay waits for its deferred render removal before returning focus',async t=>{
 const f=fixture(t),descriptor=f.descriptor(),replacement={isConnected:true,disabled:false,dataset:{action:'replay-board-context',boardContextKey:descriptor.key},closest:selector=>selector.includes('[data-incoming-context]')?{}:null,focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 f.context.presentation.state.activeDisplayedReplay=descriptor;f.context.appEl.querySelectorAll=()=>[replacement];
 f.button.dataset.boardMessageAction='replay-stop';f.button.closest=selector=>selector.includes('#shell-board-preview-label')&&f.button.dataset.boardMessageAction?.startsWith('replay-')?{}:null;f.button.focus();
 f.context.replayController={stop(){}};f.c.dispatch('replay-stop',{trigger:f.button,returnFocus:true});assert.equal(f.doc.activeElement,f.button);
 f.button.isConnected=false;f.doc.activeElement=f.doc.body;f.notifyMutations();assert.equal(f.doc.activeElement,replacement);f.context.replayController=null;
});

test('Stop replay preserves a same-node primary action instead of moving focus to incoming narration',async t=>{
 const f=fixture(t),descriptor=f.descriptor(),replacement={isConnected:true,disabled:false,dataset:{action:'replay-board-context',boardContextKey:descriptor.key},closest:selector=>selector.includes('[data-incoming-context]')?{}:null,focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 f.context.presentation.state.activeDisplayedReplay=descriptor;f.context.appEl.querySelectorAll=()=>[replacement];
 f.button.dataset.boardMessageAction='replay-stop';f.button.closest=selector=>selector.includes('#shell-board-preview-label')&&f.button.dataset.boardMessageAction?.startsWith('replay-')?{}:null;f.button.focus();
 f.context.replayController={stop(){f.button.dataset.boardMessageAction='pass';}};
 f.c.dispatch('replay-stop',{trigger:f.button,returnFocus:true});await f.flush();assert.equal(f.doc.activeElement,f.button);f.context.replayController=null;
});

for(const focused of [true,false])for(const cancellation of [null,'new pointer','new focus','new key','blur','hidden','new account','new view','new intent','new route','new frame','failed navigation'])test(`actual LIVE History fallback waits for mounted Board once, native focus ${focused}, cancellation ${cancellation}`,async t=>{
 const f=fixture(t);f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});const ack=f.c.store.channel('acknowledged');assert(ack?.replay);f.c.store.dismiss(ack.key);
 f.context.currentRoute.panel='history';f.button.closest=selector=>selector.split(',').includes('.history-live-replay')?{}:null;f.button.dataset.boardContextKey=ack.key;if(focused)f.button.focus();
 f.context.routeHydrated=false;f.context.mountedBoardGameId=null;
 await f.c.replayAction(f.button);assert(f.c.pending());assert.equal(f.plays.length,0);assert.equal(f.requests.snapshot(),null);
 f.context.currentRoute.panel='board';f.c.resume();assert(f.c.pending());assert.equal(f.plays.length,0);
 if(cancellation==='new pointer')f.doc.fire('pointerdown',{target:{}});
 if(cancellation==='new focus'){const outside={isConnected:true};f.doc.activeElement=outside;f.doc.fire('focusin',{target:outside});}
 if(cancellation==='new key')f.doc.fire('keydown',{target:f.doc.activeElement,key:'Tab'});
 if(cancellation==='blur')f.win.fire('blur');
 if(cancellation==='hidden'){f.doc.hidden=true;f.doc.fire('visibilitychange');f.doc.hidden=false;}
 if(cancellation==='new account')f.context.scopeGeneration='accountC';
 if(cancellation==='new view')f.c.retire();
 if(cancellation==='new intent')f.c.receive(null,{...f.meta(1),selectedPieceId:'different'});
 if(cancellation==='new route')f.context.currentRoute={name:'home'};
 if(cancellation==='new frame')f.context.view={...f.context.view,gameplayRevision:5};
 if(cancellation==='failed navigation'){f.c.routeSync();await f.flush();}
 f.context.routeHydrated=true;f.context.mountedBoardGameId='game';f.c.resume();f.c.resume();await f.flush();
 if(cancellation){assert.equal(f.c.pending(),null);assert.equal(f.requests.snapshot(),null);assert.equal(f.plays.length,0);return;}
 assert.equal(f.requests.snapshot().phase,'loading');f.releaseArchive();for(let i=0;i<4;i++)await Promise.resolve();await f.flush();assert.equal(f.plays.length,1);assert.equal(f.c.pending(),null);
 assert.equal(f.doc.activeElement,focused?f.board:f.doc.body);assert.deepEqual([...new Set(f.reveals)],focused?[f.board]:[]);
});

for(const boundary of ['trigger removed','focus target unavailable'])test(`actual History activation survives optional focus return boundary: ${boundary}`,async t=>{
 const f=fixture(t);f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});const ack=f.c.store.channel('acknowledged');
 f.context.currentRoute.panel='history';f.button.closest=selector=>selector.split(',').includes('.history-live-replay')?{}:null;f.button.dataset.boardContextKey=ack.key;f.button.focus();
 f.context.routeHydrated=false;await f.c.replayAction(f.button);assert(f.c.pending());
 if(boundary==='trigger removed'){f.button.isConnected=false;f.doc.activeElement=f.doc.body;}
 else f.board.focus=()=>{};
 f.context.currentRoute.panel='board';f.context.routeHydrated=true;f.c.resume();f.c.resume();await f.flush();
 assert.equal(f.requests.snapshot()?.phase,'loading');f.releaseArchive();for(let i=0;i<4;i++)await Promise.resolve();await f.flush();
 assert.equal(f.plays.length,1);assert.equal(f.c.pending(),null);
 if(boundary==='focus target unavailable'){assert.equal(f.doc.activeElement,f.button);assert.equal(f.reveals.length,0);}
 f.c.resume();await f.flush();assert.equal(f.plays.length,1);
});

test('incoming replay waits for the actual mounted non-inert Board before consuming its explicit intent',async t=>{
 const f=fixture(t);f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});const context=f.c.store.channel('acknowledged');
 f.context.currentRoute.panel='history';f.context.routeHydrated=false;f.button.closest=selector=>selector.split(',').includes('[data-incoming-context]')?{}:null;f.button.dataset.boardContextKey=context.key;f.button.focus();
 f.c.replayAction(f.button);assert(f.c.pending());assert.equal(f.requests.snapshot(),null);
 let inert=true;f.root.closest=selector=>selector==='[inert]'&&inert?{}:null;f.context.currentRoute.panel='board';f.context.routeHydrated=true;
 f.c.resume();assert(f.c.pending());assert.equal(f.requests.snapshot(),null,'an inert mounted Board cannot consume a replay activation');
 inert=false;f.c.resume();assert.equal(f.c.pending(),null);assert.equal(f.requests.snapshot().phase,'loading');f.releaseArchive();for(let i=0;i<4;i++)await Promise.resolve();await f.flush();
 assert.equal(f.plays.length,1);assert.deepEqual(f.plays[0].frames.map(frame=>frame.decisionId),['move']);assert.equal(f.doc.activeElement,f.board);
});

test('disposing the presentation owner retires an unresolved replay before its archive arrives',async t=>{
 const f=fixture(t);f.button.focus();const pending=f.c.replay(f.descriptor(),f.button);assert.equal(f.requests.snapshot().phase,'loading');
 f.context.presentation.destroy();f.releaseArchive();await pending;await f.flush();
 assert.equal(f.plays.length,0);assert.equal(f.requests.snapshot(),null);assert.equal(f.reveals.length,0);
});

test('a native press defers context host replacement until its matching release requests one render',async t=>{
 const f=fixture(t);f.context.renderGesture.begin('owned-press');
 f.c.receive({kind:'inspection',message:{text:'Supply inspection'}},{...f.meta(1),selectedPieceId:'commander'});
 await f.flush();assert.deepEqual(f.admissions,[]);assert.equal(f.renders.length,0);assert.equal(f.c.store.channel('piece').message.text,'Supply inspection');
 f.context.renderGesture.end('other-press');await f.flush();assert.equal(f.renders.length,0,'another release cannot consume this held native intent');
 f.context.renderGesture.end('owned-press');await f.flush();assert.deepEqual(f.renders,[{animatePanels:false,includeBoard:false}]);
});

for(const interruption of ['none','outside-focus','new-intent'])test(`incoming host replacement preserves only its owned focus: ${interruption}`,async t=>{
 const f=fixture(t),p=f.context.presentation;
 f.button.dataset={action:'replay-board-context',boardContextKey:'accepted-turn'};
 f.button.closest=selector=>selector==='[data-incoming-context]'?{}:null;f.button.focus();
 const token=p.captureIncomingFocus();assert(token);
 const replacement={isConnected:true,disabled:false,dataset:{...f.button.dataset},closest:selector=>selector==='[data-incoming-context]'?{}:null,focus(){f.doc.activeElement=this;f.doc.fire('focusin',{target:this});}};
 const hidden={...replacement,closest:selector=>selector==='[inert]'?{}:null,focus(){assert.fail('inactive host must never receive focus');}};
 f.context.appEl.querySelectorAll=()=>[hidden,replacement];f.button.isConnected=false;f.doc.activeElement=f.doc.body;
 if(interruption==='outside-focus')f.board.focus();
 if(interruption==='new-intent')f.c.owner.commit('new-piece');
 p.restoreIncomingFocus(token);await Promise.resolve();
 assert.equal(f.doc.activeElement,interruption==='none'?replacement:interruption==='outside-focus'?f.board:f.doc.body);
 assert.equal(f.reveals.length,0,'fixed incoming host never triggers a Board-page scroll reveal');
});

test('hidden Board detail never consumes an announcement ahead of the actual visible incoming host',async t=>{
 const f=fixture(t),p=f.context.presentation;
 p.store.update('piece',{key:'hidden-piece',gameId:'game',purpose:'piece-inspection',message:{text:'Hidden inspection'}});
 p.store.update('acknowledged',{key:'visible-incoming',gameId:'game',purpose:'incoming-narration',message:{text:'Incoming turn'}});
 const hidden={dataset:{boardContext:'hidden-piece'},closest:selector=>selector.includes('[inert]')?{}:null};
 const visible={dataset:{boardContext:'visible-incoming'},closest:()=>null};
 f.context.appEl.querySelectorAll=()=>[hidden,visible];p.queue();await f.flush();
 assert.equal(p.announcement.textContent,'Incoming turn');assert.equal(p.store.takeAnnouncement('hidden-piece'),'Hidden inspection','hidden content was not marked announced');
 p.queue();await f.flush();assert.equal(p.store.takeAnnouncement('visible-incoming'),null,'only the actually exposed host announces once');
});

test('imported-turn dispatch uses selected saved records without overwriting live acknowledged context',async t=>{
 const f=fixture(t),p=f.context.presentation;
 f.c.ack(f.context.view,{}, {identityId:'me',canInteract:true});
 const before=f.c.store.channel('acknowledged');
 const saved={moveId:'saved-import',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'pass'},selectionSnapshot:{pieces:[],turnIndex:0,sideToMove:'P1'},snapshot:{pieces:[],turnIndex:1,sideToMove:'P2'},importedFrom:{gameId:'source',decisionId:'original'}};
 f.context.view={...f.context.view,inHistoryMode:true,historyTurnIndex:0,historyIndex:null,historyTurnMoves:[saved],moves:[saved,{moveId:'live-head',turnIndex:1}],board:{state:{pieces:[],turnIndex:2,sideToMove:'P1'}}};
 // The real narrow Board projection stays live while the History control owns
 // its saved turn. Capturing that live projection would replay the wrong turn.
 f.context.getBoardGame=view=>deriveBoardView(view,{narrow:true,identityId:'me'});
 let generation=3;f.context.viewingIntent={generation:()=>generation};
 const descriptor=p.importedTurnReplayDescriptor('game');assert.ok(descriptor);
 assert.deepEqual(descriptor.moveIds,['saved-import']);assert.equal(p.canReplayDisplayed(descriptor),true);
 f.button.dataset={boardContextKey:descriptor.key,replaySource:'imported-turn'};
 f.button.closest=selector=>selector.includes('.history-imported-turn-replay')?{}:null;
 f.button.focus();p.replayAction(f.button);await f.flush();
 assert.equal(f.plays.length,1);assert.deepEqual(f.plays[0].frames.map(frame=>frame.decisionId),['saved-import']);
 assert.equal(f.c.store.channel('acknowledged'),before,'a History replay must not replace the live acknowledged summary');
 generation++;assert.equal(p.canReplayDisplayed(descriptor),false);
 f.button.dataset.boardContextKey=descriptor.key;p.replayAction(f.button);await f.flush();
 assert.equal(f.plays.length,1,'an old control cannot acquire the new generation');
});

test('mobile imported-turn activation waits for the Board handoff and rechecks selected intent',async t=>{
 const f=fixture(t),p=f.context.presentation;
 const saved={moveId:'saved-import',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'pass'},selectionSnapshot:{pieces:[],turnIndex:0,sideToMove:'P1'},snapshot:{pieces:[],turnIndex:1,sideToMove:'P2'},importedFrom:{gameId:'source',decisionId:'original'}};
 f.context.view={...f.context.view,inHistoryMode:true,historyTurnIndex:0,historyIndex:null,historyTurnMoves:[saved],moves:[saved]};
 f.context.getBoardGame=view=>deriveBoardView(view,{narrow:true,identityId:'me'});
 let generation=5;f.context.viewingIntent={generation:()=>generation};f.context.currentRoute.panel='history';
 const descriptor=p.importedTurnReplayDescriptor('game');assert.ok(descriptor);
 f.button.dataset={boardContextKey:descriptor.key,replaySource:'imported-turn'};f.button.closest=selector=>selector.includes('.history-imported-turn-replay')?{}:null;
 let navigated=0;f.context.navigateTo=()=>{navigated++;};f.button.focus();p.replayAction(f.button);
 assert.equal(navigated,1);assert.equal(f.plays.length,0);assert.ok(p.state.pendingBoardContextReplay);
 generation++;f.context.currentRoute.panel='board';p.resume();await f.flush();
 assert.equal(f.plays.length,0,'changed History intent must win before the Board is ready');
 assert.equal(p.state.pendingBoardContextReplay,null);
});

for(const variant of ['current','wide','History-panel','completed','new-generation','new-owner'])test(`imported replay finish restores live mobile authority only for its current ongoing Board: ${variant}`,t=>{
 const f=fixture(t),p=f.context.presentation;
 const saved={moveId:'saved',turnIndex:0,turnMoveIndex:0,action:{type:'pass'},selectionSnapshot:{pieces:[],turnIndex:0},snapshot:{pieces:[],turnIndex:1},importedFrom:{gameId:'source',decisionId:'original'}};
 f.context.view={...f.context.view,inHistoryMode:true,historyTurnIndex:0,historyTurnMoves:[saved],moves:[saved],board:{state:{pieces:[],turnIndex:1,sideToMove:'P2',outcome:{status:'ongoing'}}}};
 f.context.getBoardGame=view=>deriveBoardView(view,{narrow:true,identityId:'me'});let generation=2;f.context.viewingIntent={generation:()=>generation};let restored=0;
 f.context.transport.returnToLive=({gameId})=>{assert.equal(gameId,'game');restored++;f.context.view={...f.context.view,inHistoryMode:false,historyTurnIndex:null,historyTurnMoves:null};};
 const descriptor=p.importedTurnReplayDescriptor('game');assert.ok(descriptor);
 if(variant==='wide')f.context.getShellLayoutMode=()=> 'wide';
 if(variant==='History-panel')f.context.currentRoute.panel='history';
 if(variant==='completed')f.context.view.board.state.outcome.status='p1_win';
 if(variant==='new-generation')generation++;
 if(variant==='new-owner')f.context.transport={...f.context.transport};
 assert.equal(p.finishImportedTurnReplay(descriptor),variant==='current');assert.equal(restored,variant==='current'?1:0);
 if(variant==='current'){assert.equal(f.context.view.inHistoryMode,false);assert.equal(p.canReplayDisplayed(descriptor),false,'leaving History intentionally retires replay eligibility');}
});

test('imported replay live restoration rechecks ownership after its synchronous focus handoff',t=>{
 const f=fixture(t),p=f.context.presentation;const saved={moveId:'saved',turnIndex:0,turnMoveIndex:0,action:{type:'pass'},selectionSnapshot:{pieces:[],turnIndex:0},snapshot:{pieces:[],turnIndex:1},importedFrom:{gameId:'source',decisionId:'original'}};
 f.context.view={...f.context.view,inHistoryMode:true,historyTurnIndex:0,historyTurnMoves:[saved],moves:[saved],board:{state:{pieces:[],turnIndex:1,outcome:{status:'ongoing'}}}};f.context.getBoardGame=view=>deriveBoardView(view,{narrow:true});let generation=2;f.context.viewingIntent={generation:()=>generation};let restored=0;f.context.transport.returnToLive=()=>{restored++;};
 const descriptor=p.importedTurnReplayDescriptor('game');assert.ok(descriptor);
 assert.equal(p.finishImportedTurnReplay(descriptor,()=>generation++),false);assert.equal(restored,0,'a changed selection during focus handoff must win');
});

for(const reason of ['completed','navigation','error','destroyed','replaced','live-change'])test(`starter clears temporary imported History only on completed playback: ${reason}`,async t=>{
 const f=fixture(t),p=f.context.presentation;const saved={moveId:'saved',turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'pass'},selectionSnapshot:{pieces:[],turnIndex:0,sideToMove:'P1'},snapshot:{pieces:[],turnIndex:1,sideToMove:'P2'},importedFrom:{gameId:'source',decisionId:'original'}};
 f.context.view={...f.context.view,inHistoryMode:true,historyTurnIndex:0,historyTurnMoves:[saved],moves:[saved],board:{state:{pieces:[],turnIndex:1,sideToMove:'P2',outcome:{status:'ongoing'}}}};f.context.getBoardGame=view=>deriveBoardView(view,{narrow:true});f.context.replayFinishReason=reason;let restored=0;f.context.transport.returnToLive=()=>{restored++;f.context.view={...f.context.view,inHistoryMode:false,historyTurnIndex:null,historyTurnMoves:null};};
 f.button.closest=selector=>selector.includes('.history-imported-turn-replay')?{}:null;f.button.focus();const descriptor=p.importedTurnReplayDescriptor('game');assert.ok(descriptor);await f.c.replay(descriptor,f.button);await f.flush();assert.equal(f.plays.length,1);assert.equal(restored,reason==='completed'?1:0);
});
