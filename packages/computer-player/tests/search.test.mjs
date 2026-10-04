import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInitialState, resolveToStability, validateAction } from "../../game-engine/src/index.ts";
import { selectMove, seededRandom, transition, terminalValue, legalActionMap } from "../src/index.ts";
import { catalogActions } from "./catalog-helper.mjs";

const initial = () => resolveToStability(createInitialState());
const uniform = async () => ({ policyLogits: new Float32Array(2801), value: .25 });
test("seeded PUCT returns completed legal model-informed visits", async () => {
  const request = { state: initial(), seed: 31, simulations: 8, maxValueGap: .1, temperature: .5 };
  const first = await selectMove(request, uniform);
  const second = await selectMove(request, uniform);
  assert.equal(first.status, "ready");
  assert.equal(validateAction(request.state, first.action).ok, true);
  assert.deepEqual(first.action, second.action);
  assert.deepEqual(first.policy, second.policy);
  assert.ok(first.actions.find(item => item.index === first.actionIndex).visits > 0);
  assert.equal(first.actions.find(item => item.index === first.actionIndex).immediate, "eligible");
  assert.ok(Math.abs(first.policy.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-10);
  assert.ok(first.nodes <= 2048);
  assert.equal(first.policyMask, true);
  assert.equal(first.fallback, null);
});

test("expired pre-model work recovers; tiny post-model budgets emit explicit masked fallback", async () => {
  const deadline = await selectMove({ state: initial(), seed: 1, deadlineMs: 0 }, uniform);
  assert.equal(deadline.status, "recovery");
  assert.equal(deadline.stopped, "deadline");
  const tiny = await selectMove({ state: initial(), seed: 1, maxNodes: 1 }, uniform);
  assert.equal(tiny.status, "ready");
  assert.equal(tiny.reason, "model-fallback");
  assert.equal(tiny.fallback.reason, "safety-incomplete");
  assert.equal(tiny.policyMask, false);
  assert.deepEqual(tiny.policy, []);
  assert.ok(tiny.actions.every(action => action.visits === 0));
  assert.equal(tiny.stopped, "node-limit");
});

test("cancellation before and after evaluator await rejects stale work", async () => {
  const control = new AbortController(); control.abort();
  await assert.rejects(selectMove({ state: initial(), seed: 1, signal: control.signal }, uniform), { name: "AbortError" });
  const during = new AbortController();
  await assert.rejects(selectMove({ state: initial(), seed: 1, signal: during.signal }, async () => {
    during.abort(); return uniform();
  }), { name: "AbortError" });
});

test("invalid model values and masked logits are rejected", async () => {
  for (const value of [NaN, Infinity, -Infinity, 1.0000001192092896, -1.0000001192092896, 1.01, -1.01]) {
    await assert.rejects(selectMove({ state: initial(), seed: 1 }, async () => ({ policyLogits: new Float32Array(2801), value })), /model output/);
  }
  for (const length of [0, 2800, 2802]) {
    await assert.rejects(selectMove({ state: initial(), seed: 1 }, async () => ({ policyLogits: new Float32Array(length), value: 0 })), /model output/);
  }
  const logits = new Float32Array(2801); logits[0] = Infinity;
  await assert.rejects(selectMove({ state: initial(), seed: 1 }, async () => ({ policyLogits: logits, value: 0 })), /Non-finite/);
});

test("terminal truth bypasses inference and seeded streams are reproducible", async () => {
  const result = await selectMove({ state: { ...initial(), outcome: { status: "p2_win" } }, seed: 1 }, async () => { throw new Error("must not infer"); });
  assert.equal(result.reason, "terminal");
  const a = seededRandom(1), b = seededRandom(1);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
});

test("default64 nonuniform evaluator completes normal opening within node cap", async () => {
  let calls = 0;
  const result = await selectMove({ state: initial(), seed: 17 }, async () => {
    calls++;
    return { policyLogits: Float32Array.from({ length: 2801 }, (_, index) => Math.sin(index)), value: .1 };
  });
  assert.equal(result.status, "ready");
  assert.ok(calls > 1);
  assert.ok(result.simulations > 0);
  assert.ok(result.nodes <= 2048);
});

test("immediate authoritative win overrides an adversarial pass preference", async () => {
  const catalog = JSON.parse(readFileSync(new URL("../../../apps/web/scenarios/catalog.json", import.meta.url)));
  const scenario = catalog.scenarios.find(item => item.title === "Commander surrounded loss of supply");
  let state = resolveToStability(structuredClone(scenario.initialState));
  let winningStart;
  for (const action of catalogActions(scenario)) {
    const next = transition(state, action);
    if (terminalValue(next) === (state.sideToMove === "P1" ? 1 : -1)) { winningStart = state; break; }
    state = next;
  }
  assert.ok(winningStart);
  const result = await selectMove({ state: winningStart, seed: 7 }, async () => {
    const policyLogits = new Float32Array(2801); policyLogits[2800] = 100;
    return { policyLogits, value: 0 };
  });
  assert.equal(result.status, "ready");
  assert.equal(result.reason, "immediate-win");
  assert.equal(terminalValue(transition(winningStart, result.action)), winningStart.sideToMove === "P1" ? 1 : -1);
});

test("default search can act through real continuation controllers", async () => {
  const catalog = JSON.parse(readFileSync(new URL("../../../apps/web/scenarios/catalog.json", import.meta.url)));
  const starts = new Map();
  for (const scenario of catalog.scenarios.slice(0, 8)) {
    let state = resolveToStability(structuredClone(scenario.initialState));
    for (const action of catalogActions(scenario)) {
      state = transition(state, action);
      if (state.continuation) {
        const phase = state.continuation.phase ?? state.continuation.type;
        if (!starts.has(phase)) starts.set(phase, structuredClone(state));
      }
    }
  }
  for (const phase of ["retreat", "follow", "rush"]) {
    assert.ok(starts.has(phase));
    const state = starts.get(phase);
    const result = await selectMove({ state, seed: 13 }, uniform);
    assert.equal(result.status, "ready", phase);
    assert.equal(validateAction(state, result.action).ok, true);
    assert.ok(result.nodes <= 2048);
  }
});

test("both controllers reject an immediate losing reply despite overwhelming model preference", async () => {
  const base = createInitialState();
  base.pieces[1].position = { row: 3, col: 9 };
  for (const [index, [row, col]] of [[2, 6], [4, 6], [3, 5]].entries()) {
    base.pieces.push({ id: `block${index}`, owner: "P2", kind: "unit", position: { row, col }, supplied: true, commanded: true });
  }
  for (const controller of ["P1", "P2"]) {
    const state = structuredClone(base);
    if (controller === "P2") {
      state.sideToMove = "P2";
      for (const piece of state.pieces) {
        piece.owner = piece.owner === "P1" ? "P2" : "P1";
        if (piece.kind === "commander") piece.id = piece.owner === "P1" ? "C1" : "C2";
        piece.position = { row: 9 - piece.position.row, col: 9 - piece.position.col };
      }
    }
    resolveToStability(state);
    const result = await selectMove({ state, seed: 3, simulations: 8 }, async () => {
      const policyLogits = new Float32Array(2801); policyLogits[2800] = 20;
      return { policyLogits, value: 0 };
    });
    assert.equal(result.status, "ready");
    assert.equal(result.actions.find(item => item.index === 2800).immediate, "losing");
    assert.notEqual(result.action.type, "pass");
    const next = transition(state, result.action);
    if (next.sideToMove !== controller) {
      for (const reply of legalActionMap(next).values()) {
        assert.notEqual(terminalValue(transition(next, reply)), controller === "P1" ? -1 : 1);
      }
    }
  }
});

test("soft deadline returns only earlier completed model evaluations", async () => {
  const request = { state: initial(), seed: 31, simulations: 64 };
  let calls = 0;
  const result = await selectMove(request, async () => {
    if (++calls === 3) request.deadlineMs = 0;
    return uniform();
  });
  assert.equal(result.status, "ready");
  assert.equal(result.stopped, "deadline");
  assert.equal(result.simulations, 1);
  assert.equal(result.actions.filter(item => item.visits > 0).length, 1);
});

test("internal legal enumeration has its own allowance without raising the search node ceiling", async () => {
  const { buildContinuationSuccessorState } = await import('../../game-engine/src/index.ts');
  const { commander, makeState, unit } = await import('../../game-engine/test/helpers/state-builders.mjs');
  const raw=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,4),unit('B','P1',5,5),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)]});
  const state=buildContinuationSuccessorState(raw,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  const result=await selectMove({state,seed:107,maxNodes:2},uniform);
  assert.equal(result.status,'ready');assert.equal(result.reason,'model-fallback');
  assert.equal(result.policyMask,false);assert.equal(result.stopped,'node-limit');assert.equal(result.nodes,2);
  assert.ok(result.actions.length>0);
  assert.ok(result.engineBudget.peakExpansions>result.nodes);
  assert.equal(result.engineBudget.perOperationLimit,16384);
  assert.ok(legalActionMap(state).size>0);
});
