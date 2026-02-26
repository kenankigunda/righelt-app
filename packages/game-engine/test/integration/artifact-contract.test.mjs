import test from "node:test";
import assert from "node:assert/strict";

import { replayActions } from "../../src/replay.ts";
import { resolveToStability } from "../../src/resolve.ts";
import { createInitialState } from "../../src/state.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

function supplyArtifactFor(artifacts, player) {
  return artifacts?.supply.find((entry) => entry.player === player);
}

test("full artifact mode returns supply shortest-path artifacts", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 1, col: 9 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const p1Supply = supplyArtifactFor(resolved.artifacts, "P1");
  assert.ok(p1Supply);
  assert.ok(Array.isArray(p1Supply.shortestPathByPieceId.U1a));
  assert.ok(p1Supply.shortestPathByPieceId.U1a.length > 0);
  assert.equal(typeof p1Supply.distanceByPieceId.U1a, "number");
});

test("supply shortest-path selection is deterministic for equal-length options", () => {
  const buildState = () => {
    const state = createInitialState();
    addPiece(state, {
      id: "U1a",
      owner: "P1",
      kind: "unit",
      position: { row: 2, col: 8 },
      supplied: true,
      commanded: true,
    });
    return state;
  };

  const runA = resolveToStability(buildState(), { artifactMode: "full" });
  const runB = resolveToStability(buildState(), { artifactMode: "full" });
  const pathA = supplyArtifactFor(runA.artifacts, "P1")?.shortestPathByPieceId.U1a;
  const pathB = supplyArtifactFor(runB.artifacts, "P1")?.shortestPathByPieceId.U1a;

  assert.deepEqual(pathA, pathB);
});

test("command artifact includes candidate/cut/active edges and commander paths", () => {
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

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const command = resolved.artifacts?.command;
  assert.ok(command);
  assert.ok(command.candidateEdges.includes("C1|U1a"));
  assert.ok(command.candidateEdges.includes("U2a|U2b"));
  assert.ok(command.cutEdges.includes("C1|U1a"));
  assert.ok(Array.isArray(command.activeEdges));
  assert.ok(Array.isArray(command.shortestPathToCommanderByPieceId.C1));
});

test("Q-003 command artifact reports stable candidate/cut/active edge sets", () => {
  const buildState = () => {
    const state = createInitialState();
    addPiece(state, { id: "U1q3", owner: "P1", kind: "unit", position: { row: 3, col: 9 }, supplied: true, commanded: false });
    addPiece(state, { id: "U2q3a", owner: "P2", kind: "unit", position: { row: 1, col: 8 }, supplied: true, commanded: false });
    addPiece(state, { id: "U2q3b", owner: "P2", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: false });
    return state;
  };

  const runA = resolveToStability(buildState(), { artifactMode: "full" });
  const runB = resolveToStability(buildState(), { artifactMode: "full" });
  assert.deepEqual(runA.artifacts?.command.candidateEdges, runB.artifacts?.command.candidateEdges);
  assert.deepEqual(runA.artifacts?.command.cutEdges, runB.artifacts?.command.cutEdges);
  assert.deepEqual(runA.artifacts?.command.activeEdges, runB.artifacts?.command.activeEdges);
});

test("Q-004 commanded piece path-to-commander artifact is present and deterministic", () => {
  const buildState = () => {
    const state = createInitialState();
    addPiece(state, { id: "U1q4", owner: "P1", kind: "unit", position: { row: 3, col: 9 }, supplied: true, commanded: false });
    return state;
  };

  const runA = resolveToStability(buildState(), { artifactMode: "full" });
  const runB = resolveToStability(buildState(), { artifactMode: "full" });
  assert.ok(Array.isArray(runA.artifacts?.command.shortestPathToCommanderByPieceId.U1q4));
  assert.deepEqual(
    runA.artifacts?.command.shortestPathToCommanderByPieceId.U1q4,
    runB.artifacts?.command.shortestPathToCommanderByPieceId.U1q4,
  );
});

test("group artifact exposes components, members, and strengths", () => {
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
    position: { row: 9, col: 0 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const groups = resolved.artifacts?.groups;
  assert.ok(groups);
  const componentId = groups.componentByPieceId.C1;
  assert.ok(componentId);
  assert.ok(Array.isArray(groups.membersByComponentId[componentId]));
  assert.equal(typeof groups.strengthByComponentId[componentId], "number");
});

test("piece supplied/commanded booleans are consistent with artifacts", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 9 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const commandPaths = resolved.artifacts?.command.shortestPathToCommanderByPieceId ?? {};
  const p1Reachability = new Set(supplyArtifactFor(resolved.artifacts, "P1")?.reachability ?? []);
  const p2Reachability = new Set(supplyArtifactFor(resolved.artifacts, "P2")?.reachability ?? []);

  for (const piece of resolved.pieces) {
    const reachabilitySet = piece.owner === "P1" ? p1Reachability : p2Reachability;
    assert.equal(piece.supplied, reachabilitySet.has(piece.id));
    assert.equal(piece.commanded, Object.prototype.hasOwnProperty.call(commandPaths, piece.id));
  }
});

test("minimal and full artifact replay modes produce identical final gameplay state", () => {
  const initial = createInitialState();
  const actions = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];

  const minimal = replayActions(initial, actions, { includeTrace: false, artifactMode: "minimal" });
  const full = replayActions(initial, actions, { includeTrace: false, artifactMode: "full" });

  assert.equal(minimal.failure, undefined);
  assert.equal(full.failure, undefined);
  assert.equal(minimal.finalState.sideToMove, full.finalState.sideToMove);
  assert.equal(minimal.finalState.turnIndex, full.finalState.turnIndex);
  assert.equal(minimal.outcome.status, full.outcome.status);
  assert.equal(minimal.finalState.continuation, full.finalState.continuation);
});
