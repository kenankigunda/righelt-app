import type { Action, ApplyResult, GameState } from "./types";
import { BOARD_SIZE } from "./deterministic";
import { normalizeState } from "./deterministic";
import { localGroupMembers, validateAction } from "./legal";

function isEmptySquare(state: GameState, row: number, col: number) {
  return !state.pieces.some((piece) => piece.position.row === row && piece.position.col === col);
}

function getOrthogonalDirection(
  from: { row: number; col: number },
  to: { row: number; col: number },
): { row: number; col: number } {
  if (from.row === to.row) {
    return { row: 0, col: Math.sign(to.col - from.col) };
  }
  return { row: Math.sign(to.row - from.row), col: 0 };
}

function findFirstOccupiedOnRay(
  state: GameState,
  from: { row: number; col: number },
  direction: { row: number; col: number },
) {
  let row = from.row + direction.row;
  let col = from.col + direction.col;

  while (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
    const piece = state.pieces.find((candidate) => candidate.position.row === row && candidate.position.col === col);
    if (piece) {
      return piece;
    }
    row += direction.row;
    col += direction.col;
  }

  return undefined;
}

function orthogonallyAdjacentEmptySquares(state: GameState, row: number, col: number) {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ].filter(
    (coord) =>
      coord.row >= 0 &&
      coord.row < BOARD_SIZE &&
      coord.col >= 0 &&
      coord.col < BOARD_SIZE &&
      isEmptySquare(state, coord.row, coord.col),
  );
}

function clearShiftedFlags(state: GameState) {
  for (const piece of state.pieces) {
    if (piece.shifted) {
      piece.shifted = false;
    }
  }
}

function opponentOf(owner: "P1" | "P2"): "P1" | "P2" {
  return owner === "P1" ? "P2" : "P1";
}

function nextUnitId(state: GameState, owner: "P1" | "P2") {
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

export function applyAction(state: GameState, action: Action): ApplyResult {
  const validation = validateAction(state, action);
  if (!validation.ok) {
    throw new Error(`Cannot apply invalid action: ${validation.code}`);
  }

  const next = normalizeState(state);
  const actor =
    (action.actorId && next.pieces.find((piece) => piece.id === action.actorId)) ||
    (action.from &&
      next.pieces.find(
        (piece) => piece.position.row === action.from?.row && piece.position.col === action.from?.col,
      )) ||
    undefined;

  const endTurn = (nextSideToMove = opponentOf(next.sideToMove)) => {
    next.sideToMove = nextSideToMove;
    next.turnIndex += 1;
    next.continuation = null;
    clearShiftedFlags(next);
  };

  if (action.type === "pass") {
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
    });
    endTurn();
  } else if (action.type === "rush" && actor && action.to) {
    actor.position = { ...action.to };
    if (!next.continuation || next.continuation.type !== "rush") {
      next.continuation = {
        type: "rush",
        owner: actor.owner,
        rushedPieceIds: [actor.id],
        chainLength: 1,
      };
    } else {
      const rushedPieceIds = new Set(next.continuation.rushedPieceIds ?? []);
      rushedPieceIds.add(actor.id);
      next.continuation.rushedPieceIds = [...rushedPieceIds];
      next.continuation.chainLength += 1;
    }
  } else if (action.type === "push" && actor && action.to) {
    const origin = { ...actor.position };
    const pushingGroupPieceIds = localGroupMembers(next, actor.id);
    const direction = getOrthogonalDirection(actor.position, action.to);
    const defender = findFirstOccupiedOnRay(next, actor.position, direction);
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
      chainLength: 1,
    };
    next.sideToMove = defender.owner;

    const retreatSquares = [
      { row: defender.position.row - 1, col: defender.position.col },
      { row: defender.position.row + 1, col: defender.position.col },
      { row: defender.position.row, col: defender.position.col - 1 },
      { row: defender.position.row, col: defender.position.col + 1 },
    ].filter((to) =>
      validateAction(next, {
        type: "retreat",
        actorId: defender.id,
        from: defender.position,
        to,
      }).ok,
    );
    if (retreatSquares.length === 0) {
      next.pieces = next.pieces.filter((piece) => piece.id !== defender.id);
      next.continuation = {
        ...next.continuation,
        owner: actor.owner,
        phase: "follow",
        pushedPieceId: undefined,
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
      next.continuation.pushedPieceId = undefined;
    }
  } else {
    throw new Error(`Action type ${action.type} is not implemented yet`);
  }
  const nextState = normalizeState(next);
  return {
    state: nextState,
    outcome: nextState.outcome,
  };
}
