import {isOngoingGame} from './game-lifecycle.js';
import {createBoardContextStore} from './board-context.js';
import {createBoardContextOwner,createBoardContextFocus} from './board-context-owner.js';
import {createBoardContextLayout} from './board-context-layout.js';
import {publishAcknowledgedBoardMessage,contextReplayAvailable} from './playback-presentation.js';
import {captureDisplayedReplay,displayedReplayIsCurrent,displayedReplayMatchesPreviousTurnEpisode} from './displayed-replay.js';
import {createBoardContextReceiver} from './board-context-receiver.js';
import {displayedReplayFocusTarget} from './displayed-replay-starter.js';

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
  const {replayRequests,replayController}=getDependencies();
  activeDisplayedReplay=null;cancelPendingBoardContextReplay();boardContextFocus.retire();contextAnnouncement.textContent='';
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
   d.syncBoardContextDetails?.(game);restoreIncomingFocus(incomingFocus);
   d.syncRecoverySpace(appEl);boardContextLayout.sync();
   const active=[...appEl.querySelectorAll('[data-alert-stack-card].is-active [data-board-context],[data-context-active-host="true"]')].find(host=>!host.closest('[inert],[hidden],[aria-hidden="true"]'));
   const text=active&&boardContexts.takeAnnouncement(active.dataset.boardContext);if(text)contextAnnouncement.textContent=text;
  });
 };
 const currentReplayContext=(descriptor=activeDisplayedReplay)=>{
  const d=getDependencies(),gameId=d.getCurrentViewedGameId(),game=d.transport.getAuthoritativeGame(gameId);
  return {owner:d.transport,scope:boardContextScope(),gameId,revision:game?.gameplayRevision,lineageHead:game?.moves?.filter(move=>!move.undone).at(-1)?.moveId??null,visible:!document.hidden,
   ...(descriptor?.source==='imported-turn'?{viewGeneration:d.viewingIntent?.generation(gameId)??0}:{})};
 };
 const importedTurnReplayDescriptor=gameId=>{
  const d=getDependencies(),currentId=d.getCurrentViewedGameId();if(gameId&&gameId!==currentId)return null;
  return captureDisplayedReplay({game:d.transport.getGameViewModel(currentId),owner:d.transport,scope:boardContextScope(),source:'imported-turn',visible:!document.hidden,viewGeneration:d.viewingIntent?.generation(currentId)??0});
 };
 const canReplayDisplayed=descriptor=>{
  const d=getDependencies(),game=descriptor?.source==='imported-turn'?d.transport.getGameViewModel(d.getCurrentViewedGameId()):displayedReplayFrame();
  return displayedReplayIsCurrent(descriptor,{game,context:currentReplayContext(descriptor)});
 };
 const finishImportedTurnReplay=(descriptor,beforeReturn=()=>{})=>{
  const d=getDependencies();
  if(descriptor?.source!=='imported-turn'||d.getShellLayoutMode()!=='narrow'||d.getGamePanel()!=='board'
   ||!isOngoingGame(d.transport.getAuthoritativeGame(descriptor.gameId))||!canReplayDisplayed(descriptor))return false;
  beforeReturn();
  if(!canReplayDisplayed(descriptor))return false;
  d.transport.returnToLive({gameId:descriptor.gameId});return true;
 };
 const contextReplayEnabled=descriptor=>{
  const d=getDependencies();
  return contextReplayAvailable({descriptor,followWorking:d.forcedFollowWorking(descriptor?.gameId),playbackPlaying:d.confirmedPlayback?.snapshot().playing,canReplay:canReplayDisplayed,replayPending:d.replayRequests.snapshot(),replayPlaying:d.replayController?.snapshot().playing});
 };
 const previousTurnReplayDescriptor=episode=>{
  const d=getDependencies(),acknowledged=boardContexts.channel('acknowledged');
  const descriptor=acknowledged?.replay??captureDisplayedReplay({game:displayedReplayFrame(),owner:d.transport,scope:boardContextScope(),identityId:d.transport.getIdentityId(),visible:!document.hidden});
  return displayedReplayMatchesPreviousTurnEpisode(descriptor,episode)&&contextReplayEnabled(descriptor)?descriptor:null;
 };
 const replayPreviousTurn=(episode,trigger)=>{
  const descriptor=previousTurnReplayDescriptor(episode);if(!descriptor)return false;
  void getDependencies().startComputerReplay(descriptor,trigger);return true;
 };
 const acknowledgedBoardMessage=(view,status,options)=>{
  const d=getDependencies();
  return publishAcknowledgedBoardMessage(view,status,options,{boardContexts,queueBoardContextRefresh,transport:d.transport,boardContextScope,document,notificationStack:d.notificationStack});
 };
 const receiveBoardContext=createBoardContextReceiver(()=>({displayedReplayFrame,boardContextScope,boardContextOwner,boardContexts,notificationStack:getDependencies().notificationStack,appEl,document,queueBoardContextRefresh}));
 const dispatchBoardMessageAction=(id,{trigger=null,descriptor=null,returnFocus=false}={})=>{
  const d=getDependencies();
  if(id==='retry-confirmed-playback')d.confirmedPlayback?.retry();
  if(id==='replay-computer')void d.startComputerReplay(descriptor??boardContexts.channel('acknowledged')?.replay??activeDisplayedReplay,trigger);
  if(id==='replay-stop'){
   const replayDescriptor=activeDisplayedReplay,returnOwnedFocus=Boolean(returnFocus||document.activeElement===trigger&&trigger?.isConnected&&!trigger.disabled);
   let observer=null,timer=null;
   const cleanup=()=>{observer?.disconnect();observer=null;if(timer!==null)document.defaultView.clearTimeout(timer);timer=null;};
   const focusReturn=returnOwnedFocus?boardContextFocus.begin(trigger,{allowRemoval:true,allows:displayedReplayFocusTarget,onRetire:cleanup}):null;
   if(focusReturn)focusReturn.renderOwnedRemoval(()=>d.replayController?.stop('stopped'));else d.replayController?.stop('stopped');
   const target=()=>{
    const targets=[...appEl.querySelectorAll('[data-action="replay-board-context"][data-board-context-key]')].filter(target=>displayedReplayFocusTarget(target)&&!target.disabled&&!target.closest('[inert]'));
    return targets.find(target=>target.dataset.boardContextKey===replayDescriptor?.key)??targets[0]??null;
   };
   const settle=()=>{
    if(!focusReturn)return true;
    if(document.activeElement===trigger&&trigger.isConnected&&!displayedReplayFocusTarget(trigger)){focusReturn.release();return true;}
    if(trigger.isConnected&&displayedReplayFocusTarget(trigger))return false;
    if(!focusReturn.current()){focusReturn.release();return true;}
    const next=target();if(!next)return false;focusReturn.restoreNow(()=>next);return true;
   };
   if(focusReturn&&!settle()){
    observer=new document.defaultView.MutationObserver(settle);observer.observe(appEl,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','inert','data-action','data-board-message-action']});
    timer=document.defaultView.setTimeout(()=>focusReturn.release(),2000);
   }
  }
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
  const d=getDependencies(),imported=actionEl.dataset.replaySource==='imported-turn',captured=imported?importedTurnReplayDescriptor():null;
  const context=imported?(captured?.key===actionEl.dataset.boardContextKey?{gameId:captured.gameId,replay:captured}:null):boardContexts.get(actionEl.dataset.boardContextKey);
  if(context?.gameId!==d.getCurrentViewedGameId()||!contextReplayEnabled(context.replay))return;
  if(actionEl.closest('.history-live-replay,.history-imported-turn-replay,[data-incoming-context]')&&d.getShellLayoutMode()==='narrow'&&d.getGamePanel()!=='board'){
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
  captureIncomingFocus,restoreIncomingFocus,finishImportedTurnReplay,queue:queueBoardContextRefresh,displayedReplayFrame,canReplayDisplayed,contextReplayEnabled,importedTurnReplayDescriptor,previousTurnReplayDescriptor,replayPreviousTurn,currentReplayContext,ack:acknowledgedBoardMessage,receive:receiveBoardContext,dispatch:dispatchBoardMessageAction,cancel:cancelPendingBoardContextReplay,resume:resumeBoardContextReplay,replayAction,dismiss,
  state:{get activeDisplayedReplay(){return activeDisplayedReplay;},set activeDisplayedReplay(value){activeDisplayedReplay=value;},get activeReplayFocusCleanup(){return activeReplayFocusCleanup;},set activeReplayFocusCleanup(value){activeReplayFocusCleanup=value;},get pendingBoardContextReplay(){return pendingBoardContextReplay;}},
  destroy(){if(disposed)return;disposed=true;boardContextOwner.retire();cancelPendingBoardContextReplay();activeReplayFocusCleanup?.();activeReplayFocusCleanup=null;boardContextFocus.destroy();boardContextLayout.destroy?.();contextAnnouncement.remove?.();},
 };
}
