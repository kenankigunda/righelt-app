import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyScenarioToGame, reconcileGameToScenarioResultingState, applyServerAction,
  applyRevertToMove, createInitialGame, exportScenarioFromGame, withViewModel,
} from "../src/shell-live-core.ts";
import { listLegalActions } from "../../game-engine/src/index.ts";
import { getTurnOwnerSideForState } from "../../shared-types/src/shell-live-turn.js";

const catalog = JSON.parse(readFileSync(new URL("../../../apps/web/scenarios/catalog.json", import.meta.url)));
const fixture = catalog.scenarios.find(({ title }) => title === "Retreat after push");
const swapSides = (value) => {
  if (value === "P1") return "P2";
  if (value === "P2") return "P1";
  if (typeof value === "string") return value.replace(/([CU])([12])(?=-|$)/g, (_, kind, side) => kind + (side === "1" ? "2" : "1"));
  if (Array.isArray(value)) return value.map(swapSides);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [swapSides(key), (key === "row" || key === "col") && Number.isInteger(child) ? 9 - child : swapSides(child)]));
  return value;
};

for (const mirrored of [false, true]) {
  for (const legacy of [false, true]) {
  for (const initialContinuation of [false, true]) {
    test(`imported push resumes retreat, follow, undo and exported branch (${mirrored ? "P1" : "P2"} attacker; ${initialContinuation ? "initial" : "resulting"} state; ${legacy ? "legacy" : "current"})`, () => {
      const scenario = mirrored ? swapSides(structuredClone(fixture)) : structuredClone(fixture);
      const attacker = scenario.resultingState.continuation.attackerOwner;
      if (legacy) delete scenario.resultingState.continuation.attackerOwner;
      if (initialContinuation) {
        scenario.initialState = structuredClone(scenario.resultingState);
        scenario.moves = [];
      }
      const game = createInitialGame({ gameId: "import-push", identityId: "tester", selfPlayMode: true });
      applyScenarioToGame(game, scenario);
      const ownerSeat = attacker === "P1" ? "Player 1" : "Player 2";
      assert.equal(game.turns.at(-1).playerSeat, ownerSeat, "initial import must preserve turn owner");
      assert.equal(withViewModel(game, "tester").canRecordMove, true);
      assert.equal(withViewModel(game, "tester").controlSeat, attacker === "P1" ? "Player 2" : "Player 1");
      reconcileGameToScenarioResultingState(game, scenario);
      assert.equal(game.turns.at(-1).playerSeat, ownerSeat);
      const retreat = listLegalActions(game.board.state).find((action) => action.type === "retreat");
      assert.ok(retreat);
      const moved = applyServerAction(game, retreat);
      assert.equal(moved.ok, true);
      assert.equal(game.board.state.sideToMove, attacker);
      const follow = listLegalActions(game.board.state).find((action) => action.type === "follow");
      assert.ok(follow, "recorded retreat must leave follow playable");
      assert.equal(applyServerAction(game, follow).ok, true);
      assert.equal(applyRevertToMove(game, moved.move.moveId, "tester").ok, true);
      assert.equal(game.turns.at(-1).playerSeat, ownerSeat);
      assert.equal(applyServerAction(game, retreat).ok, true);
      assert.ok(listLegalActions(game.board.state).some((action) => action.type === "follow"));
      const exported = exportScenarioFromGame(game, { scenarioId: "branch", title: "branch" });
      const branch = createInitialGame({ gameId: "branch", identityId: "tester", selfPlayMode: true });
      applyScenarioToGame(branch, exported);
      reconcileGameToScenarioResultingState(branch, exported);
      assert.equal(branch.turns.at(-1).playerSeat, ownerSeat);
      assert.ok(listLegalActions(branch.board.state).some((action) => action.type === "follow"));
    });
  }
  }
}

test("legacy push continuation without attackerOwner still distinguishes retreat control from turn ownership", () => {
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P1", continuation: { type: "push", phase: "retreat" } }), "P2");
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P2", continuation: { type: "push", phase: "follow" } }), "P2");
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P1", continuation: { type: "rush" } }), "P1");
});
