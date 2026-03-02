import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  deserializeState,
  deterministicStateHash,
  listLegalActions,
  replayActions,
  serializeState,
  validateAction,
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

test("P-007 legal action generation equals validation boundary", () => {
  const initial = createInitialState();
  const legal = listLegalActions(initial);

  assert.ok(legal.length > 0, "expected at least one legal action");
  assert.equal(legal.some((action) => action.type === "pass"), true, "expected pass to remain legal");
  assert.equal(
    legal.some((action) => action.type === "move" && action.actorId === "C1"),
    true,
    "expected initial commander moves to be generated",
  );
  for (const action of legal) {
    const result = validateAction(initial, action);
    assert.equal(result.ok, true, `listed legal action rejected: ${JSON.stringify(action)}`);
  }

  const sampledNotInL = [
    {
      type: "move",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 4, col: 7 },
    },
    {
      type: "project",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 3, col: 7 },
    },
    {
      type: "rush",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 3, col: 7 },
    },
  ];

  for (const action of sampledNotInL) {
    const inLegalSet = legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(action));
    assert.equal(inLegalSet, false, `sampled illegal action unexpectedly generated: ${JSON.stringify(action)}`);
    const result = validateAction(initial, action);
    assert.equal(result.ok, false, `sampled non-listed action unexpectedly accepted: ${JSON.stringify(action)}`);
  }
});

test("P-008 deterministic history emission", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }];

  const runA = replayActions(initial, actions, { includeTrace: true });
  const runB = replayActions(initial, actions, { includeTrace: true });

  const encodedA = JSON.stringify(runA.trace ?? []);
  const encodedB = JSON.stringify(runB.trace ?? []);

  assert.equal(encodedA, encodedB);
});
