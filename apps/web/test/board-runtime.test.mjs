import test from "node:test";
import assert from "node:assert/strict";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";

const noop = () => {};

test("board runtime keeps internal action type when external controls are absent", () => {
  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
  const recordedActionStartPiece = {
    id: "A1",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 2 },
    supplied: false,
    commanded: false,
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
      recordedActionStartPiece,
    },
  );

  assert.equal(summaryCalls, 0);
  assert.equal(renderCalls.at(-1)?.overlay?.mode, "recorded-action");
  assert.deepEqual(renderCalls.at(-1)?.overlay?.recordedAction, recordedAction);
  assert.deepEqual(renderCalls.at(-1)?.overlay?.recordedActionStartPiece, recordedActionStartPiece);
  assert.equal(boardPreviewLabelEl.textContent, "Showing recorded move.");
});

test("board runtime starts history destruction in the removal-effects layer before the settled overlay appears", async () => {
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });

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
      recordedAction: {
        type: "move",
        actorId: "A1",
        from: { row: 4, col: 2 },
        to: { row: 4, col: 3 },
      },
      destroyedPieces: [{
        row: 9,
        col: 9,
        ownerSeat: "p2",
        kind: "unit",
        supplied: false,
        commanded: false,
        piece: {
          id: "Z9",
          owner: "P2",
          kind: "unit",
          position: { row: 9, col: 9 },
          supplied: false,
          commanded: false,
        },
      }],
    },
  );

  assert.deepEqual(renderCalls.at(-1)?.overlay?.destroyedPieces, []);
  assert.equal(renderCalls.at(-1)?.removalEffects?.[0]?.piece?.id, "Z9");
  assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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

test("board runtime shortens rush continuation CTA on narrow mobile viewports only", async () => {
  let previewHtml = "";
  const originalWindow = globalThis.window;
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query === "(max-width: 430px)",
    }),
  };

  try {
    const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
      boardAdapter: {
        mount: noop,
        render: noop,
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
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: {
        set innerHTML(value) {
          previewHtml = value;
        },
        get innerHTML() {
          return previewHtml;
        },
        set textContent(value) {
          previewHtml = value;
        },
        get textContent() {
          return previewHtml;
        },
        addEventListener: noop,
        removeEventListener: noop,
      },
      boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
    });

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: {
          type: "rush",
          owner: "P1",
          rushedPieceIds: ["A1"],
          rushChainPieceIds: ["A1"],
          chainLength: 1,
        },
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 4 },
            supplied: true,
            commanded: true,
          },
        ],
      },
      {
        legalActions: [{ type: "pass", actorId: "A1", from: { row: 4, col: 4 } }],
      },
    );

    assert.match(previewHtml, />end turn now</);
    assert.doesNotMatch(previewHtml, />end your turn now</);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("board runtime omits end-turn CTA when the rush chain is not yet closable", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
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
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["A"],
        rushChainPieceIds: ["A"],
        chainLength: 1,
      },
      outcome: null,
      pieces: [
        {
          id: "A",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 3 },
          supplied: true,
          commanded: true,
        },
        {
          id: "B",
          owner: "P1",
          kind: "unit",
          position: { row: 5, col: 5 },
          supplied: true,
          commanded: true,
        },
        {
          id: "C1",
          owner: "P1",
          kind: "commander",
          position: { row: 3, col: 6 },
          supplied: true,
          commanded: true,
        },
        {
          id: "C2",
          owner: "P2",
          kind: "commander",
          position: { row: 6, col: 3 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E0",
          owner: "P2",
          kind: "unit",
          position: { row: 0, col: 4 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E1",
          owner: "P2",
          kind: "unit",
          position: { row: 9, col: 4 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E2",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 5 }, to: { row: 4, col: 4 } }],
    },
  );

  assert.doesNotMatch(previewHtml, /data-board-preview-action="end-turn"/);
  assert.match(previewHtml, /Continue rushing on one of the/);
  assert.match(previewHtml, /to reconnect your piece at/);
  assert.match(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
  assert.match(previewHtml, />4,3</);
});

test("board runtime rush blocker prompt prefers the most recently rushed unsupplied piece", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
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
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["A", "B"],
        rushChainPieceIds: ["A", "B"],
        chainLength: 2,
      },
      outcome: null,
      pieces: [
        { id: "A", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
        { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 1 }, supplied: true, commanded: true },
        { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 8 }, supplied: true, commanded: true },
        { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
        { id: "E0", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
        { id: "E1", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 1 }, to: { row: 4, col: 2 } }],
    },
  );

  assert.match(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
  assert.match(previewHtml, />5,1</);
});

test("board runtime falls back to generic rush prompt when blocker lookup yields no piece", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
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
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["GONE"],
        rushChainPieceIds: ["GONE"],
        chainLength: 1,
      },
      outcome: null,
      pieces: [
        { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
        { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
        { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
        { id: "E0", owner: "P2", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 5 }, to: { row: 4, col: 5 } }],
    },
  );

  assert.match(previewHtml, /Continue rushing on one of the/);
  assert.doesNotMatch(previewHtml, /to reconnect your piece at/);
  assert.doesNotMatch(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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

test("board runtime preserves in-progress removal effects across interactive turn handoff reloads", async () => {
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [{ type: "move", actorId: "B1", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } }],
          removedPieces: [
            {
              pieceId: "A1",
              position: { row: 4, col: 2 },
              reason: "loss_of_supply",
              message: "Piece at (4, 2) destroyed due to loss of supply",
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
        continuation: {
          type: "push",
          owner: "P1",
          phase: "follow",
          source: { row: 4, col: 1 },
          target: { row: 4, col: 2 },
        },
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 2 },
            supplied: false,
            commanded: false,
          },
        ],
      },
      {
        legalActions: [{ type: "follow", actorId: "A1", from: { row: 4, col: 1 }, to: { row: 4, col: 2 } }],
      },
    );

    await runtime.submitCurrentAction({
      type: "follow",
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
        sideToMove: "P2",
        turnIndex: 1,
        continuation: null,
        outcome: null,
        pieces: [],
      },
      {
        legalActions: [{ type: "move", actorId: "B1", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } }],
        resetSelection: true,
      },
    );

    const preservedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(preservedRender);
    assert.equal(preservedRender.removalEffects[0].startedAt, originalStartedAt);
    assert.equal(runtime.getOverlay().mode, "interactive");
    assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test("board runtime does not submit retreat continuation while interaction is locked to the other player", async () => {
  let applyCount = 0;
  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
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
      applyAction: async () => {
        applyCount += 1;
        return { accepted: true, state: null, legalActions: [] };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => false,
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
      sideToMove: "P2",
      turnIndex: 0,
      continuation: {
        type: "push",
        phase: "retreat",
        pushedPieceId: "D1",
      },
      outcome: null,
      pieces: [
        {
          id: "D1",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
          pushed: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "retreat",
          actorId: "D1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  await runtime.submitCurrentAction();
  assert.equal(applyCount, 0);
});

test("board runtime uses retreat chip styling for push retreat actor coordinate in preview label", async () => {
  let previewHtml = "";
  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
    },
    host: {
      applyAction: async () => ({ accepted: true, state: null, legalActions: [] }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P2",
      turnIndex: 0,
      continuation: {
        type: "push",
        phase: "retreat",
        pushedPieceId: "D1",
        followGroupPieceIds: ["D1"],
      },
      outcome: null,
      pieces: [
        {
          id: "D1",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
          pushed: true,
        },
      ],
    },
    { legalActions: [{ type: "retreat", actorId: "D1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }] },
  );

  assert.match(previewHtml, /board-preview-coordinate-chip-retreat/);
  assert.match(previewHtml, />4,2</);
  assert.equal(previewHtml.includes("board-preview-coordinate-chip-continuation-pending"), false);
});

test("board preview source coordinate chip uses selected-piece styling", async () => {
  let previewHtml = "";
  let onCellClick = null;

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ??
        null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
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
        return {
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: true, state: null, legalActions: [] }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, legal: true },
        ],
      }),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
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
          position: { row: 2, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 2, col: 2 });
  await new Promise((r) => setTimeout(r, 0));

  assert.match(previewHtml, /board-preview-coordinate-chip-selected-piece/);
  assert.match(previewHtml, /board-preview-coordinate-chip-selected-piece-p1/);
  assert.match(previewHtml, />2,2</);
  assert.equal(previewHtml.includes("board-preview-coordinate-chip-source"), false);
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
  assert.equal(nonHover.boardPreviewLabelEl.textContent.includes("Activate this destination again"), true);

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

test("board runtime can force click target selection even on hover-capable devices", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  const boardPreviewLabelEl = {
    textContent: "",
    innerHTML: "",
    addEventListener: noop,
    removeEventListener: noop,
  };
  const appliedActions = [];

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
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece = snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: { selectedPieceId: clickedPiece.id, source: { ...clickedPiece.position }, target: null },
            nextActionType: currentActionType,
          };
        }
        const actionAtTarget = selectedPieceMoves.find((action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col);
        if (actionAtTarget) {
          return {
            selection: { ...selection, target: clickedCoord },
            nextActionType: actionAtTarget.type,
          };
        }
        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return { accepted: true, state: { sideToMove: "P2", turnIndex: 1, continuation: null, outcome: null, pieces: [] }, legalActions: [] };
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
      endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => true,
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
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
  assert.equal(String(boardPreviewLabelEl.textContent).includes("Activate this destination again"), true);

  onCellClick({ row: 4, col: 3 });
  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(appliedActions.length, 1);
});

test("board runtime keeps lone-target auto-selection while forced click target selection is active", async () => {
  let onCellClick = null;

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece = snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
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
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => true,
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
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
});

test("board runtime toggles overlay phase when the selected piece is clicked again", async () => {
  let onCellClick = null;
  const renderCalls = [];
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

  const multiMoves = [
    { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
  ];

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ??
          null;
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
        actions: multiMoves,
        previewActions: multiMoves.map((a) => ({ ...a, legal: true })),
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
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    { legalActions: multiMoves },
  );

  onCellClick({ row: 4, col: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderCalls.at(-1)?.selectedPieceOverlayPhase, "actionPreviews");
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Selected piece at"), true);

  onCellClick({ row: 4, col: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderCalls.at(-1)?.selectedPieceOverlayPhase, "supplyCommand");
  assert.deepEqual(runtime.getSelection().target, null);
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Showing supply & command lines"), true);
});

test("board runtime can submit a legal target immediately after piece selection", async () => {
  let onCellClick = null;
  const appliedActions = [];
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
  assert.equal(appliedActions.length, 0);
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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

test("board runtime promotes lone auto-selected targets to the correct action type across action kinds", async () => {
  const cases = [
    {
      type: "move",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    },
    {
      type: "project",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "commander", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "project", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    },
    {
      type: "rush",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 3,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "rush", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 4 } },
    },
    {
      type: "push",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P2",
        turnIndex: 12,
        continuation: null,
        outcome: null,
        pieces: [
          { id: "A1", owner: "P2", kind: "unit", position: { row: 6, col: 1 }, supplied: true, commanded: true },
          { id: "A2", owner: "P2", kind: "unit", position: { row: 5, col: 1 }, supplied: true, commanded: true },
          { id: "D1", owner: "P1", kind: "unit", position: { row: 6, col: 2 }, supplied: true, commanded: true },
        ],
      },
      action: { type: "push", actorId: "A1", from: { row: 6, col: 1 }, to: { row: 6, col: 2 } },
    },
    {
      type: "follow",
      trigger: "forced-selection",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 7,
        continuation: { type: "push", phase: "follow", followGroupPieceIds: ["A1"] },
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
      },
      action: { type: "follow", actorId: "A1", from: { row: 5, col: 5 }, to: { row: 5, col: 4 } },
    },
    {
      type: "retreat",
      trigger: "forced-selection",
      snapshot: {
        sideToMove: "P2",
        turnIndex: 9,
        continuation: { type: "push", phase: "retreat", pushedPieceId: "A1" },
        outcome: null,
        pieces: [{ id: "A1", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
      },
      action: { type: "retreat", actorId: "A1", from: { row: 5, col: 5 }, to: { row: 6, col: 5 } },
    },
  ];

  for (const testCase of cases) {
    let onCellClick = null;
    const appliedActions = [];

    const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
        nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
          const clickedPiece =
            snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ??
            null;
          if (!clickedPiece) {
            return {
              selection: {
                selectedPieceId: "A1",
                source: { ...testCase.action.from },
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
            state: { sideToMove: "P1", turnIndex: 0, continuation: null, outcome: null, pieces: [] },
            legalActions: [],
          };
        },
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({
          state: null,
          actions: [testCase.action],
          previewActions: [{ ...testCase.action, legal: true }],
        }),
        endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
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
    await runtime.loadSnapshot(testCase.snapshot, {
      legalActions: [testCase.action],
    });

    if (testCase.trigger === "source-click") {
      onCellClick(testCase.action.from);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(
      runtime.getSelection(),
      {
        selectedPieceId: "A1",
        source: { ...testCase.action.from },
        target: { ...testCase.action.to },
      },
      `expected ${testCase.type} target to auto-select`,
    );
    assert.equal(runtime.getActionType(), testCase.type, `expected ${testCase.type} action type to sync from the lone target`);

    onCellClick(testCase.action.to);
    assert.equal(appliedActions.length, 0);
    onCellClick(testCase.action.to);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(appliedActions, [testCase.action], `expected ${testCase.type} confirmation to submit the synced action`);
  }
});

test("board runtime clears transient hover targets when hover support turns off", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let supportsHover = true;

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

test("board runtime clears transient hover targets when click target selection becomes forced", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let forceClickTargetSelection = false;
  const appliedActions = [];

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
          state: { sideToMove: "P2", turnIndex: 1, continuation: null, outcome: null, pieces: [] },
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
      endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => forceClickTargetSelection,
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
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
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

  forceClickTargetSelection = true;
  assert.equal(runtime.syncInteractionCapabilities(), true);
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellClick({ row: 4, col: 3 });
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

test("board runtime keeps an explicit preview stable when hover becomes available", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let forceClickTargetSelection = true;
  let boardPreviewLabelValue = "";

  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(next) {
      boardPreviewLabelValue = next;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(next) {
      boardPreviewLabelValue = next;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

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
      applyAction: async () => ({ accepted: false }),
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
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => forceClickTargetSelection,
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
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
  assert.equal(String(boardPreviewLabelEl.textContent).includes("Activate this destination again"), true);

  forceClickTargetSelection = false;
  assert.equal(runtime.syncInteractionCapabilities(), true);
  assert.equal(String(boardPreviewLabelEl.textContent).includes("Activate this destination again"), true);

  onCellHoverStart({ row: 5, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
});

test("board runtime hydrates a source-only selection state and loads piece moves", async () => {
  const renderCalls = [];
  let pieceMoveLoads = 0;

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
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
      loadPieceMoves: async () => {
        pieceMoveLoads += 1;
        return {
          state: null,
          actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
          previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
        };
      },
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
      turnIndex: 2,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
      selectionState: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: null,
      },
    },
  );

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });
  assert.equal(pieceMoveLoads, 1);
  assert.equal(renderCalls.at(-1)?.selection?.selectedPieceId, "A1");
});

test("board runtime hydrates a source and target from a selection action", async () => {
  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
    boardAdapter: {
      mount: noop,
      render: noop,
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
      sideToMove: "P2",
      turnIndex: 3,
      continuation: null,
      outcome: null,
      pieces: [{ id: "B1", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "B1", from: { row: 5, col: 5 }, to: { row: 5, col: 6 } }],
      selectionAction: { type: "move", actorId: "B1", from: { row: 5, col: 5 }, to: { row: 5, col: 6 } },
    },
  );

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "B1",
    source: { row: 5, col: 5 },
    target: { row: 5, col: 6 },
  });
});

test("board runtime keeps selection while piece moves are still loading", async () => {
  let onCellClick = null;
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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

test("board runtime emits turn-ended when applyAction returns a settled next-turn state", async () => {
  const actionResults = [];
  const boardMessages = [];

  const runtime = createBoardRuntime({
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
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
          sideToMove: "P2",
          turnIndex: 1,
          continuation: null,
          outcome: null,
          pieces: [],
        },
        legalActions: [{ type: "move" }],
      }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
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

  assert.equal(boardMessages.some((message) => message?.type === "turn_ended"), true);
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: null,
    source: null,
    target: null,
  });
  assert.deepEqual(actionResults.at(-1), {
    accepted: true,
    outcome: null,
  });
});

// ---------------------------------------------------------------------------
// U-10 — history destroyed pieces animate via transient removal effects before settling into overlay state
// ---------------------------------------------------------------------------
test("U-10: loadSnapshot starts a history destruction transition before exposing the settled overlay", async () => {
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
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
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    const snapshot = {
      sideToMove: "P1",
      turnIndex: 1,
      continuation: null,
      outcome: null,
      pieces: [{ id: "X1", owner: "P1", kind: "unit", position: { row: 3, col: 4 }, supplied: true, commanded: true }],
    };

    await runtime.loadSnapshot(snapshot, { legalActions: [] });

    const stateBefore = runtime.getState();
    const keysBefore = Object.keys(stateBefore).sort();

    await runtime.loadSnapshot(snapshot, {
      legalActions: [],
      overlayMode: "recorded-action",
      destroyedPieces: [{
        row: 3,
        col: 4,
        ownerSeat: "p1",
        kind: "unit",
        supplied: true,
        commanded: true,
        piece: {
          id: "X1",
          owner: "P1",
          kind: "unit",
          position: { row: 3, col: 4 },
          supplied: true,
          commanded: true,
        },
      }],
    });

    const stateAfter = runtime.getState();
    assert.deepEqual(
      Object.keys(stateAfter).sort(),
      keysBefore,
      "getState() must not gain extra fields from history destroyed-piece overlays",
    );
    assert.equal(stateAfter.sideToMove, "P1");
    assert.equal(stateAfter.turnIndex, 1);
    assert.deepEqual(stateAfter.pieces, stateBefore.pieces);
    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
    const animatedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(animatedRender);
    assert.equal(animatedRender.removalEffects[0].piece?.id, "X1");
    assert.equal(animatedRender.removalEffects[0].startedAt, 5000);
    assert.equal(animatedRender.overlay?.destroyedPieces?.length ?? 0, 0);
    assert.equal(scheduledTimers.length, 1);
    assert.equal(scheduledTimers[0].delay, 2400);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

// ---------------------------------------------------------------------------
// U-11 — the history destruction transition settles into overlay state and clears on a later load
// ---------------------------------------------------------------------------
test("U-11: history destruction transition settles into overlay state and clears on the next load", async () => {
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
    previewAction: (state) => ({ state, removed: [], changed: [], supplyChanges: [], commandChanges: [], continuation: null }),
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
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
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    const destroyedRecord = {
      row: 4,
      col: 7,
      ownerSeat: "p2",
      kind: "commander",
      piece: {
        id: "C2",
        owner: "P2",
        kind: "commander",
        position: { row: 4, col: 7 },
        supplied: true,
        commanded: true,
      },
    };

    await runtime.loadSnapshot(
      { sideToMove: "P2", turnIndex: 2, continuation: null, outcome: null, pieces: [] },
      { legalActions: [], overlayMode: "recorded-action", destroyedPieces: [destroyedRecord] },
    );

    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
    assert.equal(scheduledTimers.length, 1);
    scheduledTimers[0].fn();

    assert.deepEqual(runtime.getOverlay().destroyedPieces, [destroyedRecord]);
    const settledRender = renderCalls.at(-1);
    assert.deepEqual(settledRender?.overlay?.destroyedPieces, [destroyedRecord]);
    assert.deepEqual(settledRender?.removalEffects, []);

    await runtime.loadSnapshot(
      { sideToMove: "P1", turnIndex: 3, continuation: null, outcome: null, pieces: [] },
      { legalActions: [], overlayMode: "recorded-action", destroyedPieces: [] },
    );

    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
