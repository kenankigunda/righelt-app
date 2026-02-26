import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../../src/state.ts";
import { resolveToStability } from "../../src/resolve.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

test("supplied is true when path to supply exists", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 1, col: 9 },
    supplied: false,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const u1a = resolved.pieces.find((piece) => piece.id === "U1a");
  assert.equal(Boolean(u1a?.supplied), true);
});

test("supplied is false when path to supply does not exist", () => {
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

test("supply recomputes after occupancy change before final terminal evaluation", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 0, col: 9 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 0, col: 8 },
    supplied: true,
    commanded: true,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 1, col: 9 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const c1 = resolved.pieces.find((piece) => piece.id === "C1");
  assert.equal(Boolean(c1?.supplied), true);
  assert.equal(resolved.outcome.status, "ongoing");
});

test("B-001 commander supply is computed from pathing and can become false", () => {
  const state = createInitialState();
  addPiece(state, { id: "U2a", owner: "P2", kind: "unit", position: { row: 2, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2b", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2c", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2d", owner: "P2", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  const c1 = resolved.pieces.find((piece) => piece.id === "C1");
  assert.equal(Boolean(c1?.supplied), false);
});

test("H-001 supplied is true for reachable piece", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1h1", owner: "P1", kind: "unit", position: { row: 1, col: 9 }, supplied: false, commanded: false });
  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  const piece = resolved.pieces.find((candidate) => candidate.id === "U1h1");
  assert.equal(Boolean(piece?.supplied), true);
});

test("H-002 supplied is false when commander has no path", () => {
  const state = createInitialState();
  addPiece(state, { id: "U2h2a", owner: "P2", kind: "unit", position: { row: 2, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h2b", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h2c", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h2d", owner: "P2", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  const c1 = resolved.pieces.find((candidate) => candidate.id === "C1");
  assert.equal(Boolean(c1?.supplied), false);
});

test("H-003 unsupplied non-commander is removed by forced effects", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1h3", owner: "P1", kind: "unit", position: { row: 1, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h3a", owner: "P2", kind: "unit", position: { row: 0, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h3b", owner: "P2", kind: "unit", position: { row: 2, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h3c", owner: "P2", kind: "unit", position: { row: 1, col: 0 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2h3d", owner: "P2", kind: "unit", position: { row: 1, col: 2 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.pieces.some((piece) => piece.id === "U1h3"), false);
});
