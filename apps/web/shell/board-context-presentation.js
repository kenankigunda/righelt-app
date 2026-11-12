import {createBoardContextStore} from './board-context.js';
import {createBoardContextOwner,createBoardContextFocus} from './board-context-owner.js';
import {createBoardContextLayout} from './board-context-layout.js';
import {publishAcknowledgedBoardMessage,contextReplayAvailable} from './playback-presentation.js';
import {displayedReplayIsCurrent} from './displayed-replay.js';
import {createBoardContextReceiver} from './board-context-receiver.js';

// App and focused tests execute the same presentation owner. Live collaborators
// are read at invocation, so account/transport replacement cannot leave a stale
// closure with permission to replay or restore focus.
export function createBoardContextPresentation({appEl,document,getDependencies,createLayout=createBoardContextLayout,enqueue=queueMicrotask}) {
 const boardContexts=createBoardContextStore(),boardContextLayout=createLayout(document);
 let boardContextRefreshPending=false,activeDisplayedReplay=null,activeReplayFocusCleanup=null,pendingBoardContextReplay=null,disposed=false;
 const displayedReplayFrame=()=>{const d=getDependencies();return d.getBoardGame(d.transport.getGameViewModel(d.getCurrentViewedGameId()));};
 const boardContextOwner=createBoardContextOwner({store:boardContexts,getScope:()=>{
  const {transport,viewingScope,boardContextVisit,currentRoute}=getDependencies(),game=displayedReplayFrame();
  return {owner:transport,key:JSON.stringify([viewingScope(),boardContextVisit,currentRoute.name,currentRoute.gameId,game?.inHistoryMode?[game.historyIndex,game.historyTurnIndex]:'live'])};
 },onRetire:()=>{
  const {incomingNarrationState,replayRequests,replayController}=getDependencies();
  activeDisplayedReplay=null;cancelPendingBoardContextReplay();boardContextFocus.retire();incomingNarrationState.retire();appEl.querySelector(':scope > [data-incoming-narration-root]')?.replaceChildren();contextAnnouncement.textContent='';
  replayRequests.cancel();replayController?.stop('view-changed');
 },onIntentChange:()=>{
  const {replayRequests,replayController}=getDependencies();
  cancelPendingBoardContextReplay();
  if(activeDisplayedReplay){activeDisplayedReplay=null;activeReplayFocusCleanup?.();activeReplayFocusCleanup=null;replayRequests.cancel();replayController?.stop('selection-changed');}
 }});
 const boardContextFocus=createBoardContextFocus({doc:document,owner:boardContextOwner,reveal:(target,current)=>{if(!target?.closest?.('[data-incoming-context]'))boardContextLayout.reveal(target,current,{immediate:true});}});
 const boardContextScope=()=>boardContextOwner.scope();
 const boardFocusTarget=()=>appEl.querySelector('#shell-board-preview-label button:not(:disabled),#shell-board .cell.selected-piece')??appEl.querySelector('.board-message-live');
 const contextAnnouncement=document.createElement('div');contextAnnouncement.className='sr-only';contextAnnouncement.setAttribute('role','status');contextAnnouncement.setAttribute('aria-live','polite');contextAnnouncement.setAttribute('aria-atomic','true');document.body.append(contextAnnouncement);
 const captureIncomingFocus=()=>{
  const target=document.activeElement;
  if(!appEl.contains(target)||!target?.closest?.('[data-incoming-context]'))return null;
  const action=target.dataset.action,key=target.dataset.boardContextKey;
  const matchingReplacement=candidate=>candidate?.dataset?.action===action&&candidate?.dataset?.boardContextKey===key&&candidate.closest?.('[data-incoming-context]');
  return {target,action,key,owner:boardContextFocus.begin(target,{allowRemoval:true,allows:matchingReplacement})};
 };
 const restoreIncomingFocus=(token,{afterOwnedRender=false}={})=>{
  if(!token)return;
  if(afterOwnedRender){
   const target=[...appEl.querySelectorAll('[data-incoming-context] [data-action]')].find(candidate=>candidate.dataset.action===token.action&&candidate.dataset.boardContextKey===token.key&&!candidate.closest?.('[inert]'));
   if(token.owner.intentCurrent()&&target?.isConnected&&!target.disabled)target.focus({preventScroll:true});
   token.owner.release();return;
  }
  if(token.target.isConnected&&!token.target.closest?.('[inert]')){token.owner.release();return;}
  token.owner.restore(()=>[...appEl.querySelectorAll('[data-incoming-context] [data-action]')].find(target=>target.dataset.action===token.action&&target.dataset.boardContextKey===token.key&&!target.closest?.('[inert]'))
   ??appEl.querySelector('[data-game-panel="history"] > h2'));
 };
 const queueBoardContextRefresh=()=>{
  if(disposed||boardContextRefreshPending)return;boardContextRefreshPending=true;
  enqueue(()=>{
   boardContextRefreshPending=false;if(disposed)return;
   const d=getDependencies();
   if(d.renderGesture.defer({animatePanels:false,includeBoard:false}))return;
   const incomingFocus=captureIncomingFocus();
   boardContextScope();
   const gameId=d.getCurrentViewedGameId(),game=gameId?d.transport.getGameViewModel(gameId):null;
   if(!game||appEl.querySelector('[data-game-shell-root]')?.dataset.gameId!==gameId){incomingFocus?.owner.release();return;}
   if(d.updateMountedHeader())d.syncRenderedMarkupSnapshot();
   const history=appEl.querySelector('[data-game-panel="history"]');if(history)d.patchToolHtml(history,d.renderHistoryPanel(game));
   d.syncIncomingNarrationHost(game);d.syncBoardContextDetails?.(game);restoreIncomingFocus(incomingFocus);
   d.syncRecoverySpace(appEl);boardContextLayout.sync();
   const active=[...appEl.querySelectorAll('[data-alert-stack-card].is-active [data-board-context],[data-context-active-host="true"]')].find(host=>!host.closest('[inert],[hidden],[aria-hidden="true"]'));
   const text=active&&boardContexts.takeAnnouncement(active.dataset.boardContext);if(text)contextAnnouncement.textContent=text;
  });
 };
 const currentReplayContext=()=>{
  const d=getDependencies(),gameId=d.getCurrentViewedGameId(),game=d.transport.getAuthoritativeGame(gameId);
  return {owner:d.transport,scope:boardContextScope(),gameId,revision:game?.gameplayRevision,lineageHead:game?.moves?.filter(move=>!move.undone).at(-1)?.moveId??null,visible:!document.hidden};
 };
 const canReplayDisplayed=descriptor=>displayedReplayIsCurrent(descriptor,{game:displayedReplayFrame(),context:currentReplayContext()});
 const contextReplayEnabled=descriptor=>{
  const d=getDependencies();
  return contextReplayAvailable({descriptor,followWorking:d.forcedFollowWorking(descriptor?.gameId),playbackPlaying:d.confirmedPlayback?.snapshot().playing,canReplay:canReplayDisplayed,replayPending:d.replayRequests.snapshot(),replayPlaying:d.replayController?.snapshot().playing});
 };
 const acknowledgedBoardMessage=(view,status,options)=>{
  const d=getDependencies();
  return publishAcknowledgedBoardMessage(view,status,options,{boardContexts,queueBoardContextRefresh,transport:d.transport,boardContextScope,document,notificationStack:d.notificationStack});
 };
 const receiveBoardContext=createBoardContextReceiver(()=>({displayedReplayFrame,boardContextScope,boardContextOwner,boardContexts,notificationStack:getDependencies().notificationStack,appEl,document,queueBoardContextRefresh}));
 const dispatchBoardMessageAction=(id,{trigger=null,descriptor=null}={})=>{
  const d=getDependencies();
  if(id==='retry-confirmed-playback')d.confirmedPlayback?.retry();
  if(id==='replay-computer')void d.startComputerReplay(descriptor??boardContexts.channel('acknowledged')?.replay??activeDisplayedReplay,trigger);
  if(id==='replay-stop')d.replayController?.stop('stopped');
  if(id==='replay-next')d.replayController?.next();
  if(id==='replay-cancel'||id==='replay-dismiss'){activeDisplayedReplay=null;activeReplayFocusCleanup?.();activeReplayFocusCleanup=null;d.replayRequests.cancel();}
 };
 const cancelPendingBoardContextReplay=()=>{
  const pending=pendingBoardContextReplay;pendingBoardContextReplay=null;pending?.activation.release();pending?.focusReturn.release();
 };
 const resumeBoardContextReplay=()=>{
  const d=getDependencies(),pending=pendingBoardContextReplay;if(!pending)return;
  if(!pending.activation.current()||!canReplayDisplayed(pending.descriptor)){cancelPendingBoardContextReplay();return;}
  const root=appEl.querySelector('[data-testid="game-board-wrap"]');
  if(!d.routeHydrated||d.currentRoute.name!=='game'||d.getGamePanel()!=='board'||d.mountedBoardGameId!==pending.descriptor.gameId||!root?.isConnected||root.closest('[inert]'))return;
  pendingBoardContextReplay=null;
  if(!pending.activation.consume()){pending.focusReturn.release();return;}
  const trigger=pending.focusReturn.restoreNow(boardFocusTarget);
  if(boardContextOwner.current(pending.intent)&&canReplayDisplayed(pending.descriptor))dispatchBoardMessageAction('replay-computer',{descriptor:pending.descriptor,trigger});
 };
 const replayAction=actionEl=>{
  const d=getDependencies(),context=boardContexts.get(actionEl.dataset.boardContextKey);
  if(context?.gameId!==d.getCurrentViewedGameId()||!contextReplayEnabled(context.replay))return;
  if(actionEl.closest('.history-live-replay,[data-incoming-context]')&&d.getShellLayoutMode()==='narrow'&&d.getGamePanel()!=='board'){
   cancelPendingBoardContextReplay();
   pendingBoardContextReplay={descriptor:context.replay,activation:boardContextFocus.activate(actionEl,{allowRemoval:true,onRetire:cancelPendingBoardContextReplay}),focusReturn:boardContextFocus.begin(actionEl,{allowRemoval:true}),intent:boardContextOwner.capture()};
   d.navigateTo(d.buildGameHash(context.gameId,null,d.getCurrentGameHashState('board')));resumeBoardContextReplay();return;
  }
  dispatchBoardMessageAction('replay-computer',{descriptor:context.replay,trigger:actionEl});
 };
 const dismiss=actionEl=>{
  const d=getDependencies(),context=boardContexts.get(actionEl.dataset.boardContextKey);
  if(context?.gameId!==d.getCurrentViewedGameId()||!boardContexts.dismiss(context?.key))return;
  const focusReturn=boardContextFocus.begin(actionEl,{allowRemoval:true});queueBoardContextRefresh();focusReturn.restore(boardFocusTarget);
 };
 return {store:boardContexts,layout:boardContextLayout,owner:boardContextOwner,focus:boardContextFocus,announcement:contextAnnouncement,scope:boardContextScope,boardFocusTarget,
  captureIncomingFocus,restoreIncomingFocus,queue:queueBoardContextRefresh,displayedReplayFrame,canReplayDisplayed,contextReplayEnabled,currentReplayContext,ack:acknowledgedBoardMessage,receive:receiveBoardContext,dispatch:dispatchBoardMessageAction,cancel:cancelPendingBoardContextReplay,resume:resumeBoardContextReplay,replayAction,dismiss,
  state:{get activeDisplayedReplay(){return activeDisplayedReplay;},set activeDisplayedReplay(value){activeDisplayedReplay=value;},get activeReplayFocusCleanup(){return activeReplayFocusCleanup;},set activeReplayFocusCleanup(value){activeReplayFocusCleanup=value;},get pendingBoardContextReplay(){return pendingBoardContextReplay;}},
  destroy(){if(disposed)return;disposed=true;boardContextOwner.retire();cancelPendingBoardContextReplay();activeReplayFocusCleanup?.();activeReplayFocusCleanup=null;boardContextFocus.destroy();boardContextLayout.destroy?.();contextAnnouncement.remove?.();},
 };
}
