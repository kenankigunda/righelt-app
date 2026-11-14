import {BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';
import {BOARD_PROMPT} from '../board/prompt-models.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {historyActorLabel,recordedActorIdentity} from './perspective-labels.js';
import {historyTurnSide} from './history-preview.js';
import {describeRecordedMove,describeRecordedTurn,recordedMoveNumber,recordedActorSide,recordedNarrationCoordinates,recordedMoveWithClosure} from './recorded-narration.js';
import {completedTurnTitle,isCompletedWinningTurn} from './completed-review.js';
import {completedOutcomeNarration} from './completion-narration.js';
import {BOARD_MESSAGE_STRENGTH,isMeaningfulHistoryMessage,resolveBoardMessageOwner} from '../board/message-priority.js';

export const HISTORY_HIT_TARGET_CONTRACT='move-button-v1';

const actorName=(game,move,side,options)=>historyActorLabel(game,{...move,actorSide:side},options);
const ownedActor=(game,move,options)=>recordedActorIdentity(game,move,options).owned;
/** Presentation reads the exact pinned record, never current board occupants. */
export function selectedHistoryPresentation(game,options={}){
 if(!game?.inHistoryMode)return null;
 if(game.historyTurnIndex!=null){
  const moves=game.historyTurnMoves??[],turn=game.turns?.find(turn=>turn.index===game.historyTurnIndex),side=historyTurnSide(turn,moves);
  const actor=moves.find(move=>recordedActorSide(move)===side),name=actorName(game,actor,side,options);
  const completedTitle=isCompletedWinningTurn(game)?completedTurnTitle(game,options.identityId,game.historyTurnIndex):null;
  const completion=completedTitle?completedOutcomeNarration(game,options):null;
  const narration=describeRecordedTurn(moves,name,{owned:ownedActor(game,actor,options)});
  return {caption:{text:completedTitle??`Turn ${game.historyTurnIndex+1}`,side},message:completion??{text:narration??'Historical turn details unavailable',actorName:name,coordinates:recordedNarrationCoordinates(moves)},messageStrength:completion||narration?BOARD_MESSAGE_STRENGTH.SEMANTIC:BOARD_MESSAGE_STRENGTH.PLACEHOLDER};
 }
 const move=selectedHistoricalRecord(game);
 const number=recordedMoveNumber(move),side=recordedActorSide(move),name=actorName(game,move,side,options);
 const narration=describeRecordedMove(move,name,{owned:ownedActor(game,move,options)});
 return {record:move,caption:{text:number==null?'Move unavailable':`Move ${number}`,side},message:{text:narration??'Historical move details unavailable',actorName:name,coordinates:recordedNarrationCoordinates(move?[move]:[])},messageStrength:narration?BOARD_MESSAGE_STRENGTH.SEMANTIC:BOARD_MESSAGE_STRENGTH.PLACEHOLDER};
}

export function selectedHistoricalRecord(game){
 const move=game?.inspectedDecision??game?.moves?.find(move=>move.index===game.historyIndex);
 return recordedMoveWithClosure(move,[...(game?.moves??[]),...(game?.historyContextMoves??[])]);
}
/** Closure changes historical presentation only, never the live authoritative view. */
export function recordedHistoryView(game){
 if(!game?.inHistoryMode||game.historyTurnIndex!=null)return game;
 const move=selectedHistoricalRecord(game);
 if(!move)return game;
 return {...game,inspectedDecision:move,currentSnapshot:move.snapshot??game.currentSnapshot};
}

/** Recorded detail belongs to context, outside the finite Board prompt budget. */
export function historyBoardMessage(game,options={}){
 const presentation=selectedHistoryPresentation(game,options);
 if(!presentation)return null;
 const context={...presentation.message,purpose:BOARD_CONTEXT_PURPOSE.HISTORY};
 return resolveBoardMessageOwner({semantic:isMeaningfulHistoryMessage(context,presentation.messageStrength)?context:null,generic:{text:BOARD_PROMPT.history}});
}
