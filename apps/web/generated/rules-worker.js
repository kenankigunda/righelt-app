// apps/web/generated/packages/game-engine/src/deterministic.js
var BOARD_SIZE = 10;
var SUPPLY_POINTS = {
  P1: { row: 0, col: 9 },
  P2: { row: 9, col: 0 }
};
var OWNER_ORDER = {
  P1: 0,
  P2: 1
};
var KIND_ORDER = {
  commander: 0,
  unit: 1
};
function compareCoordinates(a, b) {
  if (a.row !== b.row) {
    return a.row - b.row;
  }
  return a.col - b.col;
}
function cloneCoordinate(value) {
  return { row: value.row, col: value.col };
}
function normalizePiece(piece) {
  return {
    ...piece,
    position: cloneCoordinate(piece.position),
    displaySupplied: piece.displaySupplied ?? piece.supplied,
    displayCommanded: piece.displayCommanded ?? piece.commanded
  };
}
function normalizePieces(pieces) {
  return pieces.map(normalizePiece).sort((a, b) => {
    const ownerDelta = OWNER_ORDER[a.owner] - OWNER_ORDER[b.owner];
    if (ownerDelta !== 0) {
      return ownerDelta;
    }
    const kindDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return a.id.localeCompare(b.id);
  });
}
function normalizeContinuation(value) {
  if (!value) {
    return null;
  }
  const frozenPieceStatesById = value.frozenPieceStatesById ? Object.fromEntries(Object.entries(value.frozenPieceStatesById).sort(([a], [b]) => a.localeCompare(b)).map(([pieceId, frozenState]) => [pieceId, { ...frozenState }])) : void 0;
  const { followPoint, followGroupPieceIds, rushedPieceIds, rushChainPieceIds, pushedPieceId, frozenPieceStatesById: _frozenPieceStatesById, ...context } = value;
  return {
    ...context,
    ...pushedPieceId === void 0 ? {} : { pushedPieceId },
    ...followPoint ? { followPoint: cloneCoordinate(followPoint) } : {},
    ...followGroupPieceIds ? { followGroupPieceIds: [...followGroupPieceIds].sort((a, b) => a.localeCompare(b)) } : {},
    ...rushedPieceIds ? { rushedPieceIds: [...rushedPieceIds].sort((a, b) => a.localeCompare(b)) } : {},
    ...rushChainPieceIds ? { rushChainPieceIds: [...rushChainPieceIds].sort((a, b) => a.localeCompare(b)) } : {},
    ...frozenPieceStatesById ? { frozenPieceStatesById } : {}
  };
}
function normalizeSupplyArtifacts(artifacts) {
  return [...artifacts].map((artifact) => ({
    ...artifact,
    reachability: [...artifact.reachability].sort((a, b) => a.localeCompare(b)),
    shortestPathByPieceId: Object.fromEntries(Object.entries(artifact.shortestPathByPieceId).sort(([a], [b]) => a.localeCompare(b)).map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)])),
    distanceByPieceId: Object.fromEntries(Object.entries(artifact.distanceByPieceId).sort(([a], [b]) => a.localeCompare(b)))
  })).sort((a, b) => a.player.localeCompare(b.player));
}
function normalizeCommandArtifact(command) {
  return {
    candidateEdges: [...command.candidateEdges].sort((a, b) => a.localeCompare(b)),
    cutEdges: [...command.cutEdges].sort((a, b) => a.localeCompare(b)),
    activeEdges: [...command.activeEdges].sort((a, b) => a.localeCompare(b)),
    shortestPathToCommanderByPieceId: Object.fromEntries(Object.entries(command.shortestPathToCommanderByPieceId).sort(([a], [b]) => a.localeCompare(b)).map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)]))
  };
}
function normalizeGroupArtifact(groups) {
  return {
    componentByPieceId: Object.fromEntries(Object.entries(groups.componentByPieceId).sort(([a], [b]) => a.localeCompare(b))),
    membersByComponentId: Object.fromEntries(Object.entries(groups.membersByComponentId).sort(([a], [b]) => a.localeCompare(b)).map(([componentId, members]) => [componentId, [...members].sort((a, b) => a.localeCompare(b))])),
    strengthByComponentId: Object.fromEntries(Object.entries(groups.strengthByComponentId).sort(([a], [b]) => a.localeCompare(b)))
  };
}
function normalizeState(state) {
  return {
    boardSize: BOARD_SIZE,
    sideToMove: state.sideToMove,
    turnIndex: state.turnIndex,
    pieces: normalizePieces(state.pieces),
    continuation: normalizeContinuation(state.continuation),
    outcome: { ...state.outcome },
    ...state.artifacts ? {
      artifacts: {
        mode: state.artifacts.mode,
        supply: normalizeSupplyArtifacts(state.artifacts.supply),
        command: normalizeCommandArtifact(state.artifacts.command),
        groups: normalizeGroupArtifact(state.artifacts.groups)
      }
    } : {}
  };
}

// apps/web/generated/packages/game-engine/src/removals.js
var reportRemoval = (piece, reason, collect) => {
  collect?.({ piece: structuredClone(piece), reason });
};
var destructionRecords = (events, operationId) => events.map(({ piece, reason }) => ({
  ...operationId ? { eventId: `${operationId}:${piece.id}` } : {},
  pieceId: piece.id,
  kind: piece.kind,
  piece: structuredClone(piece),
  position: { ...piece.position },
  ownerSeat: piece.owner === "P1" ? "p1" : "p2",
  supplied: piece.supplied,
  commanded: piece.commanded,
  reason
}));
var removalNotices = (events, operationId) => events.map(({ piece, reason }) => ({
  ...operationId ? { eventId: `${operationId}:${piece.id}` } : {},
  pieceId: piece.id,
  piece: structuredClone(piece),
  position: { ...piece.position },
  reason,
  message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed ${reason === "no_retreat" ? "because it could not retreat" : "due to loss of supply"}`
}));

// apps/web/generated/packages/shared-types/src/commander-outcome.js
function commanderOutcome(pieces) {
  const defeat = (id) => {
    const commander = pieces.find((piece) => piece.id === id);
    return !commander ? "destroyed" : commander.supplied ? null : "unsupplied";
  };
  const p1 = defeat("C1"), p2 = defeat("C2");
  if (!p1 && !p2) return { status: "ongoing" };
  if (p1 && p2) return { status: "draw", reason: p1 === p2 ? `both_commanders_${p1}` : `p1_commander_${p1}_p2_${p2}` };
  return p1 ? { status: "p2_win", reason: `p1_commander_${p1}` } : { status: "p1_win", reason: `p2_commander_${p2}` };
}

// apps/web/generated/packages/game-engine/src/computation-guard.js
var MAX_ENGINE_OPERATION_EXPANSIONS = 16384;
var current;
var currentObserver;
function isEngineComputationObserved() {
  return currentObserver !== void 0;
}
function observeEngineComputation(event) {
  for (let frame = currentObserver; frame; frame = frame.parent)
    frame.observer(event);
}
function checkEngineComputation(expansion = false) {
  for (let frame = current; frame; frame = frame.parent)
    frame.guard(expansion);
  if (expansion && currentObserver)
    observeEngineComputation({ type: "expansion" });
}
function withEngineComputationGuard(guard, operation) {
  const previous = current;
  current = { guard, parent: previous };
  try {
    checkEngineComputation();
    const result = operation();
    if (result && typeof result.then === "function") {
      throw new TypeError("Engine computation guards require synchronous operations");
    }
    checkEngineComputation();
    return result;
  } finally {
    current = previous;
  }
}
var EngineComputationLimit = class extends Error {
  code = "rules_budget_exceeded";
  constructor() {
    super("Rules calculation exceeded its resource budget");
  }
};
function boundedEngineOperation(operation, maxExpansions = MAX_ENGINE_OPERATION_EXPANSIONS) {
  if (!Number.isSafeInteger(maxExpansions) || maxExpansions < 1)
    throw new TypeError("Invalid engine expansion budget");
  let expansions = 0;
  return withEngineComputationGuard((expansion) => {
    if (expansion && ++expansions > maxExpansions)
      throw new EngineComputationLimit();
  }, operation);
}

// apps/web/generated/packages/game-engine/src/decision-cache.js
var DECISION_CACHE_LIMITS = { maxEntries: 512, maxEstimatedBytes: 4 * 1024 * 1024 };
var current2;
function completedDecisionRule(rule, state, operation) {
  const cache = current2;
  if (!cache)
    return operation();
  checkEngineComputation();
  const key = rule + ":" + JSON.stringify({ ...state, artifacts: void 0 });
  const stored = cache.read(key);
  if (stored !== void 0)
    return stored;
  const result = operation();
  checkEngineComputation();
  cache.store(key, result);
  return result;
}

// apps/web/generated/packages/game-engine/src/continuation.js
function cloneState(state) {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({
      ...piece,
      position: { ...piece.position }
    })),
    continuation: state.continuation ? {
      ...state.continuation,
      followPoint: state.continuation.followPoint ? { ...state.continuation.followPoint } : void 0,
      followGroupPieceIds: state.continuation.followGroupPieceIds ? [...state.continuation.followGroupPieceIds] : void 0,
      rushedPieceIds: state.continuation.rushedPieceIds ? [...state.continuation.rushedPieceIds] : void 0,
      rushChainPieceIds: state.continuation.rushChainPieceIds ? [...state.continuation.rushChainPieceIds] : void 0,
      frozenPieceStatesById: state.continuation.frozenPieceStatesById ? Object.fromEntries(Object.entries(state.continuation.frozenPieceStatesById).map(([pieceId, frozenState]) => [
        pieceId,
        { ...frozenState }
      ])) : void 0
    } : null,
    outcome: { ...state.outcome },
    artifacts: void 0
  };
}
function outOfBounds(value) {
  if (!value) {
    return false;
  }
  return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}
function coordinateKey(row, col) {
  return `${row},${col}`;
}
function sortedOrthogonalNeighbors(row, col) {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 }
  ].filter((next) => !outOfBounds(next)).sort((a, b) => a.row === b.row ? a.col - b.col : a.row - b.row);
}
function isOrthogonallyAdjacent(from, to) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta + colDelta === 1;
}
function isAnyAdjacent(from, to) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
}
function isClearOrthogonalLineForPieces(a, b, occupied) {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }
  if (a.row === b.row) {
    const start2 = Math.min(a.col, b.col) + 1;
    const end2 = Math.max(a.col, b.col);
    for (let col = start2; col < end2; col += 1) {
      if (occupied.has(coordinateKey(a.row, col))) {
        return false;
      }
    }
    return true;
  }
  const start = Math.min(a.row, b.row) + 1;
  const end = Math.max(a.row, b.row);
  for (let row = start; row < end; row += 1) {
    if (occupied.has(coordinateKey(row, a.col))) {
      return false;
    }
  }
  return true;
}
function buildCommandEdgesForPieces(pieces) {
  const occupied = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
  const edges = [];
  for (const owner of ["P1", "P2"]) {
    const ownPieces = pieces.filter((piece) => piece.owner === owner).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);
        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible = (a.position.row === b.position.row || a.position.col === b.position.col) && isClearOrthogonalLineForPieces(a.position, b.position, occupied);
        if (!diagonalAllowed && !orthogonalVisible) {
          continue;
        }
        edges.push({
          owner,
          from: { ...a.position },
          to: { ...b.position }
        });
      }
    }
  }
  return edges;
}
function buildSupplyCheckPieces(state) {
  return state.pieces.filter((piece) => !piece.pushed).map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: { ...piece.position }
  }));
}
function computeLiveSuppliedPieceIds(state, owner) {
  const observed = isEngineComputationObserved();
  if (observed)
    observeEngineComputation({ type: "supply-start" });
  try {
    const pieces = buildSupplyCheckPieces(state);
    const enemyBlockedByEdge = /* @__PURE__ */ new Set();
    for (const edge of buildCommandEdgesForPieces(pieces)) {
      if (edge.owner === owner) {
        continue;
      }
      if (edge.from.row === edge.to.row) {
        const row = edge.from.row;
        const startCol = Math.min(edge.from.col, edge.to.col) + 1;
        const endCol = Math.max(edge.from.col, edge.to.col);
        for (let col = startCol; col < endCol; col += 1) {
          enemyBlockedByEdge.add(coordinateKey(row, col));
        }
        continue;
      }
      if (edge.from.col === edge.to.col) {
        const col = edge.from.col;
        const startRow = Math.min(edge.from.row, edge.to.row) + 1;
        const endRow = Math.max(edge.from.row, edge.to.row);
        for (let row = startRow; row < endRow; row += 1) {
          enemyBlockedByEdge.add(coordinateKey(row, col));
        }
      }
    }
    const occupiedByCoordinate = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece]));
    const supplyPoint = SUPPLY_POINTS[owner];
    const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);
    const isTraversable = (row, col) => {
      if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
        return false;
      }
      const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
      return !occupant || occupant.owner === owner;
    };
    if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
      return /* @__PURE__ */ new Set();
    }
    const reachableCoordinates = /* @__PURE__ */ new Set([supplyKey]);
    const queue = [{ ...supplyPoint }];
    while (queue.length > 0) {
      const current3 = queue.shift();
      if (!current3) {
        break;
      }
      for (const next of sortedOrthogonalNeighbors(current3.row, current3.col)) {
        const nextKey = coordinateKey(next.row, next.col);
        if (reachableCoordinates.has(nextKey) || !isTraversable(next.row, next.col)) {
          continue;
        }
        reachableCoordinates.add(nextKey);
        queue.push(next);
      }
    }
    const supplied = /* @__PURE__ */ new Set();
    for (const piece of pieces) {
      if (piece.owner !== owner) {
        continue;
      }
      if (reachableCoordinates.has(coordinateKey(piece.position.row, piece.position.col))) {
        supplied.add(piece.id);
      }
    }
    return supplied;
  } finally {
    if (observed)
      observeEngineComputation({ type: "supply-end" });
  }
}
function getPieceAt(state, value) {
  return state.pieces.find((piece) => piece.position.row === value.row && piece.position.col === value.col);
}
function hasPieceAt(state, value) {
  return Boolean(getPieceAt(state, value));
}
function getFrozenPieceState(state, piece) {
  if (state.continuation?.frozenOwner !== piece.owner) {
    return null;
  }
  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
}
function isActivePieceInContext(state, piece) {
  const frozen = getFrozenPieceState(state, piece);
  const supplied = frozen?.supplied ?? piece.supplied;
  const commanded = frozen?.commanded ?? piece.commanded;
  return supplied && commanded && !piece.pushed && !piece.shifted;
}
function enemyAdjacentCount(state, owner, center) {
  return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;
}
function localGroupMembers(state, pieceId) {
  const seed = state.pieces.find((piece) => piece.id === pieceId);
  if (!seed) {
    return [];
  }
  const queue = [seed];
  const visited = /* @__PURE__ */ new Set([seed.id]);
  while (queue.length > 0) {
    const current3 = queue.shift();
    if (!current3) {
      break;
    }
    for (const candidate of state.pieces) {
      if (candidate.owner !== seed.owner || visited.has(candidate.id)) {
        continue;
      }
      if (isOrthogonallyAdjacent(candidate.position, current3.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}
function captureFrozenPieceStates(state, owner) {
  return Object.fromEntries(state.pieces.filter((piece) => piece.owner === owner).map((piece) => [
    piece.id,
    {
      supplied: piece.supplied,
      commanded: piece.commanded
    }
  ]));
}
function sortedUnique(ids) {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
function getRushChainMembers(state, actorId) {
  const actor = state.pieces.find((piece) => piece.id === actorId && !piece.pushed);
  if (!actor) {
    return [];
  }
  const queue = [actor];
  const visited = /* @__PURE__ */ new Set([actor.id]);
  while (queue.length > 0) {
    const current3 = queue.shift();
    if (!current3) {
      break;
    }
    for (const candidate of state.pieces) {
      if (candidate.owner !== actor.owner || candidate.pushed || visited.has(candidate.id)) {
        continue;
      }
      if (isAnyAdjacent(candidate.position, current3.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}
function obligationPieceIdsForContinuation(state) {
  if (!state.continuation) {
    return [];
  }
  const obligationIds = state.continuation.type === "push" ? state.continuation.followGroupPieceIds ?? [] : state.continuation.rushChainPieceIds ?? [];
  const presentPieceIds = new Set(state.pieces.map((piece) => piece.id));
  return sortedUnique(obligationIds.filter((pieceId) => presentPieceIds.has(pieceId)));
}
function obligationOwner(state) {
  if (!state.continuation) {
    return null;
  }
  return state.continuation.type === "push" ? state.continuation.attackerOwner ?? state.continuation.owner ?? null : state.continuation.owner;
}
function areObligationPiecesSupplied(state) {
  const owner = obligationOwner(state);
  if (!owner) {
    return false;
  }
  const obligationPieceIds = obligationPieceIdsForContinuation(state);
  const suppliedIds = computeLiveSuppliedPieceIds(state, owner);
  return obligationPieceIds.every((pieceId) => suppliedIds.has(pieceId));
}
function pushFollowPointOccupied(state, continuation) {
  if (!continuation.followPoint) {
    return false;
  }
  return state.pieces.some((piece) => !piece.pushed && piece.position.row === continuation.followPoint?.row && piece.position.col === continuation.followPoint?.col);
}
function validateRushBase(state, actor, action) {
  if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
    return false;
  }
  if (!isActivePieceInContext(state, actor)) {
    return false;
  }
  if (!action.to || !isAnyAdjacent(actor.position, action.to) || hasPieceAt(state, action.to)) {
    return false;
  }
  const rowDelta = action.to.row - actor.position.row;
  const colDelta = action.to.col - actor.position.col;
  const diagonal = Math.abs(rowDelta) === 1 && Math.abs(colDelta) === 1;
  if (diagonal) {
    if (actor.pushed) {
      return false;
    }
    const coAdjacentA = { row: actor.position.row + rowDelta, col: actor.position.col };
    const coAdjacentB = { row: actor.position.row, col: actor.position.col + colDelta };
    const enemyA = getPieceAt(state, coAdjacentA);
    const enemyB = getPieceAt(state, coAdjacentB);
    if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
      return false;
    }
    return true;
  }
  return enemyAdjacentCount(state, actor.owner, action.to) > 0;
}
function validateRetreatBase(state, actor, action) {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    return false;
  }
  if (!actor.pushed || actor.id !== state.continuation.pushedPieceId) {
    return false;
  }
  if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to) || hasPieceAt(state, action.to)) {
    return false;
  }
  if (state.continuation.followPoint && action.to.row === state.continuation.followPoint.row && action.to.col === state.continuation.followPoint.col) {
    return false;
  }
  return true;
}
function validateFollowBase(state, actor, action) {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
    return false;
  }
  const { followPoint } = state.continuation;
  if (!followPoint || actor.shifted || !action.to) {
    return false;
  }
  if (action.to.row !== followPoint.row || action.to.col !== followPoint.col) {
    return false;
  }
  if (pushFollowPointOccupied(state, state.continuation)) {
    return false;
  }
  if (Array.isArray(state.continuation.followGroupPieceIds) && state.continuation.followGroupPieceIds.length > 0 && !state.continuation.followGroupPieceIds.includes(actor.id)) {
    return false;
  }
  return isOrthogonallyAdjacent(actor.position, followPoint);
}
function buildRushSuccessorActions(state) {
  return state.pieces.filter((piece) => piece.owner === state.sideToMove).flatMap((piece) => {
    const actions = [];
    for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
      for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
        if (rowDelta === 0 && colDelta === 0) {
          continue;
        }
        const action = {
          type: "rush",
          actorId: piece.id,
          from: { ...piece.position },
          to: {
            row: piece.position.row + rowDelta,
            col: piece.position.col + colDelta
          }
        };
        if (!outOfBounds(action.to) && validateRushBase(state, piece, action)) {
          actions.push(action);
        }
      }
    }
    return actions;
  });
}
function buildPushRetreatSuccessorActions(state) {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    return [];
  }
  const pushedPiece = state.continuation.pushedPieceId ? state.pieces.find((piece) => piece.id === state.continuation?.pushedPieceId) : void 0;
  if (!pushedPiece) {
    return [];
  }
  return [
    { row: pushedPiece.position.row - 1, col: pushedPiece.position.col },
    { row: pushedPiece.position.row + 1, col: pushedPiece.position.col },
    { row: pushedPiece.position.row, col: pushedPiece.position.col - 1 },
    { row: pushedPiece.position.row, col: pushedPiece.position.col + 1 }
  ].filter((to) => !outOfBounds(to)).map((to) => ({
    type: "retreat",
    actorId: pushedPiece.id,
    from: { ...pushedPiece.position },
    to
  })).filter((action) => validateRetreatBase(state, pushedPiece, action));
}
function buildPushFollowSuccessorActions(state) {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
    return [];
  }
  return state.pieces.filter((piece) => piece.owner === state.sideToMove).map((piece) => ({
    type: "follow",
    actorId: piece.id,
    from: { ...piece.position },
    to: state.continuation?.followPoint ? { ...state.continuation.followPoint } : void 0
  })).filter((action) => {
    const actor = action.actorId ? state.pieces.find((piece) => piece.id === action.actorId) : void 0;
    return Boolean(actor && validateFollowBase(state, actor, action));
  });
}
function buildContinuationSuccessorState(state, action) {
  checkEngineComputation(true);
  if (isEngineComputationObserved())
    observeEngineComputation({ type: "successor" });
  const next = cloneState(state);
  const actor = action.actorId ? next.pieces.find((piece) => piece.id === action.actorId) : void 0;
  if (action.type === "push" && actor && action.to) {
    const defender = getPieceAt(next, action.to);
    if (!defender) {
      return normalizeState(next);
    }
    const origin = { ...actor.position };
    actor.position = { ...action.to };
    actor.shifted = true;
    defender.position = { ...action.to };
    defender.pushed = true;
    defender.shifted = false;
    next.continuation = {
      type: "push",
      owner: defender.owner,
      attackerOwner: actor.owner,
      phase: "retreat",
      followPoint: origin,
      pushedPieceId: defender.id,
      followGroupPieceIds: localGroupMembers(state, actor.id),
      frozenOwner: actor.owner,
      frozenPieceStatesById: captureFrozenPieceStates(state, actor.owner),
      chainLength: (state.continuation?.chainLength ?? 0) + 1
    };
    next.sideToMove = defender.owner;
    return normalizeState(next);
  }
  if (action.type === "rush" && actor && action.to) {
    actor.position = { ...action.to };
    if (!next.continuation || next.continuation.type !== "rush") {
      next.continuation = {
        type: "rush",
        owner: actor.owner,
        frozenOwner: actor.owner,
        frozenPieceStatesById: captureFrozenPieceStates(state, actor.owner),
        rushedPieceIds: [actor.id],
        rushChainPieceIds: getRushChainMembers(next, actor.id),
        chainLength: 1
      };
    } else {
      const rushedPieceIds = sortedUnique([...next.continuation.rushedPieceIds ?? [], actor.id]);
      const rushChainPieceIds = sortedUnique([
        ...next.continuation.rushChainPieceIds ?? [],
        ...getRushChainMembers(next, actor.id)
      ]);
      next.continuation.rushedPieceIds = rushedPieceIds;
      next.continuation.rushChainPieceIds = rushChainPieceIds;
      next.continuation.chainLength += 1;
    }
    return normalizeState(next);
  }
  if (action.type === "retreat" && actor && action.to && next.continuation?.type === "push") {
    actor.position = { ...action.to };
    actor.pushed = false;
    next.sideToMove = next.continuation.attackerOwner ?? next.sideToMove;
    next.continuation.owner = next.sideToMove;
    next.continuation.phase = "follow";
    next.continuation.pushedPieceId = void 0;
    return normalizeState(next);
  }
  if (action.type === "follow" && actor && action.to && next.continuation?.type === "push") {
    const origin = { ...actor.position };
    actor.position = { ...action.to };
    actor.shifted = true;
    next.sideToMove = next.continuation.attackerOwner ?? actor.owner;
    next.continuation.owner = next.sideToMove;
    next.continuation.phase = "follow";
    next.continuation.followPoint = origin;
    next.continuation.chainLength += 1;
    return normalizeState(next);
  }
  return normalizeState(next);
}
function* advanceForcedRetreatIfNeeded(state) {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    yield state;
    return;
  }
  const retreatActions = buildPushRetreatSuccessorActions(state);
  if (retreatActions.length > 0) {
    for (const action of retreatActions)
      yield buildContinuationSuccessorState(state, action);
    return;
  }
  const next = cloneState(state);
  const continuation = next.continuation;
  if (!continuation || continuation.type !== "push") {
    yield normalizeState(next);
    return;
  }
  const attackerOwner = continuation.attackerOwner ?? next.sideToMove;
  if (continuation.pushedPieceId) {
    next.pieces = next.pieces.filter((piece) => piece.id !== continuation.pushedPieceId);
  }
  continuation.phase = "follow";
  continuation.owner = attackerOwner;
  continuation.pushedPieceId = void 0;
  next.sideToMove = attackerOwner;
  yield normalizeState(next);
}
function* buildSuccessorStates(state) {
  if (!state.continuation)
    return;
  if (state.continuation.type === "push" && state.continuation.phase === "retreat") {
    yield* advanceForcedRetreatIfNeeded(state);
    return;
  }
  const actions = state.continuation.type === "push" ? buildPushFollowSuccessorActions(state) : buildRushSuccessorActions(state);
  for (const action of actions)
    yield buildContinuationSuccessorState(state, action);
}
function canCloseContinuationNow(state) {
  if (!state.continuation) {
    return false;
  }
  if (!areObligationPiecesSupplied(state)) {
    return false;
  }
  if (state.continuation.type === "rush") {
    return true;
  }
  if (state.continuation.phase === "retreat") {
    return false;
  }
  if (!state.continuation.followPoint || pushFollowPointOccupied(state, state.continuation)) {
    return false;
  }
  return buildPushFollowSuccessorActions(state).length === 0;
}
function continuationSearchKey(state) {
  return JSON.stringify({
    sideToMove: state.sideToMove,
    continuation: {
      type: state.continuation?.type ?? null,
      owner: state.continuation?.owner ?? null,
      attackerOwner: state.continuation?.attackerOwner ?? null,
      phase: state.continuation?.phase ?? null,
      followPoint: state.continuation?.followPoint ?? null,
      pushedPieceId: state.continuation?.pushedPieceId ?? null,
      followGroupPieceIds: [...state.continuation?.followGroupPieceIds ?? []].sort((a, b) => a.localeCompare(b)),
      rushedPieceIds: [...state.continuation?.rushedPieceIds ?? []].sort((a, b) => a.localeCompare(b)),
      rushChainPieceIds: [...state.continuation?.rushChainPieceIds ?? []].sort((a, b) => a.localeCompare(b))
    },
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      kind: piece.kind,
      position: piece.position,
      pushed: Boolean(piece.pushed),
      shifted: Boolean(piece.shifted)
    })).sort((a, b) => a.id.localeCompare(b.id))
  });
}
function isContinuationCompletable(state, memo) {
  if (memo)
    return solveContinuation(state, memo);
  return completedDecisionRule("continuation-v1", state, () => solveContinuation(state, /* @__PURE__ */ new Map()));
}
function optimisticRushSupplyRegion(state) {
  const owner = obligationOwner(state);
  const allEnemies = state.pieces.filter((piece) => piece.owner !== owner);
  const enemies = allEnemies.filter((piece) => !piece.pushed);
  const blocked = new Set(enemies.map((piece) => coordinateKey(piece.position.row, piece.position.col)));
  const possibleBlockers = /* @__PURE__ */ new Set();
  const moved = new Set(state.continuation?.rushedPieceIds ?? []);
  for (const piece of state.pieces.filter((piece2) => piece2.owner === owner && !piece2.pushed)) {
    possibleBlockers.add(coordinateKey(piece.position.row, piece.position.col));
    if (moved.has(piece.id) || !isActivePieceInContext(state, piece))
      continue;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const to = { row: piece.position.row + dr, col: piece.position.col + dc };
        if (!dr && !dc || outOfBounds(to) || blocked.has(coordinateKey(to.row, to.col)))
          continue;
        const enemyAt = (row, col) => allEnemies.some((enemy) => enemy.position.row === row && enemy.position.col === col);
        const geometricallyPossible = dr && dc ? enemyAt(piece.position.row + dr, piece.position.col) || enemyAt(piece.position.row, piece.position.col + dc) : allEnemies.some((enemy) => Math.max(Math.abs(enemy.position.row - to.row), Math.abs(enemy.position.col - to.col)) === 1);
        if (geometricallyPossible)
          possibleBlockers.add(coordinateKey(to.row, to.col));
      }
  }
  for (const edge of buildCommandEdgesForPieces(enemies)) {
    checkEngineComputation();
    const interior = [];
    if (edge.from.row === edge.to.row) {
      for (let col = Math.min(edge.from.col, edge.to.col) + 1; col < Math.max(edge.from.col, edge.to.col); col++) {
        interior.push(coordinateKey(edge.from.row, col));
      }
    } else if (edge.from.col === edge.to.col) {
      for (let row = Math.min(edge.from.row, edge.to.row) + 1; row < Math.max(edge.from.row, edge.to.row); row++) {
        interior.push(coordinateKey(row, edge.from.col));
      }
    }
    if (!interior.some((key) => possibleBlockers.has(key)))
      for (const key of interior)
        blocked.add(key);
  }
  const point = SUPPLY_POINTS[owner];
  const visited = /* @__PURE__ */ new Set();
  const queue = [point];
  if (blocked.has(coordinateKey(point.row, point.col)))
    return visited;
  visited.add(coordinateKey(point.row, point.col));
  for (let index = 0; index < queue.length; index++) {
    checkEngineComputation();
    for (const next of sortedOrthogonalNeighbors(queue[index].row, queue[index].col)) {
      const key = coordinateKey(next.row, next.col);
      if (!blocked.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  return visited;
}
function solveContinuation(state, memo) {
  checkEngineComputation(Boolean(state.continuation));
  if (!state.continuation) {
    return true;
  }
  const normalized = normalizeState(state);
  const key = continuationSearchKey(normalized);
  if (isEngineComputationObserved())
    observeEngineComputation({ type: "continuation-key", key: JSON.stringify({ ...normalized, artifacts: void 0 }) });
  const existing = memo.get(key);
  if (existing !== void 0 && isEngineComputationObserved())
    observeEngineComputation({ type: "memo-hit", key });
  if (existing === "success") {
    return true;
  }
  if (existing === "failure" || existing === "visiting") {
    return false;
  }
  try {
    memo.set(key, "visiting");
    if (canCloseContinuationNow(normalized)) {
      memo.set(key, "success");
      return true;
    }
    if (normalized.continuation?.type === "rush") {
      const rushSupplyRegion = optimisticRushSupplyRegion(normalized);
      const required = new Set(obligationPieceIdsForContinuation(normalized));
      const moved = new Set(normalized.continuation.rushedPieceIds ?? []);
      if (normalized.pieces.some((piece) => required.has(piece.id) && moved.has(piece.id) && !rushSupplyRegion.has(coordinateKey(piece.position.row, piece.position.col)))) {
        memo.set(key, "failure");
        return false;
      }
    }
    for (const successor of buildSuccessorStates(normalized)) {
      if (solveContinuation(successor, memo)) {
        memo.set(key, "success");
        return true;
      }
    }
    memo.set(key, "failure");
    return false;
  } catch (error) {
    memo.delete(key);
    throw error;
  }
}
function getRushUnsuppliedPieceIds(state) {
  if (state.continuation?.type !== "rush" || !["P1", "P2"].includes(state.continuation.owner))
    return [];
  const supplied = computeLiveSuppliedPieceIds(state, state.continuation.owner);
  return obligationPieceIdsForContinuation(state).filter((id) => !supplied.has(id));
}
function analyzeRushSupplyGuidance(state) {
  const obligationPieceIds = getRushUnsuppliedPieceIds(state);
  if (!obligationPieceIds.length)
    return { obligationPieceIds, actions: [] };
  const actionKey = (action) => `${action.actorId}:${action.to?.row},${action.to?.col}`;
  const isSubsequence = (needle, haystack) => {
    let index = 0;
    for (const key of haystack)
      if (needle[index] === key)
        index++;
    return index === needle.length;
  };
  const solutions = [];
  const firstActions = /* @__PURE__ */ new Map();
  const successors = /* @__PURE__ */ new Map();
  let frontier = [{ state, path: [] }];
  while (frontier.length) {
    const nextFrontier = [];
    for (const node of frontier) {
      checkEngineComputation(true);
      const rushSupplyRegion = optimisticRushSupplyRegion(node.state);
      const moved = new Set(node.state.continuation?.rushedPieceIds ?? []);
      const required = new Set(obligationPieceIdsForContinuation(node.state));
      if (node.state.pieces.some((piece) => required.has(piece.id) && moved.has(piece.id) && !rushSupplyRegion.has(coordinateKey(piece.position.row, piece.position.col))))
        continue;
      if (solutions.some((route) => isSubsequence(route, node.path)))
        continue;
      const key = continuationSearchKey(node.state);
      let edges = successors.get(key);
      if (!edges) {
        edges = buildRushSuccessorActions(node.state).map((action) => {
          checkEngineComputation(true);
          const next = buildContinuationSuccessorState(node.state, action);
          return { action, state: next, closes: canCloseContinuationNow(next) };
        });
        successors.set(key, edges);
      }
      for (const edge of edges) {
        const path = [...node.path, actionKey(edge.action)];
        if (solutions.some((route) => isSubsequence(route, path)))
          continue;
        const first = node.first ?? edge.action;
        if (edge.closes) {
          solutions.push(path);
          firstActions.set(actionKey(first), { action: first, immediate: path.length === 1 });
        } else
          nextFrontier.push({ state: edge.state, path, first });
      }
    }
    frontier = nextFrontier;
  }
  return { obligationPieceIds, actions: [...firstActions.values()] };
}

// apps/web/generated/packages/shared-types/src/retreat-rules.js
var LEGACY_RETREAT_SEMANTICS = "geometric-retreat-v1";
var CURRENT_RETREAT_SEMANTICS = "completion-preserving-retreat-v2";
function liveRetreatSemantics(options) {
  const value = options?.retreatSemantics === void 0 ? CURRENT_RETREAT_SEMANTICS : options.retreatSemantics;
  if (value !== CURRENT_RETREAT_SEMANTICS && value !== LEGACY_RETREAT_SEMANTICS)
    throw new Error("Unknown retreat semantics");
  return value;
}

// apps/web/generated/packages/game-engine/src/legal.js
function outOfBounds2(value) {
  if (!value) {
    return false;
  }
  return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}
function getPieceAt2(state, value) {
  return state.pieces.find((piece) => piece.position.row === value.row && piece.position.col === value.col);
}
function hasPieceAt2(state, value) {
  return Boolean(getPieceAt2(state, value));
}
function sameCoordinate(left, right) {
  return Boolean(left && right && left.row === right.row && left.col === right.col);
}
function isOrthogonallyAdjacent2(from, to) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta + colDelta === 1;
}
function isAnyAdjacent2(from, to) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
}
function isOrthogonalDistance(from, to, distance) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta === distance && colDelta === 0 || rowDelta === 0 && colDelta === distance;
}
function isActivePiece(piece) {
  return piece.supplied && piece.commanded && !piece.pushed && !piece.shifted;
}
function getFrozenPieceState2(state, piece) {
  if (state.continuation?.frozenOwner !== piece.owner) {
    return null;
  }
  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
}
function isActivePieceInContext2(state, piece) {
  const frozen = getFrozenPieceState2(state, piece);
  if (!frozen) {
    return isActivePiece(piece);
  }
  return isActivePiece({
    ...piece,
    supplied: frozen.supplied,
    commanded: frozen.commanded
  });
}
function coordinateKey2(row, col) {
  return `${row},${col}`;
}
function sortedOrthogonalNeighbors2(row, col) {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 }
  ].filter((next) => !outOfBounds2(next)).sort((a, b) => a.row === b.row ? a.col - b.col : a.row - b.row);
}
function isClearOrthogonalLineForPieces2(a, b, occupied) {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }
  if (a.row === b.row) {
    const start2 = Math.min(a.col, b.col) + 1;
    const end2 = Math.max(a.col, b.col);
    for (let col = start2; col < end2; col += 1) {
      if (occupied.has(coordinateKey2(a.row, col))) {
        return false;
      }
    }
    return true;
  }
  const start = Math.min(a.row, b.row) + 1;
  const end = Math.max(a.row, b.row);
  for (let row = start; row < end; row += 1) {
    if (occupied.has(coordinateKey2(row, a.col))) {
      return false;
    }
  }
  return true;
}
function buildCommandEdgesForPieces2(pieces) {
  const occupied = new Map(pieces.map((piece) => [coordinateKey2(piece.position.row, piece.position.col), piece.id]));
  const edges = [];
  for (const owner of ["P1", "P2"]) {
    const ownPieces = pieces.filter((piece) => piece.owner === owner).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);
        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible = (a.position.row === b.position.row || a.position.col === b.position.col) && isClearOrthogonalLineForPieces2(a.position, b.position, occupied);
        if (!diagonalAllowed && !orthogonalVisible) {
          continue;
        }
        edges.push({
          owner,
          from: { ...a.position },
          to: { ...b.position }
        });
      }
    }
  }
  return edges;
}
function isCoordinateSuppliedForOwner(pieces, owner, target) {
  const observed = isEngineComputationObserved();
  if (observed)
    observeEngineComputation({ type: "supply-start" });
  try {
    const enemyBlockedByEdge = /* @__PURE__ */ new Set();
    for (const edge of buildCommandEdgesForPieces2(pieces)) {
      if (edge.owner === owner) {
        continue;
      }
      if (edge.from.row === edge.to.row) {
        const row = edge.from.row;
        const startCol = Math.min(edge.from.col, edge.to.col) + 1;
        const endCol = Math.max(edge.from.col, edge.to.col);
        for (let col = startCol; col < endCol; col += 1) {
          enemyBlockedByEdge.add(coordinateKey2(row, col));
        }
        continue;
      }
      if (edge.from.col === edge.to.col) {
        const col = edge.from.col;
        const startRow = Math.min(edge.from.row, edge.to.row) + 1;
        const endRow = Math.max(edge.from.row, edge.to.row);
        for (let row = startRow; row < endRow; row += 1) {
          enemyBlockedByEdge.add(coordinateKey2(row, col));
        }
      }
    }
    const occupiedByCoordinate = new Map(pieces.map((piece) => [coordinateKey2(piece.position.row, piece.position.col), piece]));
    const supplyPoint = SUPPLY_POINTS[owner];
    const targetKey = coordinateKey2(target.row, target.col);
    const supplyKey = coordinateKey2(supplyPoint.row, supplyPoint.col);
    const isTraversable = (row, col) => {
      if (enemyBlockedByEdge.has(coordinateKey2(row, col))) {
        return false;
      }
      const occupant = occupiedByCoordinate.get(coordinateKey2(row, col));
      return !occupant || occupant.owner === owner;
    };
    const visited = /* @__PURE__ */ new Set();
    if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
      return false;
    }
    if (supplyKey === targetKey)
      return true;
    visited.add(supplyKey);
    const queue = [{ ...supplyPoint }];
    while (queue.length > 0) {
      const current3 = queue.shift();
      if (!current3) {
        break;
      }
      for (const next of sortedOrthogonalNeighbors2(current3.row, current3.col)) {
        const nextKey = coordinateKey2(next.row, next.col);
        if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
          continue;
        }
        if (nextKey === targetKey)
          return true;
        visited.add(nextKey);
        queue.push(next);
      }
    }
    return false;
  } finally {
    if (observed)
      observeEngineComputation({ type: "supply-end" });
  }
}
function wouldCoordinateBeSuppliedForOwner(pieces, owner, destination) {
  return isCoordinateSuppliedForOwner(pieces, owner, destination);
}
function wouldBeSuppliedAfterRelocation(state, actorId, owner, destination) {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: piece.id === actorId ? { ...destination } : { ...piece.position }
  }));
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}
function wouldProjectedPieceBeSupplied(state, owner, destination) {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: { ...piece.position }
  }));
  hypothetical.push({
    id: "__projected__",
    owner,
    position: { ...destination }
  });
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}
function resolveActor(state, action) {
  if (action.actorId) {
    return state.pieces.find((piece) => piece.id === action.actorId);
  }
  if (action.from) {
    return getPieceAt2(state, action.from);
  }
  return void 0;
}
function localGroupStrength(state, pieceId) {
  return localGroupMembers2(state, pieceId).length;
}
function localGroupMembers2(state, pieceId) {
  const seed = state.pieces.find((piece) => piece.id === pieceId);
  if (!seed) {
    return [];
  }
  const queue = [seed];
  const visited = /* @__PURE__ */ new Set([seed.id]);
  while (queue.length > 0) {
    const current3 = queue.shift();
    if (!current3) {
      break;
    }
    for (const candidate of state.pieces) {
      if (candidate.owner !== seed.owner || visited.has(candidate.id)) {
        continue;
      }
      if (isOrthogonallyAdjacent2(candidate.position, current3.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}
function enemyAdjacentCount2(state, owner, center) {
  return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent2(piece.position, center)).length;
}
function validateContinuation(state, action) {
  if (!state.continuation) {
    return null;
  }
  if (state.continuation.type === "push") {
    if (state.continuation.phase === "retreat") {
      if (action.type !== "retreat") {
        return {
          ok: false,
          code: "CONTINUATION_REQUIRED",
          message: "Push retreat phase requires retreat action"
        };
      }
      return null;
    }
    if (action.type !== "follow") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Push follow phase requires follow action"
      };
    }
    return null;
  }
  if (state.continuation.type === "rush") {
    if (action.type !== "rush" && action.type !== "end_turn") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Rush continuation requires Rush or End Turn"
      };
    }
  }
  return null;
}
var ORTHOGONAL_OFFSETS = [[-1, 0], [0, -1], [0, 1], [1, 0]];
var RUSH_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
function* legalActionCandidates(state) {
  if (state.outcome.status !== "ongoing")
    return;
  const continuation = state.continuation;
  if (continuation?.type === "push") {
    if (continuation.phase === "retreat") {
      const piece = state.pieces.find((candidate) => candidate.id === continuation.pushedPieceId);
      if (!piece)
        return;
      for (const to of [
        { row: piece.position.row - 1, col: piece.position.col },
        { row: piece.position.row + 1, col: piece.position.col },
        { row: piece.position.row, col: piece.position.col - 1 },
        { row: piece.position.row, col: piece.position.col + 1 }
      ]) {
        if (!outOfBounds2(to))
          yield { type: "retreat", actorId: piece.id, from: piece.position, to };
      }
    } else if (continuation.followPoint && !outOfBounds2(continuation.followPoint)) {
      const allowed = new Set(continuation.followGroupPieceIds ?? []);
      for (const piece of state.pieces) {
        if (piece.owner === state.sideToMove && (allowed.size === 0 || allowed.has(piece.id)) && isOrthogonallyAdjacent2(piece.position, continuation.followPoint)) {
          yield { type: "follow", actorId: piece.id, from: piece.position, to: continuation.followPoint };
        }
      }
    }
    if (continuation.phase !== "retreat")
      yield { type: "end_turn" };
    return;
  }
  if (!continuation)
    yield { type: "pass" };
  for (const piece of state.pieces) {
    if (piece.owner !== state.sideToMove)
      continue;
    const types = continuation ? ["rush"] : ["move", "project", "rush", "push"];
    for (const type of types) {
      const distance = type === "project" ? 2 : 1;
      const offsets = type === "rush" ? RUSH_OFFSETS : ORTHOGONAL_OFFSETS;
      for (const [rowDelta, colDelta] of offsets) {
        const to = { row: piece.position.row + rowDelta * distance, col: piece.position.col + colDelta * distance };
        if (!outOfBounds2(to))
          yield { type, actorId: piece.id, from: { ...piece.position }, to };
      }
    }
  }
  if (continuation?.type === "rush")
    yield { type: "end_turn" };
}
function listLegalActions(state, options) {
  liveRetreatSemantics(options);
  const actions = [];
  const observed = isEngineComputationObserved();
  for (const action of legalActionCandidates(state)) {
    if (observed)
      observeEngineComputation({ type: "candidate", action });
    const validation = validateAction(state, action, options);
    if (observed)
      observeEngineComputation({ type: "candidate-result", action, status: validation.ok ? "legal" : "illegal" });
    if (validation.ok)
      actions.push(action);
  }
  return actions;
}
function validateAction(state, action, options) {
  const retreatSemantics = liveRetreatSemantics(options);
  checkEngineComputation();
  if (state.outcome.status !== "ongoing") {
    return {
      ok: false,
      code: "TERMINAL_GAME",
      message: "No actions are legal after terminal outcome"
    };
  }
  if (outOfBounds2(action.from) || outOfBounds2(action.to)) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      message: "Action coordinates must be inside board bounds"
    };
  }
  if (action.from && !hasPieceAt2(state, action.from)) {
    return {
      ok: false,
      code: "SOURCE_EMPTY",
      message: "No piece exists at action source coordinate"
    };
  }
  if (action.type === "pass" || action.type === "end_turn") {
    if (action.actorId || action.from || action.to || action.targetId) {
      return { ok: false, code: "INVALID_SHAPE", message: "Turn controls cannot identify a piece or destination" };
    }
    if (action.type === "pass") {
      return state.continuation ? { ok: false, code: "CONTINUATION_REQUIRED", message: "Use End Turn to close a sequence" } : { ok: true };
    }
    return state.continuation && canCloseContinuationNow(state) ? { ok: true } : { ok: false, code: "CONTINUATION_REQUIRED", message: "The sequence cannot end yet" };
  }
  const continuationValidation = validateContinuation(state, action);
  if (continuationValidation)
    return continuationValidation;
  const actor = resolveActor(state, action);
  if (!actor) {
    return {
      ok: false,
      code: "INVALID_SHAPE",
      message: "Action must identify an actor by actorId or from"
    };
  }
  if (actor.owner !== state.sideToMove) {
    return {
      ok: false,
      code: "NOT_SIDE_TO_MOVE",
      message: "Actor is not owned by side to move"
    };
  }
  if (action.from && !sameCoordinate(action.from, actor.position)) {
    return {
      ok: false,
      code: "INVALID_SHAPE",
      message: "Action from coordinate does not match actor position"
    };
  }
  if (action.type === "move") {
    if (actor.kind !== "commander") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move is legal only for commanders"
      };
    }
    if (!isActivePieceInContext2(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive commander cannot move"
      };
    }
    if (!action.to || !isOrthogonallyAdjacent2(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move destination must be an orthogonally adjacent square"
      };
    }
    if (hasPieceAt2(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move destination is occupied"
      };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Move destination would be unsupplied"
      };
    }
    return { ok: true };
  }
  if (action.type === "project") {
    if (!isActivePieceInContext2(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive piece cannot project"
      };
    }
    if (!action.to || !isOrthogonalDistance(actor.position, action.to, 2)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Project destination must be exactly 2 orthogonal squares away"
      };
    }
    const midpoint = {
      row: (actor.position.row + action.to.row) / 2,
      col: (actor.position.col + action.to.col) / 2
    };
    if (hasPieceAt2(state, midpoint) || hasPieceAt2(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Project path and destination must be empty"
      };
    }
    if (!wouldProjectedPieceBeSupplied(state, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Project destination would be unsupplied"
      };
    }
    return { ok: true };
  }
  if (action.type === "rush") {
    if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Piece may only rush once per rush sequence"
      };
    }
    if (!isActivePieceInContext2(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive piece cannot rush"
      };
    }
    if (!action.to || !isAnyAdjacent2(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Rush destination must be one square away"
      };
    }
    if (hasPieceAt2(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Rush destination is occupied"
      };
    }
    const rowDelta = action.to.row - actor.position.row;
    const colDelta = action.to.col - actor.position.col;
    const diagonal = Math.abs(rowDelta) === 1 && Math.abs(colDelta) === 1;
    if (diagonal) {
      if (actor.pushed) {
        return {
          ok: false,
          code: "RULE_VIOLATION",
          message: "Pushed piece cannot diagonal-rush"
        };
      }
      const coAdjacentA = { row: actor.position.row + rowDelta, col: actor.position.col };
      const coAdjacentB = { row: actor.position.row, col: actor.position.col + colDelta };
      const enemyA = getPieceAt2(state, coAdjacentA);
      const enemyB = getPieceAt2(state, coAdjacentB);
      if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
        return {
          ok: false,
          code: "RULE_VIOLATION",
          message: "Diagonal rush requires enemy in a co-adjacent square"
        };
      }
    } else {
      if (enemyAdjacentCount2(state, actor.owner, action.to) === 0) {
        return {
          ok: false,
          code: "RULE_VIOLATION",
          message: "Orthogonal rush destination must be adjacent to at least one enemy"
        };
      }
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Rush destination cannot complete to an end-supplied rush chain"
      };
    }
    return { ok: true };
  }
  if (action.type === "push") {
    if (!isActivePieceInContext2(state, actor) || actor.pushed || actor.shifted) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Actor cannot push in current temporary state"
      };
    }
    if (!action.to) {
      return {
        ok: false,
        code: "INVALID_SHAPE",
        message: "Push requires target coordinate"
      };
    }
    if (!isOrthogonallyAdjacent2(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must be an orthogonally adjacent square"
      };
    }
    const defender = getPieceAt2(state, action.to);
    if (!defender || defender.owner === actor.owner) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must contain an orthogonally adjacent enemy piece"
      };
    }
    const attackerStrength = localGroupStrength(state, actor.id);
    const defenderStrength = localGroupStrength(state, defender.id);
    if (attackerStrength <= defenderStrength) {
      return {
        ok: false,
        code: "PUSH_STRENGTH_TOO_WEAK",
        message: "Push requires strictly greater attacker group strength"
      };
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Push destination cannot complete to an end-supplied pushing group"
      };
    }
    return { ok: true };
  }
  if (action.type === "follow") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow is only legal during push follow phase"
      };
    }
    if (actor.shifted) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor already shifted in this continuation"
      };
    }
    if (!state.continuation.followPoint || !action.to || !sameCoordinate(action.to, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow destination must be current follow-point"
      };
    }
    if (hasPieceAt2(state, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow-point must be empty"
      };
    }
    if (Array.isArray(state.continuation.followGroupPieceIds) && state.continuation.followGroupPieceIds.length > 0 && !state.continuation.followGroupPieceIds.includes(actor.id)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor must belong to the pushing group"
      };
    }
    if (!isOrthogonallyAdjacent2(actor.position, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor must be orthogonally adjacent to current follow-point"
      };
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Follow destination cannot complete to an end-supplied pushing group"
      };
    }
    return { ok: true };
  }
  if (action.type === "retreat") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat is only legal during push retreat phase"
      };
    }
    if (!actor.pushed || actor.id !== state.continuation.pushedPieceId) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Only the pushed piece may retreat"
      };
    }
    if (!action.to || !isOrthogonallyAdjacent2(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination must be orthogonally adjacent"
      };
    }
    if (hasPieceAt2(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination is occupied"
      };
    }
    if (state.continuation.followPoint && sameCoordinate(action.to, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination cannot be the reserved follow-point"
      };
    }
    if (retreatSemantics === CURRENT_RETREAT_SEMANTICS) {
      const successor = buildContinuationSuccessorState(state, action);
      if (!isContinuationCompletable(successor)) {
        return {
          ok: false,
          code: "SUPPLY_DESTINATION_UNSUPPLIED",
          message: "Retreat destination cannot complete to an end-supplied pushing group"
        };
      }
    }
    return { ok: true };
  }
  return {
    ok: false,
    code: "RULE_VIOLATION",
    message: "Unsupported action type"
  };
}

// apps/web/generated/packages/game-engine/src/resolve.js
var MAX_RESOLVE_PASSES = 64;
function sortIds(ids) {
  return [...ids].sort((a, b) => a.localeCompare(b));
}
function coordinateKey3(row, col) {
  return `${row},${col}`;
}
function parseCoordinateKey(key) {
  const [row, col] = key.split(",").map((value) => Number(value));
  return { row, col };
}
function isInBounds(boardSize, row, col) {
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}
function sortedOrthogonalNeighbors3(boardSize, row, col) {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 }
  ].filter((next) => isInBounds(boardSize, next.row, next.col)).sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row;
    }
    return a.col - b.col;
  });
}
function networkPieces(state) {
  return state.pieces.filter((piece) => !piece.pushed);
}
function isFrozenPieceDuringContinuation(state, pieceId, owner) {
  return Boolean(state.continuation?.frozenOwner === owner && state.continuation.frozenPieceStatesById?.[pieceId]);
}
function setPieceDisplayStatus(piece, nextSupplied, nextCommanded) {
  let changed = false;
  if (typeof nextSupplied === "boolean" && piece.displaySupplied !== nextSupplied) {
    piece.displaySupplied = nextSupplied;
    changed = true;
  }
  if (typeof nextCommanded === "boolean" && piece.displayCommanded !== nextCommanded) {
    piece.displayCommanded = nextCommanded;
    changed = true;
  }
  return changed;
}
function computeSupplyForOwner(state, owner) {
  const enemyBlockedByEdge = /* @__PURE__ */ new Set();
  for (const edge of buildCommandEdges(state)) {
    if (edge.owner === owner) {
      continue;
    }
    if (edge.from.row === edge.to.row) {
      const row = edge.from.row;
      const startCol = Math.min(edge.from.col, edge.to.col) + 1;
      const endCol = Math.max(edge.from.col, edge.to.col);
      for (let col = startCol; col < endCol; col += 1) {
        enemyBlockedByEdge.add(coordinateKey3(row, col));
      }
      continue;
    }
    if (edge.from.col === edge.to.col) {
      const col = edge.from.col;
      const startRow = Math.min(edge.from.row, edge.to.row) + 1;
      const endRow = Math.max(edge.from.row, edge.to.row);
      for (let row = startRow; row < endRow; row += 1) {
        enemyBlockedByEdge.add(coordinateKey3(row, col));
      }
    }
  }
  const supplyPoint = SUPPLY_POINTS[owner];
  const occupiedByCoordinate = new Map(networkPieces(state).map((piece) => [coordinateKey3(piece.position.row, piece.position.col), piece]));
  const isTraversable = (row, col) => {
    if (enemyBlockedByEdge.has(coordinateKey3(row, col))) {
      return false;
    }
    const occupant = occupiedByCoordinate.get(coordinateKey3(row, col));
    if (!occupant) {
      return true;
    }
    return occupant.owner === owner;
  };
  const supplyKey = coordinateKey3(supplyPoint.row, supplyPoint.col);
  const visited = /* @__PURE__ */ new Set();
  const parentByKey = /* @__PURE__ */ new Map();
  if (isTraversable(supplyPoint.row, supplyPoint.col)) {
    visited.add(supplyKey);
    parentByKey.set(supplyKey, null);
    const queue = [{ row: supplyPoint.row, col: supplyPoint.col }];
    while (queue.length > 0) {
      const current3 = queue.shift();
      if (!current3) {
        break;
      }
      for (const next of sortedOrthogonalNeighbors3(state.boardSize, current3.row, current3.col)) {
        const nextKey = coordinateKey3(next.row, next.col);
        if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
          continue;
        }
        visited.add(nextKey);
        parentByKey.set(nextKey, coordinateKey3(current3.row, current3.col));
        queue.push(next);
      }
    }
  }
  const suppliedByPieceId = {};
  const shortestPathByPieceId = {};
  const distanceByPieceId = {};
  for (const piece of state.pieces.filter((candidate) => candidate.owner === owner && !candidate.pushed)) {
    const pieceKey = coordinateKey3(piece.position.row, piece.position.col);
    const supplied = visited.has(pieceKey);
    suppliedByPieceId[piece.id] = supplied;
    if (!supplied) {
      continue;
    }
    const path = [];
    let cursor = pieceKey;
    while (cursor) {
      path.push(parseCoordinateKey(cursor));
      cursor = parentByKey.get(cursor);
    }
    shortestPathByPieceId[piece.id] = path;
    distanceByPieceId[piece.id] = Math.max(0, path.length - 1);
  }
  return {
    suppliedByPieceId,
    shortestPathByPieceId,
    distanceByPieceId,
    reachability: sortIds(Object.entries(suppliedByPieceId).filter(([, supplied]) => supplied).map(([pieceId]) => pieceId))
  };
}
function computeBaselineArtifacts(state, mode) {
  const visiblePieces = networkPieces(state);
  const p1Pieces = visiblePieces.filter((piece) => piece.owner === "P1");
  const p2Pieces = visiblePieces.filter((piece) => piece.owner === "P2");
  const p1Components = Object.fromEntries(sortIds(p1Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P1:${pieceId}`]));
  const p2Components = Object.fromEntries(sortIds(p2Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P2:${pieceId}`]));
  return {
    mode,
    supply: [
      {
        player: "P1",
        reachability: sortIds(p1Pieces.filter((piece) => piece.supplied).map((piece) => piece.id)),
        shortestPathByPieceId: {},
        distanceByPieceId: {}
      },
      {
        player: "P2",
        reachability: sortIds(p2Pieces.filter((piece) => piece.supplied).map((piece) => piece.id)),
        shortestPathByPieceId: {},
        distanceByPieceId: {}
      }
    ],
    command: {
      candidateEdges: [],
      cutEdges: [],
      activeEdges: [],
      shortestPathToCommanderByPieceId: {}
    },
    groups: {
      componentByPieceId: {
        ...p1Components,
        ...p2Components
      },
      membersByComponentId: Object.fromEntries([
        ...Object.keys(p1Components).map((pieceId) => [`P1:${pieceId}`, [pieceId]]),
        ...Object.keys(p2Components).map((pieceId) => [`P2:${pieceId}`, [pieceId]])
      ]),
      strengthByComponentId: Object.fromEntries([
        ...Object.keys(p1Components).map((pieceId) => [`P1:${pieceId}`, 1]),
        ...Object.keys(p2Components).map((pieceId) => [`P2:${pieceId}`, 1])
      ])
    }
  };
}
function makeEdgeId(aId, bId) {
  return aId.localeCompare(bId) <= 0 ? `${aId}|${bId}` : `${bId}|${aId}`;
}
function isClearOrthogonalLine(state, a, b, occupied) {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }
  if (a.row === b.row) {
    const start2 = Math.min(a.col, b.col) + 1;
    const end2 = Math.max(a.col, b.col);
    for (let col = start2; col < end2; col += 1) {
      if (occupied.has(coordinateKey3(a.row, col))) {
        return false;
      }
    }
    return true;
  }
  const start = Math.min(a.row, b.row) + 1;
  const end = Math.max(a.row, b.row);
  for (let row = start; row < end; row += 1) {
    if (occupied.has(coordinateKey3(row, a.col))) {
      return false;
    }
  }
  return true;
}
function orientation(a, b, c) {
  return (b.col - a.col) * (c.row - a.row) - (b.row - a.row) * (c.col - a.col);
}
function samePoint(left, right) {
  return left.row === right.row && left.col === right.col;
}
function pointStrictlyInsideSegment(point, a, b) {
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);
  const minCol = Math.min(a.col, b.col);
  const maxCol = Math.max(a.col, b.col);
  return point.row >= minRow && point.row <= maxRow && point.col >= minCol && point.col <= maxCol && !samePoint(point, a) && !samePoint(point, b);
}
function collinearSegmentsOverlapInInterior(edgeA, edgeB) {
  const vertical = edgeA.from.col === edgeA.to.col && edgeB.from.col === edgeB.to.col && edgeA.from.col === edgeB.from.col;
  if (vertical) {
    const start2 = Math.max(Math.min(edgeA.from.row, edgeA.to.row), Math.min(edgeB.from.row, edgeB.to.row));
    const end2 = Math.min(Math.max(edgeA.from.row, edgeA.to.row), Math.max(edgeB.from.row, edgeB.to.row));
    return end2 > start2;
  }
  const horizontal = edgeA.from.row === edgeA.to.row && edgeB.from.row === edgeB.to.row && edgeA.from.row === edgeB.from.row;
  if (horizontal) {
    const start2 = Math.max(Math.min(edgeA.from.col, edgeA.to.col), Math.min(edgeB.from.col, edgeB.to.col));
    const end2 = Math.min(Math.max(edgeA.from.col, edgeA.to.col), Math.max(edgeB.from.col, edgeB.to.col));
    return end2 > start2;
  }
  const diagonalSlopeA = {
    row: edgeA.to.row - edgeA.from.row,
    col: edgeA.to.col - edgeA.from.col
  };
  const diagonalSlopeB = {
    row: edgeB.to.row - edgeB.from.row,
    col: edgeB.to.col - edgeB.from.col
  };
  if (Math.abs(diagonalSlopeA.row) !== Math.abs(diagonalSlopeA.col) || Math.abs(diagonalSlopeB.row) !== Math.abs(diagonalSlopeB.col)) {
    return false;
  }
  const sameSlopeSign = Math.sign(diagonalSlopeA.row) === Math.sign(diagonalSlopeA.col) && Math.sign(diagonalSlopeB.row) === Math.sign(diagonalSlopeB.col);
  const oppositeSlopeSign = Math.sign(diagonalSlopeA.row) === -Math.sign(diagonalSlopeA.col) && Math.sign(diagonalSlopeB.row) === -Math.sign(diagonalSlopeB.col);
  if (!sameSlopeSign && !oppositeSlopeSign) {
    return false;
  }
  const project = sameSlopeSign ? (point) => point.row + point.col : (point) => point.row - point.col;
  const start = Math.max(Math.min(project(edgeA.from), project(edgeA.to)), Math.min(project(edgeB.from), project(edgeB.to)));
  const end = Math.min(Math.max(project(edgeA.from), project(edgeA.to)), Math.max(project(edgeB.from), project(edgeB.to)));
  return end > start;
}
function segmentIntersectionPoint(edgeA, edgeB) {
  const a = edgeA.from;
  const b = edgeA.to;
  const c = edgeB.from;
  const d = edgeB.to;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
    return collinearSegmentsOverlapInInterior(edgeA, edgeB) ? { row: Number.NaN, col: Number.NaN } : null;
  }
  if (o1 === 0 && pointStrictlyInsideSegment(c, a, b) || o2 === 0 && pointStrictlyInsideSegment(d, a, b)) {
    return { row: o1 === 0 ? c.row : d.row, col: o1 === 0 ? c.col : d.col };
  }
  if (o3 === 0 && pointStrictlyInsideSegment(a, c, d) || o4 === 0 && pointStrictlyInsideSegment(b, c, d)) {
    return { row: o3 === 0 ? a.row : b.row, col: o3 === 0 ? a.col : b.col };
  }
  if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
    const denominator = (a.row - b.row) * (c.col - d.col) - (a.col - b.col) * (c.row - d.row);
    if (denominator === 0) {
      return { row: Number.NaN, col: Number.NaN };
    }
    const determinantA = a.row * b.col - a.col * b.row;
    const determinantB = c.row * d.col - c.col * d.row;
    return {
      row: (determinantA * (c.row - d.row) - (a.row - b.row) * determinantB) / denominator,
      col: (determinantA * (c.col - d.col) - (a.col - b.col) * determinantB) / denominator
    };
  }
  return null;
}
function buildCommandEdges(state) {
  const visiblePieces = networkPieces(state);
  const occupied = new Map(visiblePieces.map((piece) => [coordinateKey3(piece.position.row, piece.position.col), piece.id]));
  const edges = /* @__PURE__ */ new Map();
  for (const owner of ["P1", "P2"]) {
    const ownPieces = visiblePieces.filter((piece) => piece.owner === owner).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);
        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible = (a.position.row === b.position.row || a.position.col === b.position.col) && isClearOrthogonalLine(state, a.position, b.position, occupied);
        if (!diagonalAllowed && !orthogonalVisible) {
          continue;
        }
        const id = makeEdgeId(a.id, b.id);
        edges.set(id, {
          owner,
          fromId: a.id,
          toId: b.id,
          from: { ...a.position },
          to: { ...b.position },
          id
        });
      }
    }
  }
  return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function applyCommandPhase(state, mode) {
  const edges = buildCommandEdges(state);
  const edgesByOwner = {
    P1: edges.filter((edge) => edge.owner === "P1"),
    P2: edges.filter((edge) => edge.owner === "P2")
  };
  const cutEdges = /* @__PURE__ */ new Set();
  for (const p1Edge of edgesByOwner.P1) {
    for (const p2Edge of edgesByOwner.P2) {
      if (segmentIntersectionPoint(p1Edge, p2Edge)) {
        cutEdges.add(p1Edge.id);
        cutEdges.add(p2Edge.id);
      }
    }
  }
  const activeEdges = edges.filter((edge) => !cutEdges.has(edge.id));
  let changed = false;
  const shortestPathToCommanderByPieceId = {};
  for (const owner of ["P1", "P2"]) {
    const commanderId = owner === "P1" ? "C1" : "C2";
    const visiblePieces = networkPieces(state);
    const ownPieceIds = sortIds(visiblePieces.filter((piece) => piece.owner === owner).map((piece) => piece.id));
    const adjacency = /* @__PURE__ */ new Map();
    for (const pieceId of ownPieceIds) {
      adjacency.set(pieceId, []);
    }
    for (const edge of activeEdges.filter((candidate) => candidate.owner === owner)) {
      adjacency.get(edge.fromId)?.push(edge.toId);
      adjacency.get(edge.toId)?.push(edge.fromId);
    }
    for (const [pieceId, neighbors] of adjacency.entries()) {
      adjacency.set(pieceId, sortIds(neighbors));
    }
    const visited = /* @__PURE__ */ new Set();
    const parent = /* @__PURE__ */ new Map();
    const queue = [];
    if (adjacency.has(commanderId)) {
      queue.push(commanderId);
      visited.add(commanderId);
      parent.set(commanderId, null);
    }
    while (queue.length > 0) {
      const current3 = queue.shift();
      if (!current3) {
        break;
      }
      const neighbors = adjacency.get(current3) ?? [];
      for (const next of neighbors) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        parent.set(next, current3);
        queue.push(next);
      }
    }
    for (const piece of state.pieces.filter((candidate) => candidate.owner === owner)) {
      if (piece.pushed) {
        continue;
      }
      const nextCommanded = visited.has(piece.id);
      if (setPieceDisplayStatus(piece, void 0, nextCommanded)) {
        changed = true;
      }
      if (isFrozenPieceDuringContinuation(state, piece.id, piece.owner)) {
        continue;
      }
      if (piece.commanded !== nextCommanded) {
        piece.commanded = nextCommanded;
        changed = true;
      }
      if (mode === "full" && nextCommanded) {
        const pathNodes = [];
        let cursor = piece.id;
        while (cursor) {
          pathNodes.push(cursor);
          cursor = parent.get(cursor);
        }
        const pathCoordinates = [];
        for (const pathNodeId of pathNodes) {
          const pathNode = state.pieces.find((candidate) => candidate.id === pathNodeId);
          if (!pathNode) {
            continue;
          }
          pathCoordinates.push({ row: pathNode.position.row, col: pathNode.position.col });
        }
        shortestPathToCommanderByPieceId[piece.id] = pathCoordinates;
      }
    }
  }
  const nextCommandArtifact = {
    candidateEdges: sortIds(edges.map((edge) => edge.id)),
    cutEdges: sortIds(cutEdges),
    activeEdges: sortIds(activeEdges.map((edge) => edge.id)),
    shortestPathToCommanderByPieceId: mode === "full" ? shortestPathToCommanderByPieceId : {}
  };
  if (!state.artifacts || JSON.stringify(state.artifacts.command) !== JSON.stringify(nextCommandArtifact)) {
    state.artifacts = state.artifacts ? {
      ...state.artifacts,
      command: nextCommandArtifact
    } : {
      mode,
      supply: [],
      command: nextCommandArtifact,
      groups: {
        componentByPieceId: {},
        membersByComponentId: {},
        strengthByComponentId: {}
      }
    };
    changed = true;
  }
  return changed;
}
function applyGroupPhase(state, mode) {
  const visiblePieces = networkPieces(state);
  const adjacency = /* @__PURE__ */ new Map();
  for (const piece of visiblePieces) {
    adjacency.set(piece.id, []);
  }
  for (let i = 0; i < visiblePieces.length; i += 1) {
    for (let j = i + 1; j < visiblePieces.length; j += 1) {
      const left = visiblePieces[i];
      const right = visiblePieces[j];
      if (left.owner !== right.owner) {
        continue;
      }
      const rowDelta = Math.abs(left.position.row - right.position.row);
      const colDelta = Math.abs(left.position.col - right.position.col);
      if (rowDelta + colDelta !== 1) {
        continue;
      }
      adjacency.get(left.id)?.push(right.id);
      adjacency.get(right.id)?.push(left.id);
    }
  }
  for (const [pieceId, neighbors] of adjacency.entries()) {
    adjacency.set(pieceId, sortIds(neighbors));
  }
  const componentByPieceId = {};
  const membersByComponentId = {};
  const strengthByComponentId = {};
  const visited = /* @__PURE__ */ new Set();
  const orderedPieces = [...visiblePieces].sort((a, b) => a.id.localeCompare(b.id));
  for (const startPiece of orderedPieces) {
    if (visited.has(startPiece.id)) {
      continue;
    }
    const queue = [startPiece.id];
    visited.add(startPiece.id);
    const componentMembers = [];
    while (queue.length > 0) {
      const current3 = queue.shift();
      if (!current3) {
        break;
      }
      componentMembers.push(current3);
      for (const next of adjacency.get(current3) ?? []) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        queue.push(next);
      }
    }
    const sortedMembers = sortIds(componentMembers);
    const componentId = `${startPiece.owner}:${sortedMembers[0]}`;
    membersByComponentId[componentId] = sortedMembers;
    strengthByComponentId[componentId] = sortedMembers.length;
    for (const pieceId of sortedMembers) {
      componentByPieceId[pieceId] = componentId;
    }
  }
  const nextGroupsArtifact = {
    componentByPieceId,
    membersByComponentId,
    strengthByComponentId
  };
  if (!state.artifacts || JSON.stringify(state.artifacts.groups) !== JSON.stringify(nextGroupsArtifact)) {
    state.artifacts = state.artifacts ? {
      ...state.artifacts,
      groups: nextGroupsArtifact
    } : {
      mode,
      supply: [],
      command: {
        candidateEdges: [],
        cutEdges: [],
        activeEdges: [],
        shortestPathToCommanderByPieceId: {}
      },
      groups: nextGroupsArtifact
    };
    return true;
  }
  return false;
}
function applyContinuationPhase(state, onRemoval) {
  if (!state.continuation) {
    return false;
  }
  if (state.outcome.status !== "ongoing") {
    state.continuation = null;
    return true;
  }
  const expectedOwner = state.continuation.owner;
  if (state.sideToMove !== expectedOwner) {
    state.sideToMove = expectedOwner;
    return true;
  }
  if (state.continuation.type === "push") {
    const attackerOwner = state.continuation.attackerOwner ?? expectedOwner;
    if (state.continuation.phase === "retreat") {
      const pushedPiece = state.continuation.pushedPieceId ? state.pieces.find((piece) => piece.id === state.continuation?.pushedPieceId) : void 0;
      if (!pushedPiece) {
        state.continuation.phase = "follow";
        state.continuation.owner = attackerOwner;
        state.continuation.pushedPieceId = void 0;
        state.sideToMove = attackerOwner;
        return true;
      }
      const retreatCandidates = buildPushRetreatSuccessorActions(state);
      if (retreatCandidates.length === 0) {
        reportRemoval(pushedPiece, "no_retreat", onRemoval);
        state.pieces = state.pieces.filter((piece) => piece.id !== pushedPiece.id);
        state.continuation.phase = "follow";
        state.continuation.owner = attackerOwner;
        state.continuation.pushedPieceId = void 0;
        state.sideToMove = attackerOwner;
        return true;
      }
      return false;
    }
    const followPoint = state.continuation.followPoint;
    if (!followPoint) {
      if (!canCloseContinuationNow(state)) {
        return false;
      }
      state.continuation = null;
      state.sideToMove = attackerOwner === "P1" ? "P2" : "P1";
      state.turnIndex += 1;
      for (const piece of state.pieces) {
        if (piece.shifted) {
          piece.shifted = false;
        }
      }
      return true;
    }
    const occupied = state.pieces.some((piece) => !piece.pushed && piece.position.row === followPoint.row && piece.position.col === followPoint.col);
    if (occupied) {
      return false;
    }
    const allowedPieces = new Set(state.continuation.followGroupPieceIds ?? []);
    const hasFriendlyAdjacent = state.pieces.some((piece) => {
      if (piece.owner !== expectedOwner || piece.pushed || piece.shifted || allowedPieces.size > 0 && !allowedPieces.has(piece.id)) {
        return false;
      }
      const rowDelta = Math.abs(piece.position.row - followPoint.row);
      const colDelta = Math.abs(piece.position.col - followPoint.col);
      return rowDelta + colDelta === 1;
    });
    if (!hasFriendlyAdjacent) {
      if (!canCloseContinuationNow(state)) {
        return false;
      }
      state.continuation = null;
      state.sideToMove = attackerOwner === "P1" ? "P2" : "P1";
      state.turnIndex += 1;
      for (const piece of state.pieces) {
        if (piece.shifted) {
          piece.shifted = false;
        }
      }
      return true;
    }
    return false;
  }
  if (state.continuation.type === "rush") {
    if (!canCloseContinuationNow(state)) {
      return false;
    }
    const hasRushCandidate = state.pieces.filter((piece) => piece.owner === expectedOwner).some((piece) => {
      for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
        for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
          if (rowDelta === 0 && colDelta === 0) {
            continue;
          }
          const candidate = {
            type: "rush",
            actorId: piece.id,
            from: piece.position,
            to: {
              row: piece.position.row + rowDelta,
              col: piece.position.col + colDelta
            }
          };
          if (validateAction(state, candidate).ok) {
            return true;
          }
        }
      }
      return false;
    });
    if (!hasRushCandidate) {
      state.continuation = null;
      state.sideToMove = expectedOwner === "P1" ? "P2" : "P1";
      state.turnIndex += 1;
      return true;
    }
  }
  return false;
}
function applySupplyPhase(state, mode) {
  const p1Supply = computeSupplyForOwner(state, "P1");
  const p2Supply = computeSupplyForOwner(state, "P2");
  let changed = false;
  for (const piece of state.pieces) {
    if (piece.pushed) {
      continue;
    }
    if (isFrozenPieceDuringContinuation(state, piece.id, piece.owner)) {
      const ownerSupply2 = piece.owner === "P1" ? p1Supply : p2Supply;
      const nextSupplied2 = Boolean(ownerSupply2.suppliedByPieceId[piece.id]);
      if (setPieceDisplayStatus(piece, nextSupplied2, void 0)) {
        changed = true;
      }
      continue;
    }
    const ownerSupply = piece.owner === "P1" ? p1Supply : p2Supply;
    const nextSupplied = Boolean(ownerSupply.suppliedByPieceId[piece.id]);
    if (setPieceDisplayStatus(piece, nextSupplied, void 0)) {
      changed = true;
    }
    if (piece.supplied !== nextSupplied) {
      piece.supplied = nextSupplied;
      changed = true;
    }
  }
  const nextSupplyArtifacts = [
    {
      player: "P1",
      reachability: p1Supply.reachability,
      shortestPathByPieceId: mode === "full" ? p1Supply.shortestPathByPieceId : {},
      distanceByPieceId: mode === "full" ? p1Supply.distanceByPieceId : {}
    },
    {
      player: "P2",
      reachability: p2Supply.reachability,
      shortestPathByPieceId: mode === "full" ? p2Supply.shortestPathByPieceId : {},
      distanceByPieceId: mode === "full" ? p2Supply.distanceByPieceId : {}
    }
  ];
  if (!state.artifacts || JSON.stringify(state.artifacts.supply) !== JSON.stringify(nextSupplyArtifacts)) {
    state.artifacts = state.artifacts ? {
      ...state.artifacts,
      supply: nextSupplyArtifacts
    } : {
      mode,
      supply: nextSupplyArtifacts,
      command: {
        candidateEdges: [],
        cutEdges: [],
        activeEdges: [],
        shortestPathToCommanderByPieceId: {}
      },
      groups: {
        componentByPieceId: {},
        membersByComponentId: {},
        strengthByComponentId: {}
      }
    };
    changed = true;
  }
  return changed;
}
function applyForcedEffectsPhase(state, onRemoval) {
  if (state.continuation) {
    return false;
  }
  const beforeCount = state.pieces.length;
  state.pieces = state.pieces.filter((piece) => {
    const keep = piece.pushed || piece.kind === "commander" || piece.supplied || isFrozenPieceDuringContinuation(state, piece.id, piece.owner);
    if (!keep)
      reportRemoval(piece, "loss_of_supply", onRemoval);
    return keep;
  });
  return state.pieces.length !== beforeCount;
}
function evaluateTerminalPhase(state) {
  if (state.outcome.status !== "ongoing") {
    return false;
  }
  const outcome = commanderOutcome(state.pieces);
  if (outcome.status === "ongoing")
    return false;
  state.outcome = outcome;
  return true;
}
function runResolvePass(state, mode, onRemoval) {
  let changed = false;
  const nextArtifacts = computeBaselineArtifacts(state, mode);
  if (state.artifacts?.supply) {
    nextArtifacts.supply = state.artifacts.supply;
  }
  if (state.artifacts?.command) {
    nextArtifacts.command = state.artifacts.command;
  }
  if (state.artifacts?.groups) {
    nextArtifacts.groups = state.artifacts.groups;
  }
  if (JSON.stringify(state.artifacts) !== JSON.stringify(nextArtifacts)) {
    state.artifacts = nextArtifacts;
    changed = true;
  }
  if (applySupplyPhase(state, mode)) {
    changed = true;
  }
  if (applyCommandPhase(state, mode)) {
    changed = true;
  }
  if (applyGroupPhase(state, mode)) {
    changed = true;
  }
  if (applyContinuationPhase(state, onRemoval)) {
    changed = true;
  }
  if (applyForcedEffectsPhase(state, onRemoval)) {
    changed = true;
  }
  return changed;
}
function resolveToStability(state, options) {
  const mode = options?.artifactMode ?? "minimal";
  const maxPasses = options?.maxPasses ?? MAX_RESOLVE_PASSES;
  let pass = 0;
  while (pass < maxPasses) {
    const changed = runResolvePass(state, mode, options?.onRemoval);
    if (!changed) {
      if (!state.continuation) {
        evaluateTerminalPhase(state);
      }
      return state;
    }
    pass += 1;
  }
  throw new Error(`resolveToStability exceeded max passes (${maxPasses})`);
}

// apps/web/generated/packages/game-engine/src/serialize.js
function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, nestedValue]) => [key, stableSortObject(nestedValue)]));
  }
  return value;
}
function serializeState(state) {
  return JSON.stringify(stableSortObject(normalizeState(state)));
}

// apps/web/generated/packages/game-engine/src/hash.js
function deterministicStateHash(value) {
  const serialized = serializeState(value);
  const seeds = [
    2166136261,
    2654435761,
    2246822507,
    3266489909,
    668265263,
    374761393,
    3550635116,
    4251993797
  ];
  let hash = "";
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < serialized.length; i += 1) {
      h ^= serialized.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    hash += h.toString(16).padStart(8, "0");
  }
  return hash;
}
function equivalentGameStates(left, right) {
  return deterministicStateHash(resolveToStability(structuredClone(left), { artifactMode: "full" })) === deterministicStateHash(resolveToStability(structuredClone(right), { artifactMode: "full" }));
}

// apps/web/generated/packages/game-engine/src/apply.js
function clearShiftedFlags(state) {
  for (const piece of state.pieces) {
    if (piece.shifted) {
      piece.shifted = false;
    }
  }
}
function opponentOf(owner) {
  return owner === "P1" ? "P2" : "P1";
}
function nextUnitId(state, owner) {
  const prefix = owner === "P1" ? "U1-" : "U2-";
  let next = 1;
  for (const piece of state.pieces) {
    if (!piece.id.startsWith(prefix)) {
      continue;
    }
    const numeric = Number.parseInt(piece.id.slice(prefix.length), 10);
    if (Number.isFinite(numeric)) {
      next = Math.max(next, numeric + 1);
    }
  }
  return `${prefix}${next}`;
}
function captureFrozenPieceStates2(state, owner) {
  return Object.fromEntries(state.pieces.filter((piece) => piece.owner === owner).map((piece) => [
    piece.id,
    {
      supplied: piece.supplied,
      commanded: piece.commanded
    }
  ]));
}
function applyAction(state, action, options) {
  const validation = validateAction(state, action, options);
  if (!validation.ok) {
    throw new Error(`Cannot apply invalid action: ${validation.code}`);
  }
  const next = normalizeState(state);
  const actor = action.actorId && next.pieces.find((piece) => piece.id === action.actorId) || action.from && next.pieces.find((piece) => piece.position.row === action.from?.row && piece.position.col === action.from?.col) || void 0;
  const endTurn = (nextSideToMove = opponentOf(next.sideToMove)) => {
    next.sideToMove = nextSideToMove;
    next.turnIndex += 1;
    next.continuation = null;
    clearShiftedFlags(next);
  };
  if (action.type === "pass" || action.type === "end_turn") {
    endTurn();
  } else if (action.type === "move" && actor && action.to) {
    actor.position = { ...action.to };
    endTurn();
  } else if (action.type === "project" && actor && action.to) {
    next.pieces.push({
      id: nextUnitId(next, actor.owner),
      owner: actor.owner,
      kind: "unit",
      position: { ...action.to },
      supplied: true,
      commanded: true,
      displaySupplied: true,
      displayCommanded: true
    });
    endTurn();
  } else if (action.type === "rush" && actor && action.to) {
    actor.position = { ...action.to };
    if (!next.continuation || next.continuation.type !== "rush") {
      next.continuation = {
        type: "rush",
        owner: actor.owner,
        frozenOwner: actor.owner,
        frozenPieceStatesById: captureFrozenPieceStates2(state, actor.owner),
        rushedPieceIds: [actor.id],
        rushChainPieceIds: getRushChainMembers(next, actor.id),
        chainLength: 1
      };
    } else {
      const rushedPieceIds = new Set(next.continuation.rushedPieceIds ?? []);
      rushedPieceIds.add(actor.id);
      const rushChainPieceIds = new Set(next.continuation.rushChainPieceIds ?? []);
      for (const pieceId of getRushChainMembers(next, actor.id)) {
        rushChainPieceIds.add(pieceId);
      }
      next.continuation.rushedPieceIds = [...rushedPieceIds];
      next.continuation.rushChainPieceIds = [...rushChainPieceIds];
      next.continuation.chainLength += 1;
    }
  } else if (action.type === "push" && actor && action.to) {
    const origin = { ...actor.position };
    const pushingGroupPieceIds = localGroupMembers2(next, actor.id);
    const defender = next.pieces.find((candidate) => candidate.position.row === action.to?.row && candidate.position.col === action.to?.col);
    if (!defender) {
      throw new Error("Push defender not found");
    }
    actor.position = { ...action.to };
    actor.shifted = true;
    defender.position = { ...action.to };
    defender.pushed = true;
    defender.shifted = false;
    next.continuation = {
      type: "push",
      owner: defender.owner,
      attackerOwner: actor.owner,
      phase: "retreat",
      followPoint: origin,
      pushedPieceId: defender.id,
      followGroupPieceIds: pushingGroupPieceIds,
      frozenOwner: actor.owner,
      frozenPieceStatesById: captureFrozenPieceStates2(state, actor.owner),
      chainLength: 1
    };
    next.sideToMove = defender.owner;
    const retreatSquares = buildPushRetreatSuccessorActions(next);
    if (retreatSquares.length === 0) {
      reportRemoval(defender, "no_retreat", options?.onRemoval);
      next.pieces = next.pieces.filter((piece) => piece.id !== defender.id);
      next.continuation = {
        ...next.continuation,
        owner: actor.owner,
        phase: "follow",
        pushedPieceId: void 0
      };
      next.sideToMove = actor.owner;
    }
  } else if (action.type === "follow" && actor && action.to) {
    const origin = { ...actor.position };
    actor.position = { ...action.to };
    actor.shifted = true;
    if (next.continuation?.type === "push") {
      next.sideToMove = next.continuation.attackerOwner ?? actor.owner;
      next.continuation.phase = "follow";
      next.continuation.followPoint = origin;
      next.continuation.chainLength += 1;
    }
  } else if (action.type === "retreat" && actor && action.to) {
    actor.position = { ...action.to };
    actor.pushed = false;
    if (next.continuation?.type === "push") {
      next.sideToMove = next.continuation.attackerOwner ?? opponentOf(actor.owner);
      next.continuation.owner = next.sideToMove;
      next.continuation.phase = "follow";
      next.continuation.pushedPieceId = void 0;
    }
  } else {
    throw new Error(`Action type ${action.type} is not implemented yet`);
  }
  const nextState = normalizeState(next);
  return {
    state: nextState,
    outcome: nextState.outcome
  };
}

// apps/web/generated/packages/shared-types/src/sync-protocol.js
var LIVE_HISTORY = Object.freeze({ requestHeader: "X-Righelt-Projection", requestValue: "history-v1", socketQuery: "historyProjection", snapshotValue: "summary-v1" });
var SHARED_OPERATIONS = Object.freeze(["revert-request", "revert-approve", "revert-reject", "revert-rescind", "computer-control"]);
var SYNC_LIMITS = Object.freeze({ commandsPerRequest: 16, outstandingPerGame: 16, outstandingPerIdentity: 128, commandIdCharacters: 128, historyCacheEntries: 64, envelopeBytes: 64 * 1024, bodyBytes: 1024 * 1024 });
var SYNC_TIMING = Object.freeze({ requestTimeoutMs: 5e3, recoveryPassMs: 1e4, reconnectAlertMs: 4e3, confirmationBudgetMs: 15e3, degradedPollMs: 5e3, degradedSlowPollMs: 3e4, degradedSlowAfterMs: 6e4, heartbeatIntervalMs: 5e3, inboundTimeoutMs: 15e3, retryDelaysMs: Object.freeze([500, 1e3, 2e3, 4e3, 5e3]), maximumRetryAfterMs: 2147483647, retryJitter: 0.2 });

// apps/web/generated/packages/shared-types/src/computer-play.js
var COMPUTER_TIMING = Object.freeze({ phaseLabelAfterMs: 500, detailAfterMs: 5e3, saveNoticeAfterMs: 1e4, stalledAfterMs: 3e4, renewAfterMs: SYNC_TIMING.heartbeatIntervalMs, leaseMs: SYNC_TIMING.inboundTimeoutMs });
var COMPUTER_CAPABILITIES = Object.freeze({ resumeHere: "resume-here-v1" });
var COMPUTER_LIMITS = Object.freeze({ cachedModels: 2, historyPage: 100, attemptPage: 20, checkpointEvery: 50, noteCharacters: 2e3, attemptBytes: 256 * 1024 });
var COMPUTER_PROFILES = Object.freeze({
  babs: Object.freeze({ name: "Babs", version: "experimental-v1", simulations: 8, temperature: 1, maxValueGap: 0.1 }),
  tau: Object.freeze({ name: "Tau", version: "experimental-v1", simulations: 32, temperature: 0.5, maxValueGap: 0.05 }),
  horus: Object.freeze({ name: "Horus", version: "experimental-v1", simulations: 128, temperature: 0.1, maxValueGap: 0.01 })
});
var LEGACY_COMPUTER_MODEL = Object.freeze({
  id: "initial-1554",
  sha256: "748fcc5e7346900ead62a241002c50ca1012ef8857c73c3eb71e308b955d0490",
  bytes: 411327,
  checkpoint: "04302e437e01868cc48a237df3c3e8621d84dade628511324b6a3e6e438d6291",
  url: "/computer/models/initial-1554.onnx",
  experimental: true
});
var CURRENT_COMPUTER_MODEL = Object.freeze({
  id: "trained-20261029-1086",
  sha256: "f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f",
  bytes: 322842,
  checkpoint: "fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44",
  url: "/computer/models/trained-20261029-1086.onnx",
  experimental: true
});
var LEGACY_COMPUTER_MODEL_ID = "initial-1554";
var COMPUTER_MODELS = Object.freeze({
  [LEGACY_COMPUTER_MODEL_ID]: LEGACY_COMPUTER_MODEL,
  [CURRENT_COMPUTER_MODEL.id]: CURRENT_COMPUTER_MODEL
});
function computerProfileFor(control, side, turnIndex) {
  return !control || control.manual || control.takeoverTurn === turnIndex ? null : control.seats[side === "P1" ? "p1" : "p2"];
}

// apps/web/generated/packages/shared-types/src/shell-live-turn.js
var getNextSeat = (seat) => seat === "Player 1" ? "Player 2" : "Player 1";
var getSideForSeat = (seat) => seat === "Player 1" ? "P1" : "P2";
var getControlSeatForTurn = (state, turnOwnerSeat) => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};
var clearTransientTurnFlags = (pieces) => (Array.isArray(pieces) ? pieces : []).map((piece) => ({
  ...piece,
  shifted: false,
  pushed: false
}));
var buildNextTurn = (activeTurn, endedAt) => {
  const nextSeat = getNextSeat(activeTurn.playerSeat);
  return {
    index: activeTurn.index + 1,
    startedAt: endedAt,
    endedAt: null,
    playerSeat: nextSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null
  };
};
var finalizeResolvedTurn = ({ state, activeTurn, endedAt, resolveToStability: resolveToStability2, onRemoval }) => {
  const nextTurn = buildNextTurn(activeTurn, endedAt);
  const nextState = resolveToStability2(
    {
      ...state,
      sideToMove: getSideForSeat(nextTurn.playerSeat),
      turnIndex: nextTurn.index,
      continuation: null,
      pieces: clearTransientTurnFlags(state?.pieces)
    },
    { artifactMode: "full", onRemoval }
  );
  return { nextState, nextTurn };
};

// apps/web/shell/optimistic-live.js
var clone = (value) => structuredClone(value);
var getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
var getSideToMoveSeat = (game) => game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2";
var getSeatIdentity = (game, seat) => seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null;
var PROJECTED_GAME_FIELDS = Object.freeze([
  "board",
  "moves",
  "turns",
  "updatedAt",
  "lastMoveAt",
  "currentTurn",
  "turnOwnerSeat",
  "controlSeat",
  "control",
  "legalActions",
  "pendingMoves",
  "pendingCommandCount",
  "liveCurrentSnapshot",
  "currentSnapshot",
  "computerTurn",
  "canRecordMove",
  "canEndTurn",
  "sharedMutationsBlocked"
]);
var completeTurn = (game, queuedAt, pendingMoves, operationId) => {
  const events = [];
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false, error: "turn_not_initialized" };
  }
  if (activeTurn.moveIndexes.length === 0 && !game.board.state.continuation) {
    return { ok: false, error: "turn_has_no_moves" };
  }
  const validation = validateAction(game.board.state, { type: "end_turn" });
  if (!validation.ok) return { ok: false, error: validation.code, validation };
  const closed = applyAction(game.board.state, { type: "end_turn" }).state;
  const endedAt = queuedAt;
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const { nextState, nextTurn } = finalizeResolvedTurn({
    state: closed,
    activeTurn,
    endedAt,
    resolveToStability,
    onRemoval: (event) => events.push(event)
  });
  const lastMove = [...game.moves, ...pendingMoves].reverse().find((move) => !move.undone && move.turnIndex === activeTurn.index);
  if (lastMove) {
    lastMove.snapshot = clone(nextState);
    lastMove.destroyedPieces = [...lastMove.destroyedPieces ?? [], ...destructionRecords(events, operationId)];
  }
  game.turns.push(nextTurn);
  game.board.state = nextState;
  game.updatedAt = endedAt;
  return { ok: true, nextTurn, events };
};
var buildPendingMoveEntry = ({ command, selectionSnapshot, snapshot, activeTurn, index }) => ({
  index,
  turnIndex: activeTurn.index,
  turnMoveIndex: activeTurn.moveIndexes.length - 1,
  actorSide: selectionSnapshot.sideToMove,
  at: command.queuedAt,
  notation: command.notation,
  action: clone(command.action),
  clientCommandId: command.clientCommandId,
  selectionSnapshot,
  snapshot,
  pending: true
});
var finalizeProjectedView = ({ authoritativeGame, workingGame, identityId, queue, pendingMoves, liveLegalActions }) => {
  const next = clone(workingGame);
  const activeTurn = getActiveTurn(next);
  const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
  const controlSeat = getControlSeatForTurn(next.board.state, turnOwnerSeat);
  const controlIdentity = getSeatIdentity(next, controlSeat);
  const turnOwnerIdentity = getSeatIdentity(next, turnOwnerSeat);
  const isPlayer = next.myRole === "Player 1" || next.myRole === "Player 2";
  next.turnOwnerSeat = turnOwnerSeat;
  next.controlSeat = controlSeat;
  next.control = controlSeat === turnOwnerSeat ? "turn-owner" : "opponent";
  next.currentTurn = activeTurn ? clone(activeTurn) : null;
  next.legalActions = liveLegalActions;
  next.pendingMoves = pendingMoves.map((move) => clone(move));
  next.pendingCommandCount = queue.length;
  next.liveCurrentSnapshot = clone(next.board.state);
  next.currentSnapshot = next.inHistoryMode ? authoritativeGame.currentSnapshot : clone(next.board.state);
  if (next.awaitingCreation) {
    next.sharedMutationsBlocked = true;
  }
  next.computerTurn = computerProfileFor(next.computer, getSideForSeat(controlSeat), activeTurn?.index ?? next.board.state.turnIndex ?? 0);
  next.canRecordMove = !next.awaitingCreation && !next.computerTurn && isPlayer && !next.inHistoryMode && controlIdentity === identityId && liveLegalActions.length > 0;
  next.canEndTurn = !next.computerTurn && isPlayer && !next.inHistoryMode && controlSeat === turnOwnerSeat && turnOwnerIdentity === identityId && validateAction(next.board.state, { type: "end_turn" }).ok;
  return next;
};
var projectOptimisticGame = ({ authoritativeGame, identityId, queue }) => {
  const workingGame = clone(authoritativeGame);
  workingGame.board = {
    ...workingGame.board ?? {},
    state: clone(authoritativeGame.board?.state ?? authoritativeGame.currentSnapshot)
  };
  const pendingMoves = [];
  const commandResults = /* @__PURE__ */ new Map();
  let liveLegalActions;
  for (const command of queue) {
    if (command.kind === "apply" && command.action?.type !== "end_turn") {
      const activeTurn = getActiveTurn(workingGame);
      if (!activeTurn) {
        return { ok: false, error: "turn_not_initialized", clientCommandId: command.clientCommandId };
      }
      const stable = resolveToStability(workingGame.board.state, { artifactMode: "full" });
      const validation = validateAction(stable, command.action);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.code || "invalid_action",
          validation,
          clientCommandId: command.clientCommandId
        };
      }
      const events = [];
      const onRemoval = (event) => events.push(event);
      const applied = applyAction(stable, command.action, { onRemoval });
      const nextStable = resolveToStability(applied.state, { artifactMode: "full", onRemoval });
      const turnSettled = nextStable.continuation == null;
      const finalizedTurn = turnSettled ? finalizeResolvedTurn({
        state: nextStable,
        activeTurn,
        endedAt: command.queuedAt,
        resolveToStability,
        onRemoval
      }) : null;
      const settledState = finalizedTurn?.nextState ?? nextStable;
      if (!turnSettled) {
        nextStable.sideToMove = getSideForSeat(getControlSeatForTurn(nextStable, activeTurn.playerSeat));
        nextStable.turnIndex = activeTurn.index;
      }
      activeTurn.moveIndexes.push(workingGame.moves.length + pendingMoves.length);
      activeTurn.lastMoveAt = command.queuedAt;
      workingGame.board.state = settledState;
      workingGame.lastMoveAt = command.queuedAt;
      workingGame.updatedAt = command.queuedAt;
      if (turnSettled) {
        activeTurn.endedAt = command.queuedAt;
        activeTurn.status = "complete";
        workingGame.turns.push(finalizedTurn.nextTurn);
      }
      const pendingMove = buildPendingMoveEntry({
        command,
        selectionSnapshot: stable,
        snapshot: settledState,
        activeTurn,
        index: workingGame.moves.length + pendingMoves.length
      });
      pendingMove.destroyedPieces = destructionRecords(events, command.clientCommandId);
      pendingMoves.push(pendingMove);
      liveLegalActions = listLegalActions(settledState);
      commandResults.set(command.clientCommandId, {
        accepted: true,
        state: clone(settledState),
        legalActions: liveLegalActions,
        removedPieces: removalNotices(events, command.clientCommandId),
        destroyedPieces: destructionRecords(events, command.clientCommandId),
        outcome: settledState.outcome ?? null
      });
      continue;
    }
    const ended = completeTurn(workingGame, command.queuedAt, pendingMoves, command.clientCommandId);
    if (!ended.ok) {
      return { ok: false, error: ended.error, clientCommandId: command.clientCommandId };
    }
    liveLegalActions = listLegalActions(workingGame.board.state);
    commandResults.set(command.clientCommandId, {
      accepted: true,
      removedPieces: removalNotices(ended.events, command.clientCommandId),
      destroyedPieces: destructionRecords(ended.events, command.clientCommandId),
      state: clone(workingGame.board.state),
      legalActions: liveLegalActions,
      outcome: workingGame.board.state.outcome ?? null
    });
  }
  const firstComputer = queue.findIndex((command) => Boolean(command.computer));
  const visibleGame = firstComputer < 0 ? finalizeProjectedView({
    authoritativeGame,
    workingGame,
    identityId,
    queue,
    pendingMoves,
    liveLegalActions: liveLegalActions ?? listLegalActions(workingGame.board.state)
  }) : projectOptimisticGame({ authoritativeGame, identityId, queue: queue.slice(0, firstComputer) }).game;
  return { ok: true, game: visibleGame, commandResults };
};

// apps/web/board/client-move-generation.js
var sameCoordinate2 = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);
var compareActions = (left, right) => {
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
var compareActionPreviews = (left, right) => {
  const actionOrder = compareActions(left, right);
  if (actionOrder !== 0) {
    return actionOrder;
  }
  if (left.legal !== right.legal) {
    return left.legal ? -1 : 1;
  }
  return String(left.blockedReason ?? "").localeCompare(String(right.blockedReason ?? ""));
};
var outOfBounds3 = (coord) => Boolean(coord) && (coord.row < 0 || coord.row >= BOARD_SIZE || coord.col < 0 || coord.col >= BOARD_SIZE);
var PROJECTED_PREVIEW_ID = "__projected_preview__";
var getPieceAt3 = (state, coord) => state?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null;
var hasPieceAt3 = (state, coord) => Boolean(getPieceAt3(state, coord));
var isOrthogonallyAdjacent3 = (from, to) => Math.abs(from.row - to.row) + Math.abs(from.col - to.col) === 1;
var isAnyAdjacent3 = (from, to) => {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
};
var isOrthogonalDistance2 = (from, to, distance) => {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta === distance && colDelta === 0 || rowDelta === 0 && colDelta === distance;
};
var isActivePiece2 = (piece) => piece.supplied && piece.commanded && !piece.pushed && !piece.shifted;
var getFrozenPieceState3 = (state, piece) => {
  if (state?.continuation?.frozenOwner !== piece.owner) {
    return null;
  }
  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
};
var isActivePieceInContext3 = (state, piece) => {
  const frozen = getFrozenPieceState3(state, piece);
  if (!frozen) {
    return isActivePiece2(piece);
  }
  return isActivePiece2({
    ...piece,
    supplied: frozen.supplied,
    commanded: frozen.commanded
  });
};
var coordinateKey4 = (row, col) => `${row},${col}`;
var sortedOrthogonalNeighbors4 = (row, col) => [
  { row: row - 1, col },
  { row: row + 1, col },
  { row, col: col - 1 },
  { row, col: col + 1 }
].filter((coord) => !outOfBounds3(coord)).sort((a, b) => a.row === b.row ? a.col - b.col : a.row - b.row);
var isClearOrthogonalLineForPieces3 = (a, b, occupied) => {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }
  if (a.row === b.row) {
    for (let col = Math.min(a.col, b.col) + 1; col < Math.max(a.col, b.col); col += 1) {
      if (occupied.has(coordinateKey4(a.row, col))) {
        return false;
      }
    }
    return true;
  }
  for (let row = Math.min(a.row, b.row) + 1; row < Math.max(a.row, b.row); row += 1) {
    if (occupied.has(coordinateKey4(row, a.col))) {
      return false;
    }
  }
  return true;
};
var buildCommandEdgesForPieces3 = (pieces) => {
  const occupied = new Map(pieces.map((piece) => [coordinateKey4(piece.position.row, piece.position.col), piece.id]));
  const edges = [];
  for (const owner of ["P1", "P2"]) {
    const ownPieces = pieces.filter((piece) => piece.owner === owner).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);
        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible = (a.position.row === b.position.row || a.position.col === b.position.col) && isClearOrthogonalLineForPieces3(a.position, b.position, occupied);
        if (!diagonalAllowed && !orthogonalVisible) {
          continue;
        }
        edges.push({
          owner,
          from: { ...a.position },
          to: { ...b.position }
        });
      }
    }
  }
  return edges;
};
var isCoordinateSuppliedForOwner2 = (pieces, owner, target) => {
  const enemyBlockedByEdge = /* @__PURE__ */ new Set();
  for (const edge of buildCommandEdgesForPieces3(pieces)) {
    if (edge.owner === owner) {
      continue;
    }
    if (edge.from.row === edge.to.row) {
      for (let col = Math.min(edge.from.col, edge.to.col) + 1; col < Math.max(edge.from.col, edge.to.col); col += 1) {
        enemyBlockedByEdge.add(coordinateKey4(edge.from.row, col));
      }
      continue;
    }
    if (edge.from.col === edge.to.col) {
      for (let row = Math.min(edge.from.row, edge.to.row) + 1; row < Math.max(edge.from.row, edge.to.row); row += 1) {
        enemyBlockedByEdge.add(coordinateKey4(row, edge.from.col));
      }
    }
  }
  const occupiedByCoordinate = new Map(pieces.map((piece) => [coordinateKey4(piece.position.row, piece.position.col), piece]));
  const supplyPoint = SUPPLY_POINTS[owner];
  const targetKey = coordinateKey4(target.row, target.col);
  const supplyKey = coordinateKey4(supplyPoint.row, supplyPoint.col);
  const isTraversable = (row, col) => {
    if (enemyBlockedByEdge.has(coordinateKey4(row, col))) {
      return false;
    }
    const occupant = occupiedByCoordinate.get(coordinateKey4(row, col));
    return !occupant || occupant.owner === owner;
  };
  if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
    return false;
  }
  const visited = /* @__PURE__ */ new Set([supplyKey]);
  const queue = [{ ...supplyPoint }];
  while (queue.length > 0) {
    const current3 = queue.shift();
    if (!current3) {
      break;
    }
    for (const next of sortedOrthogonalNeighbors4(current3.row, current3.col)) {
      const nextKey = coordinateKey4(next.row, next.col);
      if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
        continue;
      }
      visited.add(nextKey);
      queue.push(next);
    }
  }
  return visited.has(targetKey);
};
var wouldCoordinateBeSuppliedForOwner2 = (pieces, owner, destination) => isCoordinateSuppliedForOwner2(pieces, owner, destination);
var wouldBeSuppliedAfterRelocation2 = (state, actorId, owner, destination) => {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: piece.id === actorId ? { ...destination } : { ...piece.position }
  }));
  return wouldCoordinateBeSuppliedForOwner2(hypothetical, owner, destination);
};
var wouldProjectedPieceBeSupplied2 = (state, owner, destination) => {
  const hypothetical = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: { ...piece.position }
  }));
  hypothetical.push({ id: "__projected__", owner, position: { ...destination } });
  return wouldCoordinateBeSuppliedForOwner2(hypothetical, owner, destination);
};
var clonePieceForPreview = (piece) => ({
  ...piece,
  position: { ...piece.position }
});
var buildHypotheticalPiecesForPreview = (state, action, actor) => {
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
      shifted: false
    });
    return hypothetical;
  }
  if (action.type === "push") {
    const defender = getPieceAt3(state, action.to);
    return state.pieces.filter((piece) => piece.id !== defender?.id).map(
      (piece) => piece.id === actor.id ? {
        ...clonePieceForPreview(piece),
        position: { ...action.to },
        pushed: false
      } : clonePieceForPreview(piece)
    );
  }
  return state.pieces.map(
    (piece) => piece.id === actor.id ? {
      ...clonePieceForPreview(piece),
      position: { ...action.to },
      pushed: false
    } : clonePieceForPreview(piece)
  );
};
var buildPreviewPiece = (state, action) => {
  if (!state || ["pass", "end_turn"].includes(action?.type) || !action?.to) {
    return null;
  }
  const actor = resolveActor2(state, action);
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
    position: { ...previewPiece.position }
  };
};
var localGroupMembers3 = (state, pieceId) => {
  const seed = state?.pieces?.find((piece) => piece.id === pieceId);
  if (!seed) {
    return [];
  }
  const queue = [seed];
  const visited = /* @__PURE__ */ new Set([seed.id]);
  while (queue.length > 0) {
    const current3 = queue.shift();
    if (!current3) {
      break;
    }
    for (const candidate of state.pieces) {
      if (candidate.owner !== seed.owner || visited.has(candidate.id)) {
        continue;
      }
      if (isOrthogonallyAdjacent3(candidate.position, current3.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
};
var localGroupStrength2 = (state, pieceId) => localGroupMembers3(state, pieceId).length;
var canOfferPushForPiece = (state, pieceId) => localGroupStrength2(state, pieceId) >= 2;
var enemyAdjacentCount3 = (state, owner, center) => state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent3(piece.position, center)).length;
var resolveActor2 = (state, action) => {
  if (action.actorId) {
    return state.pieces.find((piece) => piece.id === action.actorId) ?? null;
  }
  if (action.from) {
    return getPieceAt3(state, action.from);
  }
  return null;
};
var validateContinuation2 = (state, action) => {
  if (!state.continuation) {
    return null;
  }
  if (action.type === "end_turn") return canCloseContinuationNow(state) ? null : { code: "CONTINUATION_REQUIRED" };
  if (state.continuation.type === "push") {
    if (state.continuation.phase === "retreat") {
      return action.type === "retreat" ? null : { code: "CONTINUATION_REQUIRED" };
    }
    return action.type === "follow" ? null : { code: "CONTINUATION_REQUIRED" };
  }
  if (state.continuation.type === "rush") {
    return action.type === "rush" || action.type === "end_turn" ? null : { code: "CONTINUATION_REQUIRED" };
  }
  return null;
};
var validateActionForPreview = (state, action) => {
  if (state?.outcome?.status !== "ongoing") {
    return { ok: false, code: "TERMINAL_GAME" };
  }
  if (outOfBounds3(action.from) || outOfBounds3(action.to)) {
    return { ok: false, code: "OUT_OF_BOUNDS" };
  }
  if (action.from && !hasPieceAt3(state, action.from)) {
    return { ok: false, code: "SOURCE_EMPTY" };
  }
  const continuationValidation = validateContinuation2(state, action);
  if (continuationValidation) {
    return { ok: false, code: continuationValidation.code };
  }
  if (action.type === "pass") return state.continuation ? { ok: false, code: "CONTINUATION_REQUIRED" } : { ok: true };
  if (action.type === "end_turn") {
    return state.continuation && canCloseContinuationNow(state) ? { ok: true } : { ok: false, code: "CONTINUATION_REQUIRED" };
  }
  const actor = resolveActor2(state, action);
  if (!actor) {
    return { ok: false, code: "INVALID_SHAPE" };
  }
  if (actor.owner !== state.sideToMove) {
    return { ok: false, code: "NOT_SIDE_TO_MOVE" };
  }
  if (action.from && !sameCoordinate2(action.from, actor.position)) {
    return { ok: false, code: "INVALID_SHAPE" };
  }
  if (action.type === "move") {
    if (actor.kind !== "commander" || !isActivePieceInContext3(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonallyAdjacent3(actor.position, action.to) || hasPieceAt3(state, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }
  if (action.type === "project") {
    if (!isActivePieceInContext3(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonalDistance2(actor.position, action.to, 2)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const midpoint = {
      row: (actor.position.row + action.to.row) / 2,
      col: (actor.position.col + action.to.col) / 2
    };
    if (hasPieceAt3(state, midpoint) || hasPieceAt3(state, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldProjectedPieceBeSupplied2(state, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }
  if (action.type === "rush") {
    if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!isActivePieceInContext3(state, actor)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isAnyAdjacent3(actor.position, action.to) || hasPieceAt3(state, action.to)) {
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
      const enemyA = getPieceAt3(state, coAdjacentA);
      const enemyB = getPieceAt3(state, coAdjacentB);
      if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
        return { ok: false, code: "RULE_VIOLATION" };
      }
    } else if (enemyAdjacentCount3(state, actor.owner, action.to) === 0) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!wouldBeSuppliedAfterRelocation2(state, actor.id, actor.owner, action.to)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }
  if (action.type === "push") {
    if (!isActivePieceInContext3(state, actor) || actor.pushed || actor.shifted) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!action.to || !isOrthogonallyAdjacent3(actor.position, action.to)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const defender = getPieceAt3(state, action.to);
    if (!defender || defender.owner === actor.owner) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const attackerStrength = localGroupStrength2(state, actor.id);
    const defenderStrength = localGroupStrength2(state, defender.id);
    if (attackerStrength <= defenderStrength) {
      return { ok: false, code: "PUSH_STRENGTH_TOO_WEAK" };
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }
  if (action.type === "follow") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (actor.shifted || !action.to || !sameCoordinate2(action.to, state.continuation.followPoint) || hasPieceAt3(state, state.continuation.followPoint) || Array.isArray(state.continuation.followGroupPieceIds) && state.continuation.followGroupPieceIds.length > 0 && !state.continuation.followGroupPieceIds.includes(actor.id) || !isOrthogonallyAdjacent3(actor.position, state.continuation.followPoint)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    const successor = buildContinuationSuccessorState(state, action);
    if (!isContinuationCompletable(successor)) {
      return { ok: false, code: "SUPPLY_DESTINATION_UNSUPPLIED" };
    }
    return { ok: true };
  }
  if (action.type === "retreat") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    if (!actor.pushed || actor.id !== state.continuation.pushedPieceId || !action.to || !isOrthogonallyAdjacent3(actor.position, action.to) || hasPieceAt3(state, action.to) || state.continuation.followPoint && sameCoordinate2(action.to, state.continuation.followPoint)) {
      return { ok: false, code: "RULE_VIOLATION" };
    }
    return { ok: true };
  }
  return { ok: false, code: "RULE_VIOLATION" };
};
var buildCandidateActions = (piece) => {
  const actions = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"];
  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        actions.push({
          type,
          actorId: piece.id,
          from: { ...piece.position },
          to: { row, col }
        });
      }
    }
  }
  return actions;
};
var listPieceMovesFromLegalActions = ({ state, legalActions, pieceId }) => {
  const piece = state?.pieces?.find((candidate) => candidate.id === pieceId);
  if (!piece || !Array.isArray(legalActions)) {
    return [];
  }
  const allowPush = canOfferPushForPiece(state, pieceId);
  return legalActions.filter((action) => {
    if (!action || ["pass", "end_turn"].includes(action.type)) {
      return false;
    }
    if (action.type === "push" && !allowPush) {
      return false;
    }
    if (action.actorId === pieceId) {
      return true;
    }
    return sameCoordinate2(action.from, piece.position);
  }).map((action) => structuredClone(action)).sort(compareActions);
};
var listPieceMovePreviews = ({ state, legalActions, pieceId }) => {
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
    if (validation.code === "SUPPLY_DESTINATION_UNSUPPLIED" || validation.code === "PUSH_STRENGTH_TOO_WEAK") {
      previews.push({
        ...structuredClone(action),
        legal: false,
        blockedReason: validation.code,
        previewPiece: buildPreviewPiece(state, action)
      });
    }
  }
  return previews.sort(compareActionPreviews);
};
var buildPieceMoveResponse = ({ state, legalActions, pieceId }) => {
  const actions = listPieceMovesFromLegalActions({ state, legalActions, pieceId });
  return {
    state,
    pieceId,
    actions,
    previewActions: listPieceMovePreviews({ state, legalActions, pieceId })
  };
};

// apps/web/board/rules-worker.js
self.onmessage = ({ data: { id, scope, type, input } }) => {
  try {
    const result = boundedEngineOperation(() => type === "project" ? projectOptimisticGame(input) : type === "previews" ? buildPieceMoveResponse(input) : type === "rush-guidance" ? analyzeRushSupplyGuidance(input) : type === "equivalent" ? equivalentGameStates(input.left, input.right) : (() => {
      throw new Error("unknown_rules_operation");
    })());
    self.postMessage({ id, scope, type, result });
  } catch (error) {
    self.postMessage({ id, scope, type, error: { message: error.message, code: error.code } });
  }
};
