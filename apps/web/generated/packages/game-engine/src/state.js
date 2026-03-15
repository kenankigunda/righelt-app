import { BOARD_SIZE, createMinimalArtifacts, normalizeState } from "./deterministic.js";
export function createInitialState() {
    const initial = {
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
                displaySupplied: true,
                displayCommanded: true,
            },
            {
                id: "C2",
                owner: "P2",
                kind: "commander",
                position: { row: 6, col: 3 },
                supplied: true,
                commanded: true,
                displaySupplied: true,
                displayCommanded: true,
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
