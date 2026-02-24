import test from "node:test";
import assert from "node:assert/strict";
import { validateAction } from "../../src/index.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("L-001 out-of-bounds coordinates", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 4, 4), commander("C2", "P2", 6, 3)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 4, col: 4 },
    to: { row: 10, col: 4 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "OUT_OF_BOUNDS");
  }
});

test("L-002 action by non-side-to-move", () => {
  const state = makeState({
    sideToMove: "P1",
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "C2",
    from: { row: 6, col: 3 },
    to: { row: 6, col: 4 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "NOT_SIDE_TO_MOVE");
  }
});

test("L-003 action from empty source square", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const result = validateAction(state, {
    type: "move",
    actorId: "U1-1",
    from: { row: 0, col: 0 },
    to: { row: 0, col: 1 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "SOURCE_EMPTY");
  }
});

test("L-004 action on terminal game", () => {
  const state = makeState({
    outcome: { status: "p1_win", reason: "terminal" },
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
  });
  const result = validateAction(state, { type: "pass" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "TERMINAL_GAME");
  }
});
