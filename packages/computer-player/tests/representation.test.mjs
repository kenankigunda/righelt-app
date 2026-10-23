import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, resolveToStability } from "../../game-engine/src/index.ts";
import { encodeState, encodeAction, legalActionMap, experimentConfig } from "../src/index.ts";

const cell = (encoded, name, row, col) => encoded[experimentConfig.planes.indexOf(name) * 100 + row * 10 + col];
test("46 planes preserve overlapping owners and frozen false versus absent entries", () => {
  const state = createInitialState();
  state.pieces[1].position = { ...state.pieces[0].position };
  state.pieces[1].pushed = true;
  state.sideToMove = "P2";
  state.continuation = { type: "push", owner: "P2", attackerOwner: "P1", phase: "retreat",
    frozenOwner: "P1", chainLength: 2048, followPoint: { row: 3, col: 5 }, pushedPieceId: "C2",
    followGroupPieceIds: ["C1"], rushedPieceIds: ["C1"], rushChainPieceIds: ["C1"],
    frozenPieceStatesById: { C1: { supplied: false, commanded: true } } };
  const before = structuredClone(state);
  const encoded = encodeState(state);
  assert.equal(encoded.length, 4600);
  for (const name of ["P1.commander", "P2.commander", "P2.pushed", "P1.frozenPresent", "P1.frozenCommanded",
    "P1.followGroup", "P1.rushed", "P1.rushChain", "P2.pushedPiece", "controller.P2", "phase.retreat", "owner.P2", "attackerOwner.P1", "frozenOwner.P1"]) {
    assert.equal(cell(encoded, name, 3, 6), 1, name);
  }
  assert.equal(cell(encoded, "P1.frozenSupplied", 3, 6), 0);
  assert.equal(cell(encoded, "P2.frozenPresent", 3, 6), 0);
  assert.equal(cell(encoded, "followPoint", 3, 5), 1);
  assert.equal(cell(encoded, "supply.P1", 0, 9), 1);
  assert.equal(cell(encoded, "supply.P2", 9, 0), 1);
  assert.ok(cell(encoded, "chainLength", 0, 0) > 1);
  assert.deepEqual(state, before);
});

test("rejects malformed counters, coordinates, flags and lossy occupancy", () => {
  for (const turnIndex of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => encodeState({ ...createInitialState(), turnIndex }), /counter/);
  }
  const duplicate = createInitialState();
  duplicate.pieces.push({ ...duplicate.pieces[0], id: "other" });
  assert.throws(() => encodeState(duplicate), /occupancy/);
  const bad = createInitialState(); bad.pieces[0].position.row = NaN;
  assert.throws(() => encodeState(bad), /coordinate/);
  bad.pieces[0].position.row = 3; bad.pieces[0].supplied = "yes";
  assert.throws(() => encodeState(bad), /supplied/);
});

test("all 28 geometric channels and pass match source-major public encoding", () => {
  const origin = { row: 4, col: 4 };
  const orthogonal = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const rush = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
  let channel = 0;
  for (const type of ["move", "project", "rush", "push", "follow", "retreat"]) {
    for (const [dr, dc] of type === "rush" ? rush : orthogonal) {
      const distance = type === "project" ? 2 : 1;
      assert.equal(encodeAction({ type, from: origin, to: { row: 4 + dr * distance, col: 4 + dc * distance } }), 44 * 28 + channel++);
    }
  }
  assert.equal(channel, 28);
  assert.equal(encodeAction({ type: "pass" }), 2800);
  assert.throws(() => encodeAction({ type: "move", from: origin, to: { row: 5, col: 5 } }), /channel/);
});

test("legal map retains authoritative identities and terminal masks are empty", () => {
  const state = resolveToStability(createInitialState());
  const map = legalActionMap(state);
  assert.ok(map.size > 1);
  for (const [index, action] of map) {
    assert.equal(encodeAction(action), index);
    if (action.type !== "pass") assert.equal(action.actorId, "C1");
  }
  assert.equal(legalActionMap({ ...state, outcome: { status: "p1_win" } }).size, 0);
});
