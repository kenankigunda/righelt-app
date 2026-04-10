import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComputerPlayerCommandId,
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
  assert.equal(buildComputerPlayerCommandId(game, "select"), "bot:game-cp-1:turn-live-001:tau-tenacious:select");
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
