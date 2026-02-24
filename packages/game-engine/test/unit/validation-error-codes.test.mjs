import test from "node:test";
import assert from "node:assert/strict";

import { validateAction } from "../../src/index.ts";
import { commander, makeState } from "../helpers/state-builders.mjs";

test("validation error code map is reachable for all defined variants", () => {
  const cases = [
    {
      code: "INVALID_SHAPE",
      state: makeState({
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: { type: "move" },
    },
    {
      code: "OUT_OF_BOUNDS",
      state: makeState({
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: {
        type: "move",
        actorId: "C1",
        from: { row: 3, col: 6 },
        to: { row: 10, col: 6 },
      },
    },
    {
      code: "NOT_SIDE_TO_MOVE",
      state: makeState({
        sideToMove: "P1",
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: {
        type: "move",
        actorId: "C2",
        from: { row: 6, col: 3 },
        to: { row: 6, col: 4 },
      },
    },
    {
      code: "SOURCE_EMPTY",
      state: makeState({
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: {
        type: "move",
        actorId: "C1",
        from: { row: 0, col: 0 },
        to: { row: 0, col: 1 },
      },
    },
    {
      code: "CONTINUATION_REQUIRED",
      state: makeState({
        continuation: {
          type: "push",
          owner: "P1",
          followPoint: { row: 4, col: 4 },
          chainLength: 1,
        },
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: { type: "pass" },
    },
    {
      code: "TERMINAL_GAME",
      state: makeState({
        outcome: { status: "p1_win", reason: "terminal" },
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: { type: "pass" },
    },
    {
      code: "RULE_VIOLATION",
      state: makeState({
        pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3)],
      }),
      action: {
        type: "move",
        actorId: "C1",
        from: { row: 3, col: 6 },
        to: { row: 4, col: 7 },
      },
    },
  ];

  for (const entry of cases) {
    const result = validateAction(entry.state, entry.action);
    assert.equal(result.ok, false, `expected failure for ${entry.code}`);
    if (!result.ok) {
      assert.equal(result.code, entry.code);
      assert.equal(typeof result.message, "string");
      assert.ok(result.message.length > 0);
    }
  }
});
