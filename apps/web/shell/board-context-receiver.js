import {runtimeContextPurpose,BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';

export function createBoardContextReceiver(getDependencies) {
 return (context,meta)=>{
  const {displayedReplayFrame,boardContextScope,boardContextOwner,boardContexts,notificationStack,appEl,document,queueBoardContextRefresh}=getDependencies();
  const game=displayedReplayFrame();if(!game)return;
  const frame=[boardContextScope(),game.id,game.gameplayRevision,game.inHistoryMode?[game.historyIndex,game.historyTurnIndex]:'live'];
  const key=JSON.stringify([...frame,context?.mandatory?'required-rush':meta.selectedPieceId,meta.phase,meta.continuationPhase,context?.mandatory?context.message.coordinates:null]);
  if(!meta.transient){
   boardContextOwner.commit(JSON.stringify([...frame,meta.selectedPieceId,meta.phase,meta.continuationPhase,meta.intentVersion]));
   const acknowledged=boardContexts.channel('acknowledged');
   const fallback=acknowledged?.purpose!==BOARD_CONTEXT_PURPOSE.INCOMING&&acknowledged?.gameId===game.id&&acknowledged.message&&!boardContexts.isDismissed(acknowledged.key)?`board-context:${acknowledged.key}`:null;
   notificationStack.prefer(game.id,context?.message&&!boardContexts.isDismissed(key)&&(meta.selectedPieceId||context.mandatory||context.kind==='replay-progress')?`board-context:${key}`:fallback);
  }
  const focused=appEl.contains(document.activeElement)&&Boolean(document.activeElement?.closest('[data-board-context]'));
  if(context&&meta.transient&&focused)return;
  const value=context?{...context,purpose:runtimeContextPurpose(context),key,gameId:game.id,transient:context.mandatory?false:meta.transient}:meta.selectedPieceId?{key,gameId:game.id,message:null,transient:false}:null;
  if(boardContexts.update('piece',value))queueBoardContextRefresh();
 };
}
