import { createBoardRuntime } from "/apps/web/board/runtime/board-runtime.js";
import { createEngineBoardAdapter } from "/apps/web/board-adapters/engine-board-adapter.js";
import { buildPieceMoveResponse } from "/apps/web/board/client-move-generation.js";

let state, actions, runtime, applied = [], pending = null, canInteract = true, canPresentActions = true, selectWhileBlocked = false, message = null, messageActions = [];
const coord = (row, col) => ({ row, col });
const setup = async (type = "rush", hover = true) => {
  runtime?.destroy();
  canInteract = true;
  canPresentActions = true;
  selectWhileBlocked = false;
  message = null; messageActions = [];
  state = { boardSize: 10, sideToMove: "P1", turnIndex: 0, continuation: null, outcome: { status: "ongoing" },
    pieces: [{ id: "A", owner: "P1", kind: "unit", position: coord(4, 2), supplied: true, commanded: true }] };
  if (type === "retreat") state.continuation = { type: "push", phase: "retreat", pushedPieceId: "A" };
  if (type === "follow") state.continuation = { type: "push", phase: "follow", followGroupPieceIds: ["A"] };
  actions = type === "pass" ? [{type:"pass"}] : [coord(4, 3), coord(5, 2)].map(to => ({ type, actorId: "A", from: coord(4, 2), to }));
  applied = [];
  runtime = createBoardRuntime({ boardAdapter: createEngineBoardAdapter(), controls: { getSupportsHover: () => hover, getBoardMessage: () => message, onBoardMessageAction: action => messageActions.push(action) }, host: {
    canSelect: () => canInteract || selectWhileBlocked,
    canInteract: () => canInteract,
    canPresentActions: () => canPresentActions,
    loadPieceMoves: async (_state, pieceId) => buildPieceMoveResponse({ state, legalActions: actions, pieceId }),
    loadLegalActions: async () => ({ state, legalActions: actions }),
    applyAction: async (_state, action) => {
      applied.push(structuredClone(action));
      if (pending) await pending.promise;
      return { accepted: false, state, legalActions: actions };
    },
  } });
  runtime.bindElements({ boardEl: document.querySelector("#board"), overlayLinesEl: document.querySelector("#lines"), boardPreviewLabelEl: document.querySelector("#preview") });
  await runtime.loadSnapshot(state, { legalActions: actions });
};
window.boardFixture = {
  setup,
  configure: async (snapshot, legalActions, {selectionState, interactive = true} = {}) => {
    state = snapshot;
    actions = legalActions;
    canInteract = interactive;
    canPresentActions = interactive;
    await runtime.loadSnapshot(state, {legalActions: actions, selectionState});
  },
  inspect: value => runtime.setInspection(value),
  // Deliver a normal host snapshot after native input has cleared selection.
  // The real runtime chooses any mandatory actor without a supplied selection.
  rehydrateCurrent: async () => runtime.loadSnapshot(state, { legalActions: actions }),
  selection: () => runtime.getSelection(),
  applied: () => applied,
  gateInteraction: blocked => {
    selectWhileBlocked = true;
    canInteract = !blocked;
    // Render the admitted control fence, then exercise the shell's status-only
    // settlement path without snapshot/selection hydration or pointer movement.
    if (blocked) runtime.refreshVisuals();
    runtime.refreshStatus();
  },
  message: value => { message = value; runtime.refreshStatus(); },
  messageActions: () => messageActions,
  refresh: async () => {
    // A recovery/control gate can reject hover events during hydration. The
    // pointer remains over a legal preview when interaction becomes available.
    canInteract = false;
    await runtime.loadSnapshot(state, { legalActions: actions, selectionState: { selectedPieceId: "A", source: coord(4, 2), target: null } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    canInteract = true;
  },
  hold: () => { let resolve; const promise = new Promise(done => { resolve = done; }); pending = { promise, resolve }; },
  release: () => { pending.resolve(); pending = null; },
};
window.fixtureReady = true;
