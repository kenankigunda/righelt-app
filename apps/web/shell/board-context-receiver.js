import {runtimeContextPurpose} from './board-context-purpose.js';
import {isMeaningfulHistoryMessage} from '../board/message-priority.js';

export function createBoardContextReceiver(getDependencies) {
 return (context,meta)=>{
  const {displayedReplayFrame,boardContextScope,boardContextOwner,boardContexts,appEl,document,queueBoardContextRefresh}=getDependencies();
  const game=displayedReplayFrame();if(!game)return;
  const frame=[boardContextScope(),game.id,game.gameplayRevision,game.inHistoryMode?[game.historyIndex,game.historyTurnIndex]:'live'];
  const key=JSON.stringify([...frame,context?.mandatory?'required-rush':meta.selectedPieceId,meta.phase,meta.continuationPhase,context?.mandatory?context.message.coordinates:null]);
  if(!meta.transient){
   boardContextOwner.commit(JSON.stringify([...frame,meta.selectedPieceId,meta.phase,meta.continuationPhase,meta.intentVersion]));

  }
  const focused=appEl.contains(document.activeElement)&&Boolean(document.activeElement?.closest('[data-board-context]'));
  if(context&&meta.transient&&focused)return;
  const weakHistory=context?.kind==='history'&&!isMeaningfulHistoryMessage(context.message,context.strength);
  const value=context&&!weakHistory?{...context,purpose:runtimeContextPurpose(context),key,gameId:game.id,transient:context.mandatory?false:meta.transient}:meta.selectedPieceId?{key,gameId:game.id,message:null,transient:false}:null;
  if(boardContexts.update('piece',value))queueBoardContextRefresh();
 };
}
