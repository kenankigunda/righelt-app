import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createIncomingMoveReplayController,
  getControlledSeats,
  isIncomingMoveReplayEligible,
} from "../shell/incoming-move-replay.js";

const createMove = ({ actorSide = "P2", index = 0, notation = `M${index + 1}` } = {}) => ({
  index,
  actorSide,
  notation,
  action: {
    type: "move",
    actorId: `piece-${index}`,
    from: { row: index, col: 0 },
    to: { row: index, col: 1 },
  },
  selectionSnapshot: {
    sideToMove: actorSide,
    turnIndex: index,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      {
        id: `piece-${index}`,
        owner: actorSide,
        kind: "unit",
        position: { row: index, col: 0 },
        supplied: true,
        commanded: true,
      },
    ],
  },
  snapshot: {
    sideToMove: actorSide === "P1" ? "P2" : "P1",
    turnIndex: index,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      {
        id: `piece-${index}`,
        owner: actorSide,
        kind: "unit",
        position: { row: index, col: 1 },
        supplied: true,
        commanded: true,
      },
    ],
  },
  destroyedPieces: [],
});

const createGame = ({ moves = [], myRoles = ["Player 1"], id = "game-replay" } = {}) => ({
  id,
  myRoles,
  myRole: myRoles[0] ?? "Viewer",
  inHistoryMode: false,
  currentSnapshot: moves.at(-1)?.snapshot ?? {
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [],
  },
  legalActions: [],
  moves,
});

const createFakeClock = () => {
  let nextId = 1;
  const timers = [];
  return {
    setTimeout(fn, delay) {
      const handle = { id: nextId++, fn, delay, cleared: false };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (!handle) {
        return;
      }
      handle.cleared = true;
    },
    flushNext(expectedDelay = null) {
      const next = timers.shift();
      assert.ok(next, "expected a pending timer");
      if (expectedDelay !== null) {
        assert.equal(next.delay, expectedDelay);
      }
      if (!next.cleared) {
        next.fn();
      }
      return next;
    },
    getPendingDelays() {
      return timers.filter((timer) => !timer.cleared).map((timer) => timer.delay);
    },
  };
};

test("incoming move replay waits for focus return before starting", () => {
  const clock = createFakeClock();
  let currentGame = createGame({ moves: [] });
  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => true,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);
  controller.setWindowFocused(false);

  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);

  assert.equal(controller.getActiveReplay(currentGame.id), null);
  assert.deepEqual(controller.getQueuedMoveIndexes(currentGame.id), [0]);

  controller.setWindowFocused(true);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "baseline");
  assert.deepEqual(controller.getActiveReplay(currentGame.id)?.snapshot, currentGame.moves[0].selectionSnapshot);
  assert.deepEqual(clock.getPendingDelays(), [350]);
  clock.flushNext(350);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "preview");
  assert.equal(controller.getActiveReplay(currentGame.id)?.actorSeat, "Player 2");
  clock.flushNext(450);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "settle");
  assert.deepEqual(controller.getActiveReplay(currentGame.id)?.snapshot, currentGame.moves[0].snapshot);
  clock.flushNext(450);
  assert.equal(controller.getActiveReplay(currentGame.id), null);
});

test("incoming move replay hides the baseline override when the current board already matches the move snapshot", () => {
  const clock = createFakeClock();
  let currentGame = createGame({ moves: [] });
  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    isBaselinePresentationSatisfied: () => true,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => true,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);

  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);

  assert.equal(controller.getActiveReplay(currentGame.id), null);
  assert.equal(controller.getReplayState(currentGame.id)?.phase, "armed");
  assert.equal(controller.isReplayActiveForGame(currentGame.id), true);
  assert.deepEqual(clock.getPendingDelays(), [180]);

  clock.flushNext(180);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "preview");
});

test("incoming move replay skips locally controlled seats and viewer mode replays all seats", () => {
  const ownerGame = createGame({
    moves: [createMove({ actorSide: "P1", index: 0 }), createMove({ actorSide: "P2", index: 1 })],
    myRoles: ["Player 1"],
  });
  assert.deepEqual(getControlledSeats(ownerGame), ["Player 1"]);
  assert.equal(isIncomingMoveReplayEligible({ game: ownerGame, move: ownerGame.moves[0] }), false);
  assert.equal(isIncomingMoveReplayEligible({ game: ownerGame, move: ownerGame.moves[1] }), true);

  const viewerGame = createGame({
    moves: [createMove({ actorSide: "P1", index: 0 }), createMove({ actorSide: "P2", index: 1 })],
    myRoles: ["Viewer"],
  });
  assert.equal(isIncomingMoveReplayEligible({ game: viewerGame, move: viewerGame.moves[0] }), true);
  assert.equal(isIncomingMoveReplayEligible({ game: viewerGame, move: viewerGame.moves[1] }), true);

  const selfPlayGame = createGame({
    moves: [createMove({ actorSide: "P1", index: 0 }), createMove({ actorSide: "P2", index: 1 })],
    myRoles: ["Player 1", "Player 2"],
  });
  assert.equal(isIncomingMoveReplayEligible({ game: selfPlayGame, move: selfPlayGame.moves[0] }), false);
  assert.equal(isIncomingMoveReplayEligible({ game: selfPlayGame, move: selfPlayGame.moves[1] }), false);
});

test("incoming move replay replays all unseen moves in order and uses static steps for reduced motion", () => {
  const clock = createFakeClock();
  let currentGame = createGame({ moves: [], myRoles: ["Viewer"] });
  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    prefersReducedMotion: () => true,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => true,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);

  currentGame = createGame({
    moves: [createMove({ actorSide: "P1", index: 0 }), createMove({ actorSide: "P2", index: 1 })],
    myRoles: ["Viewer"],
  });
  controller.observeAuthoritativeGame(currentGame);

  const baselineReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(baselineReplay?.moveIndex, 0);
  assert.equal(baselineReplay?.phase, "baseline");
  assert.deepEqual(baselineReplay?.snapshot, currentGame.moves[0].selectionSnapshot);
  clock.flushNext(180);
  const firstReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(firstReplay?.phase, "preview");
  assert.equal(firstReplay?.moveIndex, 0);
  assert.equal(firstReplay?.animated, false);
  clock.flushNext(450);
  const firstSettle = controller.getActiveReplay(currentGame.id);
  assert.equal(firstSettle?.phase, "settle");
  assert.deepEqual(firstSettle?.snapshot, currentGame.moves[0].snapshot);
  clock.flushNext(450);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "settle");
  clock.flushNext(150);
  const secondBaseline = controller.getActiveReplay(currentGame.id);
  assert.equal(secondBaseline?.phase, "baseline");
  assert.deepEqual(secondBaseline?.snapshot, currentGame.moves[1].selectionSnapshot);
  clock.flushNext(180);
  const secondReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(secondReplay?.phase, "preview");
  assert.equal(secondReplay?.moveIndex, 1);
  assert.equal(secondReplay?.animated, false);
});

test("incoming move replay source emphasis stays fully opaque at animation start", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@keyframes incoming-move-replay-source \{\s*from \{\s*opacity: 1;\s*transform: scale\(1\);/s,
  );
  assert.doesNotMatch(
    css,
    /@keyframes incoming-move-replay-source \{\s*from \{\s*opacity:\s*0\.\d+/s,
  );
});
