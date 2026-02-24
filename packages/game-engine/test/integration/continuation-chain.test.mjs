import test from "node:test";
import assert from "node:assert/strict";

import { resolveToStability } from "../../src/resolve.ts";

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
