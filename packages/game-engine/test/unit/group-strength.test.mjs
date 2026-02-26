import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../../src/state.ts";
import { resolveToStability } from "../../src/resolve.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

test("group strength equals connected component size", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 7 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 8 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1c",
    owner: "P1",
    kind: "unit",
    position: { row: 9, col: 0 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const groups = resolved.artifacts?.groups;
  assert.ok(groups);

  const c1Component = groups.componentByPieceId.C1;
  const u1cComponent = groups.componentByPieceId.U1c;
  assert.ok(c1Component);
  assert.ok(u1cComponent);
  assert.notEqual(c1Component, u1cComponent);

  assert.equal(groups.strengthByComponentId[c1Component], 3);
  assert.equal(groups.strengthByComponentId[u1cComponent], 1);
});

test("group composition recomputes after board change", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 7 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 8 },
    supplied: true,
    commanded: false,
  });

  const before = resolveToStability(state, { artifactMode: "full" });
  const beforeStrength = before.artifacts?.groups.strengthByComponentId[before.artifacts?.groups.componentByPieceId.C1];
  assert.equal(beforeStrength, 3);

  const movingPiece = before.pieces.find((piece) => piece.id === "U1b");
  assert.ok(movingPiece);
  movingPiece.position = { row: 9, col: 9 };
  movingPiece.supplied = true;
  movingPiece.commanded = false;
  before.outcome = { status: "ongoing" };

  const after = resolveToStability(before, { artifactMode: "full" });
  const afterStrength = after.artifacts?.groups.strengthByComponentId[after.artifacts?.groups.componentByPieceId.C1];
  assert.equal(afterStrength, 2);
});

test("diagonal neighbors are not in the same strength group", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 5, col: 5 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const groups = resolved.artifacts?.groups;
  assert.ok(groups);

  const first = groups.componentByPieceId.U1a;
  const second = groups.componentByPieceId.U1b;
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(groups.strengthByComponentId[first], 1);
  assert.equal(groups.strengthByComponentId[second], 1);
});

test("J-001 group strength equals orthogonally-connected member count", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1j1", owner: "P1", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1j2", owner: "P1", kind: "unit", position: { row: 3, col: 8 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1j3", owner: "P1", kind: "unit", position: { row: 9, col: 9 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const groups = resolved.artifacts?.groups;
  assert.ok(groups);
  const c1Component = groups.componentByPieceId.C1;
  assert.equal(groups.strengthByComponentId[c1Component], 3);
});

test("J-002 group strengths recompute after board-change connectivity shift", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1j4", owner: "P1", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1j5", owner: "P1", kind: "unit", position: { row: 3, col: 8 }, supplied: true, commanded: true });

  const before = resolveToStability(state, { artifactMode: "full" });
  const moved = before.pieces.find((piece) => piece.id === "U1j5");
  assert.ok(moved);
  moved.position = { row: 9, col: 0 };

  const after = resolveToStability(before, { artifactMode: "full" });
  const groups = after.artifacts?.groups;
  assert.ok(groups);
  const c1Component = groups.componentByPieceId.C1;
  assert.equal(groups.strengthByComponentId[c1Component], 2);
});
