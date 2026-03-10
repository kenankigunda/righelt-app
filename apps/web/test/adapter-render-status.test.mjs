import test from "node:test";
import assert from "node:assert/strict";

import {
  createEnginePlaygroundBoardAdapter,
  getPieceRenderStatus,
  getInactiveSelectedPieceLabel,
  getRemovalAnimationDelayMs,
  getSelectedPieceTooltipLabel,
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

test("selected piece summary keeps actionable status while continuation copy can describe future inactivity", () => {
  const adapter = createEnginePlaygroundBoardAdapter();
  const snapshot = {
    continuation: {
      type: "rush",
    },
    pieces: [
      {
        id: "U1",
        owner: "P1",
        kind: "unit",
        position: { row: 6, col: 5 },
        supplied: true,
        commanded: true,
        displaySupplied: false,
        displayCommanded: true,
      },
    ],
    artifacts: {
      groups: {
        componentByPieceId: {},
        membersByComponentId: {},
        strengthByComponentId: {},
      },
    },
  };

  const summary = adapter.getSelectedPieceSummary({
    snapshot,
    selectedPieceId: "U1",
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
  });

  assert.equal(summary?.details.supplied, false);
  assert.equal(summary?.details.actionableSupplied, true);
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

test("inactive label uses future-tense copy during continuation for commander and supply loss", () => {
  assert.equal(
    getInactiveSelectedPieceLabel(
      {
        supplied: true,
        commanded: true,
        displaySupplied: true,
        displayCommanded: false,
      },
      { continuation: { type: "rush" } },
    ),
    "Will be inactive if not moved: no connection back to its commander.",
  );

  assert.equal(
    getInactiveSelectedPieceLabel(
      {
        supplied: true,
        commanded: true,
        displaySupplied: false,
        displayCommanded: true,
      },
      { continuation: { type: "push" } },
    ),
    "Will be inactive if not moved: no connection back to its supply point.",
  );
});

test("selected piece tooltip explains frozen start-of-sequence command block", () => {
  assert.equal(
    getSelectedPieceTooltipLabel(
      {
        supplied: false,
        commanded: false,
        displaySupplied: true,
        displayCommanded: true,
      },
      {
        continuation: {
          type: "rush",
          frozenPieceStatesById: {
            U1: { supplied: true, commanded: false },
          },
        },
        pieces: [],
      },
    ),
    null,
  );

  assert.equal(
    getSelectedPieceTooltipLabel(
      {
        id: "U1",
        supplied: true,
        commanded: false,
        displaySupplied: true,
        displayCommanded: true,
      },
      {
        continuation: {
          type: "push",
          frozenPieceStatesById: {
            U1: { supplied: true, commanded: false },
          },
        },
      },
    ),
    "Cannot move: was not commanded at start of push.",
  );
});

test("removal animation delay preserves in-progress flash timing across rerenders", () => {
  assert.equal(getRemovalAnimationDelayMs(null, 5000), 0);
  assert.equal(getRemovalAnimationDelayMs({ startedAt: 4200 }, 5000), 800);
  assert.equal(getRemovalAnimationDelayMs({ startedAt: 2000 }, 5000), 1800);
});

test("selected piece tooltip explains frozen start-of-sequence supply block", () => {
  assert.equal(
    getSelectedPieceTooltipLabel(
      {
        id: "U1",
        supplied: false,
        commanded: true,
        displaySupplied: true,
        displayCommanded: true,
      },
      {
        continuation: {
          type: "rush",
          frozenPieceStatesById: {
            U1: { supplied: false, commanded: true },
          },
        },
      },
    ),
    "Cannot move: was not supplied at start of rush.",
  );
});
