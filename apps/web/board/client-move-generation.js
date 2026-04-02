import { BOARD_SIZE, SUPPLY_POINTS } from "../generated/packages/game-engine/src/deterministic.js";

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

const compareActionPreviews = (left, right) => {
  const actionOrder = compareActions(left, right);
  if (actionOrder !== 0) {
    return actionOrder;
  }
  if (left.legal !== right.legal) {
    return left.legal ? -1 : 1;
  }
  return String(left.blockedReason ?? "").localeCompare(String(right.blockedReason ?? ""));
};

const outOfBounds = (coord) =>
  Boolean(coord) && (coord.row < 0 || coord.row >= BOARD_SIZE || coord.col < 0 || coord.col >= BOARD_SIZE);

const PROJECTED_PREVIEW_ID = "__projected_preview__";

const getPieceAt = (state, coord) =>
  state?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null;

const hasPieceAt = (state, coord) => Boolean(getPieceAt(state, coord));

const isOrthogonallyAdjacent = (from, to) => Math.abs(from.row - to.row) + Math.abs(from.col - to.col) === 1;

const isAnyAdjacent = (from, to) => {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
};

const isOrthogonalDistance = (from, to, distance) => {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return (rowDelta === distance && colDelta === 0) || (rowDelta === 0 && colDelta === distance);
};

const isActivePiece = (piece) => piece.supplied && piece.commanded && !piece.pushed && !piece.shifted;

const getFrozenPieceState = (state, piece) => {
  if (state?.continuation?.frozenOwner !== piece.owner) {
    return null;
  }
  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
};

const isActivePieceInContext = (state, piece) => {
  const frozen = getFrozenPieceState(state, piece);
  if (!frozen) {
    return isActivePiece(piece);
  }
  return isActivePiece({
    ...piece,
    supplied: frozen.supplied,
    commanded: frozen.commanded,
  });
};

const coordinateKey = (row, col) => `${row},${col}`;

const sortedOrthogonalNeighbors = (row, col) =>
  [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ]
    .filter((coord) => !outOfBounds(coord))
    .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));

const isClearOrthogonalLineForPieces = (a, b, occupied) => {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }

  if (a.row === b.row) {
    for (let col = Math.min(a.col, b.col) + 1; col < Math.max(a.col, b.col); col += 1) {
      if (occupied.has(coordinateKey(a.row, col))) {
        return false;
      }
    }
    return true;
  }

  for (let row = Math.min(a.row, b.row) + 1; row < Math.max(a.row, b.row); row += 1) {
    if (occupied.has(coordinateKey(row, a.col))) {
      return false;
    }
  }
  return true;
};

const buildCommandEdgesForPieces = (pieces) => {
  const occupied = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
  const edges = [];

  for (const owner of ["P1", "P2"]) {
    const ownPieces = pieces
      .filter((piece) => piece.owner === owner)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);
        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible =
          (a.position.row === b.position.row || a.position.col === b.position.col) &&
          isClearOrthogonalLineForPieces(a.position, b.position, occupied);

        if (!diagonalAllowed && !orthogonalVisible) {
          continue;
        }

        edges.push({
          owner,
          from: { ...a.position },
          to: { ...b.position },
        });
      }
    }
  }

  return edges;
};

const isCoordinateSuppliedForOwner = (pieces, owner, target) => {
  const enemyBlockedByEdge = new Set();
  for (const edge of buildCommandEdgesForPieces(pieces)) {
    if (edge.owner === owner) {
      continue;
    }

    if (edge.from.row === edge.to.row) {
      for (let col = Math.min(edge.from.col, edge.to.col) + 1; col < Math.max(edge.from.col, edge.to.col); col += 1) {
        enemyBlockedByEdge.add(coordinateKey(edge.from.row, col));
      }
      continue;
    }

    if (edge.from.col === edge.to.col) {
      for (let row = Math.min(edge.from.row, edge.to.row) + 1; row < Math.max(edge.from.row, edge.to.row); row += 1) {
        enemyBlockedByEdge.add(coordinateKey(row, edge.from.col));
      }
    }
  }

  const occupiedByCoordinate = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece]));
  const supplyPoint = SUPPLY_POINTS[owner];
  const targetKey = coordinateKey(target.row, target.col);
  const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);

  const isTraversable = (row, col) => {
    if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
      return false;
    }
    const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
    return !occupant || occupant.owner === owner;
  };

  if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
    return false;
  }

  const visited = new Set([supplyKey]);
  const queue = [{ ...supplyPoint }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const next of sortedOrthogonalNeighbors(current.row, current.col)) {
      const nextKey = coordinateKey(next.row, next.col);
      if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
        continue;
      }
      visited.add(nextKey);
      queue.push(next);
    }
  }

  return visited.has(targetKey);
};

const wouldCoordinateBeSuppliedForOwner = (pieces, owner, destination) =>
  isCoordinateSuppliedForOwner(pieces, owner, destination);

const wouldBeSuppliedAfterRelocation = (state, actorId, owner, destination) => {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: piece.id === actorId ? { ...destination } : { ...piece.position },
  }));
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
};

const wouldProjectedPieceBeSupplied = (state, owner, destination) => {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: { ...piece.position },
  }));
  hypothetical.push({ id: "__projected__", owner, position: { ...destination } });
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
};

const wouldBeSuppliedAfterPush = (state, actorId, defenderId, owner, destination) => {
  const hypothetical = state.pieces
    .filter((piece) => piece.id !== defenderId)
    .map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      position: piece.id === actorId ? { ...destination } : { ...piece.position },
    }));
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
};

const clonePieceForPreview = (piece) => ({
  ...piece,
  position: { ...piece.position },
});

const buildHypotheticalPiecesForPreview = (state, action, actor) => {
  if (!action?.to || !actor) {
    return [];
  }

  if (action.type === "project") {
    const hypothetical = state.pieces.map(clonePieceForPreview);
    hypothetical.push({
      id: PROJECTED_PREVIEW_ID,
      owner: actor.owner,
      kind: "unit",
      position: { ...action.to },
      supplied: true,
      commanded: true,
      pushed: false,
      shifted: false,
    });
    return hypothetical;
  }

  if (action.type === "push") {
    const defender = getPieceAt(state, action.to);
    return state.pieces
      .filter((piece) => piece.id !== defender?.id)
      .map((piece) =>
        piece.id === actor.id
          ? {
              ...clonePieceForPreview(piece),
              position: { ...action.to },
              pushed: false,
            }
          : clonePieceForPreview(piece),
      );
  }

  return state.pieces.map((piece) =>
    piece.id === actor.id
      ? {
          ...clonePieceForPreview(piece),
          position: { ...action.to },
          pushed: false,
        }
      : clonePieceForPreview(piece),
  );
};

const buildPreviewPiece = (state, action) => {
  if (!state || action?.type === "pass" || !action?.to) {
    return null;
  }

  const actor = resolveActor(state, action);
  if (!actor) {
    return null;
  }

  const hypotheticalPieces = buildHypotheticalPiecesForPreview(state, action, actor);
  if (hypotheticalPieces.length === 0) {
    return null;
  }

  const previewPieceId = action.type === "project" ? PROJECTED_PREVIEW_ID : actor.id;
  const previewPiece = hypotheticalPieces.find((piece) => piece.id === previewPieceId);
  if (!previewPiece) {
    return null;
  }

  return {
    owner: actor.owner,
    kind: action.type === "project" ? "unit" : previewPiece.kind,
    position: { ...previewPiece.position },
  };
};

const localGroupMembers = (state, pieceId) => {
  const seed = state?.pieces?.find((piece) => piece.id === pieceId);
  if (!seed) {
    return [];
  }

  const queue = [seed];
  const visited = new Set([seed.id]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const candidate of state.pieces) {
      if (candidate.owner !== seed.owner || visited.has(candidate.id)) {
        continue;
      }
      if (isOrthogonallyAdjacent(candidate.position, current.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return [...visited].sort((a, b) => a.localeCompare(b));
};

const localGroupStrength = (state, pieceId) => localGroupMembers(state, pieceId).length;

const canOfferPushForPiece = (state, pieceId) => localGroupStrength(state, pieceId) >= 2;

const enemyAdjacentCount = (state, owner, center) =>
  state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;

const resolveActor = (state, action) => {
  if (action.actorId) {
    return state.pieces.find((piece) => piece.id === action.actorId) ?? null;
  }
  if (action.from) {
    return getPieceAt(state, action.from);
  }
  return null;
};

const validateContinuation = (state, action) => {
  if (!state.continuation) {
    return null;
  }

  if (state.continuation.type === "push") {
    if (state.continuation.phase === "retreat") {
      return action.type === "retreat" ? null : { code: "CONTINUATION_REQUIRED" };
    }
    return action.type === "follow" ? null : { code: "CONTINUATION_REQUIRED" };
  }

  if (state.continuation.type === "rush") {
    return action.type === "rush" || action.type === "pass" ? null : { code: "CONTINUATION_REQUIRED" };
  }

  return null;
};

const validateActionForPreview = (state, action) => {
  if (state?.outcome?.status !== "ongoing") {
    return { ok: false, code: "TERMINAL_GAME" };
  }
  if (outOfBounds(action.from) || outOfBounds(action.to)) {
    return { ok: false, code: "OUT_OF_BOUNDS" };
  }
  if (action.from && !hasPieceAt(state, action.from)) {
    return { ok: false, code: "SOURCE_EMPTY" };
  }

  const continuationValidation = validateContinuation(state, action);
  if (continuationValidation) {
    return { ok: false, code: continuationValidation.code };
  }

  if (action.type === "pass") {
    if (state.continuation && state.continuation.type !== "rush") {
      return { ok: false, code: "CONTINUATION_REQUIRED" };
    }
    return { ok: true };
  }

  const actor = resolveActor(state, action);
  if (!actor) {
    return { ok: false, code: "INVALID_SHAPE" };
  }
  if (actor.owner !== state.sideToMove) {
    return { ok: false, code: "NOT_SIDE_TO_MOVE" };
  }
  if (action.from && !sameCoordinate(action.from, actor.position)) {
    return { ok: false, code: "INVALID_SHAPE" };
  }

  if (action.type === "move") {
    if (actor.kind !== "commander" || !isActivePieceInContext(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to) || hasPieceAt(state, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  if (action.type === "project") {
    if (!isActivePieceInContext(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonalDistance(actor.position, action.to, 2)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const midpoint = {
      row: (actor.position.row + action.to.row) / 2,
      col: (actor.position.col + action.to.col) / 2,
    };
    if (hasPieceAt(state, midpoint) || hasPieceAt(state, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldProjectedPieceBeSupplied(state, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  if (action.type === "rush") {
    if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!isActivePieceInContext(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isAnyAdjacent(actor.position, action.to) || hasPieceAt(state, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }

    const rowDelta = action.to.row - actor.position.row;
    const colDelta = action.to.col - actor.position.col;
    const diagonal = Math.abs(rowDelta) === 1 && Math.abs(colDelta) === 1;

    if (diagonal) {
      if (actor.pushed) {
        return { ok: false, code: "RULE_VIOLATION" };
      }
      const coAdjacentA = { row: actor.position.row + rowDelta, col: actor.position.col };
      const coAdjacentB = { row: actor.position.row, col: actor.position.col + colDelta };
      const enemyA = getPieceAt(state, coAdjacentA);
      const enemyB = getPieceAt(state, coAdjacentB);
      if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
        return { ok: false, code: "RULE_VIOLATION" };
      }
    } else if (enemyAdjacentCount(state, actor.owner, action.to) === 0) {
      return { ok: false, code: "RULE_VIOLATION" };
    }

    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  if (action.type === "push") {
    if (!isActivePieceInContext(state, actor) || actor.pushed || actor.shifted) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const defender = getPieceAt(state, action.to);
    if (!defender || defender.owner === actor.owner) {
      return { ok: false, code: "RULE_VIOLATION" };
    }

    const attackerStrength = localGroupStrength(state, actor.id);
    const defenderStrength = localGroupStrength(state, defender.id);
    if (attackerStrength <= defenderStrength) {
      return { ok: false, code: "PUSH_STRENGTH_TOO_WEAK" };
    }
    if (!wouldBeSuppliedAfterPush(state, actor.id, defender.id, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  if (action.type === "follow") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (
      actor.shifted ||
      !action.to ||
      !sameCoordinate(action.to, state.continuation.followPoint) ||
      hasPieceAt(state, state.continuation.followPoint) ||
      (Array.isArray(state.continuation.followGroupPieceIds) &&
        state.continuation.followGroupPieceIds.length > 0 &&
        !state.continuation.followGroupPieceIds.includes(actor.id)) ||
      !isOrthogonallyAdjacent(actor.position, state.continuation.followPoint)
    ) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, state.continuation.followPoint)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  if (action.type === "retreat") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (
      !actor.pushed ||
      actor.id !== state.continuation.pushedPieceId ||
      !action.to ||
      !isOrthogonallyAdjacent(actor.position, action.to) ||
      hasPieceAt(state, action.to) ||
      (state.continuation.followPoint && sameCoordinate(action.to, state.continuation.followPoint))
    ) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }

  return { ok: false, code: "RULE_VIOLATION" };
};

const buildCandidateActions = (piece) => {
  const actions = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"];

  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        actions.push({
          type,
          actorId: piece.id,
          from: { ...piece.position },
          to: { row, col },
        });
      }
    }
  }

  return actions;
};

export const getStateKey = (state) => JSON.stringify(state ?? null);

export const listPieceMovesFromLegalActions = ({ state, legalActions, pieceId }) => {
  const piece = state?.pieces?.find((candidate) => candidate.id === pieceId);
  if (!piece || !Array.isArray(legalActions)) {
    return [];
  }

  const allowPush = canOfferPushForPiece(state, pieceId);

  return legalActions
    .filter((action) => {
      if (!action || action.type === "pass") {
        return false;
      }
      if (action.type === "push" && !allowPush) {
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

export const listPieceMovePreviews = ({ state, legalActions, pieceId }) => {
  const piece = state?.pieces?.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return [];
  }

  const allowPush = canOfferPushForPiece(state, pieceId);

  const actions = listPieceMovesFromLegalActions({ state, legalActions, pieceId });
  const previews = actions.map((action) => ({ ...action, legal: true, previewPiece: buildPreviewPiece(state, action) }));
  const previewKeys = new Set(actions.map((action) => JSON.stringify(action)));

  for (const action of buildCandidateActions(piece)) {
    if (action.type === "push" && !allowPush) {
      continue;
    }
    const actionKey = JSON.stringify(action);
    if (previewKeys.has(actionKey)) {
      continue;
    }

    const validation = validateActionForPreview(state, action);
    if (
      validation.code === "SUPPLY_DESTINATION_UNSUPPLIED" ||
      validation.code === "PUSH_STRENGTH_TOO_WEAK"
    ) {
      previews.push({
        ...structuredClone(action),
        legal: false,
        blockedReason: validation.code,
        previewPiece: buildPreviewPiece(state, action),
      });
    }
  }

  return previews.sort(compareActionPreviews);
};

export const buildPieceMoveResponse = ({ state, legalActions, pieceId }) => {
  const actions = listPieceMovesFromLegalActions({ state, legalActions, pieceId });
  return {
    state,
    pieceId,
    actions,
    previewActions: listPieceMovePreviews({ state, legalActions, pieceId }),
  };
};
