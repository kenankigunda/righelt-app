import test from "node:test";
import assert from "node:assert/strict";

import { createEnginePlaygroundBoardAdapter } from "../board-adapters/engine-playground-adapter.js";

test("retreat stack click selects pushed piece as retreat actor", () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const snapshot = {
    sideToMove: "P2",
    continuation: {
      type: "push",
      phase: "retreat",
      pushedPieceId: "D1",
    },
    pieces: [
      {
        id: "A1",
        owner: "P1",
        kind: "unit",
        position: { row: 4, col: 4 },
        supplied: true,
        commanded: true,
        pushed: false,
      },
      {
        id: "D1",
        owner: "P2",
        kind: "unit",
        position: { row: 4, col: 4 },
        supplied: true,
        commanded: true,
        pushed: true,
      },
    ],
  };

  const result = adapter.nextSelectionForCell({
    snapshot,
    selection: { selectedPieceId: null, source: null, target: null },
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
    currentActionType: "pass",
    clickedCoord: { row: 4, col: 4 },
    allowFreeSelection: false,
  });

  assert.deepEqual(result, {
    selection: {
      selectedPieceId: "D1",
      source: { row: 4, col: 4 },
      target: null,
    },
    nextActionType: "pass",
  });
});
