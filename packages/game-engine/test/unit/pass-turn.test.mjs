import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createInitialState, validateAction } from "../../src/index.ts";
import { commander, makeState } from "../helpers/state-builders.mjs";

test("C-001 pass is rejected in the initial state", () => {
  const state = createInitialState();
  const result = validateAction(state, { type: "pass" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "RULE_VIOLATION");
  }
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

test("C-003 normal actions still alternate the side to move", () => {
  const state = createInitialState();
  const firstAction = { type: "project", actorId: "C1", from: { row: 3, col: 6 }, to: { row: 1, col: 6 } };
  const secondAction = { type: "project", actorId: "C2", from: { row: 6, col: 3 }, to: { row: 8, col: 3 } };
  const afterOne = applyAction(state, firstAction).state;
  const afterTwo = applyAction(afterOne, secondAction).state;

  assert.equal(afterTwo.sideToMove, state.sideToMove);
});

test("C-004 pass is rejected during rush continuation", () => {
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
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTINUATION_REQUIRED");
  }
});
