import {updateComputerBoardLoading} from './board-message-layout.js';
import {selectedHistoryPresentation,historyBoardMessage} from './history-narration.js';
import {recordedActorSide} from './recorded-narration.js';
import {boardTurnCaption,playerDisplayName} from './perspective-labels.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {withPushSequenceMessage} from './push-sequence-replay.js';
import {opponentBoardMessage} from './opponent-narration.js';
import {captureDisplayedReplay} from './displayed-replay.js';

export function confirmedPlaybackMessage(view,status,{step,onRecorded=()=>{},identityId}={}) {
if(view?.confirmedPlayback){
            const record=step?.frame?.recordedMove;
            if(record)onRecorded(view,status,{identityId,presentationMove:record});
            const actor=record?recordedActorSide(record):step?.move?.actorSide;
            const recordedPresentation=record?selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:record}):null;
            const actorName=recordedPresentation?.message.actorName??playerDisplayName(view,actor);
            if(view.confirmedPlayback.error)return {text:`${actorName} needs help`,actorName,action:{id:'retry-confirmed-playback',label:'Retry'}};
            if(status?.activity?.needsHelp){const helpName=COMPUTER_PROFILES[status.profile]?.name??actorName;return {text:`${helpName} needs help`,actorName:helpName};}
            return {text:`${actorName} is making their move`,actorName};
          }
 return null;
}

export function playbackTurnIndicator(view,state,{replay,step,identityId}={}) {
 const automatic=step?.frame?.recordedMove;
 if(view?.confirmedPlayback&&automatic)return selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:automatic})?.caption??{text:'Move unavailable'};
 if(replay?.playing)return selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:replay.recordedMove})?.caption??{text:'Replay'};
 return selectedHistoryPresentation(view)?.caption??boardTurnCaption(view,state,{identityId});
}
export const contextReplayAvailable=({descriptor,followWorking,playbackPlaying,replayPending,replayPlaying,canReplay})=>
 !followWorking&&!playbackPlaying&&canReplay(descriptor)&&!replayPending&&!replayPlaying;
export function refreshFollowControls({boardRuntime,followWorking,replayPlaying,playbackPlaying,refreshContext}) {
 boardRuntime?.setInteractionBlocked(Boolean(followWorking||replayPlaying||playbackPlaying));
 boardRuntime?.refreshStatus();
 refreshContext();
}

export function publishAcknowledgedBoardMessage(view,status,options,{boardContexts,queueBoardContextRefresh,transport,boardContextScope,document,notificationStack}) {

 const recorded=options.presentationMove;
 const presentation=recorded?{...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:recorded}:view;
 const message=historyBoardMessage(presentation)??withPushSequenceMessage(opponentBoardMessage(view,status,{},options),view,{},options.identityId),body=message?.context;
 if(!body){if(boardContexts.update('acknowledged',null))queueBoardContextRefresh();return;}
 const replay=['replay-computer','replay-push-sequence'].includes(body.action?.id)?captureDisplayedReplay({source:body.action.id==='replay-push-sequence'?'push-sequence':'opponent-turn',game:view,owner:transport,scope:boardContextScope(),identityId:transport.getIdentityId(),visible:!document.hidden}):null;
 const context={gameId:view.id,key:replay?.key??JSON.stringify(recorded?[boardContextScope(),view.id,'confirmed-frame',recorded.moveId]:[boardContextScope(),view.id,view.gameplayRevision,'completion']),message:body,replay,mandatory:false,transient:false};
 const previousKey=boardContexts.channel('acknowledged')?.key;
 const changed=boardContexts.update('acknowledged',context);
 const piece=boardContexts.channel('piece');
 if(previousKey!==context.key&&!boardContexts.isDismissed(context.key)&&!(piece?.gameId===view.id&&piece.message&&!piece.transient&&!boardContexts.isDismissed(piece.key)))notificationStack.prefer(view.id,`board-context:${context.key}`);
 if(changed)queueBoardContextRefresh();

}

// Keep loading ownership and confirmed-frame copy in the same production boundary.
export function presentPlaybackBoardMessage(view,status,{activityHost,selection={},followWorking,replay,replayFeedback,scope,...options}={}) {
 updateComputerBoardLoading(activityHost,view,status,{
  replaying:Boolean(view?.confirmedPlayback||followWorking||replay?.playing||replayFeedback?.gameId===view?.id),
  inspecting:Boolean(selection.selectedPieceId||selection.inspection),scope,
 });
 if(view?.positionOnly)return {text:view.positionLoading?'Loading play':'Play could not finish loading'};
 return confirmedPlaybackMessage(view,status,options);
}
