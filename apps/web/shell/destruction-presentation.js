const sameMove = (left,right) => left === right || Boolean(left && right
  && ((left.moveId && left.moveId === right.moveId)
    || (left.clientCommandId && left.clientCommandId === right.clientCommandId)));

const presentationContext = (move,moves) => {
  const source=(moves ?? []).filter(Boolean);
  if(move?.undone!==true)return source.filter(entry=>entry.undone!==true);
  if(Number.isSafeInteger(move.undoEventSeq)&&move.undoEventSeq>0){
    return source.filter(entry=>entry.undone===true&&entry.undoEventSeq===move.undoEventSeq);
  }
  if(typeof move.pendingUndoRequestId==='string'&&move.pendingUndoRequestId){
    return source.filter(entry=>entry.undone===true&&entry.pendingUndoRequestId===move.pendingUndoRequestId);
  }
  // Legacy or conflicted Undo records cannot prove a shared operation. Keep the
  // durable owner's evidence without allowing one unknown lineage to move it
  // onto another undone row.
  return source.filter(entry=>sameMove(entry,move));
};

/** Redistribute destruction evidence for narration only; durable records stay on their removal move. */
export const presentationDestroyedPiecesForMove = (move, moves = []) => {
  const context=presentationContext(move,moves);
  const availableMoveIds=new Set(context.flatMap(entry=>[entry.moveId,entry.clientCommandId].filter(Boolean)));
  const records=context.flatMap(owner => (owner.destroyedPieces ?? [])
    .filter(record => availableMoveIds.has(record.causalMoveId)
      ? record.causalMoveId === move?.clientCommandId || record.causalMoveId === move?.moveId
      : owner.moveId === move?.moveId)
    .map(record=>[
      record.eventId??`${owner.moveId}:${record.pieceId??''}:${record.position?.row??''}:${record.position?.col??''}`,
      record,
    ]));
  return [...new Map(records).values()];
};

export const withCausalDestructionPresentation = moves => {
  const source = (moves ?? []).filter(Boolean);
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
