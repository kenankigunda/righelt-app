import type { GameState } from "./types";
import { BOARD_SIZE, createMinimalArtifacts, normalizeState } from "./deterministic";

export function createInitialState(): GameState {
  const initial: GameState = {
    boardSize: BOARD_SIZE,
    sideToMove: "P1",
    turnIndex: 0,
    pieces: [
      {
        id: "C1",
        owner: "P1",
        kind: "commander",
        position: { row: 3, col: 6 },
        supplied: true,
        commanded: true,
      },
      {
        id: "C2",
        owner: "P2",
        kind: "commander",
        position: { row: 6, col: 3 },
        supplied: true,
        commanded: true,
      },
    ],
    continuation: null,
    outcome: {
      status: "ongoing",
    },
    artifacts: createMinimalArtifacts(),
  };

  return normalizeState(initial);
}
