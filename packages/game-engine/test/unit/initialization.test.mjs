import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  createInitialState,
  deterministicStateHash,
  replayActions,
  serializeState,
} from "../../src/index.ts";

test("A-001 standard setup", () => {
  const state = createInitialState();

  assert.equal(state.boardSize, 10);
  assert.equal(state.sideToMove, "P1");
  assert.equal(state.turnIndex, 0);
  assert.equal(state.continuation, null);
  assert.equal(state.outcome.status, "ongoing");

  assert.deepEqual(state.pieces, [
    {
      id: "C1",
      owner: "P1",
      kind: "commander",
      position: { row: 3, col: 6 },
      supplied: true,
      commanded: true,
      displaySupplied: true,
      displayCommanded: true,
    },
    {
      id: "C2",
      owner: "P2",
      kind: "commander",
      position: { row: 6, col: 3 },
      supplied: true,
      commanded: true,
      displaySupplied: true,
      displayCommanded: true,
    },
  ]);
});

test("A-002 deterministic replay", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }];

  const runA = replayActions(initial, actions, { includeTrace: true });
  const runB = replayActions(initial, actions, { includeTrace: true });

  assert.equal(serializeState(runA.finalState), serializeState(runB.finalState));
  assert.equal(runA.finalState.sideToMove, runB.finalState.sideToMove);
  assert.equal(runA.finalState.continuation, runB.finalState.continuation);
  assert.deepEqual(runA.outcome, runB.outcome);
  assert.equal(
    deterministicStateHash(runA.finalState),
    deterministicStateHash(runB.finalState),
    "replay final hash should be identical across runs",
  );
});

test("A-003 no hidden randomness", () => {
  const initial = createInitialState();
  const hashes = Array.from({ length: 5 }, () => {
    const result = applyAction(initial, { type: "pass" });
    return deterministicStateHash(result.state);
  });

  const [first, ...rest] = hashes;
  for (const value of rest) {
    assert.equal(value, first);
  }
});
