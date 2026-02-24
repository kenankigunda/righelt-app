import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../../src/state.ts";
import { resolveToStability } from "../../src/resolve.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

test("initial state resolves with both commanders supplied and ongoing outcome", () => {
  const state = createInitialState();
  const resolved = resolveToStability(state, { artifactMode: "full" });

  const c1 = resolved.pieces.find((piece) => piece.id === "C1");
  const c2 = resolved.pieces.find((piece) => piece.id === "C2");

  assert.equal(Boolean(c1?.supplied), true);
  assert.equal(Boolean(c2?.supplied), true);
  assert.equal(resolved.outcome.status, "ongoing");
  assert.deepEqual(resolved.artifacts?.supply.map((entry) => entry.player), ["P1", "P2"]);
});

test("unsupplied commander is terminal and commander remains on board", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 2, col: 6 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2b",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2c",
    owner: "P2",
    kind: "unit",
    position: { row: 3, col: 5 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2d",
    owner: "P2",
    kind: "unit",
    position: { row: 3, col: 7 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const c1 = resolved.pieces.find((piece) => piece.id === "C1");

  assert.ok(c1);
  assert.equal(c1.supplied, false);
  assert.equal(resolved.outcome.status, "p2_win");
});

test("unsupplied non-commander is removed during forced effects", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 1, col: 1 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 0, col: 1 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2b",
    owner: "P2",
    kind: "unit",
    position: { row: 2, col: 1 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2c",
    owner: "P2",
    kind: "unit",
    position: { row: 1, col: 0 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U2d",
    owner: "P2",
    kind: "unit",
    position: { row: 1, col: 2 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });

  assert.equal(resolved.pieces.some((piece) => piece.id === "U1a"), false);
});
