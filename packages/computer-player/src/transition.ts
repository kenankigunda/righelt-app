import { applyAction, normalizeState, resolveToStability } from "../../game-engine/src/index";
import type { Action, GameState } from "../../shared-types/src/engine";
import { clearTransientTurnFlags } from "../../shared-types/src/shell-live-turn.js";

/** The engine owns controller changes, continuation closure and terminal truth. */
export function transition(state: GameState, action: Action): GameState {
  const next = resolveToStability(applyAction(normalizeState(state), action).state, { artifactMode: "minimal" });
  // Match the shared shell's canonical turn boundary, including explicit false
  // flags. IDs and counters must replay identically to committed server state.
  if (!next.continuation) {
    next.pieces = clearTransientTurnFlags(next.pieces);
    return resolveToStability(next, { artifactMode: "minimal" });
  }
  return next;
}

export function terminalValue(state: GameState): number | undefined {
  switch (state.outcome.status) {
    case "p1_win": return 1;
    case "p2_win": return -1;
    case "draw": return 0;
    case "ongoing": return undefined;
  }
}
