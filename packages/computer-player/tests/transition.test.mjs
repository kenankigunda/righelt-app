import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveToStability, normalizeState, deterministicStateHash, listLegalActions } from "../../game-engine/src/index.ts";
import { createInitialGame, applyServerActionWithExpectedState, getSeatForSide } from "../../api-handler/src/shell-live-core.ts";
import { transition, encodeState, legalActionMap } from "../src/index.ts";
import { catalogActions } from "./catalog-helper.mjs";

const catalog = JSON.parse(readFileSync(new URL("../../../apps/web/scenarios/catalog.json", import.meta.url)));
test("catalog transitions agree with real server through push, retreat, follow and rush", () => {
  const covered = new Set();
  let overlap = false;
  for (const scenario of catalog.scenarios.slice(0, 8)) {
    const game = createInitialGame({ gameId: "parity", identityId: "test", selfPlayMode: true });
    let state = resolveToStability(normalizeState(scenario.initialState), { artifactMode: "full" });
    game.board.state = structuredClone(state);
    game.turns[0].index = state.turnIndex;
    game.turns[0].playerSeat = getSeatForSide(state.sideToMove);
    for (const action of catalogActions(scenario)) {
      const before = structuredClone(state);
      const actual = transition(state, action);
      assert.deepEqual(state, before, "adapter never mutates input");
      const server = applyServerActionWithExpectedState(game, action, structuredClone(state));
      assert.equal(server.ok, true, `${scenario.title}: ${server.error}`);
      const comparable = resolveToStability(normalizeState(actual), { artifactMode: "full" });
      assert.equal(deterministicStateHash(comparable), deterministicStateHash(server.state), `${scenario.title}: ${action.type}`);
      covered.add(action.type);
      state = actual;
      encodeState(state);
      if (state.continuation?.phase === "retreat") {
        overlap = true;
        assert.equal(legalActionMap(state).size, listLegalActions(state).length);
      }
      if (state.continuation) {
        for (const candidate of legalActionMap(state).values()) {
          const branch = applyServerActionWithExpectedState(structuredClone(game), candidate, structuredClone(state));
          assert.equal(branch.ok, true);
          const expected = resolveToStability(transition(state, candidate), { artifactMode: "full" });
          assert.equal(deterministicStateHash(expected), deterministicStateHash(branch.state), candidate.type);
          covered.add(candidate.type);
        }
      }
    }
  }
  for (const type of ["move", "project", "push", "retreat", "follow", "rush"]) assert.ok(covered.has(type), type);
  assert.equal(overlap, true);
});
