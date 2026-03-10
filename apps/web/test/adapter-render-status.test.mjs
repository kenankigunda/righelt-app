import test from "node:test";
import assert from "node:assert/strict";

import {
  createEnginePlaygroundBoardAdapter,
  getPieceRenderStatus,
} from "../board-adapters/engine-playground-adapter.js";

test("getPieceRenderStatus prefers display booleans over actionable booleans", () => {
  assert.deepEqual(
    getPieceRenderStatus({
      supplied: true,
      commanded: true,
      displaySupplied: false,
      displayCommanded: false,
    }),
    {
      supplied: false,
      commanded: false,
    },
  );
});

test("selected piece summary exposes live render status and frozen actionable status", () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const snapshot = {
    pieces: [
      {
        id: "C1",
        owner: "P1",
        kind: "commander",
        position: { row: 5, col: 3 },
        supplied: true,
        commanded: true,
        displaySupplied: true,
        displayCommanded: true,
      },
      {
        id: "U1",
        owner: "P1",
        kind: "unit",
        position: { row: 6, col: 5 },
        supplied: true,
        commanded: true,
        displaySupplied: true,
        displayCommanded: false,
      },
    ],
    artifacts: {
      groups: {
        componentByPieceId: { C1: "P1:C1", U1: "P1:C1" },
        membersByComponentId: { "P1:C1": ["C1", "U1"] },
        strengthByComponentId: { "P1:C1": 2 },
      },
    },
  };

  const summary = adapter.getSelectedPieceSummary({
    snapshot,
    selectedPieceId: "U1",
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
  });

  assert.deepEqual(summary?.details, {
    id: "U1",
    owner: "P1",
    kind: "unit",
    position: { row: 6, col: 5 },
    supplied: true,
    commanded: false,
    actionableSupplied: true,
    actionableCommanded: true,
    groupComponentId: "P1:C1",
    groupStrength: 2,
  });
});

test("commander supply summary uses display supply status", () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const snapshot = {
    pieces: [
      {
        id: "C1",
        owner: "P1",
        kind: "commander",
        position: { row: 3, col: 6 },
        supplied: true,
        commanded: true,
        displaySupplied: false,
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
  };

  assert.equal(adapter.getCommanderSupplySummary(snapshot), "C1=false | C2=true");
});
