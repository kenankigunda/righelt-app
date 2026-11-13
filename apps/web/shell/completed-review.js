import {isCompletedGame} from './game-lifecycle.js';
import {getGameResult} from './game-result.js';

export const completedTurnIndex = game => {
  if (!isCompletedGame(game)) return null;
  const active = (game?.moves ?? []).filter(move => move?.undone !== true && Number.isSafeInteger(move?.turnIndex));
  if (active.length) return active.at(-1).turnIndex;
  const recorded = (game?.turns ?? []).filter(turn => Number.isSafeInteger(turn?.index) && (turn?.endedAt || turn?.moveIndexes?.length));
  return recorded.length ? recorded.at(-1).index : null;
};

export const completedTurnTitle = (game, identityId, turnIndex = completedTurnIndex(game)) => {
  if (!Number.isSafeInteger(turnIndex)) return null;
  const result = getGameResult(game, identityId);
  if (!result) return null;
  const title = result.title.replace(/ won as (Red|Blue)$/u, ' won');
  return `${title} on Turn ${turnIndex + 1}`;
};

export const isCompletedWinningTurn = game =>
  isCompletedGame(game) && Number.isSafeInteger(game?.historyTurnIndex) && game.historyTurnIndex === completedTurnIndex(game);

export function createCompletedReviewOwner({getTransport,onError=()=>{}}) {
  let owner=null;
  const clear=()=>{owner=null;};
  const sync=game=>{
    const transport=getTransport(),turnIndex=completedTurnIndex(game);
    if(!transport||!game||game.inHistoryMode||game.historyLoading||!Number.isSafeInteger(turnIndex))return null;
    const key=`${game.id}:${game.gameplayRevision}:${turnIndex}`;
    if(owner?.transport===transport&&owner.key===key)return owner.promise;
    const current={transport,key,promise:null};
    current.promise=Promise.resolve().then(()=>transport.selectHistoryTurn({gameId:game.id,turnIndex})).catch(error=>{if(owner===current)onError(error);});
    owner=current;
    return current.promise;
  };
  return {sync,clear};
}
