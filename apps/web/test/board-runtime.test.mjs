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

test("board runtime uses recorded-action overlay mode without selected piece summary flow", async () => {
  const renderCalls = [];
  let summaryCalls = 0;
  let boardPreviewLabelValue = "";
  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(value) {
      boardPreviewLabelValue = value;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(value) {
      boardPreviewLabelValue = value;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: () => {
        summaryCalls += 1;
        return null;
      },
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
      canInteract: () => false,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });

  const recordedAction = {
    type: "move",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  };

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [],
      overlayMode: "recorded-action",
      recordedAction,
    },
  );

  assert.equal(summaryCalls, 0);
  assert.equal(renderCalls.at(-1)?.overlay?.mode, "recorded-action");
  assert.deepEqual(renderCalls.at(-1)?.overlay?.recordedAction, recordedAction);
  assert.equal(boardPreviewLabelEl.textContent, "Showing recorded move.");
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

test("board runtime preserves in-progress removal effects across snapshot reloads", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};
  Date.now = () => 5000;

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
    const originalStartedAt = renderWithRemoval.removalEffects[0].startedAt;
    assert.equal(originalStartedAt, 5000);

    renderCalls.length = 0;

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [],
      },
      { legalActions: [], resetSelection: false },
    );

    const preservedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(preservedRender);
    assert.equal(preservedRender.removalEffects[0].startedAt, originalStartedAt);
    assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test("board runtime does not flash no-moves preview text while selected piece moves are loading", async () => {
  let onCellClick = null;
  let resolvePieceMoves = null;
  let boardPreviewLabelValue = "";
  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(value) {
      boardPreviewLabelValue = value;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(value) {
      boardPreviewLabelValue = value;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const piece = snapshot?.pieces?.find((candidate) => candidate.id === selectedPieceId) ?? null;
        if (!piece) {
          return null;
        }
        return {
          details: { owner: piece.owner },
          actions: (Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves).map((action) => ({
            type: action.type,
            from: action.from ?? null,
            to: action.to ?? null,
            legal: action.legal,
            blockedReason: action.blockedReason ?? null,
          })),
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord }) => {
        const piece = snapshot?.pieces?.find(
          (candidate) => candidate.position.row === clickedCoord.row && candidate.position.col === clickedCoord.col,
        );
        if (!piece) {
          return {
            selection: { selectedPieceId: null, source: null, target: null },
            nextActionType: "pass",
          };
        }
        return {
          selection: { selectedPieceId: piece.id, source: { ...piece.position }, target: null },
          nextActionType: "move",
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () =>
        new Promise((resolve) => {
          resolvePieceMoves = resolve;
        }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });

  await runtime.loadSnapshot(
    {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: { status: "ongoing" },
      pieces: [
        {
          id: "C1",
          owner: "P1",
          kind: "commander",
          position: { row: 3, col: 3 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "pass" },
        { type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 } },
      ],
    },
  );

  onCellClick?.({ row: 3, col: 3 });

  assert.equal(boardPreviewLabelEl.textContent.includes("No moves for this piece at this time"), false);
  assert.equal(boardPreviewLabelEl.textContent.includes("Select a piece to see it supply and command lines"), false);

  resolvePieceMoves?.({
    state: null,
    actions: [{ type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 } }],
    previewActions: [{ type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 }, legal: true }],
  });
});

test("board runtime uses hover-aware action prompt copy", async () => {
  const createBoardPreviewLabel = () => {
    let value = "";
    return {
      get textContent() {
        return value;
      },
      set textContent(next) {
        value = next;
      },
      get innerHTML() {
        return value;
      },
      set innerHTML(next) {
        value = next;
      },
      addEventListener: noop,
      removeEventListener: noop,
    };
  };

  const createRuntime = ({ supportsHover }) => {
    let onCellClick = null;
    let onCellHoverStart = null;
    const boardPreviewLabelEl = createBoardPreviewLabel();
    const runtime = createBoardRuntime({
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
            actions: (selectedPieceMovePreviews ?? selectedPieceMoves).map((action) => ({
              type: action.type,
              from: action.from ?? null,
              to: action.to ?? null,
              legal: action.legal ?? true,
              blockedReason: action.blockedReason ?? null,
            })),
          };
        },
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
          const clickedPiece =
            snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
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
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: clickedCoord,
            },
            nextActionType: "move",
          };
        },
      },
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({
          state: null,
          actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
          previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
        }),
        canInteract: () => true,
      },
      controls: {
        getSupportsHover: () => supportsHover,
      },
    });

    return { runtime, boardPreviewLabelEl, getOnCellClick: () => onCellClick, getOnCellHoverStart: () => onCellHoverStart };
  };

  const nonHover = createRuntime({ supportsHover: false });
  nonHover.runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: nonHover.boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await nonHover.runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );
  nonHover.getOnCellClick()?.({ row: 4, col: 2 });
  nonHover.getOnCellClick()?.({ row: 4, col: 3 });
  assert.equal(nonHover.boardPreviewLabelEl.textContent.includes("Click again to"), true);

  const hover = createRuntime({ supportsHover: true });
  hover.runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: hover.boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await hover.runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );
  hover.getOnCellClick()?.({ row: 4, col: 2 });
  hover.getOnCellHoverStart()?.({ row: 4, col: 3 });
  assert.equal(hover.boardPreviewLabelEl.textContent.includes("Click to"), true);
  assert.equal(hover.boardPreviewLabelEl.textContent.includes("Click again to"), false);
});

test("board runtime can submit a legal target immediately after piece selection", async () => {
  let onCellClick = null;
  const appliedActions = [];
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
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
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
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
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: () =>
        new Promise((resolve) => {
          releasePieceMoves = () => resolve({ state: null, actions: [], previewActions: [] });
        }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
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
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 4, col: 3 });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);

  releasePieceMoves?.();
});

test("board runtime uses hover selection before click submission on hover-capable devices", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let onCellHoverEnd = null;
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart, onCellHoverEnd: nextOnCellHoverEnd }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
        onCellHoverEnd = nextOnCellHoverEnd;
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
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
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
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 }, legal: true },
        ],
      }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
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
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 5, col: 2 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellHoverEnd({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("board runtime keeps auto-selected lone targets on hover-capable devices until clicked", async () => {
  let onCellClick = null;
  let onCellHoverEnd = null;
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverEnd: nextOnCellHoverEnd }) => {
        onCellClick = nextOnCellClick;
        onCellHoverEnd = nextOnCellHoverEnd;
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
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
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
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellHoverEnd({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("board runtime clears transient hover targets when hover support turns off", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let supportsHover = true;

  const runtime = createBoardRuntime({
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
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => supportsHover,
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
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 5, col: 2 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  supportsHover = false;
  runtime.syncInteractionCapabilities();

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });
});

test("board runtime keeps selection while piece moves are still loading", async () => {
  let onCellClick = null;
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: [],
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: () =>
        new Promise((resolve) => {
          releasePieceMoves = () => resolve({ state: null, actions: [], previewActions: [] });
        }),
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

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 0, col: 0 });

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  releasePieceMoves?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("board runtime surfaces auto end-turn rejection without emitting turn-ended message", async () => {
  const actionResults = [];
  const boardMessages = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: [],
        };
      },
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
        legalActions: [{ type: "pass" }],
      }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      endTurn: async () => ({
        accepted: false,
        validation: { ok: false, code: "turn_has_no_moves" },
        state: {
          sideToMove: "P1",
          turnIndex: 0,
          continuation: null,
          outcome: null,
          pieces: [],
        },
        legalActions: [{ type: "pass" }],
      }),
      canInteract: () => true,
    },
    controls: {
      onActionResult: (value) => actionResults.push(value),
      onBoardMessage: (value) => boardMessages.push(value),
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
      pieces: [],
    },
    { legalActions: [{ type: "project", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }] },
  );

  await runtime.submitCurrentAction({
    type: "project",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  });

  assert.equal(boardMessages.some((message) => message?.type === "turn_ended"), false);
  assert.deepEqual(actionResults.at(-1), {
    accepted: false,
    validation: { ok: false, code: "turn_has_no_moves" },
  });
});
