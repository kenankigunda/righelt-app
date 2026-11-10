export const getPushRetreatPrompt = (snapshot, currentPieceId, renderBoardPreviewCoordinate) => {
    if (snapshot?.continuation?.type !== "push" || snapshot.continuation.phase !== "retreat") {
      return null;
    }
    const pushedPiece = snapshot.pieces?.find((piece) => piece.id === snapshot.continuation?.pushedPieceId);
    if (!pushedPiece) {
      return null;
    }
    return `Select a retreat for piece at ${renderBoardPreviewCoordinate(pushedPiece.position)}`;
  };

export const requiredRushContext = (state,{interactive,canPresentActions,getUnsuppliedPieceIds,getPieceById,formatCoordinate}) => {
  if(!state||!interactive||state.continuation?.type!=='rush'||canPresentActions()===false)return null;
  const points=getUnsuppliedPieceIds().map(id=>getPieceById(id)?.position).filter(Boolean).sort((a,b)=>a.row-b.row||a.col-b.col).map(point=>({...point,chipClass:'board-preview-coordinate-chip-rush-blocker'}));
  return points.length?{kind:'required-rush',mandatory:true,message:{text:`Rush to restore supply for ${points.length===1?'piece':'pieces'} at ${points.map(formatCoordinate).join(', ')}`,coordinates:points}}:null;
};
export const opponentInspectionPrompt = (point,renderCoordinate) => point
  ? `Opponent’s supply and command lines for piece at ${renderCoordinate(point)}`
  : 'Opponent’s supply and command lines';
export const annotateRushSourceCells = ({actions,snapshot,cells,findPieceById,coordKey}) => {
  for (const entry of actions) {
    const source = findPieceById(snapshot, entry.action.actorId);
    const cell = source && cells.get(coordKey(source.position));
    cell?.classList.add('rush-guidance-source');
    cell?.setAttribute('aria-label', `Supply-restoring rush available for piece at (${source.position.row}, ${source.position.col})`);
  }
};
export const buildHistoryRemovalEffects = (records) =>
    (Array.isArray(records) ? records : []).map((record) => {
      const piece =
        record?.piece && typeof record.piece === "object"
          ? {
              ...record.piece,
              position: record.piece.position
                ? {
                    row: record.piece.position.row,
                    col: record.piece.position.col,
                  }
                : { row: record.row, col: record.col },
            }
          : {
              id: null,
              owner: record?.ownerSeat === "p2" ? "P2" : "P1",
              kind: record?.kind === "commander" ? "commander" : "unit",
              position: { row: record.row, col: record.col },
              supplied: record?.supplied !== false,
              commanded: record?.commanded !== false,
            };
      return {
        pieceId: piece.id,
        position: { row: record.row, col: record.col },
        reason: "history_destroyed",
        message: `Destruction for piece at (${record.row}, ${record.col}).`,
        piece,
      };
    });
