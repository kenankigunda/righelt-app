import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyScenarioToGame, reconcileGameToScenarioResultingState, applyServerAction,
  applyRevertToMove, createInitialGame, exportScenarioFromGame,
} from "../src/shell-live-core.ts";
import { listLegalActions } from "../../game-engine/src/index.ts";
import { getTurnOwnerSideForState } from "../../shared-types/src/shell-live-turn.js";

const catalog = JSON.parse(readFileSync(new URL("../../../apps/web/scenarios/catalog.json", import.meta.url)));
const fixture = catalog.scenarios.find(({ title }) => title === "Retreat after push");
const swapSides = (value) => {
  if (value === "P1") return "P2";
  if (value === "P2") return "P1";
  if (Array.isArray(value)) return value.map(swapSides);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, swapSides(child)]));
  return value;
};

for (const mirrored of [false, true]) {
  for (const initialContinuation of [false, true]) {
    test(`imported push resumes retreat, follow, undo and exported branch (${mirrored ? "P1" : "P2"} attacker; ${initialContinuation ? "initial" : "resulting"} state)`, () => {
      const scenario = mirrored ? swapSides(structuredClone(fixture)) : structuredClone(fixture);
      if (initialContinuation) {
        scenario.initialState = structuredClone(scenario.resultingState);
        scenario.moves = [];
      }
      const game = createInitialGame({ gameId: "import-push", identityId: "tester", selfPlayMode: true });
      applyScenarioToGame(game, scenario);
      reconcileGameToScenarioResultingState(game, scenario);
      const attacker = scenario.resultingState.continuation.attackerOwner;
      const ownerSeat = attacker === "P1" ? "Player 1" : "Player 2";
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

test("legacy push continuation without attackerOwner still distinguishes retreat control from turn ownership", () => {
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P1", continuation: { type: "push", phase: "retreat" } }), "P2");
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P2", continuation: { type: "push", phase: "follow" } }), "P2");
  assert.equal(getTurnOwnerSideForState({ sideToMove: "P1", continuation: { type: "rush" } }), "P1");
});
