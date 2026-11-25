import test from "node:test";
import assert from "node:assert/strict";
import { proveTactical, TacticalInterrupted } from "../src/tactics.ts";

const rules = { terminal: node => node.value, controller: node => node.owner, children: node => node.children ?? [] };
test("minimax uses actual controller, including repeated P1 and repeated P2 decisions", () => {
  const win = { value: 1 }, loss = { value: -1 };
  const sameP1 = { owner: "P1", children: [{ owner: "P1", children: [win, loss] }, loss] };
  const sameP2 = { owner: "P2", children: [{ owner: "P2", children: [win, loss] }, win] };
  assert.deepEqual(proveTactical(sameP1, 4, rules), { lower: 1, upper: 1, incomplete: false });
  assert.deepEqual(proveTactical(sameP2, 4, rules), { lower: -1, upper: -1, incomplete: false });
  const defenderChoice = { owner: "P1", children: [{ owner: "P2", children: [win, loss] }] };
  assert.equal(proveTactical(defenderChoice, 4, rules).upper, -1);
});

test("horizon exhaustion, interrupted computation and proved draw remain distinct", () => {
  const ongoing = { owner: "P1", children: [{ value: 1 }] };
  assert.deepEqual(proveTactical(ongoing, 0, rules), { lower: -1, upper: 1, incomplete: false });
  assert.deepEqual(proveTactical(ongoing, 4, { ...rules, children: () => { throw new TacticalInterrupted(); } }), { lower: -1, upper: 1, incomplete: true });
  assert.deepEqual(proveTactical({ owner: "P1", children: [{ value: 0 }] }, 4, rules), { lower: 0, upper: 0, incomplete: false });
  assert.throws(() => proveTactical(ongoing, 4, { ...rules, children: () => { throw new Error("bad engine"); } }), /bad engine/);
});

test("unknown alternatives cannot be claimed as losses or wins", () => {
  const unknown = { owner: "P2", children: [] };
  assert.deepEqual(proveTactical({ owner: "P1", children: [{ value: -1 }, unknown] }, 4, rules), { lower: -1, upper: 1, incomplete: true });
  assert.deepEqual(proveTactical({ owner: "P2", children: [{ value: 1 }, unknown] }, 4, rules), { lower: -1, upper: 1, incomplete: true });
});

test("settlement follows retreat then Follow under their own controllers", () => {
  const win = { value: 1 }, escape = { value: 0 };
  const follow = { owner: "P1", continuing: true, children: [escape, win] };
  const retreat = { owner: "P2", continuing: true, children: [follow, escape] };
  const settlement = { ...rules, continuation: node => node.continuing === true };
  assert.deepEqual(proveTactical(retreat, 0, rules), { lower: -1, upper: 1, incomplete: false });
  assert.deepEqual(proveTactical(retreat, 0, settlement, 4), { lower: 0, upper: 0, incomplete: false });
  assert.equal(proveTactical({ ...retreat, children: [follow] }, 0, settlement, 2).lower, 1);
  assert.equal(proveTactical({ ...retreat, children: [follow] }, 0, settlement, 1).lower, -1);
  function* interrupted(node) {
    if (node !== retreat) { yield* node.children; return; }
    yield follow;
    throw new TacticalInterrupted();
  }
  assert.deepEqual(proveTactical(retreat, 0, { ...settlement, children: interrupted }, 4),
    { lower: -1, upper: 1, incomplete: true });
});
