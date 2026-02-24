import type { Action, GameState, ValidationResult } from "./types";
import { BOARD_SIZE } from "./deterministic";

function outOfBounds(value: { row: number; col: number } | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}

function hasPieceAt(state: GameState, value: { row: number; col: number }): boolean {
  return state.pieces.some((piece) => piece.position.row === value.row && piece.position.col === value.col);
}

export function listLegalActions(state: GameState): Action[] {
  if (state.outcome.status !== "ongoing") {
    return [];
  }

  if (state.continuation) {
    return [];
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

  if (state.continuation && action.type !== "follow" && action.type !== "retreat") {
    return {
      ok: false,
      code: "CONTINUATION_REQUIRED",
      message: "Continuation context requires continuation-specific action",
    };
  }

  if (action.type !== "pass") {
    return {
      ok: false,
      code: "RULE_VIOLATION",
      message: "Engine legality for this action type is not implemented yet",
    };
  }

  if (state.continuation) {
    return {
      ok: false,
      code: "CONTINUATION_REQUIRED",
      message: "Pass is not legal while continuation is active",
    };
  }

  return { ok: true };
}
