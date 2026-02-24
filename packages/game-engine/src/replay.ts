import type { Action, GameState, ReplayOptions, ReplayResult } from "./types";
import { applyAction } from "./apply";
import { normalizeState } from "./deterministic";
import { validateAction } from "./legal";

export function replayActions(
  initial: GameState,
  actions: Action[],
  options?: ReplayOptions,
): ReplayResult {
  const includeTrace = options?.includeTrace ?? true;
  let current = normalizeState(initial);
  const trace = includeTrace ? [current] : undefined;

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    const validation = validateAction(current, action);

    if (!validation.ok) {
      return {
        finalState: current,
        outcome: current.outcome,
        trace,
        failure: {
          index: i,
          validation,
        },
      };
    }

    const result = applyAction(current, action);
    current = normalizeState(result.state);
    if (trace) {
      trace.push(current);
    }
  }

  return {
    finalState: current,
    outcome: current.outcome,
    trace,
  };
}
