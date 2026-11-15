import test from "node:test";
import assert from "node:assert/strict";

import { attributeDestructions, finalSupplyLossMoveId } from "../../src/destruction-attribution.ts";

const frame = ({ supplied, displaySupplied = supplied, present = true }) => ({
  pieces: present ? [{ id: "P", supplied, displaySupplied }] : [],
});
const move = (moveId, supply, options = {}) => ({
  moveId,
  snapshot: frame(typeof supply === "object" ? supply : { supplied: supply }),
  ...options,
});

test("attributes a settlement destruction to the first cut after the last resupply", () => {
  const moves = [
    move("m1", false),
    move("m2", true),
    move("m3", false),
    move("m4", { supplied: false, present: false }, { inspectionSnapshot: frame({ supplied: false }) }),
  ];

  assert.equal(finalSupplyLossMoveId(moves, "P", "m4"), "m3");
  assert.deepEqual(attributeDestructions([
    { pieceId: "P", reason: "loss_of_supply" },
  ], moves, "m4"), [{
    pieceId: "P",
    reason: "loss_of_supply",
    removalPhase: "turn_settlement",
    causalMoveId: "m3",
  }]);
});

test("uses the frozen display supply state and resets attribution across restoration", () => {
  const moves = [
    move("m1", { supplied: true, displaySupplied: false }),
    move("m2", { supplied: false, displaySupplied: true }),
    move("m3", { supplied: true, displaySupplied: false }),
  ];
  assert.equal(finalSupplyLossMoveId(moves, "P", "m3"), "m3");
});

test("keeps immediate no-retreat destruction on the action that removed it", () => {
  assert.deepEqual(attributeDestructions([
    { pieceId: "P", reason: "no_retreat" },
  ], [move("m1", true)], "m1"), [{
    pieceId: "P",
    reason: "no_retreat",
    removalPhase: "immediate",
    causalMoveId: "m1",
  }]);
});

test("does not fabricate a causal move when retained evidence is incomplete", () => {
  assert.deepEqual(attributeDestructions([
    { pieceId: "P", reason: "loss_of_supply" },
  ], [move("m1", { supplied: false, present: false })], "m1"), [{
    pieceId: "P",
    reason: "loss_of_supply",
    removalPhase: "turn_settlement",
  }]);
});
