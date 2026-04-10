import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComputerPlayerCommandId,
  buildComputerPlayerDerivedTurnKey,
  getComputerPlayerThinkTargetMs,
  buildComputerPlayerTurnKey,
  runComputerPlayerSelectMove,
} from "../shell/computer-player-runtime.js";

test("computer-player runtime prefers an explicit activeTurnKey and keeps command ids stable", () => {
  const game = {
    id: "game-cp-1",
    currentTurn: {
      index: 4,
      playerSeat: "Player 1",
      moveIndexes: [0, 1],
    },
    controlSeat: "Player 2",
    computerPlayer: {
      activeTurnKey: "turn-live-001",
      botId: "tau-tenacious",
    },
  };

  assert.equal(buildComputerPlayerTurnKey(game), "turn-live-001");
  assert.equal(buildComputerPlayerDerivedTurnKey(game), "game-cp-1|turn:4|moves:2|owner:Player 1|control:Player 2");
  assert.equal(buildComputerPlayerCommandId(game, "select"), "bot:game-cp-1:turn-live-001:tau-tenacious:select");
});

test("computer-player think target uses persona floors and deterministic complexity bonuses", () => {
  assert.equal(getComputerPlayerThinkTargetMs({ botId: "babs" }), 600);
  assert.equal(getComputerPlayerThinkTargetMs({ botId: "tau" }), 800);
  assert.equal(getComputerPlayerThinkTargetMs({ botId: "sev" }), 800);
  assert.equal(getComputerPlayerThinkTargetMs({ botId: "horus" }), 1200);

  assert.equal(
    getComputerPlayerThinkTargetMs({
      botId: "babs",
      diagnostics: { legalActionCount: 10, exploredNodes: 50 },
    }),
    750,
  );
  assert.equal(
    getComputerPlayerThinkTargetMs({
      botId: "tau",
      diagnostics: { legalActionCount: 6, exploredNodes: 700 },
    }),
    1100,
  );
  assert.equal(
    getComputerPlayerThinkTargetMs({
      botId: "horus",
      diagnostics: { legalActionCount: 8, exploredNodes: 0 },
    }),
    1200,
  );
});

test("computer-player runtime can be overridden without changing the browser contract", async () => {
  const original = globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__;
  const requests = [];
  globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = (request) => {
    requests.push(request);
    return {
      action: { type: "pass" },
      diagnostics: {
        selectedAction: { key: "pass" },
      },
    };
  };

  try {
    const response = await runComputerPlayerSelectMove({
      personaId: "babs",
      state: { sideToMove: "P1" },
      legalActions: [{ type: "pass" }],
      seed: 123,
      trace: true,
    });

    assert.equal(requests.length, 1);
    assert.equal(response.diagnostics.selectedAction.key, "pass");
    assert.equal(response.action.type, "pass");
  } finally {
    globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = original;
  }
});
