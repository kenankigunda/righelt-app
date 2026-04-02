import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, listLegalActions, validateAction } from "../../src/index.ts";
import { resolveToStability } from "../../src/resolve.ts";
import { commander, makeState, unit } from "../helpers/state-builders.mjs";

test("G-001 push legal with stronger attacker group", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 1),
      unit("D1", "P2", 4, 2),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, true);

  const next = applyAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  }).state;

  assert.deepEqual(next.pieces.find((piece) => piece.id === "A1")?.position, { row: 4, col: 2 });
  assert.deepEqual(next.pieces.find((piece) => piece.id === "D1")?.position, { row: 4, col: 2 });
  assert.equal(next.pieces.find((piece) => piece.id === "D1")?.pushed, true);
  assert.deepEqual(next.continuation?.followPoint, { row: 4, col: 1 });
  assert.equal(next.continuation?.phase, "retreat");
  assert.equal(next.continuation?.owner, "P2");
  assert.equal(next.continuation?.attackerOwner, "P1");
  assert.equal(next.sideToMove, "P2");
  assert.deepEqual(
    listLegalActions(next).map((action) => action.type),
    ["retreat", "retreat", "retreat"],
  );
  assert.equal(listLegalActions(next).every((action) => action.actorId === "D1"), true);
});

test("G-002 push illegal on equal strength", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("D1", "P2", 4, 2),
    ],
  });
  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, false);
});

test("G-003 push illegal on weaker attacker", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("D1", "P2", 4, 2),
      unit("D2", "P2", 5, 2),
    ],
  });
  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, false);
});

test("G-004 push target must be orthogonally adjacent enemy", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 1),
      unit("D1", "P2", 4, 3),
    ],
  });
  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 3 },
  });
  assert.equal(result.ok, false);
});

test("G-005 cannot push while disallowed temporary state", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1, { shifted: true }),
      unit("A2", "P1", 3, 1),
      unit("D1", "P2", 4, 2),
    ],
  });
  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, false);
});

test("G-006 follow legal into follow-point", () => {
  const state = makeState({
    continuation: {
      type: "push",
      owner: "P1",
      attackerOwner: "P1",
      phase: "follow",
      followPoint: { row: 4, col: 3 },
      followGroupPieceIds: ["A1", "F1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 4, { shifted: true }),
      unit("F1", "P1", 4, 2),
      unit("D1", "P2", 4, 6, { pushed: true }),
    ],
  });
  const result = validateAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  });
  assert.equal(result.ok, true);

  const next = applyAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  }).state;
  assert.deepEqual(next.pieces.find((piece) => piece.id === "F1")?.position, { row: 4, col: 3 });
  assert.deepEqual(next.continuation?.followPoint, { row: 4, col: 2 });
});

test("G-007 follow illegal outside push continuation", () => {
  const state = makeState({
    pieces: [commander("C1", "P1", 0, 0), commander("C2", "P2", 9, 9), unit("F1", "P1", 4, 2)],
  });
  const result = validateAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  });
  assert.equal(result.ok, false);
});

test("G-008 follow cannot reuse shifted piece", () => {
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
      unit("F1", "P1", 4, 2, { shifted: true }),
      unit("D1", "P2", 4, 6, { pushed: true }),
    ],
  });
  const result = validateAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  });
  assert.equal(result.ok, false);
});

test("G-009 retreat legal to orthogonal empty square", () => {
  const state = makeState({
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P2",
      attackerOwner: "P1",
      phase: "retreat",
      followPoint: { row: 4, col: 3 },
      pushedPieceId: "D1",
      followGroupPieceIds: ["A1", "A2"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 4, { shifted: true }),
      unit("A2", "P1", 4, 2),
      unit("D1", "P2", 4, 4, { pushed: true }),
    ],
  });
  const result = validateAction(state, {
    type: "retreat",
    actorId: "D1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });
  assert.equal(result.ok, true);

  const next = applyAction(state, {
    type: "retreat",
    actorId: "D1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  }).state;
  assert.equal(next.pieces.find((piece) => piece.id === "D1")?.pushed, false);
  assert.equal(next.sideToMove, "P1");
  assert.equal(next.continuation?.phase, "follow");
  assert.equal(next.continuation?.owner, "P1");
  assert.deepEqual(listLegalActions(next), [
    {
      type: "follow",
      actorId: "A2",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("G-010 retreat illegal to diagonal square", () => {
  const state = makeState({
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P2",
      attackerOwner: "P1",
      phase: "retreat",
      followPoint: { row: 4, col: 1 },
      pushedPieceId: "D1",
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("D1", "P2", 4, 4, { pushed: true }),
    ],
  });
  const result = validateAction(state, {
    type: "retreat",
    actorId: "D1",
    from: { row: 4, col: 4 },
    to: { row: 5, col: 5 },
  });
  assert.equal(result.ok, false);
});

test("G-011 forced removal when no retreat", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 1),
      unit("D1", "P2", 4, 2),
      unit("B1", "P1", 3, 2),
      unit("B2", "P2", 5, 2),
      unit("B3", "P1", 4, 3),
    ],
  });

  const next = applyAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  }).state;

  assert.equal(next.pieces.some((piece) => piece.id === "D1"), false);
  assert.equal(next.continuation?.phase, "follow");
  assert.equal(next.continuation?.owner, "P1");
  assert.equal(next.sideToMove, "P1");
});

test("G-012 diagonal adjacency does not contribute to attacker group strength", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 2),
      unit("D1", "P2", 4, 2),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, false);
});

test("G-013 diagonal adjacency does not contribute to defender group strength", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 1),
      unit("D1", "P2", 4, 2),
      unit("D2", "P2", 5, 3),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, true);
});

test("G-014 orthogonal chain connectivity contributes to push strength", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 4, 0),
      unit("A3", "P1", 5, 0),
      unit("D1", "P2", 4, 2),
      unit("D2", "P2", 5, 2),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, true);
});

test("G-015 push target cannot be a friendly adjacent piece", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 1),
      unit("A2", "P1", 3, 1),
      unit("F1", "P1", 4, 2),
      unit("D1", "P2", 4, 3),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  });
  assert.equal(result.ok, false);
});

test("G-016 edge push still grants retreat through the attacker origin square", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 0, 0),
      commander("C2", "P2", 9, 9),
      unit("A1", "P1", 4, 8),
      unit("A2", "P1", 3, 8),
      unit("D1", "P2", 4, 9),
    ],
  });

  const next = applyAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 8 },
    to: { row: 4, col: 9 },
  }).state;

  assert.equal(next.pieces.some((piece) => piece.id === "D1"), true);
  assert.equal(next.pieces.find((piece) => piece.id === "D1")?.pushed, true);
  assert.deepEqual(next.pieces.find((piece) => piece.id === "D1")?.position, { row: 4, col: 9 });
  assert.equal(next.continuation?.phase, "retreat");
  assert.equal(next.continuation?.owner, "P2");
  assert.equal(next.sideToMove, "P2");
  assert.equal(next.turnIndex, 0);
});

test("G-017 push illegal when pushed destination would leave attacker unsupplied", () => {
  const state = makeState({
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("A1", "P1", 4, 4),
      unit("A2", "P1", 4, 3),
      unit("A3", "P1", 3, 3),
      unit("A4", "P1", 5, 3),
      unit("A5", "P1", 6, 3),
      unit("D1", "P2", 4, 5),
      unit("U2-wall-top", "P2", 0, 4),
      unit("U2-wall-bottom", "P2", 9, 4),
      unit("U2-block-north", "P2", 3, 5),
      unit("U2-block-south", "P2", 5, 5),
      unit("U2-block-east", "P2", 4, 6),
    ],
  });

  const result = validateAction(state, {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "SUPPLY_DESTINATION_UNSUPPLIED");
  }
});

test("G-018 follow illegal when follow destination would leave follower unsupplied", () => {
  const state = makeState({
    continuation: {
      type: "push",
      owner: "P1",
      attackerOwner: "P1",
      phase: "follow",
      followPoint: { row: 4, col: 5 },
      followGroupPieceIds: ["A1", "F1"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 6, 3),
      unit("A1", "P1", 4, 6, { shifted: true }),
      unit("F1", "P1", 4, 4),
      unit("D1", "P2", 4, 7, { pushed: true }),
      unit("U2-wall-top", "P2", 0, 4),
      unit("U2-wall-bottom", "P2", 9, 4),
      unit("U2-block-north", "P2", 3, 5),
      unit("U2-block-south", "P2", 5, 5),
      unit("U2-block-east", "P2", 4, 6),
    ],
  });

  const result = validateAction(state, {
    type: "follow",
    actorId: "F1",
    from: { row: 4, col: 4 },
    to: { row: 4, col: 5 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "SUPPLY_DESTINATION_UNSUPPLIED");
  }
});

test("G-019 retreat may enter a temporarily unsupplied square", () => {
  const state = makeState({
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P2",
      attackerOwner: "P1",
      phase: "retreat",
      followPoint: { row: 4, col: 3 },
      pushedPieceId: "D1",
      followGroupPieceIds: ["A"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 8, 1),
      unit("D1", "P2", 5, 3, { pushed: true }),
      unit("U1-wall-top", "P1", 0, 3),
      unit("U1-wall-bottom", "P1", 9, 3),
      unit("U1-block-north", "P1", 4, 4),
      unit("U1-block-south", "P1", 6, 4),
      unit("U1-block-east", "P1", 5, 5),
    ],
  });

  const result = validateAction(state, {
    type: "retreat",
    actorId: "D1",
    from: { row: 5, col: 3 },
    to: { row: 5, col: 4 },
  });

  assert.equal(result.ok, true);
});

test("retreated piece is removed for loss of supply only after the push sequence closes", () => {
  const state = makeState({
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P2",
      attackerOwner: "P1",
      phase: "retreat",
      followPoint: { row: 4, col: 3 },
      pushedPieceId: "D1",
      followGroupPieceIds: ["A"],
      chainLength: 1,
    },
    pieces: [
      commander("C1", "P1", 3, 6),
      commander("C2", "P2", 8, 1),
      unit("D1", "P2", 5, 3, { pushed: true }),
      unit("U1-wall-top", "P1", 0, 3),
      unit("U1-wall-bottom", "P1", 9, 3),
      unit("U1-block-north", "P1", 4, 4),
      unit("U1-block-south", "P1", 6, 4),
      unit("U1-block-east", "P1", 5, 5),
    ],
  });

  const afterRetreat = applyAction(state, {
    type: "retreat",
    actorId: "D1",
    from: { row: 5, col: 3 },
    to: { row: 5, col: 4 },
  }).state;

  assert.equal(afterRetreat.pieces.some((piece) => piece.id === "D1"), true);
  assert.equal(afterRetreat.continuation?.phase, "follow");

  const resolved = resolveToStability(afterRetreat, { artifactMode: "minimal" });
  assert.equal(resolved.continuation, null);
  assert.equal(resolved.pieces.some((piece) => piece.id === "D1"), false);
});
