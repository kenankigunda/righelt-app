import test from "node:test";
import assert from "node:assert/strict";

import { resolveToStability } from "../../src/resolve.ts";
import { applyAction, validateAction } from "../../src/index.ts";

function baseState() {
  return {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    pieces: [
      {
        id: "C1",
        owner: "P1",
        kind: "commander",
        position: { row: 3, col: 6 },
        supplied: true,
        commanded: true,
      },
      {
        id: "C2",
        owner: "P2",
        kind: "commander",
        position: { row: 6, col: 3 },
        supplied: true,
        commanded: true,
      },
    ],
    continuation: null,
    outcome: { status: "ongoing" },
  };
}

test("push continuation closes and side switches when no follow obligation remains", () => {
  const state = baseState();
  state.continuation = {
    type: "push",
    owner: "P1",
    followPoint: { row: 4, col: 4 },
    chainLength: 1,
  };

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.continuation, null);
  assert.equal(resolved.sideToMove, "P2");
});

test("rush continuation remains active while same-side rush candidate exists", () => {
  const state = baseState();
  state.continuation = {
    type: "rush",
    owner: "P1",
    chainLength: 1,
  };
  state.pieces.push({
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.ok(resolved.continuation);
  assert.equal(resolved.continuation?.type, "rush");
  assert.equal(resolved.sideToMove, "P1");
});

test("rush continuation closes and side switches when no rush candidates remain", () => {
  const state = baseState();
  state.continuation = {
    type: "rush",
    owner: "P1",
    chainLength: 1,
  };

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.continuation, null);
  assert.equal(resolved.sideToMove, "P2");
});

test("rush continuation closes when only previously rushed pieces have legal rushes", () => {
  const state = baseState();
  const p1Commander = state.pieces.find((piece) => piece.id === "C1");
  if (!p1Commander) {
    throw new Error("expected P1 commander");
  }
  p1Commander.position = { row: 0, col: 0 };
  state.continuation = {
    type: "rush",
    owner: "P1",
    rushedPieceIds: ["U1a"],
    chainLength: 1,
  };
  state.pieces.push({
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.continuation, null);
  assert.equal(resolved.sideToMove, "P2");
});

test("rush continuation remains active when an unused piece still has a legal rush", () => {
  const state = baseState();
  const p1Commander = state.pieces.find((piece) => piece.id === "C1");
  if (!p1Commander) {
    throw new Error("expected P1 commander");
  }
  p1Commander.position = { row: 0, col: 0 };
  state.continuation = {
    type: "rush",
    owner: "P1",
    rushedPieceIds: ["U1a"],
    chainLength: 1,
  };
  state.pieces.push({
    id: "U1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U1b",
    owner: "P1",
    kind: "unit",
    position: { row: 0, col: 2 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 0, col: 4 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.continuation?.type, "rush");
  assert.equal(resolved.sideToMove, "P1");
});

test("terminal outcome clears continuation context", () => {
  const state = baseState();
  state.continuation = {
    type: "push",
    owner: "P1",
    followPoint: { row: 4, col: 4 },
    chainLength: 1,
  };
  state.pieces.push({
    id: "U2a",
    owner: "P2",
    kind: "unit",
    position: { row: 2, col: 6 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2b",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2c",
    owner: "P2",
    kind: "unit",
    position: { row: 3, col: 5 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2d",
    owner: "P2",
    kind: "unit",
    position: { row: 3, col: 7 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.notEqual(resolved.outcome.status, "ongoing");
  assert.equal(resolved.continuation, null);
});

test("O-001 rush continuation can chain multiple rush actions", () => {
  const state = baseState();
  state.pieces.push({
    id: "U1o1a",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U1o1b",
    owner: "P1",
    kind: "unit",
    position: { row: 6, col: 6 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2o1a",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 6 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U2o1b",
    owner: "P2",
    kind: "unit",
    position: { row: 6, col: 8 },
    supplied: true,
    commanded: true,
  });

  const afterFirst = applyAction(state, {
    type: "rush",
    actorId: "U1o1a",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;
  const afterSecond = applyAction(afterFirst, {
    type: "rush",
    actorId: "U1o1b",
    from: { row: 6, col: 6 },
    to: { row: 6, col: 7 },
  }).state;

  assert.equal(afterSecond.continuation?.type, "rush");
  assert.equal(afterSecond.continuation?.chainLength, 2);
});

test("O-002 continuation closes exactly when obligations are exhausted", () => {
  const state = baseState();
  state.continuation = {
    type: "push",
    owner: "P1",
    followPoint: { row: 4, col: 4 },
    chainLength: 1,
  };

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.continuation, null);
  assert.equal(resolved.sideToMove, "P2");
});

test("O-003 non-continuation action is rejected while continuation is active", () => {
  const state = baseState();
  state.continuation = {
    type: "push",
    owner: "P1",
    followPoint: { row: 4, col: 4 },
    chainLength: 1,
  };

  const result = validateAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 3, col: 6 },
    to: { row: 3, col: 7 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONTINUATION_REQUIRED");
  }
});

test("O-004 resolve handles continuation-induced forced removals before terminal check", () => {
  const state = baseState();
  state.continuation = {
    type: "push",
    owner: "P1",
    pushedPieceId: "U2o4",
    chainLength: 1,
  };
  state.pieces.push({
    id: "U2o4",
    owner: "P2",
    kind: "unit",
    position: { row: 4, col: 4 },
    supplied: true,
    commanded: true,
    pushed: true,
  });
  state.pieces.push({
    id: "U1o4a",
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U1o4b",
    owner: "P1",
    kind: "unit",
    position: { row: 5, col: 4 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U1o4c",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 5 },
    supplied: true,
    commanded: true,
  });
  state.pieces.push({
    id: "U1o4d",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 3 },
    supplied: true,
    commanded: true,
  });

  const resolved = resolveToStability(state, { artifactMode: "minimal" });
  assert.equal(resolved.pieces.some((piece) => piece.id === "U2o4"), false);
  assert.equal(resolved.continuation, null);
});
