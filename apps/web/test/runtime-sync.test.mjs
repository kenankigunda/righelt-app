import test from "node:test";
import assert from "node:assert/strict";

import { shouldResetBoardSelection, shouldSkipBoardRuntimeReload } from "../shell/runtime-sync.js";

test("shell board selection resets when the optimistic snapshot hands off the turn", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: { sideToMove: "P2", turnIndex: 1, pieces: [] },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: { row: 4, col: 3 },
      },
      nextLegalActions: [{ type: "move", actorId: "B1", from: { row: 6, col: 6 }, to: { row: 6, col: 7 } }],
    }),
    true,
  );
});

test("shell board selection resets when the selected actor no longer occupies the selected source", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        pieces: [
          {
            id: "A1",
            position: { row: 4, col: 3 },
          },
        ],
      },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: { row: 4, col: 3 },
      },
      nextLegalActions: [{ type: "rush", actorId: "A1", from: { row: 4, col: 3 }, to: { row: 4, col: 4 } }],
    }),
    true,
  );
});

test("shell board selection resets when the selected target is no longer legal", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        pieces: [
          {
            id: "A1",
            position: { row: 4, col: 2 },
          },
        ],
      },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: { row: 4, col: 3 },
      },
      nextLegalActions: [{ type: "rush", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } }],
    }),
    true,
  );
});

test("shell board selection is preserved for same-turn continuation snapshots that still support it", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: { type: "rush", owner: "P1" },
        pieces: [
          {
            id: "A1",
            position: { row: 4, col: 2 },
          },
        ],
      },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: { row: 4, col: 3 },
      },
      nextLegalActions: [{ type: "rush", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    }),
    false,
  );
});

test("shell board source-only selection resets when the selected source becomes empty", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        pieces: [],
      },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: null,
      },
      nextLegalActions: [{ type: "move", actorId: "B1", from: { row: 6, col: 6 }, to: { row: 6, col: 7 } }],
    }),
    true,
  );
});

test("shell board source-only selection is preserved when the same actor remains at the source", () => {
  assert.equal(
    shouldResetBoardSelection({
      currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
      nextSnapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        pieces: [
          {
            id: "A1",
            position: { row: 4, col: 2 },
          },
        ],
      },
      currentSelection: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: null,
      },
      nextLegalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    }),
    false,
  );
});

test("shell board mount skips reload when runtime already matches current snapshot", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":0}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedOverlayKey: "null",
      overlayKey: "null",
      resetSelection: false,
    }),
    true,
  );
});

test("shell board mount reloads when selection reset or snapshot inputs differ", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":1}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedOverlayKey: "null",
      overlayKey: "null",
      resetSelection: false,
    }),
    false,
  );

  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":0}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedOverlayKey: "null",
      overlayKey: "null",
      resetSelection: true,
    }),
    false,
  );
});

test("shell board mount skips reload for matching authoritative ack after an optimistic move", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      runtimeLegalActionsKey: "[{\"type\":\"rush\",\"actorId\":\"A1\"}]",
      snapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      legalActionsKey: "[{\"type\":\"rush\",\"actorId\":\"A1\"}]",
      mountedOverlayKey: "null",
      overlayKey: "null",
      resetSelection: false,
    }),
    true,
  );
});

for (const defenderFirst of [false, true]) {
  test(`retreat selection survives status updates with overlapping push pieces (${defenderFirst ? "defender" : "attacker"} first)`, () => {
    const attacker = { id: "A1", position: { row: 4, col: 2 } };
    const defender = { id: "D1", position: { row: 4, col: 2 } };
    const snapshot = { sideToMove: "P2", turnIndex: 0, continuation: { type: "push", phase: "retreat", pushedPieceId: "D1" }, pieces: defenderFirst ? [defender, attacker] : [attacker, defender] };
    const selection = { selectedPieceId: "D1", source: { row: 4, col: 2 }, target: { row: 3, col: 2 } };
    const actions = [{ type: "retreat", actorId: "D1", from: selection.source, to: selection.target }];
    assert.equal(shouldResetBoardSelection({ currentSnapshot: snapshot, nextSnapshot: snapshot, currentSelection: selection, nextLegalActions: actions }), false);
    assert.equal(shouldResetBoardSelection({ currentSnapshot: snapshot, nextSnapshot: snapshot, currentSelection: { ...selection, target: null }, nextLegalActions: actions }), false);
  });
}
