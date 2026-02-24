import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  deserializeState,
  deterministicStateHash,
  replayActions,
  serializeState,
} from "../../src/index.ts";

test("P-006 serialization round-trip stability", () => {
  const initial = createInitialState();
  const roundTripped = deserializeState(serializeState(initial));
  const actions = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];

  const direct = replayActions(initial, actions, { includeTrace: false });
  const fromRoundTrip = replayActions(roundTripped, actions, { includeTrace: false });

  assert.equal(
    deterministicStateHash(direct.finalState),
    deterministicStateHash(fromRoundTrip.finalState),
    "round-trip should preserve replay semantics",
  );
  assert.deepEqual(direct.outcome, fromRoundTrip.outcome);
});

test.todo("P-007 legal action generation equals validation boundary");

test("P-008 deterministic history emission", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }];

  const runA = replayActions(initial, actions, { includeTrace: true });
  const runB = replayActions(initial, actions, { includeTrace: true });

  const encodedA = JSON.stringify(runA.trace ?? []);
  const encodedB = JSON.stringify(runB.trace ?? []);

  assert.equal(encodedA, encodedB);
});
