import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildIncomingMoveReplayStep,
  createIncomingMoveReplayController,
  getControlledSeats,
  isIncomingMoveReplayEligible,
} from "../shell/incoming-move-replay.js";

const createMove = ({
  actorSide = "P2",
  index = 0,
  notation = `M${index + 1}`,
  actionType = "move",
  from = { row: index, col: 0 },
  to = { row: index, col: 1 },
  settledPieceId = `piece-${index}`,
} = {}) => ({
  index,
  actorSide,
  notation,
  action: {
    type: actionType,
    actorId: `piece-${index}`,
    from,
    to,
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
        position: from,
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
        id: settledPieceId,
        owner: actorSide,
        kind: "unit",
        position: to,
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
  let focused = true;
  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => focused,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);
  focused = false;
  controller.setWindowFocused(false);

  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);

  assert.equal(controller.getActiveReplay(currentGame.id), null);
  assert.deepEqual(controller.getQueuedMoveIndexes(currentGame.id), [0]);

  focused = true;
  controller.setWindowFocused(true);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "lead-in");
  assert.deepEqual(controller.getActiveReplay(currentGame.id)?.snapshot, currentGame.moves[0].selectionSnapshot);
  assert.deepEqual(clock.getPendingDelays(), [350]);
  clock.flushNext(350);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "preview");
  assert.equal(controller.getActiveReplay(currentGame.id)?.actorSeat, "Player 2");
  clock.flushNext(320);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "settle");
  assert.deepEqual(controller.getActiveReplay(currentGame.id)?.snapshot, currentGame.moves[0].snapshot);
  clock.flushNext(220);
  assert.equal(controller.getActiveReplay(currentGame.id), null);
});

test("incoming move replay uses a hidden lead-in frame before preview chrome appears", () => {
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

  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);

  assert.equal(controller.getReplayState(currentGame.id)?.phase, "lead-in");
  assert.equal(controller.getReplayState(currentGame.id)?.showsReplayChrome, false);
  assert.equal(controller.getReplayState(currentGame.id)?.interactionLocked, true);
  assert.equal(controller.isReplayActiveForGame(currentGame.id), true);
  assert.deepEqual(clock.getPendingDelays(), [180]);

  clock.flushNext(180);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "preview");
  clock.flushNext(320);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "settle");
});

test("incoming move replay uses the settled snapshot for project previews while keeping baseline pre-action", () => {
  const projectMove = createMove({
    actorSide: "P2",
    index: 0,
    actionType: "project",
    from: { row: 6, col: 5 },
    to: { row: 5, col: 5 },
    settledPieceId: "projected-piece-0",
  });
  const game = createGame({ moves: [projectMove] });

  const leadInStep = buildIncomingMoveReplayStep({ game, moveIndex: 0, phase: "lead-in" });
  const previewStep = buildIncomingMoveReplayStep({ game, moveIndex: 0, phase: "preview" });
  const settleStep = buildIncomingMoveReplayStep({ game, moveIndex: 0, phase: "settle" });

  assert.deepEqual(leadInStep?.snapshot, projectMove.selectionSnapshot);
  assert.deepEqual(previewStep?.snapshot, projectMove.snapshot);
  assert.deepEqual(settleStep?.snapshot, projectMove.snapshot);
  assert.equal(previewStep?.recordedMovePresentation?.recordedAction?.type, "project");
  assert.equal(previewStep?.showsReplayChrome, true);
  assert.equal(leadInStep?.showsReplayChrome, false);
});

test("incoming move replay project preview completes directly to the live board without a visible settle phase", () => {
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

  currentGame = createGame({
    moves: [
      createMove({
        actorSide: "P2",
        index: 0,
        actionType: "project",
        from: { row: 6, col: 4 },
        to: { row: 8, col: 4 },
        settledPieceId: "projected-piece-1",
      }),
    ],
  });
  controller.observeAuthoritativeGame(currentGame);

  assert.equal(controller.getReplayState(currentGame.id)?.phase, "lead-in");
  clock.flushNext(180);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "preview");
  clock.flushNext(320);
  assert.equal(controller.getReplayState(currentGame.id), null);
});

test("incoming move replay uses live focus detection before activating the hidden lead-in", () => {
  const clock = createFakeClock();
  let currentGame = createGame({ moves: [] });
  let focused = true;
  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => focused,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);

  focused = false;
  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);
  assert.equal(controller.getReplayState(currentGame.id), null);
  assert.deepEqual(controller.getQueuedMoveIndexes(currentGame.id), [0]);

  controller.setWindowFocused(true);
  assert.equal(controller.getReplayState(currentGame.id), null);
  assert.deepEqual(controller.getQueuedMoveIndexes(currentGame.id), [0]);

  focused = true;
  controller.setWindowFocused(true);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "lead-in");
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

  const leadInReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(leadInReplay?.moveIndex, 0);
  assert.equal(leadInReplay?.phase, "lead-in");
  assert.deepEqual(leadInReplay?.snapshot, currentGame.moves[0].selectionSnapshot);
  clock.flushNext(180);
  const firstReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(firstReplay?.phase, "preview");
  assert.equal(firstReplay?.moveIndex, 0);
  assert.equal(firstReplay?.animated, false);
  clock.flushNext(320);
  const firstSettle = controller.getActiveReplay(currentGame.id);
  assert.equal(firstSettle?.phase, "settle");
  assert.deepEqual(firstSettle?.snapshot, currentGame.moves[0].snapshot);
  clock.flushNext(220);
  const secondLeadIn = controller.getActiveReplay(currentGame.id);
  assert.equal(secondLeadIn?.phase, "lead-in");
  assert.deepEqual(secondLeadIn?.snapshot, currentGame.moves[1].selectionSnapshot);
  clock.flushNext(180);
  const secondReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(secondReplay?.phase, "preview");
  assert.equal(secondReplay?.moveIndex, 1);
  assert.equal(secondReplay?.animated, false);
});

test("incoming move replay cancels a stale sequence when the authoritative tail is rewritten at the same move count", () => {
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

  currentGame = createGame({ moves: [createMove({ actorSide: "P2", index: 0 })] });
  controller.observeAuthoritativeGame(currentGame);
  assert.equal(controller.getActiveReplay(currentGame.id)?.phase, "lead-in");

  const rewrittenMove = createMove({
    actorSide: "P2",
    index: 0,
    notation: "REWRITTEN",
    to: { row: 0, col: 2 },
    settledPieceId: "piece-rewritten",
  });
  currentGame = createGame({ moves: [rewrittenMove] });
  controller.observeAuthoritativeGame(currentGame);

  const restartedReplay = controller.getActiveReplay(currentGame.id);
  assert.equal(restartedReplay?.phase, "lead-in");
  assert.equal(restartedReplay?.notation, "REWRITTEN");
  assert.deepEqual(restartedReplay?.snapshot, rewrittenMove.selectionSnapshot);
  assert.deepEqual(clock.getPendingDelays(), [180]);
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

test("incoming move replay arrow uses timing-only animation without distinct dash styling", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\.incoming-move-replay-arrow-animate \{\s*animation: incoming-move-replay-arrow 140ms/s,
  );
  assert.doesNotMatch(css, /\.incoming-move-replay-arrow-animate \{[^}]*stroke-dasharray:/s);
  assert.doesNotMatch(css, /@keyframes incoming-move-replay-arrow \{[\s\S]*stroke-dashoffset/s);
});
