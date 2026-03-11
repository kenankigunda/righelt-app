import test from "node:test";
import assert from "node:assert/strict";

import { buildPieceMoveResponse } from "../board/client-move-generation.js";

test("client move generation includes unsupplied-blocked previews but not legal actions", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "U2-wall-top", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "U2-wall-bottom", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "U2-block-north", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-south", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-east", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true },
    ],
    continuation: null,
    outcome: { status: "ongoing" },
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [
      { type: "pass" },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 3, col: 4 } },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 5, col: 4 } },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 4, col: 3 } },
    ],
    pieceId: "C1",
  });

  assert.equal(
    response.actions.some((action) => action.type === "move" && action.to?.row === 4 && action.to?.col === 5),
    false,
  );
  assert.equal(
    response.previewActions.some(
      (action) =>
        action.type === "move" &&
        action.to?.row === 4 &&
        action.to?.col === 5 &&
        action.legal === false &&
        action.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED",
    ),
    true,
  );
});

test("client move generation includes blocked push previews for inadequate group strength", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 3 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [{ type: "pass" }],
    pieceId: "A1",
  });

  assert.equal(
    response.actions.some((action) => action.type === "push" && action.to?.row === 5 && action.to?.col === 3),
    false,
  );
  assert.equal(
    response.previewActions.some(
      (action) =>
        action.type === "push" &&
        action.to?.row === 5 &&
        action.to?.col === 3 &&
        action.legal === false &&
        action.blockedReason === "PUSH_STRENGTH_TOO_WEAK",
    ),
    true,
  );
});
