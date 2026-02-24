import type { Action, GameState, ValidationResult } from "./types";
import { BOARD_SIZE } from "./deterministic";

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

function resolveActor(state: GameState, action: Action) {
  if (action.actorId) {
    return state.pieces.find((piece) => piece.id === action.actorId);
  }
  if (action.from) {
    return getPieceAt(state, action.from);
  }
  return undefined;
}

function getOrthogonalDirection(
  from: { row: number; col: number },
  to: { row: number; col: number },
): { row: number; col: number } | undefined {
  if (from.row === to.row && from.col !== to.col) {
    return { row: 0, col: Math.sign(to.col - from.col) };
  }
  if (from.col === to.col && from.row !== to.row) {
    return { row: Math.sign(to.row - from.row), col: 0 };
  }
  return undefined;
}

function firstOccupiedOnRay(
  state: GameState,
  from: { row: number; col: number },
  direction: { row: number; col: number },
) {
  let row = from.row + direction.row;
  let col = from.col + direction.col;

  while (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
    const piece = getPieceAt(state, { row, col });
    if (piece) {
      return piece;
    }
    row += direction.row;
    col += direction.col;
  }

  return undefined;
}

function localGroupStrength(state: GameState, pieceId: string): number {
  const seed = state.pieces.find((piece) => piece.id === pieceId);
  if (!seed) {
    return 0;
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
      if (isAnyAdjacent(candidate.position, current.position)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return visited.size;
}

function enemyAdjacentCount(state: GameState, owner: "P1" | "P2", center: { row: number; col: number }): number {
  return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;
}

function validateContinuation(state: GameState, action: Action): ValidationResult | null {
  if (!state.continuation) {
    return null;
  }

  if (state.continuation.type === "push") {
    if (action.type !== "follow" && action.type !== "retreat") {
      return {
        ok: false,
        code: "CONTINUATION_REQUIRED",
        message: "Push continuation requires follow or retreat actions",
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

    return state.pieces
      .flatMap((piece) => [
        {
          type: "follow" as const,
          actorId: piece.id,
          from: piece.position,
          to: state.continuation?.followPoint,
        },
        {
          type: "retreat" as const,
          actorId: piece.id,
          from: piece.position,
          to: {
            row: piece.position.row - 1,
            col: piece.position.col,
          },
        },
        {
          type: "retreat" as const,
          actorId: piece.id,
          from: piece.position,
          to: {
            row: piece.position.row + 1,
            col: piece.position.col,
          },
        },
        {
          type: "retreat" as const,
          actorId: piece.id,
          from: piece.position,
          to: {
            row: piece.position.row,
            col: piece.position.col - 1,
          },
        },
        {
          type: "retreat" as const,
          actorId: piece.id,
          from: piece.position,
          to: {
            row: piece.position.row,
            col: piece.position.col + 1,
          },
        },
      ])
      .filter((candidate) => validateAction(state, candidate).ok);
  }

  return [{ type: "pass" }];
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
    if (!isActivePiece(actor)) {
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
    return { ok: true };
  }

  if (action.type === "project") {
    if (!isActivePiece(actor)) {
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
    if (!isActivePiece(actor)) {
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

    return { ok: true };
  }

  if (action.type === "push") {
    if (!isActivePiece(actor) || actor.pushed || actor.shifted) {
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
    const direction = getOrthogonalDirection(actor.position, action.to);
    if (!direction) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must be on an orthogonal ray",
      };
    }
    const firstOccupied = firstOccupiedOnRay(state, actor.position, direction);
    if (!firstOccupied || firstOccupied.owner === actor.owner || !sameCoordinate(firstOccupied.position, action.to)) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push target must be first occupied enemy on selected orthogonal ray",
      };
    }

    const attackerStrength = localGroupStrength(state, actor.id);
    const defenderStrength = localGroupStrength(state, firstOccupied.id);
    if (attackerStrength <= defenderStrength) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Push requires strictly greater attacker group strength",
      };
    }
    return { ok: true };
  }

  if (action.type === "follow") {
    if (!state.continuation || state.continuation.type !== "push") {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Follow is only legal during push continuation",
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
    return { ok: true };
  }

  if (action.type === "retreat") {
    if (!actor.pushed) {
      return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Only pushed pieces may retreat",
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
    return { ok: true };
  }

  return {
    ok: false,
    code: "RULE_VIOLATION",
    message: "Unsupported action type",
  };
}
