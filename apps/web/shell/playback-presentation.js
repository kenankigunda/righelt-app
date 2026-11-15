import {BOARD_PROMPT} from '../board/prompt-models.js';
import {acknowledgedContextPurpose} from './board-context-purpose.js';
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
            const recordedPresentation=record?selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:record},{identityId}):null;
            const actorName=recordedPresentation?.message.actorName??playerDisplayName(view,actor);
            if(view.confirmedPlayback.error)return {text:`${actorName} needs help`,actorName,action:{id:'retry-confirmed-playback',label:'Retry'}};
            if(status?.activity?.needsHelp){const helpName=COMPUTER_PROFILES[status.profile]?.name??actorName;return {text:`${helpName} needs help`,actorName:helpName};}
            if(recordedPresentation?.message)return recordedPresentation.message;
            return {text:`${actorName} is making their move`,actorName};
          }
 return null;
}

export function playbackTurnIndicator(view,state,{replay,step,identityId}={}) {
 const automatic=step?.frame?.recordedMove;
 if(view?.confirmedPlayback&&automatic)return selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:automatic},{identityId})?.caption??{text:'Move unavailable'};
 if(replay?.playing)return selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:replay.recordedMove},{identityId})?.caption??{text:'Replay'};
 return selectedHistoryPresentation(view,{identityId})?.caption??boardTurnCaption(view,state,{identityId});
}
export const contextReplayAvailable=({descriptor,followWorking,playbackPlaying,replayPending,replayPlaying,canReplay})=>
 !followWorking&&!playbackPlaying&&canReplay(descriptor)&&!replayPending&&!replayPlaying;
export function historyBoardRuntimeMessage(view,selection={},options={}) {
 if(!view?.inHistoryMode||selection.selectedPieceId||selection.inspection)return null;
 return historyBoardMessage(view,options);
}

export function displayedReplayMessage(view,replay,replayFeedback,{identityId,episodeKey}={}) {
 if(replayFeedback?.gameId===view?.id&&replayFeedback.phase==='error')return {
  text:BOARD_PROMPT.failedReplay,
  action:{id:'replay-computer',label:'Try again'},
 };
 if(!replay?.playing)return null;
 const explanation=selectedHistoryPresentation({...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:replay.recordedMove},{identityId})?.message
  ??{text:'Historical move details unavailable'};
 const contentHeightOwner=typeof episodeKey==='string'&&episodeKey.length?`replay:${episodeKey}`:null;
 return replay.manual?{...explanation,contentHeightOwner,action:{id:'replay-next',label:'Next'}}:{...explanation,contentHeightOwner};
}
export function refreshFollowControls({boardRuntime,followWorking,replayPlaying,playbackPlaying,refreshContext}) {
 boardRuntime?.setInteractionBlocked(Boolean(followWorking||replayPlaying||playbackPlaying));
 boardRuntime?.refreshStatus();
 refreshContext();
}

export function publishAcknowledgedBoardMessage(view,status,options,{boardContexts,queueBoardContextRefresh,transport,boardContextScope,document}) {

 const recorded=options.presentationMove;
 const presentation=recorded?{...view,inHistoryMode:true,historyTurnIndex:null,inspectedDecision:recorded}:view;
 const message=historyBoardMessage(presentation,{identityId:options.identityId})??withPushSequenceMessage(opponentBoardMessage(view,status,{},options),view,{},options.identityId),body=message?.context;
 if(!body){if(boardContexts.update('acknowledged',null))queueBoardContextRefresh();return;}
 const replay=['replay-computer','replay-push-sequence'].includes(body.action?.id)?captureDisplayedReplay({source:body.action.id==='replay-push-sequence'?'push-sequence':'opponent-turn',game:view,owner:transport,scope:boardContextScope(),identityId:transport.getIdentityId(),visible:!document.hidden}):null;
 const purpose=acknowledgedContextPurpose({selectedHistory:view.inHistoryMode,recordedMove:recorded,message:body});
 const context={purpose,actorSide:recorded?recordedActorSide(recorded):body.actorSide??null,gameId:view.id,key:replay?.key??JSON.stringify(recorded?[boardContextScope(),view.id,'confirmed-frame',recorded.moveId]:[boardContextScope(),view.id,view.gameplayRevision,'completion']),message:body,replay,mandatory:false,transient:false};
 const changed=boardContexts.update('acknowledged',context);

 if(changed)queueBoardContextRefresh();

}

// Keep loading ownership and confirmed-frame copy in the same production boundary.
export function presentPlaybackBoardMessage(view,status,{activityHost,selection={},replay,replayFeedback,loadingKey=null,scope,...options}={}) {
 updateComputerBoardLoading(activityHost,view,status,{
  replaying:Boolean(view?.confirmedPlayback||replay?.playing),loadingKey,
  inspecting:Boolean(selection.selectedPieceId||selection.inspection),scope,
 });
 if(view?.positionOnly)return {text:view.positionLoading?'Loading play':'Play could not finish loading'};
 return confirmedPlaybackMessage(view,status,options);
}
