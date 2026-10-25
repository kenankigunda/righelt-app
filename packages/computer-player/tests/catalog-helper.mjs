import { resolveToStability } from "../../game-engine/src/index.ts";
import { transition } from "../src/index.ts";

// Saved catalogs record explicit rush turn endings as turn metadata rather than
// move rows. Reconstruct explicit End Turn decisions for search parity.
export function catalogActions(scenario) {
  let state = resolveToStability(structuredClone(scenario.initialState));
  const actions = [];
  for (const move of scenario.moves) {
    if (state.continuation?.type === "rush" && move.turnIndex > state.turnIndex) {
      actions.push({ type: "end_turn" });
      state = transition(state, { type: "end_turn" });
    }
    actions.push(move.action);
    state = transition(state, move.action);
  }
  return actions;
}
