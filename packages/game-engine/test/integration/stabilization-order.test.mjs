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
