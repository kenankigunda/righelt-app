import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioFromGame } from "../shell/scenarios.js";

const SCENARIO_UUIDS = {
  exportUsesCanonicalTurn: "0066b0ed-c5ba-4a89-a81a-1811d08d2d9d",
  sourceOnly: "0687afa0-a91c-480f-ac75-bd3c6d302168",
  sourceAndTarget: "a3a4664d-56d1-4c47-8498-1781686abd1a",
  historyPreMove: "6df1e170-b639-45ec-a5fe-e05fd3a27ba4",
};

const withMockedHash = async (run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ hash: "hash-live-state" });
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("buildScenarioFromGame uses the provided resulting state for live exports", async () => {
  await withMockedHash(async () => {
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
        scenarioId: SCENARIO_UUIDS.exportUsesCanonicalTurn,
        title: "Export uses canonical turn",
        resultingStateOverride: {
          boardSize: 10,
          sideToMove: "P2",
          turnIndex: 1,
          pieces: [{ id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 } }],
          continuation: null,
          outcome: { status: "ongoing" },
        },
      },
    );

    assert.equal(scenario.id, SCENARIO_UUIDS.exportUsesCanonicalTurn);
    assert.equal(scenario.resultingState.sideToMove, "P2");
    assert.equal(scenario.resultingState.turnIndex, 1);
    assert.equal(scenario.expectedFinalStateHash, "hash-live-state");
  });
});

test("buildScenarioFromGame persists a source-only saved selection", async () => {
  await withMockedHash(async () => {
    const scenario = await buildScenarioFromGame(
      { moves: [], board: { state: { sideToMove: "P1", turnIndex: 4, pieces: [], continuation: null, outcome: { status: "ongoing" } } } },
      {
        scenarioId: SCENARIO_UUIDS.sourceOnly,
        title: "Source only",
        savedSelection: {
          source: { row: 4, col: 2 },
          target: null,
          actorSide: "P1",
          turnIndex: 4,
        },
      },
    );

    assert.deepEqual(scenario.savedSelection, {
      source: { row: 4, col: 2 },
      target: null,
      actorSide: "P1",
      turnIndex: 4,
    });
  });
});

test("buildScenarioFromGame persists a source and destination saved selection", async () => {
  await withMockedHash(async () => {
    const scenario = await buildScenarioFromGame(
      { moves: [], board: { state: { sideToMove: "P2", turnIndex: 7, pieces: [], continuation: null, outcome: { status: "ongoing" } } } },
      {
        scenarioId: SCENARIO_UUIDS.sourceAndTarget,
        title: "Source and target",
        savedSelection: {
          source: { row: 5, col: 5 },
          target: { row: 5, col: 6 },
          actorSide: "P2",
          turnIndex: 7,
        },
      },
    );

    assert.deepEqual(scenario.savedSelection, {
      source: { row: 5, col: 5 },
      target: { row: 5, col: 6 },
      actorSide: "P2",
      turnIndex: 7,
    });
  });
});

test("buildScenarioFromGame can export a pre-move history snapshot with no prior moves", async () => {
  await withMockedHash(async () => {
    const historySnapshot = {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 0,
      pieces: [{ id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 } }],
      continuation: null,
      outcome: { status: "ongoing" },
    };
    const scenario = await buildScenarioFromGame(
      {
        moves: [
          {
            turnIndex: 0,
            turnMoveIndex: 0,
            actorSide: "P1",
            notation: "PROJECT (3,6) -> (5,6)",
            action: { type: "project", actorId: "C1", from: { row: 3, col: 6 }, to: { row: 5, col: 6 } },
            selectionSnapshot: historySnapshot,
            snapshot: {
              ...historySnapshot,
              pieces: [
                ...historySnapshot.pieces,
                { id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 } },
              ],
            },
          },
        ],
      },
      {
        scenarioId: SCENARIO_UUIDS.historyPreMove,
        title: "History pre-move",
        moveLimit: 0,
        resultingStateOverride: historySnapshot,
        savedSelection: {
          source: { row: 3, col: 6 },
          target: { row: 5, col: 6 },
          actorSide: "P1",
          turnIndex: 0,
        },
      },
    );

    assert.deepEqual(scenario.initialState, historySnapshot);
    assert.deepEqual(scenario.resultingState, historySnapshot);
    assert.deepEqual(scenario.moves, []);
    assert.deepEqual(scenario.savedSelection, {
      source: { row: 3, col: 6 },
      target: { row: 5, col: 6 },
      actorSide: "P1",
      turnIndex: 0,
    });
  });
});

test("buildScenarioFromGame rejects non-UUID scenario ids", async () => {
  await withMockedHash(async () => {
    await assert.rejects(
      () =>
        buildScenarioFromGame(
          { moves: [], board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } } } },
          {
            scenarioId: "S-999",
            title: "Invalid id",
          },
        ),
      /UUID v4/,
    );
  });
});
