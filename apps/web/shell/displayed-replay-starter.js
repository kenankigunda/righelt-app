import {captureDisplayedReplay,replayArchiveMatches} from './displayed-replay.js';
import {buildPushSequenceReplay} from './push-sequence-replay.js';
import {buildTurnReplay,createComputerReplay} from './computer-replay.js';
import {activeDecisionLineage} from './decision-history.js';

export const displayedReplayFocusTarget = target => Boolean(target?.closest?.('#shell-board-preview-label [data-action^="replay-"],#shell-board-preview-label [data-board-message-action^="replay-"],[data-incoming-context] [data-action="replay-board-context"],.history-live-replay [data-action="replay-board-context"],.history-imported-turn-replay [data-action="replay-board-context"]'));

// Replay remains a read-only consumer of acknowledged records. The rendering
// boundary is injected for focused controller tests, never the payload builder
// or lineage/admission checks.
export function createDisplayedReplayStarter(getDependencies,{createReplay=createComputerReplay}={}) {
 return async (requested=null,trigger=null)=>{
  const d=getDependencies(),p=d.presentation,state=p.state;
  const descriptor=requested??captureDisplayedReplay({game:p.displayedReplayFrame(),owner:d.transport,scope:p.scope(),identityId:d.transport.getIdentityId(),visible:!d.document.hidden});
  if(d.confirmedPlayback?.snapshot().playing||d.forcedFollowWorking(descriptor?.gameId)||!p.canReplayDisplayed(descriptor)||d.replayController?.snapshot().playing||d.replayRequests.snapshot()?.phase==='loading')return;
  const context=p.currentReplayContext(descriptor),{gameId,owner,revision,lineageHead}=context;
  state.activeReplayFocusCleanup?.();
  const liveFocusTarget=displayedReplayFocusTarget(trigger);
  let focusObserver=null,focusTimer=null,focusReturn=null;
  const cleanupFocusWait=()=>{focusObserver?.disconnect();focusObserver=null;if(focusTimer!==null)d.document.defaultView.clearTimeout(focusTimer);focusTimer=null;};
  const releaseFocusReturn=()=>{cleanupFocusWait();focusReturn?.release();if(state.activeReplayFocusCleanup===releaseFocusReturn)state.activeReplayFocusCleanup=null;};
  focusReturn=p.focus.begin(trigger,{allows:displayedReplayFocusTarget,allowRemoval:liveFocusTarget,allowDeferredRemoval:liveFocusTarget,onRetire:()=>{cleanupFocusWait();if(state.activeReplayFocusCleanup===releaseFocusReturn)state.activeReplayFocusCleanup=null;}});
  state.activeReplayFocusCleanup=releaseFocusReturn;state.activeDisplayedReplay=descriptor;
  const intent=p.owner.capture(),token=d.replayRequests.begin(context);
  const stillCurrent=()=>p.owner.current(intent)&&d.replayRequests.current(token,p.currentReplayContext(descriptor))&&p.canReplayDisplayed(descriptor);
  let moves=descriptor.moves;
  const buildPayload=()=>descriptor.source==='push-sequence'?buildPushSequenceReplay({moves,startId:descriptor.startId,endId:descriptor.endId,gameId,revision,lineageHead}):buildTurnReplay({moves,completedTurnIndex:descriptor.turnIndex,gameId,revision,lineageHead});
  let payload=buildPayload();
  if(!payload){
   let entries=[],cursor=null;
   try{
    do{const page=await owner.decisionHistory(gameId,cursor);if(!stillCurrent()){releaseFocusReturn();return;}entries.push(...page.items);cursor=page.nextCursor;}while(cursor);
    moves=activeDecisionLineage(entries);
    if(!replayArchiveMatches(descriptor,moves)){d.replayRequests.fail(token,p.currentReplayContext());releaseFocusReturn();return;}
    payload=buildPayload();
   }catch{d.replayRequests.fail(token,p.currentReplayContext());releaseFocusReturn();return;}
  }
  if(!stillCurrent()){d.replayRequests.reconcile(p.currentReplayContext());releaseFocusReturn();return;}
  if(!payload){d.replayRequests.fail(token,p.currentReplayContext());releaseFocusReturn();return;}
  if(!d.replayRequests.ready(token,p.currentReplayContext())){releaseFocusReturn();return;}
  getDependencies().replayController?.destroy();
  const rootEl=d.appEl.querySelector('[data-testid="game-board-wrap"]');if(!rootEl){releaseFocusReturn();return;}
  const host=trigger?.closest('.history-imported-turn-replay')?'imported-history':trigger?.closest('.history-live-replay')?'history':trigger?.closest('[data-incoming-context]')?'incoming':trigger?.closest('[data-board-context]')?'context':'board';
  const refresh=playing=>{const live=getDependencies();live.boardRuntime?.setInteractionBlocked(playing||live.forcedFollowWorking(gameId)||Boolean(live.confirmedPlayback?.snapshot().playing));live.boardRuntime?.refreshStatus();p.queue();};
  const availableFocusTarget=()=>{
   const selector=`[data-board-context-key="${d.CSS.escape(descriptor.key)}"]`;
   const hostSelector=host==='incoming'?`[data-incoming-context] ${selector}`:host==='context'?`[data-board-context] ${selector}`:host==='history'?`.history-live-replay ${selector}`:host==='imported-history'?`.history-imported-turn-replay ${selector}`:null;
   const available=target=>Boolean(target?.isConnected&&!target.disabled&&!target.closest('[inert],[hidden],[aria-hidden="true"]')&&(!target.getClientRects||target.getClientRects().length));
   const current=hostSelector?[...(d.appEl.querySelectorAll?.(hostSelector)??[])].find(available):null;
   return current??(available(trigger)?trigger:null);
  };
  const finish=({reason}={})=>{
   refresh(false);state.activeDisplayedReplay=null;
   if(p.canReplayDisplayed(descriptor)){
    if(reason==='completed'&&p.finishImportedTurnReplay?.(descriptor,()=>{focusReturn.restoreNow(()=>availableFocusTarget()??p.boardFocusTarget());}))return;
    const settle=()=>{if(!focusReturn.current()){releaseFocusReturn();return true;}const target=availableFocusTarget();if(!target)return false;cleanupFocusWait();focusReturn.restoreNow(()=>target);return true;};
    if(!settle()){
     const Observer=d.document.defaultView.MutationObserver;if(Observer){focusObserver=new Observer(settle);focusObserver.observe(d.appEl,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','inert','hidden','aria-hidden']});}
     d.document.defaultView.queueMicrotask?.(settle);
     focusTimer=d.document.defaultView.setTimeout(()=>{if(!settle()){cleanupFocusWait();focusReturn.restoreNow(p.boardFocusTarget);}},2000);
    }
   }else releaseFocusReturn();
  };
  const controller=createReplay({rootEl,createAdapter:()=>d.createEngineBoardAdapter(),reducedMotion:d.prefersReducedMotion,onChange:replay=>{
   if(replay.playing)refresh(true);else{state.activeDisplayedReplay=null;focusReturn.renderOwnedRemoval(()=>refresh(false));}
  },onFinish:finish});
  d.setReplayController(controller);
  try{await controller.play(payload);}catch{controller.stop('error');d.replayRequests.fail(token,p.currentReplayContext());}
 };
}
