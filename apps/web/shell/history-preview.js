const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

export const findRecordedActionStartPiece = (snapshot, action) => {
  if (!snapshot || !action) {
    return null;
  }
  if (typeof action.actorId === "string") {
    const pieceById = snapshot.pieces?.find((piece) => piece.id === action.actorId) ?? null;
    if (pieceById) {
      return pieceById;
    }
  }
  if (!action.from) {
    return null;
  }
  return snapshot.pieces?.find((piece) => sameCoordinate(piece.position, action.from)) ?? null;
};

export const buildDestroyedPieceOverlays = ({ destroyedPieceRecords, preActionSnapshot }) => {
  const records = Array.isArray(destroyedPieceRecords) ? destroyedPieceRecords : [];
  const preActionPieces = Array.isArray(preActionSnapshot?.pieces) ? preActionSnapshot.pieces : [];
  return records.map((record) => {
    const preActionPiece =
      preActionPieces.find((piece) => sameCoordinate(piece?.position, record.position)) ?? null;
    return {
      row: record.position.row,
      col: record.position.col,
      ownerSeat:
        record.ownerSeat ??
        (preActionPiece?.owner === "P1" ? "p1" : preActionPiece?.owner === "P2" ? "p2" : null),
      kind:
        preActionPiece?.kind ??
        (record.reason === "commander_unsupplied" ? "commander" : "unit"),
      supplied: preActionPiece ? preActionPiece.supplied !== false : record.supplied ?? true,
      commanded: preActionPiece ? preActionPiece.commanded !== false : record.commanded ?? true,
      piece: preActionPiece
        ? {
            id: preActionPiece.id ?? null,
            owner: preActionPiece.owner,
            kind: preActionPiece.kind,
            position: {
              row: preActionPiece.position.row,
              col: preActionPiece.position.col,
            },
            supplied: preActionPiece.supplied !== false,
            commanded: preActionPiece.commanded !== false,
            pushed: preActionPiece.pushed === true,
          }
        : null,
    };
  });
};
