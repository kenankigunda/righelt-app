const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

const findPieceAt = (snapshot, coord) =>
  snapshot?.pieces?.find((piece) => sameCoordinate(piece.position, coord)) ?? null;

const selectionMatchesAction = (action, selection) => {
  if (!action?.from || !action?.to || !selection?.source || !selection?.target) {
    return false;
  }
  if (!sameCoordinate(action.from, selection.source) || !sameCoordinate(action.to, selection.target)) {
    return false;
  }
  if (!selection.selectedPieceId) {
    return true;
  }
  return action.actorId === selection.selectedPieceId || !action.actorId;
};

export const shouldResetBoardSelection = ({
  currentSnapshot,
  nextSnapshot,
  currentSelection,
  nextLegalActions,
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

  const pieceAtSource = findPieceAt(nextSnapshot, currentSelection.source);
  if (!pieceAtSource) {
    return true;
  }
  if (currentSelection.selectedPieceId && pieceAtSource.id !== currentSelection.selectedPieceId) {
    return true;
  }

  if (currentSelection.selectedPieceId) {
    const selectedPiece = nextSnapshot?.pieces?.find((piece) => piece.id === currentSelection.selectedPieceId) ?? null;
    if (!selectedPiece || !sameCoordinate(selectedPiece.position, currentSelection.source)) {
      return true;
    }
  }

  if (!currentSelection.target) {
    return false;
  }

  return !(Array.isArray(nextLegalActions) ? nextLegalActions : []).some((action) =>
    selectionMatchesAction(action, currentSelection),
  );
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
