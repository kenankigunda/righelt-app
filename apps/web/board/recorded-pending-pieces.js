// Recorded display status belongs to presentation, never move admission.
export const pendingSupplyLossPieces = snapshot => (Array.isArray(snapshot?.pieces) ? snapshot.pieces : [])
  .filter(piece => typeof piece?.id === 'string' && piece.id && piece.kind === 'unit'
    && Number.isSafeInteger(piece.position?.row) && Number.isSafeInteger(piece.position?.col)
    && piece.position.row >= 0 && piece.position.col >= 0
    && (piece.displaySupplied ?? piece.supplied) === false);

export const describePendingSupplyLoss = snapshot => {
  const pieces=pendingSupplyLossPieces(snapshot).sort((a,b)=>a.position.row-b.position.row || a.position.col-b.position.col);
  if(!pieces.length)return null;
  const descriptions=pieces.map(piece=>`${piece.owner==='P1'?'Red unit':piece.owner==='P2'?'Blue unit':'Unit'} at (${piece.position.row}, ${piece.position.col})`);
  return `Pending destruction at turn end: ${descriptions.join(' and ')}.`;
};
