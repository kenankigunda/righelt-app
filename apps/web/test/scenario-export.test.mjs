import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioFromGame } from "../shell/scenarios.js";

test("buildScenarioFromGame uses the live board snapshot for full-history exports", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ hash: "hash-live-state" });

  try {
    const scenario = await buildScenarioFromGame(
      {
        moves: [
          {
            turnIndex: 0,
            turnMoveIndex: 0,
            actorSide: "P1",
            notation: "PROJECT (3,6) -> (5,6)",
            action: {
              type: "project",
              actorId: "C1",
              from: { row: 3, col: 6 },
              to: { row: 5, col: 6 },
            },
            selectionSnapshot: {
              boardSize: 10,
              sideToMove: "P1",
              turnIndex: 0,
              pieces: [],
              continuation: null,
              outcome: { status: "ongoing" },
            },
            snapshot: {
              boardSize: 10,
              sideToMove: "P1",
              turnIndex: 0,
              pieces: [{ id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 } }],
              continuation: null,
              outcome: { status: "ongoing" },
            },
          },
        ],
        board: {
          state: {
            boardSize: 10,
            sideToMove: "P2",
            turnIndex: 1,
            pieces: [{ id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 } }],
            continuation: null,
            outcome: { status: "ongoing" },
          },
        },
      },
      {
        scenarioId: "S-900",
        title: "Export uses canonical turn",
      },
    );

    assert.equal(scenario.resultingState.sideToMove, "P2");
    assert.equal(scenario.resultingState.turnIndex, 1);
    assert.equal(scenario.expectedFinalStateHash, "hash-live-state");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
