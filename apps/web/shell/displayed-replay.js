import {latestOpponentTurn} from './opponent-narration.js';

const lineage = game => game?.moves?.filter(move=>!move.undone).at(-1)?.moveId??null;
const moveIdentity = moves => moves.map(move=>move.moveId);

// Capture the same accepted frame that supplied the visible summary. A newer
// transport frame must never silently replace the turn the player clicked.
export function captureDisplayedReplay({game,owner,scope,identityId,visible=true}) {
 if(!game||game.inHistoryMode||game.positionOnly||!visible)return null;
 const completed=latestOpponentTurn(game,{identityId});
 if(!completed)return null;
 const revision=game.gameplayRevision,lineageHead=lineage(game);
 if(typeof game.id!=='string'||!game.id||!Number.isSafeInteger(revision)||revision<0||!owner)return null;
 return Object.freeze({owner,scope,gameId:game.id,revision,lineageHead,turnIndex:completed.turn.index,
  moveIds:Object.freeze(moveIdentity(completed.moves)),moves:structuredClone(game.moves),
  key:JSON.stringify([scope,game.id,revision,lineageHead,completed.turn.index,moveIdentity(completed.moves)])});
}

export function displayedReplayIsCurrent(descriptor,{game,context}) {
 if(!descriptor||!game||game.inHistoryMode||game.positionOnly||!context?.visible)return false;
 if(descriptor.owner!==context.owner||descriptor.scope!==context.scope||descriptor.gameId!==context.gameId
  ||descriptor.revision!==context.revision||descriptor.lineageHead!==context.lineageHead)return false;
 if(game.id!==descriptor.gameId||game.gameplayRevision!==descriptor.revision||lineage(game)!==descriptor.lineageHead)return false;
 const moves=game.moves?.filter(move=>!move.undone&&move.turnIndex===descriptor.turnIndex)??[];
 return (game.board?.state?.turnIndex??0)-1===descriptor.turnIndex
  &&JSON.stringify(moveIdentity(moves))===JSON.stringify(descriptor.moveIds);
}

export function replayArchiveMatches(descriptor,moves) {
 return JSON.stringify(moveIdentity(moves.filter(move=>!move.undone&&move.turnIndex===descriptor.turnIndex)))===JSON.stringify(descriptor.moveIds);
}
