import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, listLegalActions, validateAction } from "../../src/index.ts";
import { resolveToStability } from "../../src/resolve.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("F-001 orthogonal rush legal when target adjacent to enemy", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 6),
    ],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, true);

  const next = applyAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;
  assert.equal(next.continuation?.type, "rush");
});

test("F-002 orthogonal rush illegal without enemy adjacency", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("F-003 diagonal rush legal with co-adjacent enemy", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 5, 4),
    ],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, true);
});

test("F-004 diagonal rush illegal without co-adjacent enemy", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("F-005 pushed piece cannot diagonal-rush", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4, { pushed: true }),
      unit("U2-1", "P2", 5, 4),
    ],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("F-006 rush destination occupied", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 5),
    ],
  });
  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("F-007 a piece can only rush once per rush continuation", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 6),
    ],
  });

  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("F-008 rush continuation can be ended by pass", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });

  const validation = validateAction(state, { type: "pass" });
  assert.equal(validation.ok, true);

  const next = applyAction(state, { type: "pass" }).state;
  assert.equal(next.continuation, null);
  assert.equal(next.sideToMove, "P2");
  assert.equal(next.turnIndex, 1);
});

test("F-009 rush continuation rejects non-rush actions", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 6),
    ],
  });

  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 3, col: 6 },
    to: { row: 3, col: 5 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTINUATION_REQUIRED");
  }
});

test("F-010 listLegalActions includes pass and omits already-rushed pieces", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0, { commanded: false }),
      commander("C2", "P2", 9, 9, { commanded: false }),
      unit("U1-1", "P1", 4, 4),
      unit("U1-2", "P1", 5, 5),
      unit("U2-1", "P2", 5, 7),
    ],
  });

  const legal = listLegalActions(state);
  const passCount = legal.filter((action) => action.type === "pass").length;
  assert.equal(passCount, 1);
  assert.equal(
    legal.some((action) => action.type === "rush" && action.actorId === "U1-1"),
    false,
  );
  assert.equal(
    legal.some((action) => action.type === "rush" && action.actorId === "U1-2"),
    true,
  );
});

test("F-011 distinct pieces can chain rushes in one continuation", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0, { commanded: false }),
      commander("C2", "P2", 9, 9, { commanded: false }),
      unit("U1-1", "P1", 4, 4),
      unit("U1-2", "P1", 6, 6),
      unit("U2-1", "P2", 4, 6),
      unit("U2-2", "P2", 6, 8),
    ],
  });

  const afterFirst = applyAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;

  assert.equal(afterFirst.continuation?.type, "rush");
  assert.deepEqual(afterFirst.continuation?.rushedPieceIds, ["U1-1"]);
  assert.equal(afterFirst.continuation?.chainLength, 1);

  const afterSecond = applyAction(afterFirst, {
    type: "rush",
    actorId: "U1-2",
    from: { row: 6, col: 6 },
    to: { row: 6, col: 7 },
  }).state;

  assert.equal(afterSecond.continuation?.type, "rush");
  assert.deepEqual(afterSecond.continuation?.rushedPieceIds, ["U1-1", "U1-2"]);
  assert.equal(afterSecond.continuation?.chainLength, 2);
  assert.equal(afterSecond.sideToMove, "P1");
});

test("F-012 pass ends rush continuation even when more rushes are available", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0, { commanded: false }),
      commander("C2", "P2", 9, 9, { commanded: false }),
      unit("U1-1", "P1", 4, 4),
      unit("U1-2", "P1", 5, 5),
      unit("U2-1", "P2", 5, 7),
    ],
  });

  const legal = listLegalActions(state);
  assert.equal(
    legal.some((action) => action.type === "rush" && action.actorId === "U1-2"),
    true,
  );

  const next = applyAction(state, { type: "pass" }).state;
  assert.equal(next.continuation, null);
  assert.equal(next.sideToMove, "P2");
  assert.equal(next.turnIndex, 1);
});

test("F-012b pass is illegal while rush continuation still has forced resupply debt", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      forcedResupplyPieceIds: ["U1-2"],
      rushedPieceIds: ["U1-1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0, { commanded: false }),
      commander("C2", "P2", 9, 9, { commanded: false }),
      unit("U1-1", "P1", 4, 4),
      unit("U1-2", "P1", 5, 5, { supplied: false, displaySupplied: false }),
      unit("U2-1", "P2", 5, 7),
    ],
  });

  const result = validateAction(state, { type: "pass" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTINUATION_REQUIRED");
  }
});

test("F-013 rush destination that would be unsupplied is illegal", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 6),
      unit("U2-wall-top", "P2", 0, 4),
      unit("U2-wall-bottom", "P2", 9, 4),
      unit("U2-block-north", "P2", 3, 5),
      unit("U2-block-south", "P2", 5, 5),
    ],
  });

  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });

  assert.equal(result.ok, false);
});

test("F-014 rush continuation uses frozen commanded state for the initiating player", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      frozenOwner: "P1",
      frozenPieceStatesById: {
        C1: { supplied: true, commanded: true },
        "U1-1": { supplied: true, commanded: true },
      },
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 9),
      commander("C2", "P2", 9, 0),
      unit("U1-1", "P1", 4, 4, { commanded: false, supplied: true }),
      unit("U2-1", "P2", 4, 6),
    ],
  });

  const result = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });

  assert.equal(result.ok, true);
});

test("F-015 rush continuation can display a piece as inactive while it remains legally usable", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      frozenOwner: "P1",
      frozenPieceStatesById: {
        C1: { supplied: true, commanded: true },
        "U1-1": { supplied: true, commanded: true },
      },
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 9, { commanded: true, supplied: true }),
      commander("C2", "P2", 9, 0, { commanded: true, supplied: true }),
      unit("U1-1", "P1", 4, 4, {
        supplied: true,
        commanded: true,
        displaySupplied: false,
        displayCommanded: false,
      }),
      unit("U2-1", "P2", 4, 6),
    ],
  });

  const legal = validateAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });

  assert.equal(legal.ok, true);
  assert.equal(state.pieces.find((piece) => piece.id === "U1-1")?.displayCommanded, false);
});

test("F-016 rush continuation updates display supply without dropping frozen usability", () => {
  const state = makeState({
    continuation: {
      type: "rush",
      owner: "P1",
      frozenOwner: "P1",
      frozenPieceStatesById: {
        C1: { supplied: true, commanded: true },
        "U1-1": { supplied: true, commanded: true },
      },
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 5),
      unit("U2-1", "P2", 4, 6),
      unit("U2-wall-top", "P2", 0, 4),
      unit("U2-wall-bottom", "P2", 9, 4),
      unit("U2-block-north", "P2", 3, 5),
      unit("U2-block-south", "P2", 5, 5),
    ],
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  const piece = resolved.pieces.find((candidate) => candidate.id === "U1-1");
  assert.equal(piece?.supplied, true);
  assert.equal(piece?.displaySupplied, false);
});
