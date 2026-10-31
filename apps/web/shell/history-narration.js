import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {playerDisplayName} from './perspective-labels.js';
import {historyTurnSide} from './history-preview.js';
import {describeRecordedMove,describeRecordedTurn,recordedMoveNumber,recordedActorSide,recordedNarrationCoordinates} from './recorded-narration.js';

const actorName=(game,move,side)=>COMPUTER_PROFILES[move?.computerProof?.profile]?.name??playerDisplayName(game,side);
/** Presentation reads the exact pinned record, never current board occupants. */
export function selectedHistoryPresentation(game){
 if(!game?.inHistoryMode)return null;
 if(game.historyTurnIndex!=null){
  const moves=game.historyTurnMoves??[],turn=game.turns?.find(turn=>turn.index===game.historyTurnIndex),side=historyTurnSide(turn,moves);
  const actor=moves.find(move=>recordedActorSide(move)===side),name=actorName(game,actor,side);
  return {caption:{text:`Turn ${game.historyTurnIndex+1}`,side},message:{text:describeRecordedTurn(moves,name)??'Historical turn details unavailable',actorName:name,coordinates:recordedNarrationCoordinates(moves)}};
 }
 const move=game.inspectedDecision??game.moves?.find(move=>move.index===game.historyIndex);
 const number=recordedMoveNumber(move),side=recordedActorSide(move),name=actorName(game,move,side);
 return {caption:{text:number==null?'Move unavailable':`Move ${number}`,side},message:{text:describeRecordedMove(move,name)??'Historical move details unavailable',actorName:name,coordinates:recordedNarrationCoordinates(move?[move]:[])}};
}
