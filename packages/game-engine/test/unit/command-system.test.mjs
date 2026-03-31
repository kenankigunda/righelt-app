import test from "node:test";
import assert from "node:assert/strict";

import { listLegalActions, validateAction } from "../../src/legal.ts";
import { createInitialState } from "../../src/state.ts";
import { resolveToStability } from "../../src/resolve.ts";

function addPiece(state, piece) {
  state.pieces.push(piece);
}

test("I-001 commander commands itself", () => {
  const state = createInitialState();
  const resolved = resolveToStability(state, { artifactMode: "full" });

  const c1 = resolved.pieces.find((piece) => piece.id === "C1");
  const c2 = resolved.pieces.find((piece) => piece.id === "C2");
  assert.equal(Boolean(c1?.commanded), true);
  assert.equal(Boolean(c2?.commanded), true);
});

test("I-002 orthogonal command edge through empty squares is created", () => {
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
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("C1|U1a"));
  assert.ok(resolved.artifacts?.command.activeEdges.includes("C1|U1a"));
});

test("I-003 diagonal command edge allowed only at distance 1", () => {
  const state = createInitialState();
  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 7 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 5, col: 8 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("U1a|U1b"));
  assert.equal(resolved.artifacts?.command.candidateEdges.includes("C1|U1b"), false);
});

test("I-004 and I-005 edge intersections cut command links and block propagation across them", () => {
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
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("C1|U1a"));
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("U2a|U2b"));
  assert.ok(resolved.artifacts?.command.cutEdges.includes("C1|U1a"));
  assert.ok(resolved.artifacts?.command.cutEdges.includes("U2a|U2b"));
  assert.equal(resolved.artifacts?.command.activeEdges.includes("C1|U1a"), false);

  const u1a = resolved.pieces.find((piece) => piece.id === "U1a");
  assert.equal(Boolean(u1a?.commanded), false);
});

test("diagonal enemy edge intersections cut both command edges", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 7 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 3, col: 7 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2b",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("C1|U1a"));
  assert.ok(resolved.artifacts?.command.candidateEdges.includes("U2a|U2b"));
  assert.ok(resolved.artifacts?.command.cutEdges.includes("C1|U1a"));
  assert.ok(resolved.artifacts?.command.cutEdges.includes("U2a|U2b"));
  assert.equal(resolved.artifacts?.command.activeEdges.includes("U2a|U2b"), false);

  const p2Target = resolved.pieces.find((piece) => piece.id === "U2b");
  assert.equal(Boolean(p2Target?.commanded), false);
});

test("I-006 uncommanded but supplied piece is inactive for action validation and legal-action generation", () => {
  const state = createInitialState();

  addPiece(state, {
    id: "U1i6",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 9 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2i6a",
    owner: "P2",
    kind: "unit",
    position: { row: 1, col: 8 },
    supplied: true,
    commanded: false,
  });
  addPiece(state, {
    id: "U2i6b",
    owner: "P2",
    kind: "unit",
    position: { row: 8, col: 8 },
    supplied: true,
    commanded: false,
  });

  const resolved = resolveToStability(state, { artifactMode: "full" });
  const blockedAction = {
    type: "project",
    actorId: "U1i6",
    from: { row: 3, col: 9 },
    to: { row: 3, col: 7 },
  };

  const validation = validateAction(resolved, blockedAction);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "RULE_VIOLATION");
  assert.equal(
    listLegalActions(resolved).some((action) => action.actorId === "U1i6"),
    false,
  );
});
