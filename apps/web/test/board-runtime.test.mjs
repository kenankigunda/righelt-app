import test from "node:test";
import assert from "node:assert/strict";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";

const noop = () => {};

test("board runtime keeps internal action type when external controls are absent", () => {
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => ({ details: null, prompts: [] }),
      getPieceById: () => null,
      getPieceAt: () => null,
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
      canInteract: () => true,
    },
  });

  assert.equal(runtime.getActionType(), "pass");
  runtime.setActionType("project");
  assert.equal(runtime.getActionType(), "project");
  runtime.setActionType("move");
  assert.equal(runtime.getActionType(), "move");
});

test("board runtime renders removal effects returned from shell apply actions", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
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
        applyAction: async () => ({
          accepted: true,
          state: {
            sideToMove: "P1",
            turnIndex: 0,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
          removedPieces: [
            {
              pieceId: "A1",
              position: { row: 4, col: 2 },
              reason: "no_retreat",
              message: "Piece at (4, 2) destroyed because it could not retreat",
            },
          ],
        }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });
    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 2 },
            supplied: true,
            commanded: true,
          },
        ],
      },
      { legalActions: [] },
    );

    await runtime.submitCurrentAction({
      type: "push",
      actorId: "A1",
      from: { row: 4, col: 1 },
      to: { row: 4, col: 2 },
    });

    const renderWithRemoval = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(renderWithRemoval);
    assert.equal(renderWithRemoval.removalEffects[0].piece?.id, "A1");
    assert.equal(scheduledTimers.length, 1);
    assert.equal(scheduledTimers[0].delay, 2400);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
