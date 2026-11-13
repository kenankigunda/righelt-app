import {captureDisplayedReplay,replayArchiveMatches} from './displayed-replay.js';
import {buildPushSequenceReplay} from './push-sequence-replay.js';
import {buildTurnReplay,createComputerReplay} from './computer-replay.js';
import {activeDecisionLineage} from './decision-history.js';

export const displayedReplayFocusTarget = target => Boolean(target?.closest?.('#shell-board-preview-label [data-action^="replay-"],#shell-board-preview-label [data-board-message-action^="replay-"],[data-incoming-context] [data-action="replay-board-context"],.history-live-replay [data-action="replay-board-context"]'));

// Replay remains a read-only consumer of acknowledged records. The rendering
// boundary is injected for focused controller tests, never the payload builder
// or lineage/admission checks.
export function createDisplayedReplayStarter(getDependencies,{createReplay=createComputerReplay}={}) {
 return async (requested=null,trigger=null)=>{
  const d=getDependencies(),p=d.presentation,state=p.state;
  const descriptor=requested??captureDisplayedReplay({game:p.displayedReplayFrame(),owner:d.transport,scope:p.scope(),identityId:d.transport.getIdentityId(),visible:!d.document.hidden});
  if(d.confirmedPlayback?.snapshot().playing||d.forcedFollowWorking(descriptor?.gameId)||!p.canReplayDisplayed(descriptor)||d.replayController?.snapshot().playing||d.replayRequests.snapshot()?.phase==='loading')return;
  const context=p.currentReplayContext(),{gameId,owner,revision,lineageHead}=context;
  state.activeReplayFocusCleanup?.();
  const liveFocusTarget=displayedReplayFocusTarget(trigger);
  const focusReturn=p.focus.begin(trigger,{allows:displayedReplayFocusTarget,allowRemoval:liveFocusTarget});
  state.activeReplayFocusCleanup=focusReturn.release;state.activeDisplayedReplay=descriptor;
  const intent=p.owner.capture(),token=d.replayRequests.begin(context);
  const stillCurrent=()=>p.owner.current(intent)&&d.replayRequests.current(token,p.currentReplayContext())&&p.canReplayDisplayed(descriptor);
  let moves=descriptor.moves;
  const buildPayload=()=>descriptor.source==='push-sequence'?buildPushSequenceReplay({moves,startId:descriptor.startId,endId:descriptor.endId,gameId,revision,lineageHead}):buildTurnReplay({moves,completedTurnIndex:descriptor.turnIndex,gameId,revision,lineageHead});
  let payload=buildPayload();
  if(!payload){
   let entries=[],cursor=null;
   try{
    do{const page=await owner.decisionHistory(gameId,cursor);if(!stillCurrent()){focusReturn.release();return;}entries.push(...page.items);cursor=page.nextCursor;}while(cursor);
    moves=activeDecisionLineage(entries);
    if(!replayArchiveMatches(descriptor,moves)){d.replayRequests.fail(token,p.currentReplayContext());focusReturn.release();return;}
    payload=buildPayload();
   }catch{d.replayRequests.fail(token,p.currentReplayContext());focusReturn.release();return;}
  }
  if(!stillCurrent()){d.replayRequests.reconcile(p.currentReplayContext());focusReturn.release();return;}
  if(!payload){d.replayRequests.fail(token,p.currentReplayContext());focusReturn.release();return;}
  if(!d.replayRequests.ready(token,p.currentReplayContext())){focusReturn.release();return;}
  getDependencies().replayController?.destroy();
  const rootEl=d.appEl.querySelector('[data-testid="game-board-wrap"]');if(!rootEl){focusReturn.release();return;}
  const host=trigger?.closest('.history-live-replay')?'history':trigger?.closest('[data-incoming-context]')?'incoming':trigger?.closest('[data-board-context]')?'context':'board';
  const refresh=playing=>{const live=getDependencies();live.boardRuntime?.setInteractionBlocked(playing||live.forcedFollowWorking(gameId)||Boolean(live.confirmedPlayback?.snapshot().playing));live.boardRuntime?.refreshStatus();p.queue();};
  const finish=()=>{
   refresh(false);state.activeDisplayedReplay=null;
   if(p.canReplayDisplayed(descriptor))focusReturn.restore(()=>{
    const selector=`[data-board-context-key="${d.CSS.escape(descriptor.key)}"]`;
    const target=trigger?.isConnected?trigger:host==='incoming'?d.appEl.querySelector(`[data-incoming-context] ${selector}`):host==='context'?d.appEl.querySelector(`[data-board-context] ${selector}`):host==='history'?d.appEl.querySelector(`.history-live-replay ${selector}`):null;
    return target&&!target.closest('[inert]')?target:p.boardFocusTarget();
   });else focusReturn.release();
   if(state.activeReplayFocusCleanup===focusReturn.release)state.activeReplayFocusCleanup=null;
  };
  const controller=createReplay({rootEl,createAdapter:()=>d.createEngineBoardAdapter(),reducedMotion:d.prefersReducedMotion,onChange:replay=>{
   if(replay.playing)refresh(true);else focusReturn.renderOwnedRemoval(()=>refresh(false));
  },onFinish:finish});
  d.setReplayController(controller);
  try{await controller.play(payload);}catch{controller.stop('error');d.replayRequests.fail(token,p.currentReplayContext());}
 };
}
