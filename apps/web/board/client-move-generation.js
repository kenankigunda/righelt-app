const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

const compareActions = (left, right) => {
  if ((left?.type ?? "") !== (right?.type ?? "")) {
    return String(left?.type ?? "").localeCompare(String(right?.type ?? ""));
  }
  if (!left?.to && !right?.to) {
    return 0;
  }
  if (!left?.to) {
    return -1;
  }
  if (!right?.to) {
    return 1;
  }
  if (left.to.row !== right.to.row) {
    return left.to.row - right.to.row;
  }
  return left.to.col - right.to.col;
};

export const getStateKey = (state) => JSON.stringify(state ?? null);

export const listPieceMovesFromLegalActions = ({ state, legalActions, pieceId }) => {
  const piece = state?.pieces?.find((candidate) => candidate.id === pieceId);
  if (!piece || !Array.isArray(legalActions)) {
    return [];
  }

  return legalActions
    .filter((action) => {
      if (!action || action.type === "pass") {
        return false;
      }
      if (action.actorId === pieceId) {
        return true;
      }
      return sameCoordinate(action.from, piece.position);
    })
    .map((action) => structuredClone(action))
    .sort(compareActions);
};

export const buildPieceMoveResponse = ({ state, legalActions, pieceId }) => {
  const actions = listPieceMovesFromLegalActions({ state, legalActions, pieceId });
  return {
    state,
    pieceId,
    actions,
    previewActions: actions.map((action) => ({ ...action, legal: true })),
  };
};
