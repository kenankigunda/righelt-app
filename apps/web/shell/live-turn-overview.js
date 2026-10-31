import {humanControlledSides} from './perspective-labels.js';
import {latestOpponentTurn} from './opponent-narration.js';
import {buildTurnPreview} from './history-preview.js';
import {getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';

const completeMoves = moves => moves.length > 0 && moves.every((move,index)=>move.snapshot && move.selectionSnapshot && move.turnMoveIndex===index);

/** Personal visit state only. Live snapshots and legal actions remain authoritative. */
export function createLiveTurnOverview({loadMoves,onChange=()=>{}}) {
  let session=null,candidate=null,dismissed=null,preview=null,attempt=null,generation=0;
  const leave = () => {session=candidate=dismissed=preview=attempt=null;generation++;};
  const sync = (game,{identityId,scope}={}) => {
    const nextSession=game ? `${scope}:${game.id}` : null;
    if (session!==nextSession) {leave();session=nextSession;}
    const state=game?.board?.state;
    const own=humanControlledSides(game,{identityId});
    const started=(game?.moves ?? []).some(move=>!move.undone && move.turnIndex===state?.turnIndex)
      || (game?.pendingMoves ?? []).some(move=>move.turnIndex===state?.turnIndex);
    const eligible=state && own.length===1 && getTurnOwnerSideForState(state)===own[0]
      && !game.inHistoryMode && !game.computerTurn && game.pendingComputerSaveStartedAt == null
      && !state.continuation && !started && (!state.outcome?.status || state.outcome.status==='ongoing');
    const completed=eligible ? latestOpponentTurn(game,{identityId}) : null;
    const key=completed ? `${session}:${completed.turn.index}:${completed.last.moveId}` : null;
    if ((candidate?.key ?? null)!==key) {candidate=key ? {key,side:own[0]} : null;preview=null;attempt=null;generation++;}
    if (!candidate || dismissed===key) return;
    if (preview) return;
    const ordered=[...completed.moves].sort((a,b)=>a.turnMoveIndex-b.turnMoveIndex);
    if (completeMoves(ordered)) {preview=buildTurnPreview(ordered);return;}
    const requestKey=`${key}:${game.gameplayRevision}`;
    if (attempt===requestKey) return;
    attempt=requestKey;
    const owner=generation;
    Promise.resolve().then(()=>owner===generation && candidate?.key===key ? loadMoves({gameId:game.id,turnIndex:completed.turn.index,revision:game.gameplayRevision,isCurrent:()=>owner===generation && candidate?.key===key && dismissed!==key}) : null).then(moves=>{
      if (owner!==generation || candidate?.key!==key || dismissed===key) return;
      const ordered=[...moves].filter(move=>!move.undone).sort((a,b)=>a.turnMoveIndex-b.turnMoveIndex);
      if (!completeMoves(ordered)) return;
      preview=buildTurnPreview(ordered);onChange();
    }).catch(()=>{}); // A visual overview never introduces recovery UI or blocks play.
  };
  return {
    sync,leave,
    selected(piece) {if(candidate && piece?.owner===candidate.side)dismissed=candidate.key;},
    overlay({selectedPieceId,inspection}={}) {return candidate && dismissed!==candidate.key && !selectedPieceId && !inspection ? preview?.overlay ?? null : null;},
  };
}
