import test from "node:test";
import assert from "node:assert/strict";

import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { shouldSkipBoardRuntimeReload } from "../shell/runtime-sync.js";

const noop = () => {};
const toStableKey = (value) => (value == null ? "null" : JSON.stringify(value));

const SOURCE = { row: 4, col: 2 };
const TARGET_A = { row: 4, col: 3 };
const TARGET_B = { row: 5, col: 2 };

const SNAPSHOT = {
  sideToMove: "P1",
  turnIndex: 0,
  continuation: null,
  outcome: null,
  pieces: [
    {
      id: "A1",
      owner: "P1",
      kind: "unit",
      position: SOURCE,
      supplied: true,
      commanded: true,
    },
  ],
};

const LEGAL_ACTIONS = [
  { type: "move", actorId: "A1", from: SOURCE, to: TARGET_A },
  { type: "move", actorId: "A1", from: SOURCE, to: TARGET_B },
];

const createBoardPreviewLabelEl = () => {
  let value = "";
  return {
    get textContent() {
      return value;
    },
    set textContent(next) {
      value = String(next ?? "");
    },
    get innerHTML() {
      return value;
    },
    set innerHTML(next) {
      value = String(next ?? "");
    },
    addEventListener: noop,
    removeEventListener: noop,
  };
};

const createMountHarness = async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  const currentRoute = { scenarios: false };
  const boardPreviewLabelEl = createBoardPreviewLabelEl();

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece =
          snapshot?.pieces?.find(
            (piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col,
          ) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        const actionAtTarget = selectedPieceMoves.find(
          (action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col,
        );
        if (actionAtTarget) {
          return {
            selection: {
              ...selection,
              target: clickedCoord,
            },
            nextActionType: actionAtTarget.type,
          };
        }
        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: LEGAL_ACTIONS,
        previewActions: LEGAL_ACTIONS.map((action) => ({ ...action, legal: true })),
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => Boolean(currentRoute.scenarios),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(SNAPSHOT, {
    legalActions: LEGAL_ACTIONS,
    resetSelection: true,
  });

  let mountedSnapshotKey = toStableKey(SNAPSHOT);
  let mountedLegalActionsKey = toStableKey(LEGAL_ACTIONS);
  let mountedOverlayKey = toStableKey({
    overlayMode: "interactive",
    recordedAction: null,
    recordedActionStartPiece: null,
    destroyedPieces: [],
    selectionAction: null,
    selectionState: null,
    forceClickTargetSelection: false,
  });

  const rerenderMountedBoard = async () => {
    const forceClickTargetSelection = Boolean(currentRoute.scenarios);
    const snapshotKey = toStableKey(SNAPSHOT);
    const legalActionsKey = toStableKey(LEGAL_ACTIONS);
    const overlayKey = toStableKey({
      overlayMode: "interactive",
      recordedAction: null,
      recordedActionStartPiece: null,
      destroyedPieces: [],
      selectionAction: null,
      selectionState: null,
      forceClickTargetSelection,
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl,
      boardTurnIndicatorEl: null,
    });
    runtime.syncInteractionCapabilities();

    const skipped = shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: toStableKey(runtime.getState()),
      runtimeLegalActionsKey: toStableKey(runtime.getLegalActions()),
      snapshotKey,
      legalActionsKey,
      mountedOverlayKey,
      overlayKey,
      resetSelection: false,
    });

    if (!skipped) {
      await runtime.loadSnapshot(SNAPSHOT, {
        legalActions: LEGAL_ACTIONS,
        resetSelection: false,
      });
    }

    mountedSnapshotKey = snapshotKey;
    mountedLegalActionsKey = legalActionsKey;
    mountedOverlayKey = overlayKey;

    return {
      skipped,
      mountedSnapshotKey,
      mountedLegalActionsKey,
      mountedOverlayKey,
    };
  };

  return {
    currentRoute,
    runtime,
    boardPreviewLabelEl,
    clickCell: (coord) => onCellClick(coord),
    hoverCell: (coord) => onCellHoverStart(coord),
    rerenderMountedBoard,
  };
};

test("integration shell rerender switches a mounted board into click target selection when scenarios open", async () => {
  const harness = await createMountHarness();

  harness.clickCell(SOURCE);
  harness.hoverCell(TARGET_A);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: TARGET_A,
  });
  assert.equal(String(harness.boardPreviewLabelEl.innerHTML).includes("Click to"), true);

  harness.currentRoute.scenarios = true;
  const rerenderResult = await harness.rerenderMountedBoard();

  assert.equal(rerenderResult.skipped, false);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: null,
  });

  harness.hoverCell(TARGET_B);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: null,
  });

  harness.clickCell(TARGET_A);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: TARGET_A,
  });
  assert.equal(String(harness.boardPreviewLabelEl.textContent).includes("Activate this destination again"), true);
});

test("integration shell rerender invalidates an old preview when scenarios close on a mounted board", async () => {
  const harness = await createMountHarness();

  harness.clickCell(SOURCE);
  harness.currentRoute.scenarios = true;
  await harness.rerenderMountedBoard();
  harness.clickCell(TARGET_A);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: TARGET_A,
  });

  harness.currentRoute.scenarios = false;
  const rerenderResult = await harness.rerenderMountedBoard();

  assert.equal(rerenderResult.skipped, false);
  harness.hoverCell(TARGET_B);
  assert.deepEqual(harness.runtime.getSelection(), {
    selectedPieceId: "A1",
    source: SOURCE,
    target: TARGET_B,
  });
  assert.equal(String(harness.boardPreviewLabelEl.textContent).includes("Activate this destination again"), false);
});
