import test from "node:test";
import assert from "node:assert/strict";

import { deterministicStateHash } from "../../src/hash.ts";
import { replayActions } from "../../src/replay.ts";
import { createInitialState } from "../../src/state.ts";

function expectReplayFailure({
  label,
  initial,
  actions,
  index,
  expectedCode,
  expectedTurnIndex,
  expectedSideToMove,
}) {
  test(label, () => {
    const withTrace = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });
    const withoutTrace = replayActions(initial, actions, { includeTrace: false, artifactMode: "minimal" });

    assert.ok(withTrace.failure);
    assert.equal(withTrace.failure?.index, index);
    assert.equal(withTrace.failure?.validation.ok, false);
    assert.equal(withTrace.failure?.validation.code, expectedCode);
    assert.equal(withTrace.finalState.turnIndex, expectedTurnIndex);
    assert.equal(withTrace.finalState.sideToMove, expectedSideToMove);

    assert.ok(withTrace.trace);
    assert.equal(withTrace.trace.length, index + 1);

    assert.ok(withoutTrace.failure);
    assert.equal(withoutTrace.failure?.index, index);
    assert.equal(withoutTrace.failure?.validation.code, expectedCode);
    assert.equal(withoutTrace.trace, undefined);
    assert.equal(withoutTrace.finalState.turnIndex, expectedTurnIndex);
    assert.equal(withoutTrace.finalState.sideToMove, expectedSideToMove);
    assert.equal(
      deterministicStateHash(withTrace.finalState),
      deterministicStateHash(withoutTrace.finalState),
    );
  });
}

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

test("P-001 headless replay executes command logs without UI state", () => {
  const result = replayActions(createInitialState(), [{ type: "pass" }, { type: "pass" }], {
    includeTrace: false,
    artifactMode: "minimal",
  });
  assert.equal(result.failure, undefined);
  assert.equal(result.finalState.turnIndex, 2);
  assert.equal(result.finalState.sideToMove, "P1");
});

test("P-002 replay stops at first invalid command index", () => {
  const result = replayActions(
    createInitialState(),
    [{ type: "pass" }, { type: "move" }, { type: "pass" }],
    { includeTrace: false, artifactMode: "minimal" },
  );
  assert.ok(result.failure);
  assert.equal(result.failure?.index, 1);
  assert.equal(result.finalState.turnIndex, 1);
});

test("P-003 replay supports final-state-only mode", () => {
  const result = replayActions(createInitialState(), [{ type: "pass" }, { type: "pass" }], {
    includeTrace: false,
    artifactMode: "full",
  });
  assert.equal(result.trace, undefined);
  assert.equal(result.failure, undefined);
});

test("P-004 full-trace and final-only replay modes end in identical final state", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];
  const traced = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });
  const finalOnly = replayActions(initial, actions, { includeTrace: false, artifactMode: "minimal" });
  assert.equal(deterministicStateHash(traced.finalState), deterministicStateHash(finalOnly.finalState));
  assert.equal(traced.outcome.status, finalOnly.outcome.status);
});

expectReplayFailure({
  label: "replay failure reports INVALID_SHAPE for malformed command and keeps previous state",
  initial: createInitialState(),
  actions: [{ type: "pass" }, { type: "move" }, { type: "pass" }],
  index: 1,
  expectedCode: "INVALID_SHAPE",
  expectedTurnIndex: 1,
  expectedSideToMove: "P2",
});

expectReplayFailure({
  label: "replay failure reports RULE_VIOLATION for shape-valid illegal move",
  initial: createInitialState(),
  actions: [
    {
      type: "move",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 4, col: 7 },
    },
  ],
  index: 0,
  expectedCode: "RULE_VIOLATION",
  expectedTurnIndex: 0,
  expectedSideToMove: "P1",
});

expectReplayFailure({
  label: "replay failure reports CONTINUATION_REQUIRED when passing during continuation",
  initial: {
    ...createInitialState(),
    sideToMove: "P2",
    pieces: [
      ...createInitialState().pieces,
      {
        id: "D1",
        owner: "P2",
        kind: "unit",
        position: { row: 4, col: 4 },
        supplied: true,
        commanded: true,
        pushed: true,
      },
    ],
    continuation: {
      type: "push",
      owner: "P2",
      attackerOwner: "P1",
      phase: "retreat",
      pushedPieceId: "D1",
      followPoint: { row: 3, col: 6 },
      chainLength: 1,
    },
  },
  actions: [{ type: "pass" }],
  index: 0,
  expectedCode: "CONTINUATION_REQUIRED",
  expectedTurnIndex: 0,
  expectedSideToMove: "P2",
});

expectReplayFailure({
  label: "replay failure reports TERMINAL_GAME for commands after terminal outcome",
  initial: {
    ...createInitialState(),
    outcome: { status: "p1_win", reason: "seed-terminal" },
  },
  actions: [{ type: "pass" }],
  index: 0,
  expectedCode: "TERMINAL_GAME",
  expectedTurnIndex: 0,
  expectedSideToMove: "P1",
});

expectReplayFailure({
  label: "replay failure reports OUT_OF_BOUNDS for invalid coordinates",
  initial: createInitialState(),
  actions: [
    {
      type: "move",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 10, col: 6 },
    },
  ],
  index: 0,
  expectedCode: "OUT_OF_BOUNDS",
  expectedTurnIndex: 0,
  expectedSideToMove: "P1",
});

expectReplayFailure({
  label: "replay failure reports NOT_SIDE_TO_MOVE for wrong owner action",
  initial: createInitialState(),
  actions: [
    {
      type: "move",
      actorId: "C2",
      from: { row: 6, col: 3 },
      to: { row: 6, col: 4 },
    },
  ],
  index: 0,
  expectedCode: "NOT_SIDE_TO_MOVE",
  expectedTurnIndex: 0,
  expectedSideToMove: "P1",
});

expectReplayFailure({
  label: "replay failure reports SOURCE_EMPTY for empty source coordinate",
  initial: createInitialState(),
  actions: [
    {
      type: "move",
      actorId: "C1",
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
    },
  ],
  index: 0,
  expectedCode: "SOURCE_EMPTY",
  expectedTurnIndex: 0,
  expectedSideToMove: "P1",
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

test("mixed-action replay succeeds and preserves minimal/full and trace/final-only parity", () => {
  const initial = createInitialState();
  const actions = [
    {
      type: "move",
      actorId: "C1",
      from: { row: 3, col: 6 },
      to: { row: 3, col: 7 },
    },
    { type: "pass" },
    {
      type: "move",
      actorId: "C1",
      from: { row: 3, col: 7 },
      to: { row: 3, col: 6 },
    },
  ];

  const tracedMinimal = replayActions(initial, actions, { includeTrace: true, artifactMode: "minimal" });
  const finalOnlyMinimal = replayActions(initial, actions, {
    includeTrace: false,
    artifactMode: "minimal",
  });
  const tracedFull = replayActions(initial, actions, { includeTrace: true, artifactMode: "full" });
  const finalOnlyFull = replayActions(initial, actions, { includeTrace: false, artifactMode: "full" });

  assert.equal(tracedMinimal.failure, undefined);
  assert.equal(finalOnlyMinimal.failure, undefined);
  assert.equal(tracedFull.failure, undefined);
  assert.equal(finalOnlyFull.failure, undefined);
  assert.ok(tracedMinimal.trace);
  assert.ok(tracedFull.trace);
  assert.equal(tracedMinimal.trace.length, actions.length + 1);
  assert.equal(tracedFull.trace.length, actions.length + 1);
  assert.equal(finalOnlyMinimal.trace, undefined);
  assert.equal(finalOnlyFull.trace, undefined);

  assert.equal(
    deterministicStateHash({ ...tracedMinimal.finalState, artifacts: undefined }),
    deterministicStateHash({ ...finalOnlyMinimal.finalState, artifacts: undefined }),
  );
  assert.equal(
    deterministicStateHash({ ...tracedFull.finalState, artifacts: undefined }),
    deterministicStateHash({ ...finalOnlyFull.finalState, artifacts: undefined }),
  );
  assert.equal(
    deterministicStateHash({ ...tracedMinimal.finalState, artifacts: undefined }),
    deterministicStateHash({ ...tracedFull.finalState, artifacts: undefined }),
  );
  assert.equal(tracedMinimal.outcome.status, tracedFull.outcome.status);
});
