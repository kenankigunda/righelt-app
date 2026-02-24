import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, validateAction } from "../../src/index.ts";
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
