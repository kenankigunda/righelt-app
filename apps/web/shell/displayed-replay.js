import {latestLocalPushSequence} from './push-sequence-replay.js';
import {latestOpponentTurn} from './opponent-narration.js';

const lineage = game => game?.moves?.filter(move=>!move.undone).at(-1)?.moveId??null;
const moveIdentity = moves => moves.map(move=>move.moveId);

const selectedImportedTurn = game => {
 if(!game?.inHistoryMode||!Number.isSafeInteger(game.historyTurnIndex)||game.historyTurnIndex<0)return null;
 const moves=[...(game.historyTurnMoves??[])].sort((a,b)=>a.turnMoveIndex-b.turnMoveIndex);
 if(!moves.length||!moves.some(move=>move.importedFrom))return null;
 if(moves.some((move,index)=>move.undone||move.turnIndex!==game.historyTurnIndex||move.turnMoveIndex!==index
  ||typeof move.moveId!=='string'||!move.moveId||!move.selectionSnapshot||!move.snapshot
  ||move.importedFrom&&(!move.importedFrom.gameId||!move.importedFrom.decisionId)))return null;
 if(new Set(moveIdentity(moves)).size!==moves.length)return null;
 return {turn:{index:game.historyTurnIndex},moves};
};

// Capture the same accepted frame that supplied the visible summary. A newer
// transport frame must never silently replace the turn the player clicked.
export function captureDisplayedReplay({game,owner,scope,identityId,visible=true,source='opponent-turn',viewGeneration=0}) {
 const imported=source==='imported-turn';
 if(!game||!imported&&game.inHistoryMode||game.positionOnly||!visible)return null;
 if(imported&&(!Number.isSafeInteger(viewGeneration)||viewGeneration<0))return null;
 const completed=imported?selectedImportedTurn(game):source==='push-sequence'?latestLocalPushSequence(game,identityId):latestOpponentTurn(game,{identityId});
 if(!completed)return null;
 const turnIndex=completed.turn?.index??completed.moves[0].turnIndex;
 const revision=game.gameplayRevision,lineageHead=lineage(game);
 if(typeof game.id!=='string'||!game.id||!Number.isSafeInteger(revision)||revision<0||!owner)return null;
 return Object.freeze({owner,scope,gameId:game.id,revision,lineageHead,turnIndex,...(source==='push-sequence'?{source,startId:completed.startId,endId:completed.endId}:imported?{source,viewGeneration}:{}),
  moveIds:Object.freeze(moveIdentity(completed.moves)),moves:structuredClone(imported?completed.moves:game.moves),
  key:JSON.stringify([scope,game.id,revision,lineageHead,source,turnIndex,moveIdentity(completed.moves),...(imported?[viewGeneration]:[])])});
}

export function displayedReplayIsCurrent(descriptor,{game,context}) {
 const imported=descriptor?.source==='imported-turn';
 if(!descriptor||!game||!imported&&game.inHistoryMode||game.positionOnly||!context?.visible)return false;
 if(descriptor.owner!==context.owner||descriptor.scope!==context.scope||descriptor.gameId!==context.gameId
  ||descriptor.revision!==context.revision||descriptor.lineageHead!==context.lineageHead)return false;
 if(game.id!==descriptor.gameId||game.gameplayRevision!==descriptor.revision||lineage(game)!==descriptor.lineageHead)return false;
 if(imported){
  const selected=selectedImportedTurn(game);
  return Boolean(selected&&descriptor.viewGeneration===context.viewGeneration&&game.historyTurnIndex===descriptor.turnIndex
   &&JSON.stringify(moveIdentity(selected.moves))===JSON.stringify(descriptor.moveIds));
 }
 const moves=descriptorMoves(descriptor,game.moves??[]);
 return (descriptor.source==='push-sequence'||(game.board?.state?.turnIndex??0)-1===descriptor.turnIndex)
  &&JSON.stringify(moveIdentity(moves))===JSON.stringify(descriptor.moveIds);
}

const descriptorMoves=(descriptor,moves)=>{
 const active=moves.filter(move=>!move.undone);
 if(descriptor.source!=='push-sequence')return active.filter(move=>move.turnIndex===descriptor.turnIndex);
 const start=active.findIndex(move=>move.moveId===descriptor.startId),end=active.findIndex(move=>move.moveId===descriptor.endId);
 return start>=0&&end>=start?active.slice(start,end+1):[];
};
export function replayArchiveMatches(descriptor,moves) {
 return JSON.stringify(moveIdentity(descriptorMoves(descriptor,moves)))===JSON.stringify(descriptor.moveIds);
}

export function displayedReplayMatchesPreviousTurnEpisode(descriptor,episode) {
 if(!descriptor||['push-sequence','imported-turn'].includes(descriptor.source)||typeof episode!=='string'||!episode)return false;
 const separator=episode.lastIndexOf(':'),turnSeparator=episode.lastIndexOf(':',separator-1);
 if(separator<0||turnSeparator<0)return false;
 const turnIndex=Number(episode.slice(turnSeparator+1,separator)),lastMoveId=episode.slice(separator+1);
 return Number.isSafeInteger(turnIndex)&&descriptor.turnIndex===turnIndex&&descriptor.moveIds?.at(-1)===lastMoveId;
}
