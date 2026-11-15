const active = moves => (moves ?? []).filter(move => move && move.undone !== true);

/** Redistribute destruction evidence for narration only; durable records stay on their removal move. */
export const presentationDestroyedPiecesForMove = (move, moves = []) => {
  const records=active(moves).flatMap(owner => (owner.destroyedPieces ?? [])
    .filter(record => record.causalMoveId
      ? record.causalMoveId === move?.clientCommandId || record.causalMoveId === move?.moveId
      : owner.moveId === move?.moveId)
    .map(record=>[
      record.eventId??`${owner.moveId}:${record.pieceId??''}:${record.position?.row??''}:${record.position?.col??''}`,
      record,
    ]));
  return [...new Map(records).values()];
};

export const withCausalDestructionPresentation = moves => {
  const source = active(moves);
  return source.map(move => ({
    ...move,
    destroyedPieces: presentationDestroyedPiecesForMove(move, source),
  }));
};

export const moveInspectionSnapshot = move => move?.inspectionSnapshot ?? move?.snapshot ?? move?.selectionSnapshot ?? null;

/** Legacy records have no phase and retain their established actual-removal behavior. */
export const immediateRemovalRecords = move => (move?.destroyedPieces ?? [])
  .filter(record => record.removalPhase !== "turn_settlement");

export const settlementRemovalRecords = move => (move?.destroyedPieces ?? [])
  .filter(record => record.removalPhase === "turn_settlement");

export const turnInspectionRemovalRecords = move => (move?.destroyedPieces ?? [])
  .filter(record => record.removalPhase !== "immediate");
