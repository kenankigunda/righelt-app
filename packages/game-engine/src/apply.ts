import type { Action, ApplyResult, GameState } from "./types";
import { normalizeState } from "./deterministic";
import { validateAction } from "./legal";

export function applyAction(state: GameState, action: Action): ApplyResult {
  const validation = validateAction(state, action);
  if (!validation.ok) {
    throw new Error(`Cannot apply invalid action: ${validation.code}`);
  }

  if (action.type !== "pass") {
    throw new Error(`Action type ${action.type} is not implemented yet`);
  }

  const nextState: GameState = normalizeState({
    ...state,
    sideToMove: state.sideToMove === "P1" ? "P2" : "P1",
    turnIndex: state.turnIndex + 1,
  });

  return {
    state: nextState,
    outcome: nextState.outcome,
  };
}
