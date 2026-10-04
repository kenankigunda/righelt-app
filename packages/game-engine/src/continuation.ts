import { checkEngineComputation, isEngineComputationObserved, observeEngineComputation } from "./computation-guard";
import type { Action, ContinuationContext, GameState, Piece } from "./types";
import { BOARD_SIZE, SUPPLY_POINTS, normalizeState } from "./deterministic";

type SearchMemoState = "visiting" | "success" | "failure";

type PieceForSupplyCheck = {
  id: string;
  owner: "P1" | "P2";
  position: { row: number; col: number };
};

function cloneState(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({
      ...piece,
      position: { ...piece.position },
    })),
    continuation: state.continuation
      ? {
          ...state.continuation,
          followPoint: state.continuation.followPoint ? { ...state.continuation.followPoint } : undefined,
          followGroupPieceIds: state.continuation.followGroupPieceIds ? [...state.continuation.followGroupPieceIds] : undefined,
          rushedPieceIds: state.continuation.rushedPieceIds ? [...state.continuation.rushedPieceIds] : undefined,
          rushChainPieceIds: state.continuation.rushChainPieceIds ? [...state.continuation.rushChainPieceIds] : undefined,
          frozenPieceStatesById: state.continuation.frozenPieceStatesById
            ? Object.fromEntries(
                Object.entries(state.continuation.frozenPieceStatesById).map(([pieceId, frozenState]) => [
                  pieceId,
                  { ...frozenState },
                ]),
              )
            : undefined,
        }
      : null,
    outcome: { ...state.outcome },
    artifacts: undefined,
  };
}

function outOfBounds(value: { row: number; col: number } | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}

function coordinateKey(row: number, col: number): string {
  return `${row},${col}`;
}

function sortedOrthogonalNeighbors(row: number, col: number): { row: number; col: number }[] {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ]
    .filter((next) => !outOfBounds(next))
    .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
}

function isOrthogonallyAdjacent(from: { row: number; col: number }, to: { row: number; col: number }) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta + colDelta === 1;
}

function isAnyAdjacent(from: { row: number; col: number }, to: { row: number; col: number }) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
}

function isClearOrthogonalLineForPieces(
  a: { row: number; col: number },
  b: { row: number; col: number },
  occupied: Map<string, string>,
): boolean {
  if (a.row !== b.row && a.col !== b.col) {
    return false;
  }

  if (a.row === b.row) {
    const start = Math.min(a.col, b.col) + 1;
    const end = Math.max(a.col, b.col);
    for (let col = start; col < end; col += 1) {
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

function buildCommandEdgesForPieces(pieces: PieceForSupplyCheck[]) {
  const occupied = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
  const edges: {
    owner: "P1" | "P2";
    from: { row: number; col: number };
    to: { row: number; col: number };
  }[] = [];

  for (const owner of ["P1", "P2"] as const) {
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
}

function buildSupplyCheckPieces(state: GameState): PieceForSupplyCheck[] {
  return state.pieces
    .filter((piece) => !piece.pushed)
    .map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      position: { ...piece.position },
    }));
}

function computeLiveSuppliedPieceIds(state: GameState, owner: "P1" | "P2"): Set<string> {
  const observed = isEngineComputationObserved();
  if (observed) observeEngineComputation({ type: "supply-start" });
  try {
    const pieces = buildSupplyCheckPieces(state);
    const enemyBlockedByEdge = new Set<string>();
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

    const isTraversable = (row: number, col: number): boolean => {
      if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
        return false;
      }
      const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
      return !occupant || occupant.owner === owner;
    };

    if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
      return new Set<string>();
    }

    const reachableCoordinates = new Set<string>([supplyKey]);
    const queue: { row: number; col: number }[] = [{ ...supplyPoint }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      for (const next of sortedOrthogonalNeighbors(current.row, current.col)) {
        const nextKey = coordinateKey(next.row, next.col);
        if (reachableCoordinates.has(nextKey) || !isTraversable(next.row, next.col)) {
          continue;
        }
        reachableCoordinates.add(nextKey);
        queue.push(next);
      }
    }

    const supplied = new Set<string>();
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
    if (observed) observeEngineComputation({ type: "supply-end" });
  }
}

function getPieceAt(state: GameState, value: { row: number; col: number }) {
  return state.pieces.find((piece) => piece.position.row === value.row && piece.position.col === value.col);
}

function hasPieceAt(state: GameState, value: { row: number; col: number }): boolean {
  return Boolean(getPieceAt(state, value));
}

function getFrozenPieceState(state: GameState, piece: Piece) {
  if (state.continuation?.frozenOwner !== piece.owner) {
    return null;
  }
  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
}

function isActivePieceInContext(state: GameState, piece: Piece) {
  const frozen = getFrozenPieceState(state, piece);
  const supplied = frozen?.supplied ?? piece.supplied;
  const commanded = frozen?.commanded ?? piece.commanded;
  return supplied && commanded && !piece.pushed && !piece.shifted;
}

function enemyAdjacentCount(state: GameState, owner: "P1" | "P2", center: { row: number; col: number }): number {
  return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;
}

function localGroupMembers(state: GameState, pieceId: string): string[] {
  const seed = state.pieces.find((piece) => piece.id === pieceId);
  if (!seed) {
    return [];
  }

  const queue = [seed];
  const visited = new Set<string>([seed.id]);

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
}

function captureFrozenPieceStates(state: GameState, owner: "P1" | "P2") {
  return Object.fromEntries(
    state.pieces
      .filter((piece) => piece.owner === owner)
      .map((piece) => [
        piece.id,
        {
          supplied: piece.supplied,
          commanded: piece.commanded,
        },
      ]),
  );
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function getRushChainMembers(state: GameState, actorId: string): string[] {
  const actor = state.pieces.find((piece) => piece.id === actorId && !piece.pushed);
  if (!actor) {
    return [];
  }

  const queue = [actor];
  const visited = new Set<string>([actor.id]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const candidate of state.pieces) {
      if (candidate.owner !== actor.owner || candidate.pushed || visited.has(candidate.id)) {
        continue;
      }
      if (isAnyAdjacent(candidate.position, current.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return [...visited].sort((a, b) => a.localeCompare(b));
}

function obligationPieceIdsForContinuation(state: GameState): string[] {
  if (!state.continuation) {
    return [];
  }

  const obligationIds =
    state.continuation.type === "push"
      ? state.continuation.followGroupPieceIds ?? []
      : state.continuation.rushChainPieceIds ?? [];

  const presentPieceIds = new Set(state.pieces.map((piece) => piece.id));
  return sortedUnique(obligationIds.filter((pieceId) => presentPieceIds.has(pieceId)));
}

function obligationOwner(state: GameState): "P1" | "P2" | null {
  if (!state.continuation) {
    return null;
  }
  return state.continuation.type === "push"
    ? state.continuation.attackerOwner ?? state.continuation.owner ?? null
    : state.continuation.owner;
}

function compareBlockerPieces(left: Piece, right: Piece): number {
  if (left.position.row !== right.position.row) {
    return left.position.row - right.position.row;
  }
  if (left.position.col !== right.position.col) {
    return left.position.col - right.position.col;
  }
  return left.id.localeCompare(right.id);
}

export function getRushContinuationBlockingPiece(state: GameState): Piece | null {
  if (!state.continuation || state.continuation.type !== "rush") {
    return null;
  }

  const owner = obligationOwner(state);
  if (!owner) {
    return null;
  }

  const obligationPieceIds = obligationPieceIdsForContinuation(state);
  if (obligationPieceIds.length === 0) {
    return null;
  }

  const suppliedIds = computeLiveSuppliedPieceIds(state, owner);
  const unsuppliedBlockers = obligationPieceIds
    .filter((pieceId) => !suppliedIds.has(pieceId))
    .map((pieceId) => state.pieces.find((piece) => piece.id === pieceId) ?? null)
    .filter((piece): piece is Piece => Boolean(piece));

  if (unsuppliedBlockers.length === 0) {
    return null;
  }

  const rushedPieceIds = state.continuation.rushedPieceIds ?? [];
  for (let index = rushedPieceIds.length - 1; index >= 0; index -= 1) {
    const blocker = unsuppliedBlockers.find((piece) => piece.id === rushedPieceIds[index]);
    if (blocker) {
      return blocker;
    }
  }

  return [...unsuppliedBlockers].sort(compareBlockerPieces)[0] ?? null;
}

function areObligationPiecesSupplied(state: GameState): boolean {
  const owner = obligationOwner(state);
  if (!owner) {
    return false;
  }
  const obligationPieceIds = obligationPieceIdsForContinuation(state);
  const suppliedIds = computeLiveSuppliedPieceIds(state, owner);
  return obligationPieceIds.every((pieceId) => suppliedIds.has(pieceId));
}

function pushFollowPointOccupied(state: GameState, continuation: ContinuationContext): boolean {
  if (!continuation.followPoint) {
    return false;
  }
  return state.pieces.some(
    (piece) =>
      !piece.pushed &&
      piece.position.row === continuation.followPoint?.row &&
      piece.position.col === continuation.followPoint?.col,
  );
}

function validateRushBase(state: GameState, actor: Piece, action: Action): boolean {
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

function validateRetreatBase(state: GameState, actor: Piece, action: Action): boolean {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    return false;
  }
  if (!actor.pushed || actor.id !== state.continuation.pushedPieceId) {
    return false;
  }
  if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to) || hasPieceAt(state, action.to)) {
    return false;
  }
  if (
    state.continuation.followPoint &&
    action.to.row === state.continuation.followPoint.row &&
    action.to.col === state.continuation.followPoint.col
  ) {
    return false;
  }
  return true;
}

function validateFollowBase(state: GameState, actor: Piece, action: Action): boolean {
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
  if (
    Array.isArray(state.continuation.followGroupPieceIds) &&
    state.continuation.followGroupPieceIds.length > 0 &&
    !state.continuation.followGroupPieceIds.includes(actor.id)
  ) {
    return false;
  }
  return isOrthogonallyAdjacent(actor.position, followPoint);
}

function buildRushSuccessorActions(state: GameState): Action[] {
  return state.pieces
    .filter((piece) => piece.owner === state.sideToMove)
    .flatMap((piece) => {
      const actions: Action[] = [];
      for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
        for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
          if (rowDelta === 0 && colDelta === 0) {
            continue;
          }
          const action: Action = {
            type: "rush",
            actorId: piece.id,
            from: { ...piece.position },
            to: {
              row: piece.position.row + rowDelta,
              col: piece.position.col + colDelta,
            },
          };
          if (!outOfBounds(action.to) && validateRushBase(state, piece, action)) {
            actions.push(action);
          }
        }
      }
      return actions;
    });
}

function buildPushRetreatSuccessorActions(state: GameState): Action[] {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    return [];
  }

  const pushedPiece = state.continuation.pushedPieceId
    ? state.pieces.find((piece) => piece.id === state.continuation?.pushedPieceId)
    : undefined;
  if (!pushedPiece) {
    return [];
  }

  return [
    { row: pushedPiece.position.row - 1, col: pushedPiece.position.col },
    { row: pushedPiece.position.row + 1, col: pushedPiece.position.col },
    { row: pushedPiece.position.row, col: pushedPiece.position.col - 1 },
    { row: pushedPiece.position.row, col: pushedPiece.position.col + 1 },
  ]
    .filter((to) => !outOfBounds(to))
    .map((to) => ({
      type: "retreat" as const,
      actorId: pushedPiece.id,
      from: { ...pushedPiece.position },
      to,
    }))
    .filter((action) => validateRetreatBase(state, pushedPiece, action));
}

function buildPushFollowSuccessorActions(state: GameState): Action[] {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
    return [];
  }

  return state.pieces
    .filter((piece) => piece.owner === state.sideToMove)
    .map((piece) => ({
      type: "follow" as const,
      actorId: piece.id,
      from: { ...piece.position },
      to: state.continuation?.followPoint ? { ...state.continuation.followPoint } : undefined,
    }))
    .filter((action) => {
      const actor = action.actorId ? state.pieces.find((piece) => piece.id === action.actorId) : undefined;
      return Boolean(actor && validateFollowBase(state, actor, action));
    });
}

function closePushContinuation(state: GameState, attackerOwner: "P1" | "P2") {
  state.continuation = null;
  state.sideToMove = attackerOwner === "P1" ? "P2" : "P1";
  state.turnIndex += 1;
  for (const piece of state.pieces) {
    if (piece.shifted) {
      piece.shifted = false;
    }
  }
}

export function buildContinuationSuccessorState(state: GameState, action: Action): GameState {
  checkEngineComputation(true);
  if (isEngineComputationObserved()) observeEngineComputation({ type: "successor" });
  const next = cloneState(state);
  const actor = action.actorId ? next.pieces.find((piece) => piece.id === action.actorId) : undefined;

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
      chainLength: (state.continuation?.chainLength ?? 0) + 1,
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
        chainLength: 1,
      };
    } else {
      const rushedPieceIds = sortedUnique([...(next.continuation.rushedPieceIds ?? []), actor.id]);
      const rushChainPieceIds = sortedUnique([
        ...(next.continuation.rushChainPieceIds ?? []),
        ...getRushChainMembers(next, actor.id),
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
    next.continuation.pushedPieceId = undefined;
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

function* advanceForcedRetreatIfNeeded(state: GameState): Generator<GameState> {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
    yield state; return;
  }

  const retreatActions = buildPushRetreatSuccessorActions(state);
  if (retreatActions.length > 0) {
    for (const action of retreatActions) yield buildContinuationSuccessorState(state, action);
    return;
  }

  const next = cloneState(state);
  const continuation = next.continuation;
  if (!continuation || continuation.type !== "push") {
    yield normalizeState(next); return;
  }
  const attackerOwner = continuation.attackerOwner ?? next.sideToMove;
  if (continuation.pushedPieceId) {
    next.pieces = next.pieces.filter((piece) => piece.id !== continuation.pushedPieceId);
  }
  continuation.phase = "follow";
  continuation.owner = attackerOwner;
  continuation.pushedPieceId = undefined;
  next.sideToMove = attackerOwner;
  yield normalizeState(next);
}

function* buildSuccessorStates(state: GameState): Generator<GameState> {
  if (!state.continuation) return;
  if (state.continuation.type === "push" && state.continuation.phase === "retreat") {
    yield* advanceForcedRetreatIfNeeded(state);
    return;
  }
  const actions = state.continuation.type === "push"
    ? buildPushFollowSuccessorActions(state) : buildRushSuccessorActions(state);
  // Preserve authoritative action order while materializing only successors
  // actually visited by the existential completion check.
  for (const action of actions) yield buildContinuationSuccessorState(state, action);
}

export function canCloseContinuationNow(state: GameState): boolean {
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

function continuationSearchKey(state: GameState): string {
  return JSON.stringify({
    sideToMove: state.sideToMove,
    continuation: {
      type: state.continuation?.type ?? null,
      owner: state.continuation?.owner ?? null,
      attackerOwner: state.continuation?.attackerOwner ?? null,
      phase: state.continuation?.phase ?? null,
      followPoint: state.continuation?.followPoint ?? null,
      pushedPieceId: state.continuation?.pushedPieceId ?? null,
      followGroupPieceIds: [...(state.continuation?.followGroupPieceIds ?? [])].sort((a, b) => a.localeCompare(b)),
      rushedPieceIds: [...(state.continuation?.rushedPieceIds ?? [])].sort((a, b) => a.localeCompare(b)),
      rushChainPieceIds: [...(state.continuation?.rushChainPieceIds ?? [])].sort((a, b) => a.localeCompare(b)),
    },
    pieces: state.pieces
      .map((piece) => ({
        id: piece.id,
        owner: piece.owner,
        kind: piece.kind,
        position: piece.position,
        pushed: Boolean(piece.pushed),
        shifted: Boolean(piece.shifted),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function isContinuationCompletable(state: GameState, memo = new Map<string, SearchMemoState>()): boolean {
  checkEngineComputation(Boolean(state.continuation));
  if (!state.continuation) {
    return true;
  }

  const normalized = normalizeState(state);
  const key = continuationSearchKey(normalized);
  if (isEngineComputationObserved()) observeEngineComputation({ type: "continuation-key", key });
  const existing = memo.get(key);
  if (existing !== undefined && isEngineComputationObserved()) observeEngineComputation({ type: "memo-hit", key });
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

    for (const successor of buildSuccessorStates(normalized)) {
      if (isContinuationCompletable(successor, memo)) {
        memo.set(key, "success");
        return true;
      }
    }

    memo.set(key, "failure");
    return false;
  } catch (error) {
    // Resource interruption proves nothing; never retain a visiting marker.
    memo.delete(key);
    throw error;
  }
}
