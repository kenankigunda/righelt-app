import {latestLocalPushSequence} from './push-sequence-replay.js';
import {latestOpponentTurn} from './opponent-narration.js';

const lineage = game => game?.moves?.filter(move=>!move.undone).at(-1)?.moveId??null;
const moveIdentity = moves => moves.map(move=>move.moveId);

// Capture the same accepted frame that supplied the visible summary. A newer
// transport frame must never silently replace the turn the player clicked.
export function captureDisplayedReplay({game,owner,scope,identityId,visible=true,source='opponent-turn'}) {
 if(!game||game.inHistoryMode||game.positionOnly||!visible)return null;
 const completed=source==='push-sequence'?latestLocalPushSequence(game,identityId):latestOpponentTurn(game,{identityId});
 if(!completed)return null;
 const turnIndex=completed.turn?.index??completed.moves[0].turnIndex;
 const revision=game.gameplayRevision,lineageHead=lineage(game);
 if(typeof game.id!=='string'||!game.id||!Number.isSafeInteger(revision)||revision<0||!owner)return null;
 return Object.freeze({owner,scope,gameId:game.id,revision,lineageHead,turnIndex,...(source==='push-sequence'?{source,startId:completed.startId,endId:completed.endId}:{}),
  moveIds:Object.freeze(moveIdentity(completed.moves)),moves:structuredClone(game.moves),
  key:JSON.stringify([scope,game.id,revision,lineageHead,source,turnIndex,moveIdentity(completed.moves)])});
}

export function displayedReplayIsCurrent(descriptor,{game,context}) {
 if(!descriptor||!game||game.inHistoryMode||game.positionOnly||!context?.visible)return false;
 if(descriptor.owner!==context.owner||descriptor.scope!==context.scope||descriptor.gameId!==context.gameId
  ||descriptor.revision!==context.revision||descriptor.lineageHead!==context.lineageHead)return false;
 if(game.id!==descriptor.gameId||game.gameplayRevision!==descriptor.revision||lineage(game)!==descriptor.lineageHead)return false;
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
