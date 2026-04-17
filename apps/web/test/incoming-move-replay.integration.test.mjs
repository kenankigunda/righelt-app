import test from "node:test";
import assert from "node:assert/strict";

import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createIncomingMoveReplayController } from "../shell/incoming-move-replay.js";

const noop = () => {};

const createMove = () => ({
  index: 0,
  actorSide: "P2",
  notation: "PROJECT (6,3) -> (6,5)",
  action: {
    type: "move",
    actorId: "P2-A1",
    from: { row: 6, col: 3 },
    to: { row: 6, col: 5 },
  },
  selectionSnapshot: {
    sideToMove: "P2",
    turnIndex: 1,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      {
        id: "P2-A1",
        owner: "P2",
        kind: "unit",
        position: { row: 6, col: 3 },
        supplied: true,
        commanded: true,
      },
    ],
  },
  snapshot: {
    sideToMove: "P1",
    turnIndex: 1,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      {
        id: "P2-A1",
        owner: "P2",
        kind: "unit",
        position: { row: 6, col: 5 },
        supplied: true,
        commanded: true,
      },
    ],
  },
  destroyedPieces: [],
});

const createGame = (moves = []) => ({
  id: "game-incoming-replay",
  myRoles: ["Player 1"],
  myRole: "Player 1",
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
  const timers = [];
  return {
    setTimeout(fn, delay) {
      const handle = { fn, delay, cleared: false };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) {
        handle.cleared = true;
      }
    },
    flushNext(expectedDelay) {
      const next = timers.shift();
      assert.ok(next);
      assert.equal(next.delay, expectedDelay);
      if (!next.cleared) {
        next.fn();
      }
    },
  };
};

test("incoming replay controller and board runtime show the replay label while interaction is paused", async () => {
  const clock = createFakeClock();
  let currentGame = createGame();
  const previewLabelEl = {
    textContent: "",
    innerHTML: "",
    addEventListener: noop,
    removeEventListener: noop,
  };
  const turnIndicatorEl = {
    textContent: "",
    classList: {
      remove: noop,
      add: noop,
    },
  };
  let renderPayload = null;
  let interactionAllowed = true;

  const controller = createIncomingMoveReplayController({
    getGame: () => currentGame,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (handle) => clock.clearTimeout(handle),
    isDocumentVisible: () => true,
    isWindowFocused: () => true,
  });

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: (payload) => {
        renderPayload = payload;
      },
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => interactionAllowed,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: previewLabelEl,
    boardTurnIndicatorEl: turnIndicatorEl,
  });

  controller.setRouteState({ gameId: currentGame.id, replayEnabled: true });
  controller.primeGame(currentGame);
  currentGame = createGame([createMove()]);
  controller.observeAuthoritativeGame(currentGame);
  clock.flushNext(180);
  clock.flushNext(0);

  const replay = controller.getActiveReplay(currentGame.id);
  assert.ok(replay);
  interactionAllowed = !controller.isReplayActiveForGame(currentGame.id);

  await runtime.loadSnapshot(replay.snapshot, {
    legalActions: [],
    resetSelection: true,
    overlayMode: "recorded-action",
    recordedAction: replay.recordedAction,
    recordedActionStartPiece: replay.recordedActionStartPiece,
    destroyedPieces: replay.destroyedPieces,
    replay: {
      kind: "incoming-move",
      actorSeat: replay.actorSeat,
      actorSide: replay.actorSide,
      stepIndex: replay.stepIndex,
      totalSteps: replay.totalSteps,
    },
  });

  assert.equal(previewLabelEl.textContent, "Incoming move.");
  assert.equal(turnIndicatorEl.textContent, "Replaying Player 2 move");
  assert.equal(renderPayload?.overlay?.replay?.kind, "incoming-move");
  assert.equal(interactionAllowed, false);
});
