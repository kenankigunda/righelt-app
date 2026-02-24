import test from "node:test";
import assert from "node:assert/strict";

import { deterministicStateHash } from "../../src/hash.ts";
import { replayActions } from "../../src/replay.ts";
import { createInitialState } from "../../src/state.ts";

test("headless replay returns deterministic final state and outcome", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];

  const runA = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });
  const runB = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });

  assert.equal(runA.failure, undefined);
  assert.equal(runB.failure, undefined);
  assert.equal(deterministicStateHash(runA.finalState), deterministicStateHash(runB.finalState));
  assert.equal(runA.outcome.status, runB.outcome.status);
  assert.ok(runA.trace);
  assert.equal(runA.trace.length, 4);
});

test("invalid command fails at exact index and keeps previous state", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "move" }, { type: "pass" }];

  const result = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });
  assert.ok(result.failure);
  assert.equal(result.failure?.index, 1);
  assert.equal(result.failure?.validation.ok, false);
  assert.equal(result.failure?.validation.code, "RULE_VIOLATION");
  assert.equal(result.finalState.turnIndex, 1);
  assert.equal(result.finalState.sideToMove, "P2");
});

test("final-only mode omits trace and preserves final parity", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }, { type: "pass" }, { type: "pass" }];

  const traced = replayActions(initial, actions, { includeTrace: true, artifactMode: "full" });
  const finalOnly = replayActions(initial, actions, { includeTrace: false, artifactMode: "full" });

  assert.ok(traced.trace);
  assert.equal(finalOnly.trace, undefined);
  assert.equal(
    deterministicStateHash(traced.finalState),
    deterministicStateHash(finalOnly.finalState),
  );
  assert.equal(traced.finalState.sideToMove, finalOnly.finalState.sideToMove);
  assert.equal(traced.outcome.status, finalOnly.outcome.status);
});

test("final parity holds across minimal and full artifact modes", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }];

  const minimal = replayActions(initial, actions, { includeTrace: false, artifactMode: "minimal" });
  const full = replayActions(initial, actions, { includeTrace: false, artifactMode: "full" });

  assert.equal(minimal.failure, undefined);
  assert.equal(full.failure, undefined);
  assert.equal(minimal.finalState.sideToMove, full.finalState.sideToMove);
  assert.equal(minimal.outcome.status, full.outcome.status);
  assert.equal(
    deterministicStateHash({
      ...minimal.finalState,
      artifacts: undefined,
    }),
    deterministicStateHash({
      ...full.finalState,
      artifacts: undefined,
    }),
  );
});
