import type { Action, GameState, ReplayOptions, ReplayResult } from "./types";

export function replayActions(
  _initial: GameState,
  _actions: Action[],
  _options?: ReplayOptions,
): ReplayResult {
  throw new Error("replayActions is not implemented yet");
}
