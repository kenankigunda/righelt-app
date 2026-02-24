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
    position: { row: 3, col: 8 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 9 },
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
    position: { row: 3, col: 8 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 9 },
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
