import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComputerPlayerCommandId,
  buildComputerPlayerDerivedTurnKey,
  createComputerPlayerRuntime,
  getComputerPlayerMoveSelectionTimeoutMs,
  getComputerPlayerThinkTargetMs,
  buildComputerPlayerTurnKey,
  runComputerPlayerSelectMove,
} from "../shell/computer-player-runtime.js";

const createFakeClock = () => {
  let currentMs = 0;
  let nextTimerId = 1;
  const timers = new Map();

  const runDueTimers = async () => {
    while (true) {
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.at <= currentMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (dueTimers.length === 0) {
        break;
      }
      const [timerId, timer] = dueTimers[0];
      timers.delete(timerId);
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  return {
    setTimeout: (callback, delay = 0) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        at: currentMs + Math.max(0, Number(delay) || 0),
      });
      return timerId;
    },
    clearTimeout: (timerId) => {
      timers.delete(timerId);
    },
    advanceBy: async (delayMs) => {
      currentMs += Math.max(0, Number(delayMs) || 0);
      await runDueTimers();
    },
  };
};

class FakeWorker {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage() {}

  terminate() {}
}

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

test("computer-player move-selection timeout uses difficulty-based budgets", () => {
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({ botId: "babs" }), 12000);
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({ botId: "tau" }), 21000);
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({ botId: "sev" }), 21000);
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({ botId: "horus" }), 27000);
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({ botId: "unknown-bot" }), 12000);
  assert.equal(getComputerPlayerMoveSelectionTimeoutMs({}), 12000);
});

test("computer-player runtime timeout errors interpolate the effective persona timeout", async () => {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  const clock = createFakeClock();
  const runtime = createComputerPlayerRuntime({
    createWorker: () => ({ worker: new FakeWorker(), workerUrl: "blob:fake" }),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  try {
    const horusSelection = runtime.selectMove({
      personaId: "horus",
      state: { sideToMove: "P1" },
      legalActions: [{ type: "pass" }],
    });
    await clock.advanceBy(26999);
    await Promise.resolve();
    await clock.advanceBy(1);
    await assert.rejects(horusSelection, (error) => {
      assert.equal(error?.code, "computer_player_timeout");
      assert.match(error?.message ?? "", /27000ms/);
      return true;
    });

    const tauSelection = runtime.selectMove({
      personaId: "tau",
      state: { sideToMove: "P1" },
      legalActions: [{ type: "pass" }],
    });
    await clock.advanceBy(20999);
    await Promise.resolve();
    await clock.advanceBy(1);
    await assert.rejects(tauSelection, (error) => {
      assert.equal(error?.code, "computer_player_timeout");
      assert.match(error?.message ?? "", /21000ms/);
      return true;
    });
  } finally {
    runtime.destroy();
    globalThis.Worker = originalWorker;
  }
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
