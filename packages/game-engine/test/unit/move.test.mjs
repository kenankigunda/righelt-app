import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, validateAction } from "../../src/index.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("D-001 commander orthogonal move legal", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 4, 4), commander("C2", "P2", 6, 3)],
  });

  const next = applyAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;

  assert.deepEqual(next.pieces.find((piece) => piece.id === "C1")?.position, { row: 4, col: 5 });
  assert.equal(next.sideToMove, "P2");
});

test("D-002 commander move blocked by occupancy", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 4, 4), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 5)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("D-003 commander diagonal move illegal", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 4, 4), commander("C2", "P2", 6, 3)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("D-004 non-commander cannot use Move", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("D-005 inactive commander cannot move", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 4, 4, { supplied: false }),
      commander("C2", "P2", 6, 3),
    ],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});
