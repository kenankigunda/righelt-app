import {humanControlledSides} from './perspective-labels.js';
import {latestOpponentTurn} from './opponent-narration.js';
import {buildTurnPreview,historyTurnSide} from './history-preview.js';
import {getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';

const completeMoves = moves => moves.length > 0 && moves.every((move,index)=>move.snapshot && move.selectionSnapshot && move.turnMoveIndex===index);

const roleSide = value => value === 'p1' || value === 'P1' ? 'P1' : value === 'p2' || value === 'P2' ? 'P2' : null;

/** A live cue uses only soft square washes. History owns routes, ghosts and replay decoration. */
export function buildPreviousTurnOverlay(moves,side) {
  const preview=buildTurnPreview(moves,{context:'history'}),cells=new Map();
  for(const role of preview.overlay.endpointRoles??[]){
    const key=`${role.row},${role.col}`;
    cells.set(key,{row:role.row,col:role.col,source:role.source===true,target:role.target===true,side:roleSide(side),deletionSide:null});
  }
  for(const removed of preview.overlay.destroyedPieces??[]){
    const key=`${removed.row},${removed.col}`,cell=cells.get(key)??{row:removed.row,col:removed.col,source:false,target:false,side:roleSide(side),deletionSide:null};
    cell.deletionSide=roleSide(removed.ownerSeat);
    cells.set(key,cell);
  }
  return {mode:'previous-turn',presentationContext:'previous-turn',previousTurnCells:[...cells.values()]};
}

/** Recorded presentation owners take precedence over an optional live overview. */
export function liveTurnOverviewOverlay(selection,{game,overview,confirmedPlayback,replayController,forcedFollow}) {
  return game?.confirmedPlayback || confirmedPlayback?.snapshot().playing || replayController?.snapshot().playing || forcedFollow()
    ? null : overview.overlay(selection);
}

/** Personal visit state only. Live snapshots and legal actions remain authoritative. */
export function createLiveTurnOverview({loadMoves,onChange=()=>{}}) {
  let session=null,candidate=null,preview=null,attempt=null,generation=0;
  const leave = () => {session=candidate=preview=attempt=null;generation++;};
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
    if ((candidate?.key ?? null)!==key) {candidate=key ? {key,turn:completed.turn} : null;preview=null;attempt=null;generation++;}
    if (!candidate) return;
    if (preview) return;
    const ordered=[...completed.moves].sort((a,b)=>a.turnMoveIndex-b.turnMoveIndex);
    if (completeMoves(ordered)) {preview=buildPreviousTurnOverlay(ordered,historyTurnSide(completed.turn,ordered));return;}
    const requestKey=`${key}:${game.gameplayRevision}`;
    if (attempt===requestKey) return;
    attempt=requestKey;
    const owner=generation;
    Promise.resolve().then(()=>owner===generation && candidate?.key===key ? loadMoves({gameId:game.id,turnIndex:completed.turn.index,revision:game.gameplayRevision,isCurrent:()=>owner===generation && candidate?.key===key}) : null).then(moves=>{
      if (owner!==generation || candidate?.key!==key) return;
      const ordered=[...moves].filter(move=>!move.undone).sort((a,b)=>a.turnMoveIndex-b.turnMoveIndex);
      if (!completeMoves(ordered)) return;
      preview=buildPreviousTurnOverlay(ordered,historyTurnSide(completed.turn,ordered));onChange();
    }).catch(()=>{}); // A visual overview never introduces recovery UI or blocks play.
  };
  return {
    sync,leave,
    selected() {},
    overlay({selectedPieceId,inspection}={}) {return candidate && !selectedPieceId && !inspection ? preview ?? null : null;},
  };
}
