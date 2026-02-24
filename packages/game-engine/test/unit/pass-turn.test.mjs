import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createInitialState, validateAction } from "../../src/index.ts";
import { commander, makeState } from "../helpers/state-builders.mjs";

test("C-001 pass basic", () => {
  const state = createInitialState();
  const next = applyAction(state, { type: "pass" }).state;

  assert.equal(next.sideToMove, "P2");
  assert.equal(next.turnIndex, 1);
  assert.deepEqual(next.pieces, state.pieces);
});

test("C-002 pass illegal during forced continuation", () => {
  const state = makeState({
    continuation: {
      type: "push",
      owner: "P1",
      followPoint: { row: 4, col: 4 },
      chainLength: 1,
    },
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
  });

  const result = validateAction(state, { type: "pass" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTINUATION_REQUIRED");
  }
});

test("C-003 side alternation", () => {
  const state = createInitialState();
  const afterOne = applyAction(state, { type: "pass" }).state;
  const afterTwo = applyAction(afterOne, { type: "pass" }).state;

  assert.equal(afterTwo.sideToMove, state.sideToMove);
});

test("C-004 pass legal during rush continuation", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
  });

  const result = validateAction(state, { type: "pass" });
  assert.equal(result.ok, true);
});
