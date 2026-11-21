import {isCompletedGame,completedTurnIndex} from './game-lifecycle.js';
import {completedGameCaption} from './perspective-labels.js';

export {completedTurnIndex} from './game-lifecycle.js';
export const completedTurnCaption = completedGameCaption;

export const completedTurnTitle = (game, identityId, turnIndex = completedTurnIndex(game)) =>
  completedTurnCaption(game,identityId,turnIndex)?.text??null;

// A terminal command need not append a move. Caption its canonical finish turn,
// but only ask History to hydrate a turn that actually has a recorded decision.
export const completedReviewTurnIndex = game => {
  if(!isCompletedGame(game))return null;
  const active=(game.moves??[]).filter(move=>move?.undone!==true&&Number.isSafeInteger(move?.turnIndex));
  if(active.length)return active.at(-1).turnIndex;
  const recorded=(game.turns??[]).filter(turn=>Number.isSafeInteger(turn?.index)&&turn.moveIndexes?.length);
  return recorded.length?recorded.at(-1).index:null;
};
export const isCompletedWinningTurn = game =>
  isCompletedGame(game) && Number.isSafeInteger(game?.historyTurnIndex) && game.historyTurnIndex === completedReviewTurnIndex(game);

export function createCompletedReviewOwner({getTransport,onError=()=>{}}) {
  let owner=null;
  const clear=()=>{owner=null;};
  const sync=(game,entryGeneration=0,{preserveSelection=false}={})=>{
    const transport=getTransport(),turnIndex=completedReviewTurnIndex(game);
    if(!transport||!game||game.historyLoading||!Number.isSafeInteger(turnIndex))return null;
    const key=`${entryGeneration}:${game.id}:${game.gameplayRevision}:${turnIndex}`;
    if(preserveSelection&&game.inHistoryMode){owner={transport,key,promise:Promise.resolve(game)};return owner.promise;}
    if(owner?.transport===transport&&owner.key===key)return game.inHistoryMode&&game.historyTurnIndex!==turnIndex?null:owner.promise;
    if(game.inHistoryMode&&game.historyTurnIndex===turnIndex){
      const current={transport,key,promise:Promise.resolve(game)};owner=current;return current.promise;
    }
    const current={transport,key,promise:null};
    const selected=result=>{
      const view=result??transport.getGameViewModel?.(game.id);
      return view?.inHistoryMode===true&&view?.historyTurnIndex===turnIndex;
    };
    const enter=async attempt=>{
      try{
        const result=await transport.selectHistoryTurn({gameId:game.id,turnIndex});
        if(selected(result))return result;
        if(owner===current&&attempt===0)return enter(1);
        if(owner===current)owner=null;
        return result;
      }catch(error){
        if(owner===current&&attempt===0)return enter(1);
        if(owner===current){owner=null;onError(error);}
        return null;
      }
    };
    current.promise=Promise.resolve().then(()=>enter(0));
    owner=current;
    return current.promise;
  };
  return {sync,clear};
}
