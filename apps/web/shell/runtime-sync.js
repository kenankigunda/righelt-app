const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

const findPieceAt = (snapshot, coord) =>
  snapshot?.pieces?.find((piece) => sameCoordinate(piece.position, coord)) ?? null;

export const shouldResetBoardSelection = ({
  currentSnapshot,
  nextSnapshot,
  currentSelection,
  nextLegalActions,
  freeSelection = false,
}) => {
  if (!currentSelection?.source) {
    return false;
  }
  if (
    currentSnapshot &&
    nextSnapshot &&
    (currentSnapshot.sideToMove !== nextSnapshot.sideToMove || currentSnapshot.turnIndex !== nextSnapshot.turnIndex)
  ) {
    return true;
  }

  // Push participants share a square until retreat. Coordinate lookup alone
  // can find the attacker before the selected defender.
  const selectedPiece = currentSelection.selectedPieceId
    ? nextSnapshot?.pieces?.find((piece) => piece.id === currentSelection.selectedPieceId)
    : findPieceAt(nextSnapshot, currentSelection.source);
  if (!selectedPiece || !sameCoordinate(selectedPiece.position, currentSelection.source)) {
    return true;
  }

  // A changed destination does not invalidate the selected piece. The runtime
  // reconciles only that target against the acknowledged next position.
  return false;
};

export const shouldSkipBoardRuntimeReload = ({
  runtimeSnapshotKey,
  runtimeLegalActionsKey,
  snapshotKey,
  legalActionsKey,
  mountedOverlayKey,
  overlayKey,
  resetSelection,
}) =>
  runtimeSnapshotKey === snapshotKey &&
  runtimeLegalActionsKey === legalActionsKey &&
  mountedOverlayKey === overlayKey &&
  resetSelection !== true;
