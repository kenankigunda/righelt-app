import type { GameState } from "./types";

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeState(serialized: string): GameState {
  return JSON.parse(serialized) as GameState;
}
