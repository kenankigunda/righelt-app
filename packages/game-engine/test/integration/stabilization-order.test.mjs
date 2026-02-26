import test from "node:test";
import assert from "node:assert/strict";

import { resolveToStability } from "../../src/resolve.ts";
import { createInitialState } from "../../src/state.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

test("resolution order reaches deterministic stable artifacts", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 9 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 1, col: 8 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2b",
    owner: "P2",
    kind: "unit",
    position: { row: 8, col: 8 },
    supplied: true,
    commanded: false,
  });

  const runA = resolveToStability(state, { artifactMode: "full" });
  const runB = resolveToStability(createInitialState(), { artifactMode: "full" });
  assert.ok(runA.artifacts);
  assert.ok(Array.isArray(runA.artifacts.command.candidateEdges));
  assert.ok(Array.isArray(runA.artifacts.supply));
  assert.ok(runA.artifacts.groups.componentByPieceId.C1);
  assert.ok(runB.artifacts);
});

test("terminal evaluation is based on stabilized state", () => {
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

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "ongoing");
});

test("K-001 resolve applies deterministic phase order for supply/command/groups", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1k1", owner: "P1", kind: "unit", position: { row: 3, col: 9 }, supplied: true, commanded: false });
  addPiece(state, { id: "U2k1", owner: "P2", kind: "unit", position: { row: 1, col: 8 }, supplied: true, commanded: false });
  addPiece(state, { id: "U2k2", owner: "P2", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: false });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  assert.ok(resolved.artifacts?.supply);
  assert.ok(resolved.artifacts?.command);
  assert.ok(resolved.artifacts?.groups);
  assert.equal(resolved.artifacts.command.cutEdges.includes("C1|U1k1"), true);
});

test("K-002 resolve reruns passes until stable", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1k2", owner: "P1", kind: "unit", position: { row: 1, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k2a", owner: "P2", kind: "unit", position: { row: 0, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k2b", owner: "P2", kind: "unit", position: { row: 2, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k2c", owner: "P2", kind: "unit", position: { row: 1, col: 0 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k2d", owner: "P2", kind: "unit", position: { row: 1, col: 2 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.pieces.some((piece) => piece.id === "U1k2"), false);
});

test("K-002 resolve with insufficient maxPasses throws", () => {
  const state = createInitialState();
  addPiece(state, { id: "U1k3", owner: "P1", kind: "unit", position: { row: 1, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k3a", owner: "P2", kind: "unit", position: { row: 0, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k3b", owner: "P2", kind: "unit", position: { row: 2, col: 1 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k3c", owner: "P2", kind: "unit", position: { row: 1, col: 0 }, supplied: true, commanded: true });
  addPiece(state, { id: "U2k3d", owner: "P2", kind: "unit", position: { row: 1, col: 2 }, supplied: true, commanded: true });

  assert.throws(
    () => resolveToStability(state, { artifactMode: "minimal", maxPasses: 1 }),
    /resolveToStability exceeded max passes/,
  );
});

test("K-003 terminal check uses stabilized state after prior phase updates", () => {
  const state = createInitialState();
  addPiece(state, { id: "U2k4", owner: "P2", kind: "unit", position: { row: 0, col: 9 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1k4a", owner: "P1", kind: "unit", position: { row: 0, col: 8 }, supplied: true, commanded: true });
  addPiece(state, { id: "U1k4b", owner: "P1", kind: "unit", position: { row: 1, col: 9 }, supplied: true, commanded: true });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.outcome.status, "ongoing");
});
