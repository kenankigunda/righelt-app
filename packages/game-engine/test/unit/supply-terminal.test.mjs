import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../../src/state.ts";
import { resolveToStability } from "../../src/resolve.ts";
import { applyAction, listLegalActions, validateAction } from "../../src/index.ts";

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

test("B-006 unsupplied commander is terminal and commander remains on board", () => {
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

test("B-002 opponent wins when C1 is unsupplied and C2 is supplied", () => {
  const state = createInitialState();
  addPiece(state, { id: "U2a", owner: "P2", kind: "unit", position: { row: 2, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2b", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2c", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2d", owner: "P2", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "p2_win");
});

test("B-003 opponent wins when C2 is unsupplied and C1 is supplied", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1a", owner: "P1", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1b", owner: "P1", kind: "unit", position: { row: 7, col: 3 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1c", owner: "P1", kind: "unit", position: { row: 6, col: 2 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1d", owner: "P1", kind: "unit", position: { row: 6, col: 4 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "p1_win");
});

test("B-004 both commanders unsupplied in same stabilized resolve yields draw", () => {
  const state = createInitialState();
  addPiece(state, { id: "U2a", owner: "P2", kind: "unit", position: { row: 2, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2b", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2c", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2d", owner: "P2", kind: "unit", position: { row: 3, col: 7 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1a", owner: "P1", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1b", owner: "P1", kind: "unit", position: { row: 7, col: 3 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1c", owner: "P1", kind: "unit", position: { row: 6, col: 2 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1d", owner: "P1", kind: "unit", position: { row: 6, col: 4 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "draw");
});

test("B-005 legal action that unsupplies a commander ends game immediately", () => {
  const state = {
    ...createInitialState(),
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 6, col: 0 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true },
      { id: "U1-3", owner: "P1", kind: "unit", position: { row: 7, col: 3 }, supplied: true, commanded: true },
      { id: "U1-4", owner: "P1", kind: "unit", position: { row: 6, col: 4 }, supplied: true, commanded: true },
    ],
    sideToMove: "P1",
    continuation: null,
    outcome: { status: "ongoing" },
    turnIndex: 0,
  };

  const afterProject = applyAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 6, col: 0 },
    to: { row: 6, col: 2 },
  }).state;
  const resolved = resolveToStability(afterProject, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "p1_win");
  assert.deepEqual(listLegalActions(resolved), []);

  const blocked = validateAction(resolved, { type: "pass" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, "TERMINAL_GAME");
  }
});
