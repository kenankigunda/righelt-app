import {resolveToStability} from '../generated/packages/game-engine/src/index.js';
import {finalizeResolvedTurn,getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';

/** A read-only visual projection. Never feed its pieces into move admission. */
export function createSequenceStatusProjector() {
  let previousKey,previousProjection;
  return snapshot=>{
    if (!snapshot || !['rush','push'].includes(snapshot.continuation?.type)
      || snapshot.outcome?.status !== 'ongoing' || !Array.isArray(snapshot.pieces)) return null;
    // Snapshot identity alone is insufficient: adapters also accept mutable
    // engine snapshots. Cache complete authoritative inputs, not selection.
    const key=JSON.stringify(snapshot);
    if (key===previousKey) return previousProjection;
    const statusByPieceId=new Map(),destroyedPieceIds=new Set();
    const remember=piece=>statusByPieceId.set(piece.id,{
      supplied:piece.displaySupplied??piece.supplied??false,
      commanded:piece.displayCommanded??piece.commanded??false,
    });
    const {nextState}=finalizeResolvedTurn({
      state:structuredClone(snapshot),
      activeTurn:{index:snapshot.turnIndex,playerSeat:getTurnOwnerSideForState(snapshot)==='P1'?'Player 1':'Player 2'},
      endedAt:0,
      resolveToStability,
      onRemoval:({piece})=>{remember(piece);destroyedPieceIds.add(piece.id);},
    });
    for(const piece of nextState.pieces) remember(piece);
    previousKey=key;
    previousProjection={statusByPieceId,destroyedPieceIds};
    return previousProjection;
  };
}
