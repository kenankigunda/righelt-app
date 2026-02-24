import type { Action, GameState, ValidationResult } from "./types";

export function listLegalActions(_state: GameState): Action[] {
  return [];
}

export function validateAction(_state: GameState, _action: Action): ValidationResult {
  return {
    ok: false,
    code: "RULE_VIOLATION",
    message: "Engine legality is not implemented yet",
  };
}
