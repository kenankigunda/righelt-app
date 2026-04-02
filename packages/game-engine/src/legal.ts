import type { Action, GameState, Piece, ValidationResult } from "./types";
import { BOARD_SIZE, SUPPLY_POINTS } from "./deterministic";

function outOfBounds(value: { row: number; col: number } | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}

function getPieceAt(state: GameState, value: { row: number; col: number }) {
  return state.pieces.find((piece) => piece.position.row === value.row && piece.position.col === value.col);
}

function hasPieceAt(state: GameState, value: { row: number; col: number }): boolean {
  return Boolean(getPieceAt(state, value));
}

function sameCoordinate(
  left: { row: number; col: number } | undefined,
  right: { row: number; col: number } | undefined,
): boolean {
  return Boolean(left && right && left.row === right.row && left.col === right.col);
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

function isOrthogonalDistance(
  from: { row: number; col: number },
  to: { row: number; col: number },
  distance: number,
) {
  const rowDelta = Math.abs(from.row - to.row);
  const colDelta = Math.abs(from.col - to.col);
  return (rowDelta === distance && colDelta === 0) || (rowDelta === 0 && colDelta === distance);
}

function isActivePiece(piece: { supplied: boolean; commanded: boolean; pushed?: boolean; shifted?: boolean }) {
  return piece.supplied && piece.commanded && !piece.pushed && !piece.shifted;
}

function getFrozenPieceState(state: GameState, piece: Piece) {
  if (state.continuation?.frozenOwner !== piece.owner) {
    return null;
  }

  return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
}

function isActivePieceInContext(state: GameState, piece: Piece) {
  const frozen = getFrozenPieceState(state, piece);
  if (!frozen) {
    return isActivePiece(piece);
  }

  return isActivePiece({
    ...piece,
    supplied: frozen.supplied,
    commanded: frozen.commanded,
  });
}

type PieceForSupplyCheck = {
  id: string;
  owner: "P1" | "P2";
  position: { row: number; col: number };
};

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

function isCoordinateSuppliedForOwner(
  pieces: PieceForSupplyCheck[],
  owner: "P1" | "P2",
  target: { row: number; col: number },
): boolean {
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
  const targetKey = coordinateKey(target.row, target.col);
  const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);

  const isTraversable = (row: number, col: number): boolean => {
    if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
      return false;
    }
    const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
    return !occupant || occupant.owner === owner;
  };

  const visited = new Set<string>();
  if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
    return false;
  }
  visited.add(supplyKey);
  const queue: { row: number; col: number }[] = [{ ...supplyPoint }];

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
}

function wouldCoordinateBeSuppliedForOwner(
  pieces: PieceForSupplyCheck[],
  owner: "P1" | "P2",
  destination: { row: number; col: number },
) {
  return isCoordinateSuppliedForOwner(pieces, owner, destination);
}

function wouldBeSuppliedAfterRelocation(
  state: GameState,
  actorId: string,
  owner: "P1" | "P2",
  destination: { row: number; col: number },
): boolean {
  const hypothetical: PieceForSupplyCheck[] = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: piece.id === actorId ? { ...destination } : { ...piece.position },
  }));
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}

function wouldProjectedPieceBeSupplied(
  state: GameState,
  owner: "P1" | "P2",
  destination: { row: number; col: number },
): boolean {
  const hypothetical: PieceForSupplyCheck[] = state.pieces.map((piece) => ({
    id: piece.id,
    owner: piece.owner,
    position: { ...piece.position },
  }));
  hypothetical.push({
    id: "__projected__",
    owner,
    position: { ...destination },
  });
  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}

function wouldBeSuppliedAfterPush(
  state: GameState,
  actorId: string,
  defenderId: string,
  owner: "P1" | "P2",
  destination: { row: number; col: number },
): boolean {
  const hypothetical: PieceForSupplyCheck[] = state.pieces
    .filter((piece) => piece.id !== defenderId)
    .map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      position: piece.id === actorId ? { ...destination } : { ...piece.position },
    }));

  return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}

function resolveActor(state: GameState, action: Action) {
  if (action.actorId) {
    return state.pieces.find((piece) => piece.id === action.actorId);
  }
  if (action.from) {
    return getPieceAt(state, action.from);
  }
  return undefined;
}

function localGroupStrength(state: GameState, pieceId: string): number {
  return localGroupMembers(state, pieceId).length;
}

export function localGroupMembers(state: GameState, pieceId: string): string[] {
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

function enemyAdjacentCount(state: GameState, owner: "P1" | "P2", center: { row: number; col: number }): number {
  return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;
}

function getPushRetreatActions(state: GameState): Action[] {
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
  ].map((to) => ({
    type: "retreat" as const,
    actorId: pushedPiece.id,
    from: pushedPiece.position,
    to,
  })).filter((candidate) => validateAction(state, candidate).ok);
}

function getPushFollowActions(state: GameState): Action[] {
  if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
    return [];
  }

  const followPoint = state.continuation.followPoint;
  if (!followPoint) {
    return [];
  }

  const allowedPieces = new Set(state.continuation.followGroupPieceIds ?? []);
  return state.pieces
    .filter((piece) => piece.owner === state.sideToMove && (allowedPieces.size === 0 || allowedPieces.has(piece.id)))
    .map((piece) => ({
      type: "follow" as const,
      actorId: piece.id,
      from: piece.position,
      to: followPoint,
    }))
    .filter((candidate) => validateAction(state, candidate).ok);
}

function validateContinuation(state: GameState, action: Action): ValidationResult | null {
  if (!state.continuation) {
    return null;
  }

  if (state.continuation.type === "push") {
    if (state.continuation.phase === "retreat") {
      if (action.type !== "retreat") {
        return {
          ok: false,
          code: "CONTINUATION_REQUIRED",
          message: "Push retreat phase requires retreat action",
        };
      }
      return null;
    }

    if (action.type !== "follow") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Push follow phase requires follow action",
      };
    }
    return null;
  }

  if (state.continuation.type === "rush") {
    if (action.type !== "rush" && action.type !== "pass") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Rush continuation requires rush or pass",
      };
    }
  }

  return null;
}

export function listLegalActions(state: GameState): Action[] {
  if (state.outcome.status !== "ongoing") {
    return [];
  }

  if (state.continuation) {
    if (state.continuation.type === "rush") {
      const rushActions = state.pieces
        .filter((piece) => piece.owner === state.sideToMove)
        .flatMap((piece) => {
          const actions: Action[] = [];
          for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
            for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
              if (rowDelta === 0 && colDelta === 0) {
                continue;
              }
              actions.push({
                type: "rush",
                actorId: piece.id,
                from: piece.position,
                to: {
                  row: piece.position.row + rowDelta,
                  col: piece.position.col + colDelta,
                },
              });
            }
          }
          return actions.filter((candidate) => validateAction(state, candidate).ok);
        });
      return [...rushActions, { type: "pass" }];
    }

    return state.continuation.phase === "retreat" ? getPushRetreatActions(state) : getPushFollowActions(state);
  }

  const actions: Action[] = [{ type: "pass" }];
  const withTargets = ["move", "project", "rush", "push"] as const;

  for (const piece of state.pieces.filter((candidate) => candidate.owner === state.sideToMove)) {
    for (const type of withTargets) {
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          const action: Action = {
            type,
            actorId: piece.id,
            from: { ...piece.position },
            to: { row, col },
          };
          if (validateAction(state, action).ok) {
            actions.push(action);
          }
        }
      }
    }
  }

  return actions;
}

export function validateAction(state: GameState, action: Action): ValidationResult {
  if (state.outcome.status !== "ongoing") {
    return {
      ok: false,
      code: "TERMINAL_GAME",
      message: "No actions are legal after terminal outcome",
    };
  }

  if (outOfBounds(action.from) || outOfBounds(action.to)) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      message: "Action coordinates must be inside board bounds",
    };
  }

  if (action.from && !hasPieceAt(state, action.from)) {
    return {
      ok: false,
      code: "SOURCE_EMPTY",
      message: "No piece exists at action source coordinate",
    };
  }

  const continuationValidation = validateContinuation(state, action);
  if (continuationValidation) {
    return continuationValidation;
  }

  if (action.type === "pass") {
    if (state.continuation && state.continuation.type !== "rush") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Pass is not legal while continuation is active",
      };
    }
    return { ok: true };
  }

  const actor = resolveActor(state, action);
  if (!actor) {
    return {
      ok: false,
      code: "INVALID_SHAPE",
      message: "Action must identify an actor by actorId or from",
    };
  }

  if (actor.owner !== state.sideToMove) {
    return {
      ok: false,
      code: "NOT_SIDE_TO_MOVE",
      message: "Actor is not owned by side to move",
    };
  }

  if (action.from && !sameCoordinate(action.from, actor.position)) {
    return {
      ok: false,
      code: "INVALID_SHAPE",
      message: "Action from coordinate does not match actor position",
    };
  }

  if (action.type === "move") {
    if (actor.kind !== "commander") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move is legal only for commanders",
      };
    }
    if (!isActivePieceInContext(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive commander cannot move",
      };
    }
    if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move destination must be an orthogonally adjacent square",
      };
    }
    if (hasPieceAt(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Move destination is occupied",
      };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Move destination would be unsupplied",
      };
    }
    return { ok: true };
  }

  if (action.type === "project") {
    if (!isActivePieceInContext(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive piece cannot project",
      };
    }
    if (!action.to || !isOrthogonalDistance(actor.position, action.to, 2)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Project destination must be exactly 2 orthogonal squares away",
      };
    }
    const midpoint = {
      row: (actor.position.row + action.to.row) / 2,
      col: (actor.position.col + action.to.col) / 2,
    };
    if (hasPieceAt(state, midpoint) || hasPieceAt(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Project path and destination must be empty",
      };
    }
    if (!wouldProjectedPieceBeSupplied(state, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Project destination would be unsupplied",
      };
    }
    return { ok: true };
  }

  if (action.type === "rush") {
    if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Piece may only rush once per rush sequence",
      };
    }
    if (!isActivePieceInContext(state, actor)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Inactive piece cannot rush",
      };
    }
    if (!action.to || !isAnyAdjacent(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Rush destination must be one square away",
      };
    }
    if (hasPieceAt(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Rush destination is occupied",
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
          message: "Pushed piece cannot diagonal-rush",
        };
      }

      const coAdjacentA = { row: actor.position.row + rowDelta, col: actor.position.col };
      const coAdjacentB = { row: actor.position.row, col: actor.position.col + colDelta };
      const enemyA = getPieceAt(state, coAdjacentA);
      const enemyB = getPieceAt(state, coAdjacentB);
      if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
        return {
          ok: false,
          code: "RULE_VIOLATION",
          message: "Diagonal rush requires enemy in a co-adjacent square",
        };
      }
    } else {
      if (enemyAdjacentCount(state, actor.owner, action.to) === 0) {
        return {
          ok: false,
          code: "RULE_VIOLATION",
          message: "Orthogonal rush destination must be adjacent to at least one enemy",
        };
      }
    }

    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Rush destination would be unsupplied",
      };
    }

    return { ok: true };
  }

  if (action.type === "push") {
    if (!isActivePieceInContext(state, actor) || actor.pushed || actor.shifted) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Actor cannot push in current temporary state",
      };
    }
    if (!action.to) {
      return {
        ok: false,
        code: "INVALID_SHAPE",
        message: "Push requires target coordinate",
      };
    }
    if (!isOrthogonallyAdjacent(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must be an orthogonally adjacent square",
      };
    }
    const defender = getPieceAt(state, action.to);
    if (!defender || defender.owner === actor.owner) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must contain an orthogonally adjacent enemy piece",
      };
    }

    const attackerStrength = localGroupStrength(state, actor.id);
    const defenderStrength = localGroupStrength(state, defender.id);
    if (attackerStrength <= defenderStrength) {
      return {
        ok: false,
        code: "PUSH_STRENGTH_TOO_WEAK",
        message: "Push requires strictly greater attacker group strength",
      };
    }
    if (!wouldBeSuppliedAfterPush(state, actor.id, defender.id, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Push destination would be unsupplied",
      };
    }
    return { ok: true };
  }

  if (action.type === "follow") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow is only legal during push follow phase",
      };
    }
    if (actor.shifted) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor already shifted in this continuation",
      };
    }
    if (!state.continuation.followPoint || !action.to || !sameCoordinate(action.to, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow destination must be current follow-point",
      };
    }
    if (hasPieceAt(state, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow-point must be empty",
      };
    }
    if (
      Array.isArray(state.continuation.followGroupPieceIds) &&
      state.continuation.followGroupPieceIds.length > 0 &&
      !state.continuation.followGroupPieceIds.includes(actor.id)
    ) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor must belong to the pushing group",
      };
    }
    if (!isOrthogonallyAdjacent(actor.position, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow actor must be orthogonally adjacent to current follow-point",
      };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Follow destination would be unsupplied",
      };
    }
    return { ok: true };
  }

  if (action.type === "retreat") {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat is only legal during push retreat phase",
      };
    }
    if (!actor.pushed || actor.id !== state.continuation.pushedPieceId) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Only the pushed piece may retreat",
      };
    }
    if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination must be orthogonally adjacent",
      };
    }
    if (hasPieceAt(state, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination is occupied",
      };
    }
    if (state.continuation.followPoint && sameCoordinate(action.to, state.continuation.followPoint)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Retreat destination cannot be the reserved follow-point",
      };
    }
    if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
      return {
        ok: false,
        code: "SUPPLY_DESTINATION_UNSUPPLIED",
        message: "Retreat destination would be unsupplied",
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    code: "RULE_VIOLATION",
    message: "Unsupported action type",
  };
}
