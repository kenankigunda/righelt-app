import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, validateAction } from "../../src/index.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("E-001 project at distance 2 orthogonal legal", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const next = applyAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 6 },
  }).state;

  const created = next.pieces.find((piece) => piece.id !== "U1-1" && piece.kind === "unit" && piece.owner === "P1");
  assert.ok(created);
  assert.deepEqual(created?.position, { row: 4, col: 6 });
});

test("E-002 project blocked by occupied intermediate", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 5),
    ],
  });
  const result = validateAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 6 },
  });
  assert.equal(result.ok, false);
});

test("E-003 project blocked by occupied destination", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U2-1", "P2", 4, 6),
    ],
  });
  const result = validateAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 6 },
  });
  assert.equal(result.ok, false);
});

test("E-004 project wrong distance illegal", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 3, 6), commander("C2", "P2", 6, 3), unit("U1-1", "P1", 4, 4)],
  });
  const result = validateAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("E-005 inactive piece cannot project", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4, { commanded: false }),
    ],
  });
  const result = validateAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 6 },
  });
  assert.equal(result.ok, false);
});
