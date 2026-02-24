import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, deterministicStateHash, replayActions } from "../../src/index.ts";

const CHECKPOINT_ACTION_SETS = [
  [{ type: "pass" }],
  [{ type: "pass" }, { type: "pass" }],
  [{ type: "pass" }, { type: "pass" }, { type: "pass" }],
];

test("Checkpoint-2 determinism subset maintains repeat-run hash equality", () => {
  for (const actions of CHECKPOINT_ACTION_SETS) {
    const hashes = [];
    for (let i = 0; i < 5; i += 1) {
      const state = createInitialState();
      const replay = replayActions(state, actions, { includeTrace: false });
      hashes.push(deterministicStateHash(replay.finalState));
    }

    const [first, ...rest] = hashes;
    for (const value of rest) {
      assert.equal(
        value,
        first,
        `determinism mismatch for action subset ${JSON.stringify(actions)}`,
      );
    }
  }
});
