import test from "node:test";
import assert from "node:assert/strict";

import { applyAction } from "../../src/index.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("applyAction assigns next projected unit id after highest numeric suffix", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4),
      unit("U1-3", "P1", 4, 8),
    ],
  });

  const next = applyAction(state, {
    type: "project",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 6 },
  }).state;

  assert.ok(next.pieces.some((piece) => piece.id === "U1-4"));
});

test("applyAction clears shifted flags when an action ends the turn", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("U1-1", "P1", 4, 4, { shifted: true }),
    ],
  });

  const next = applyAction(state, {
    type: "move",
    actorId: "C1",
    from: { row: 3, col: 6 },
    to: { row: 3, col: 7 },
  }).state;
  const shifted = next.pieces.find((piece) => piece.id === "U1-1");
  assert.equal(Boolean(shifted?.shifted), false);
});

test("applyAction retains shifted actor during continuation until turn end", () => {
  const state = makeState({
    continuation: {
      type: "push",
      owner: "P1",
      attackerOwner: "P1",
      phase: "follow",
      followPoint: { row: 4, col: 3 },
      followGroupPieceIds: ["F1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("F1", "P1", 4, 2),
    ],
  });

  const next = applyAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  }).state;

  const follower = next.pieces.find((piece) => piece.id === "F1");
  assert.equal(Boolean(follower?.shifted), true);
  assert.equal(next.continuation?.type, "push");
});

test("applyAction snapshots initiating player command and supply when a continuation starts", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 9, { commanded: true, supplied: true }),
      commander("C2", "P2", 9, 0),
      unit("U1-1", "P1", 4, 4, { commanded: true, supplied: true }),
      unit("U2-1", "P2", 4, 6),
    ],
  });

  const next = applyAction(state, {
    type: "rush",
    actorId: "U1-1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;

  assert.equal(next.continuation?.type, "rush");
  assert.equal(next.continuation?.frozenOwner, "P1");
  assert.deepEqual(next.continuation?.frozenPieceStatesById?.["U1-1"], {
    supplied: true,
    commanded: true,
  });
  assert.deepEqual(next.continuation?.frozenPieceStatesById?.C1, {
    supplied: true,
    commanded: true,
  });
});
