import type { GameState } from "./types";

export function createInitialState(): GameState {
  return {
    boardSize: 10,
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
  };
}
