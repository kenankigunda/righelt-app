import {
  getBlockedPreviewLabel,
  buildActionPayload,
  deriveContinuationHighlightByPieceId,
  deriveAutoSelectedTarget,
  deriveForcedContinuationSelection,
  pickBestActionTypeForTarget,
  shouldResetSelectionOnDocumentClick,
  shouldSubmitOnEnter,
} from "./interaction.js";
import { assertGameBoardAdapter } from "./board-adapter-contract.js";
import { createEnginePlaygroundBoardAdapter } from "./board-adapters/engine-playground-adapter.js";
import { buildHomeHash, isPlaygroundRouteHash, isShellRouteHash, isShellRootHash } from "./shell/routes.js";

if (isShellRootHash(window.location.hash)) {
  window.location.replace(`${window.location.pathname}${window.location.search}${buildHomeHash()}`);
}
const shouldMountShell = !isPlaygroundRouteHash(window.location.hash) && isShellRouteHash(window.location.hash);
window.addEventListener("hashchange", () => {
  const nextShouldMountShell = !isPlaygroundRouteHash(window.location.hash) && isShellRouteHash(window.location.hash);
  if (nextShouldMountShell !== shouldMountShell) {
    window.location.reload();
  }
});

if (shouldMountShell) {
  const playgroundAppEl = document.getElementById("playground-app");
  const shellAppEl = document.getElementById("app");
  if (playgroundAppEl) {
    playgroundAppEl.hidden = true;
  }
  if (shellAppEl) {
    shellAppEl.hidden = false;
  }
  await import("./shell/app.js");
} else {
const boardEl = document.getElementById("board");
const overlayLinesEl = document.getElementById("overlay-lines");
const boardPreviewLabelEl = document.getElementById("board-preview-label");
const boardTurnIndicatorEl = document.getElementById("board-turn-indicator");
const actionTypeEl = document.getElementById("action-type");
const allowFreeSelectionEl = document.getElementById("allow-free-selection");
const sourceValueEl = document.getElementById("source-value");
const targetValueEl = document.getElementById("target-value");
const submitActionEl = document.getElementById("submit-action");
const resetSelectionEl = document.getElementById("reset-selection");
const actionResultEl = document.getElementById("action-result");
const sideToMoveEl = document.getElementById("side-to-move");
const turnIndexEl = document.getElementById("turn-index");
const continuationEl = document.getElementById("continuation");
const commanderSupplyEl = document.getElementById("commander-supply");
const selectedPieceEl = document.getElementById("selected-piece");
const selectedMovePreviewEl = document.getElementById("selected-move-preview");
const selectedPieceMovesEl = document.getElementById("selected-piece-moves");
const legalActionsEl = document.getElementById("legal-actions");
const moveLogEl = document.getElementById("move-log");
const fixtureSelectEl = document.getElementById("fixture-select");
const fixtureDescriptionEl = document.getElementById("fixture-description");
const fixtureIncorrectToggleEl = document.getElementById("fixture-incorrect-toggle");
const loadFixtureEl = document.getElementById("load-fixture");
const replayFixtureEl = document.getElementById("replay-fixture");
const saveFixtureEl = document.getElementById("save-fixture");
const updateFixtureEl = document.getElementById("update-fixture");
const fixtureResultEl = document.getElementById("fixture-result");

let state = null;
let legalActions = [];
let selectedPieceMoves = [];
let selectedPieceMovePreviews = [];
let removalEffects = [];
let selectedPieceId = null;
let selectedSource = null;
let selectedTarget = null;
const moveLog = [];
let fixtures = [];
let currentFixtureId = null;
let fixtureCatalog = { id: "M", title: "Milestone 2 Golden Scenarios", fixtures: [] };
let removalEffectsTimer = null;
let selectedPieceMovesRequestId = 0;

const PLAYER_TONE_CLASSES = ["player-tone-p1", "player-tone-p2", "player-tone-neutral"];

const invalidateSelectedPieceMovesRequests = () => {
  selectedPieceMovesRequestId += 1;
};

const boardAdapter = createEnginePlaygroundBoardAdapter();
assertGameBoardAdapter(boardAdapter);
boardAdapter.mount({
  boardEl,
  overlayLinesEl,
  onCellClick: handleBoardCellClick,
});

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "unset");
const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);
const actionPreviewLabel = (actionType, snapshot, destination) => {
  const suffix = destination ? ` (${destination.row},${destination.col})` : "";
  if (snapshot?.continuation?.type === "rush" && actionType === "rush") {
    return `continue rush on${suffix}`;
  }
  if (snapshot?.continuation?.type === "push" && actionType === "follow") {
    return `continue push on${suffix}`;
  }
  switch (actionType) {
    case "move":
      return `move commander to${suffix}`;
    case "project":
      return `project new piece to${suffix}`;
    case "rush":
      return `rush piece to${suffix}`;
    case "push":
      return `push piece onto${suffix}`;
    case "follow":
      return `follow piece to${suffix}`;
    case "retreat":
      return `retreat piece to${suffix}`;
    default:
      return `move to${suffix}`;
  }
};

const setPlayerTone = (element, player) => {
  if (!element) {
    return;
  }
  element.classList.remove(...PLAYER_TONE_CLASSES);
  if (player === "P1") {
    element.classList.add("player-tone-p1");
    return;
  }
  if (player === "P2") {
    element.classList.add("player-tone-p2");
    return;
  }
  element.classList.add("player-tone-neutral");
};

const describeActionForLog = (action) => `${action.type.toUpperCase()} ${formatCoordinate(action.from)} -> ${formatCoordinate(action.to)}`;

const pushMoveLogEntry = (text, player = null) => {
  moveLog.push({ text, player });
};

const setBoardPreviewPrompt = (text) => {
  boardPreviewLabelEl.textContent = text;
};

const setBoardPreviewPromptHtml = (html) => {
  boardPreviewLabelEl.innerHTML = html;
};

const getBoardPreviewCoordinateChipClass = (coord) => {
  if (!coord) {
    return "board-preview-coordinate-chip-neutral";
  }

  if (selectedTarget && sameCoordinate(coord, selectedTarget)) {
    return "board-preview-coordinate-chip-target";
  }
  if (selectedSource && sameCoordinate(coord, selectedSource)) {
    return "board-preview-coordinate-chip-source";
  }

  const continuationHighlights = deriveContinuationHighlightByPieceId(state, legalActions);
  const pieceAtCoord = state?.pieces?.find((piece) => sameCoordinate(piece.position, coord));
  if (pieceAtCoord) {
    if (continuationHighlights.pendingPieceIds.has(pieceAtCoord.id)) {
      return "board-preview-coordinate-chip-continuation-pending";
    }
    if (continuationHighlights.movedPieceIds.has(pieceAtCoord.id)) {
      return "board-preview-coordinate-chip-continuation-moved";
    }
  }

  return "board-preview-coordinate-chip-neutral";
};

const renderBoardPreviewCoordinate = (coord) => {
  if (!coord) {
    return "";
  }
  const chipClass = getBoardPreviewCoordinateChipClass(coord);
  return `<span class="board-preview-coordinate-chip ${chipClass}">${escapeHtml(`${coord.row},${coord.col}`)}</span>`;
};

const setRushContinuationPrompt = (player) => {
  const toneClass = player === "P1" ? "player-tone-p1" : player === "P2" ? "player-tone-p2" : "player-tone-neutral";
  boardPreviewLabelEl.innerHTML = `Continue rushing on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares, or <button type="button" class="board-preview-inline-button" data-board-preview-action="end-turn">end your turn now</button>`;
};

const setPushFollowContinuationPrompt = (player) => {
  const toneClass = player === "P1" ? "player-tone-p1" : player === "P2" ? "player-tone-p2" : "player-tone-neutral";
  boardPreviewLabelEl.innerHTML = `Follow your push on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares`;
};

const getPushRetreatPrompt = (snapshot, selectedPieceId) => {
  if (snapshot?.continuation?.type !== "push" || snapshot.continuation.phase !== "retreat") {
    return null;
  }
  const pushedPiece = snapshot.pieces?.find((piece) => piece.id === snapshot.continuation?.pushedPieceId);
  if (!pushedPiece) {
    return null;
  }
  const suffix = selectedPieceId === pushedPiece.id ? "Select a square to retreat to:" : "Select it to retreat:";
  return `Your piece on the <span class="board-preview-retreat-chip">highlighted square</span> has been pushed! ${escapeHtml(suffix)}`;
};

const setBoardPreviewAction = (text) => {
  const coordinateMatch = text.match(/\(\d+,\d+\)$/);
  if (!coordinateMatch || !selectedTarget) {
    boardPreviewLabelEl.innerHTML = `Click again to <strong>${escapeHtml(text)}</strong>`;
    return;
  }

  const labelWithoutCoordinate = text.slice(0, coordinateMatch.index).trimEnd();
  boardPreviewLabelEl.innerHTML = `Click again to <strong>${escapeHtml(labelWithoutCoordinate)} ${renderBoardPreviewCoordinate(selectedTarget)}</strong>`;
};

const getCurrentSelection = () => ({
  selectedPieceId,
  source: selectedSource,
  target: selectedTarget,
});

const applySelection = (selection) => {
  selectedPieceId = selection.selectedPieceId;
  selectedSource = selection.source;
  selectedTarget = selection.target;
};

const clearSelection = () => {
  selectedPieceId = null;
  selectedPieceMoves = [];
  selectedPieceMovePreviews = [];
  selectedSource = null;
  selectedTarget = null;
  invalidateSelectedPieceMovesRequests();
};

const clearRemovalEffects = () => {
  removalEffects = [];
  if (removalEffectsTimer) {
    clearTimeout(removalEffectsTimer);
    removalEffectsTimer = null;
  }
};

const showRemovalEffects = (effects) => {
  clearRemovalEffects();
  const startedAt = Date.now();
  removalEffects = Array.isArray(effects) ? effects.map((effect) => ({ ...effect, startedAt })) : [];
  if (removalEffects.length === 0) {
    return;
  }
  renderBoard();
  removalEffectsTimer = setTimeout(() => {
    removalEffects = [];
    removalEffectsTimer = null;
    renderBoard();
  }, 2400);
};

const actionsAtTarget = (coord) =>
  selectedPieceMoves.filter((action) => action.to && action.to.row === coord.row && action.to.col === coord.col);

const submitCurrentAction = async (actionOverride = null) => {
  if (!state) return;
  submitActionEl.disabled = true;
  setActionResult("Applying action...");
  const action = actionOverride ?? buildActionPayload(actionTypeEl.value, selectedSource, selectedTarget, selectedPieceId);
  const previousState = state;

  try {
    const response = await fetch("/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, action }),
    });
    const body = await response.json();

    if (!response.ok) {
      setActionResult(body);
      return;
    }

    if (body.accepted) {
      invalidateSelectedPieceMovesRequests();
      state = body.state;
      legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      pushMoveLogEntry(describeActionForLog(action), previousState?.sideToMove ?? null);
      if (!applyForcedContinuationSelection()) {
        if (previousState?.sideToMove && state?.sideToMove && previousState.sideToMove !== state.sideToMove) {
          clearSelection();
        } else {
          selectedTarget = null;
        }
      }
      showRemovalEffects(
        (Array.isArray(body.removedPieces) ? body.removedPieces : []).map((effect) => ({
          ...effect,
          piece:
            previousState?.pieces?.find((piece) => piece.id === effect.pieceId) ?? null,
        })),
      );
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      renderMoveLog();
      if (selectedPieceId) {
        await reloadSelectedPieceMoves();
      }
      setActionResult({ accepted: true, outcome: body.outcome ?? state.outcome });
      return;
    }

    state = body.state ?? state;
    invalidateSelectedPieceMovesRequests();
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    setActionResult({
      accepted: false,
      validation: body.validation,
    });
    await reloadLegalActions();
    pushMoveLogEntry(`REJECTED ${action.type.toUpperCase()}: ${body.validation?.code ?? "unknown"}`, previousState?.sideToMove ?? null);
    renderMoveLog();
  } catch (error) {
    setActionResult({
      ok: false,
      error: "request_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    submitActionEl.disabled = false;
  }
};

const endCurrentTurn = async () => {
  if (!state) return;
  submitActionEl.disabled = true;
  setActionResult("Ending turn...");
  try {
    const response = await fetch("/api/engine/playground/end-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const body = await response.json();
    if (!response.ok || body.accepted !== true) {
      setActionResult(body);
      return;
    }
    invalidateSelectedPieceMovesRequests();
    state = body.state ?? state;
    legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
    clearSelection();
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    renderMoveLog();
    setActionResult({ accepted: true, outcome: body.outcome ?? state.outcome });
  } catch (error) {
    setActionResult({
      ok: false,
      error: "end_turn_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    submitActionEl.disabled = false;
  }
};

function handleBoardCellClick(clickedCoord) {
  const allowFreeSelection = Boolean(allowFreeSelectionEl?.checked);
  const clickedPiece = boardAdapter.getPieceAt(state, clickedCoord);
  const hasPreviewAtClicked = selectedPieceMovePreviews.some(
    (action) => action.to && action.to.row === clickedCoord.row && action.to.col === clickedCoord.col,
  );
  if (!allowFreeSelection && !clickedPiece && !hasPreviewAtClicked) {
    actionTypeEl.value = "pass";
    clearSelection();
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    return;
  }

  if (sameCoordinate(selectedTarget, clickedCoord)) {
    const candidates = actionsAtTarget(clickedCoord);
    if (candidates.length > 0) {
      const nextType = pickBestActionTypeForTarget(candidates, actionTypeEl.value);
      if (nextType && actionTypeEl.value !== nextType) {
        actionTypeEl.value = nextType;
      }
      void submitCurrentAction();
      return;
    }
  }

  const result = boardAdapter.nextSelectionForCell({
    snapshot: state,
    selection: getCurrentSelection(),
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType: actionTypeEl.value,
    clickedCoord,
    allowFreeSelection,
  });

  const previousSelection = getCurrentSelection();
  applySelection(result.selection);
  actionTypeEl.value = result.nextActionType;

  const pieceChanged = previousSelection.selectedPieceId !== result.selection.selectedPieceId;
  if (pieceChanged) {
    invalidateSelectedPieceMovesRequests();
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
  }

  refreshSelectionLabels();
  renderBoard();
  renderStatus();
  void reloadSelectedPieceMoves().catch((error) => {
    setActionResult({
      ok: false,
      error: "piece_moves_load_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

const setActionResult = (value) => {
  actionResultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const setFixtureResult = (value) => {
  fixtureResultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const normalizeFixture = (fixture) => ({
  ...fixture,
  description: typeof fixture.description === "string" ? fixture.description : fixture.title,
  incorrect: fixture.incorrect === true,
});

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const renderSelectedFixtureDescription = () => {
  if (!fixtureDescriptionEl) {
    return;
  }
  const fixture = getSelectedFixture();
  if (fixtureIncorrectToggleEl) {
    fixtureIncorrectToggleEl.checked = Boolean(fixture?.incorrect);
    fixtureIncorrectToggleEl.disabled = !fixture;
  }
  const description = fixture?.description ??
    "Select a fixture to inspect what scenario it is intended to illustrate.";
  const paragraphs = description.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const renderedParagraphs = [];
  if (fixture?.incorrect) {
    renderedParagraphs.push('<p class="fixture-status fixture-status-incorrect"><strong>Marked incorrect.</strong></p>');
  }
  renderedParagraphs.push(...paragraphs.map((paragraph) => {
    if (paragraph.startsWith("Next move:")) {
      return `<p><strong>${escapeHtml(paragraph)}</strong></p>`;
    }
    return `<p>${escapeHtml(paragraph)}</p>`;
  }));
  fixtureDescriptionEl.innerHTML = renderedParagraphs.join("");
};

const refreshSelectionLabels = () => {
  sourceValueEl.textContent = formatCoordinate(selectedSource);
  targetValueEl.textContent = formatCoordinate(selectedTarget);
};

const applyForcedContinuationSelection = () => {
  const forcedSelection = deriveForcedContinuationSelection(state, legalActions);
  if (!forcedSelection) {
    return false;
  }

  selectedPieceId = forcedSelection.selectedPieceId;
  selectedSource = forcedSelection.source;
  selectedTarget = forcedSelection.target;
  actionTypeEl.value = forcedSelection.actionType;
  refreshSelectionLabels();
  return true;
};

const renderMoveLog = () => {
  moveLogEl.innerHTML = "";
  if (moveLog.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No actions submitted yet.";
    moveLogEl.appendChild(empty);
    return;
  }
  for (const entry of moveLog) {
    const li = document.createElement("li");
    li.textContent = typeof entry === "string" ? entry : entry.text;
    setPlayerTone(li, typeof entry === "string" ? null : entry.player);
    moveLogEl.appendChild(li);
  }
};

const renderBoard = () => {
  if (!state) {
    return;
  }
  boardAdapter.render({
    snapshot: state,
    selection: getCurrentSelection(),
    legalActions,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    removalEffects,
    allowFreeSelection: Boolean(allowFreeSelectionEl?.checked),
    currentActionType: actionTypeEl.value,
  });
};

const renderStatus = () => {
  if (!state) return;

  sideToMoveEl.textContent = state.sideToMove;
  setPlayerTone(sideToMoveEl, state.sideToMove);
  boardTurnIndicatorEl.textContent = state.sideToMove === "P1" ? "Player 1 to play" : "Player 2 to play";
  setPlayerTone(boardTurnIndicatorEl, state.sideToMove);
  turnIndexEl.textContent = String(state.turnIndex);
  continuationEl.textContent = state.continuation
    ? `${state.continuation.type}${state.continuation.phase ? `/${state.continuation.phase}` : ""} (owner ${state.continuation.owner})`
    : "none";

  commanderSupplyEl.textContent = boardAdapter.getCommanderSupplySummary(state);

  const pieceSummary = boardAdapter.getSelectedPieceSummary({
    snapshot: state,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
  });

  if (!pieceSummary) {
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    selectedPieceEl.textContent = "No piece selected.";
    selectedMovePreviewEl.textContent = "No destination selected.";
    selectedPieceMovesEl.textContent = "[]";
    const pushRetreatPrompt = getPushRetreatPrompt(state, selectedPieceId);
    if (pushRetreatPrompt) {
      setBoardPreviewPromptHtml(pushRetreatPrompt);
    } else if (state.continuation?.type === "rush") {
      setRushContinuationPrompt(state.sideToMove);
    } else if (state.continuation?.type === "push" && state.continuation.phase === "follow") {
      setPushFollowContinuationPrompt(state.sideToMove);
    } else {
      setBoardPreviewPrompt("Select a piece to see it supply and command lines + what it can do:");
    }
  } else {
    selectedPieceEl.textContent = JSON.stringify(pieceSummary.details, null, 2);
    selectedPieceMovesEl.textContent = JSON.stringify(pieceSummary.actions, null, 2);

    if (!selectedTarget) {
      selectedMovePreviewEl.textContent = "No destination selected.";
      const pushRetreatPrompt = getPushRetreatPrompt(state, selectedPieceId);
      if (pushRetreatPrompt) {
        setBoardPreviewPromptHtml(pushRetreatPrompt);
      } else if (pieceSummary.details.owner !== state.sideToMove) {
        setBoardPreviewPrompt("Opponent piece. Supply and command lines shown only:");
      } else if (selectedPieceMoves.length === 0) {
        if (state.continuation?.type === "rush") {
          setRushContinuationPrompt(state.sideToMove);
        } else {
          setBoardPreviewPrompt("No moves for this piece at this time. Supply and command lines shown only:");
        }
      } else {
        setBoardPreviewPrompt("Select a square to move to:");
      }
    } else {
      const previewsAtTarget = selectedPieceMovePreviews.filter(
        (action) => action.to && action.to.row === selectedTarget.row && action.to.col === selectedTarget.col,
      );
      const legalAtTarget = selectedPieceMoves.filter(
        (action) => action.to && action.to.row === selectedTarget.row && action.to.col === selectedTarget.col,
      );

      const preferredPreview =
        previewsAtTarget.find((action) => action.type === actionTypeEl.value) ??
        previewsAtTarget[0] ??
        null;

      if (!preferredPreview) {
        selectedMovePreviewEl.textContent = JSON.stringify(
          {
            destination: selectedTarget,
            selectable: false,
            reason: "No move preview exists for this destination.",
          },
          null,
          2,
        );
        setBoardPreviewPrompt("Select a square to move to:");
      } else {
        const disallowedReason =
          preferredPreview.legal === false
            ? getBlockedPreviewLabel(preferredPreview.blockedReason ?? null)
            : null;

        selectedMovePreviewEl.textContent = JSON.stringify(
          {
            actionLabel: actionPreviewLabel(preferredPreview.type, state, selectedTarget),
            destination: selectedTarget,
            legal: legalAtTarget.some((action) => action.type === preferredPreview.type),
            reason: disallowedReason ?? "Legal preview.",
          },
          null,
          2,
        );
        if (preferredPreview.legal === false) {
          setBoardPreviewPrompt("Select a square to move to:");
        } else {
          setBoardPreviewAction(actionPreviewLabel(preferredPreview.type, state, selectedTarget));
        }
      }
    }
  }

  legalActionsEl.textContent = JSON.stringify(legalActions, null, 2);
};

const reloadLegalActions = async () => {
  if (!state) return;
  const response = await fetch("/api/engine/playground/legal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch legal actions: HTTP ${response.status}`);
  }
  const body = await response.json();
  state = body.state ?? state;
  legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
  applyForcedContinuationSelection();
  renderBoard();
  renderStatus();
};

const reloadSelectedPieceMoves = async () => {
  const selectedPiece = boardAdapter.getPieceById(state, selectedPieceId);
  if (!state || !selectedPiece) {
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    renderBoard();
    renderStatus();
    return;
  }

  const requestId = ++selectedPieceMovesRequestId;
  const requestedPieceId = selectedPiece.id;

  const response = await fetch("/api/engine/playground/piece-moves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, pieceId: selectedPiece.id }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch selected piece moves: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (requestId !== selectedPieceMovesRequestId || selectedPieceId !== requestedPieceId) {
    return;
  }
  state = body.state ?? state;
  selectedPieceMoves = Array.isArray(body.actions) ? body.actions : [];
  selectedPieceMovePreviews = Array.isArray(body.previewActions) ? body.previewActions : selectedPieceMoves;
  if (!selectedTarget) {
    selectedTarget = deriveAutoSelectedTarget(selectedPieceMoves);
  }
  renderBoard();
  renderStatus();
};

const loadDefaultEngineState = async () => {
  invalidateSelectedPieceMovesRequests();
  const response = await fetch("/api/engine/playground/state", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load initial state: HTTP ${response.status}`);
  }
  const body = await response.json();
  state = body.state;
  legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
  clearRemovalEffects();
  clearSelection();
  applyForcedContinuationSelection();
  renderBoard();
  renderStatus();
  renderMoveLog();
};

const computeStateHash = async (candidateState) => {
  const response = await fetch("/api/engine/playground/hash", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: candidateState }),
  });
  if (!response.ok) {
    throw new Error(`Failed to compute hash: HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.hash;
};

const getFixtureWriterBaseUrl = () => {
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return null;
  }
  const browserPort = Number.parseInt(window.location.port || "80", 10);
  if (!Number.isFinite(browserPort)) {
    return null;
  }
  return `http://${host}:${browserPort + 1000}`;
};

const computeExpectedFromCurrentState = async () => {
  if (!state) {
    throw new Error("No active state to save");
  }
  const expectedHash = await computeStateHash(state);
  const expectedOutcome = state?.outcome?.status ?? "ongoing";
  return { expectedHash, expectedOutcome };
};

const downloadFixtureCatalog = (catalog, filename) => {
  const blob = new Blob([`${JSON.stringify(catalog, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const updateFixtureOptions = () => {
  const selectedId = currentFixtureId;
  fixtureSelectEl.innerHTML = "";
  for (const fixture of fixtures) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = `${fixture.id} - ${fixture.title}${fixture.incorrect ? " [incorrect]" : ""}`;
    fixtureSelectEl.appendChild(option);
  }
  if (fixtures.length === 0) {
    currentFixtureId = null;
    return;
  }
  currentFixtureId = selectedId && fixtures.some((fixture) => fixture.id === selectedId) ? selectedId : fixtures[0].id;
  fixtureSelectEl.value = currentFixtureId;
  renderSelectedFixtureDescription();
};

const tryLocalFixtureWrite = async (pathSuffix, payload) => {
  const base = getFixtureWriterBaseUrl();
  if (!base) {
    return { ok: false, reason: "not_localhost" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${base}${pathSuffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, reason: "local_write_failed", body };
    }
    const body = await response.json();
    return { ok: true, body };
  } catch {
    clearTimeout(timeout);
    return { ok: false, reason: "local_writer_unreachable" };
  }
};

const loadFixtureCatalog = async () => {
  const response = await fetch("/fixtures/m-golden-fixtures.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load fixtures: HTTP ${response.status}`);
  }
  const catalog = await response.json();
  fixtureCatalog = {
    id: typeof catalog.id === "string" ? catalog.id : "M",
    title: typeof catalog.title === "string" ? catalog.title : "Milestone 2 Golden Scenarios",
    fixtures: Array.isArray(catalog.fixtures)
      ? catalog.fixtures.map(normalizeFixture)
      : [],
  };
  fixtures = fixtureCatalog.fixtures;
  updateFixtureOptions();
};

const getSelectedFixture = () => fixtures.find((fixture) => fixture.id === currentFixtureId) ?? null;

const getFixtureNextMove = (fixture) => {
  if (!fixture || typeof fixture !== "object") {
    return null;
  }
  const candidate = fixture.next_move ?? fixture.action_sequence?.[0] ?? null;
  if (!candidate || typeof candidate !== "object" || typeof candidate.type !== "string") {
    return null;
  }
  return candidate;
};

const applyFixtureNextMoveSelection = async (fixture) => {
  const nextMove = getFixtureNextMove(fixture);
  if (!nextMove || !nextMove.from || !nextMove.to) {
    actionTypeEl.value = nextMove?.type ?? "pass";
    clearSelection();
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    return;
  }

  const selectedPiece =
    (typeof nextMove.actorId === "string" && boardAdapter.getPieceById(state, nextMove.actorId)) ||
    boardAdapter.getPieceAt(state, nextMove.from);

  selectedPieceId = selectedPiece?.id ?? null;
  selectedSource = { ...nextMove.from };
  selectedTarget = { ...nextMove.to };
  actionTypeEl.value = nextMove.type;
  refreshSelectionLabels();

  if (!selectedPieceId) {
    renderBoard();
    renderStatus();
    return;
  }

  await reloadSelectedPieceMoves();
};

const loadFixtureIntoPlayground = async (fixture, { announce = true } = {}) => {
  if (!fixture) {
    throw new Error("Fixture is required");
  }

  invalidateSelectedPieceMovesRequests();
  state = structuredClone(fixture.initial_state);
  legalActions = [];
  clearRemovalEffects();
  clearSelection();
  moveLog.length = 0;
  pushMoveLogEntry(`Loaded fixture ${fixture.id}`);
  renderMoveLog();

  try {
    await reloadLegalActions();
    await applyFixtureNextMoveSelection(fixture);
  } catch {
    renderBoard();
    renderStatus();
  }

  if (announce) {
    setFixtureResult({
      ok: true,
      fixtureId: fixture.id,
      title: fixture.title,
      expected: {
        hash: fixture.expected_final_state_hash,
        outcome: fixture.expected_outcome,
      },
    });
  }
};

const getNextFixtureId = () => {
  const prefix = (fixtureCatalog.id || "M").toUpperCase();
  let maxNumeric = 0;
  let maxDigits = 3;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  for (const fixture of fixtures) {
    const match = pattern.exec(fixture.id);
    if (!match) {
      continue;
    }
    const digits = match[1];
    const numeric = Number.parseInt(digits, 10);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    maxNumeric = Math.max(maxNumeric, numeric);
    maxDigits = Math.max(maxDigits, digits.length);
  }

  const nextNumeric = String(maxNumeric + 1).padStart(maxDigits, "0");
  return `${prefix}-${nextNumeric}`;
};

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!shouldResetSelectionOnDocumentClick(target)) {
    return;
  }
  actionTypeEl.value = "pass";
  clearSelection();
  refreshSelectionLabels();
  renderBoard();
  renderStatus();
});

boardPreviewLabelEl.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-board-preview-action]");
  if (!actionButton) {
    return;
  }
  const previewAction = actionButton.getAttribute("data-board-preview-action");
  if (previewAction !== "end-turn") {
    return;
  }
  void endCurrentTurn();
});

document.addEventListener("keydown", (event) => {
  if (
    !shouldSubmitOnEnter({
      key: event.key,
      target: event.target,
      actionType: actionTypeEl.value,
      submitDisabled: submitActionEl.disabled,
    })
  ) {
    return;
  }
  event.preventDefault();
  submitActionEl.click();
});

resetSelectionEl.addEventListener("click", () => {
  clearSelection();
  refreshSelectionLabels();
  renderBoard();
  renderStatus();
});

submitActionEl.addEventListener("click", async () => {
  void submitCurrentAction();
});

fixtureSelectEl.addEventListener("change", () => {
  currentFixtureId = fixtureSelectEl.value;
  renderSelectedFixtureDescription();
});

fixtureIncorrectToggleEl?.addEventListener("change", async () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    return;
  }

  const updatedFixture = {
    ...fixture,
    incorrect: fixtureIncorrectToggleEl.checked,
  };
  const nextCatalog = {
    ...fixtureCatalog,
    fixtures: fixtures.map((entry) => (entry.id === fixture.id ? updatedFixture : entry)),
  };

  fixtureCatalog = nextCatalog;
  fixtures = fixtureCatalog.fixtures;
  updateFixtureOptions();

  const localWrite = await tryLocalFixtureWrite("/fixtures/update", {
    fixtureId: fixture.id,
    description: updatedFixture.description,
    incorrect: updatedFixture.incorrect,
  });

  if (localWrite.ok) {
    setFixtureResult({
      ok: true,
      mode: "local_write",
      fixtureId: fixture.id,
      incorrect: updatedFixture.incorrect,
    });
    return;
  }

  downloadFixtureCatalog(nextCatalog, "m-golden-fixtures.updated.json");
  setFixtureResult({
    ok: true,
    mode: "download_fallback",
    fixtureId: fixture.id,
    incorrect: updatedFixture.incorrect,
    localWrite,
  });
});

loadFixtureEl.addEventListener("click", async () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setFixtureResult({ ok: false, error: "fixture_not_found" });
    return;
  }
  await loadFixtureIntoPlayground(fixture);
});

replayFixtureEl.addEventListener("click", async () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setFixtureResult({ ok: false, error: "fixture_not_found" });
    return;
  }

  replayFixtureEl.disabled = true;
  setFixtureResult(`Running ${fixture.id}...`);
  try {
    let workingState = structuredClone(fixture.initial_state);
    let acceptedCount = 0;
    let failure = null;

    for (let index = 0; index < fixture.action_sequence.length; index += 1) {
      const action = fixture.action_sequence[index];
      const response = await fetch("/api/engine/playground/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: workingState, action }),
      });
      const body = await response.json();
      if (!response.ok || !body.accepted) {
        failure = {
          index,
          action,
          response: body,
        };
        break;
      }
      acceptedCount += 1;
      workingState = body.state;
    }

    const observedHash = await computeStateHash(workingState);
    const observedOutcome = workingState?.outcome?.status ?? "ongoing";
    const pass = !failure &&
      observedHash === fixture.expected_final_state_hash &&
      observedOutcome === fixture.expected_outcome;

    state = workingState;
    clearSelection();
    refreshSelectionLabels();
    renderBoard();
    await reloadLegalActions();
    renderMoveLog();

    setFixtureResult({
      fixtureId: fixture.id,
      acceptedCount,
      expected: {
        hash: fixture.expected_final_state_hash,
        outcome: fixture.expected_outcome,
      },
      observed: {
        hash: observedHash,
        outcome: observedOutcome,
      },
      pass,
      failure,
    });
  } catch (error) {
    setFixtureResult({
      ok: false,
      error: "replay_failed",
      message: error instanceof Error ? error.message : "Unknown replay error",
    });
  } finally {
    replayFixtureEl.disabled = false;
  }
});

saveFixtureEl.addEventListener("click", async () => {
  if (!state) {
    setFixtureResult({ ok: false, error: "no_state_loaded" });
    return;
  }

  const fixtureId = getNextFixtureId();
  const title = window.prompt("Fixture title:", `Saved from playground ${fixtureId}`);
  if (!title) {
    return;
  }

  saveFixtureEl.disabled = true;
  try {
    const { expectedHash, expectedOutcome } = await computeExpectedFromCurrentState();
    const fixture = {
      id: fixtureId,
      title,
      description: title,
      incorrect: false,
      initial_state: structuredClone(state),
      action_sequence: [],
      expected_final_state_hash: expectedHash,
      expected_outcome: expectedOutcome,
    };

    const localWrite = await tryLocalFixtureWrite("/fixtures/save", { fixture });
    const nextCatalog = {
      ...fixtureCatalog,
      fixtures: [...fixtures, fixture],
    };

    fixtureCatalog = nextCatalog;
    fixtures = fixtureCatalog.fixtures;
    currentFixtureId = fixtureId;
    updateFixtureOptions();

    if (localWrite.ok) {
      setFixtureResult({
        ok: true,
        mode: "local_write",
        fixtureId,
        expected: { hash: expectedHash, outcome: expectedOutcome },
      });
      return;
    }

    downloadFixtureCatalog(nextCatalog, "m-golden-fixtures.updated.json");
    setFixtureResult({
      ok: true,
      mode: "download_fallback",
      fixtureId,
      expected: { hash: expectedHash, outcome: expectedOutcome },
      localWrite,
    });
  } catch (error) {
    setFixtureResult({
      ok: false,
      error: "save_fixture_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    saveFixtureEl.disabled = false;
  }
});

updateFixtureEl.addEventListener("click", async () => {
  if (!state) {
    setFixtureResult({ ok: false, error: "no_state_loaded" });
    return;
  }
  const fixture = getSelectedFixture();
  if (!fixture) {
    setFixtureResult({ ok: false, error: "fixture_not_found" });
    return;
  }

  updateFixtureEl.disabled = true;
  try {
    const { expectedHash, expectedOutcome } = await computeExpectedFromCurrentState();
    const updatedFixture = {
      ...fixture,
      expected_final_state_hash: expectedHash,
      expected_outcome: expectedOutcome,
    };
    const nextCatalog = {
      ...fixtureCatalog,
      fixtures: fixtures.map((entry) => (entry.id === fixture.id ? updatedFixture : entry)),
    };

    const localWrite = await tryLocalFixtureWrite("/fixtures/update", {
      fixtureId: fixture.id,
      expected_final_state_hash: expectedHash,
      expected_outcome: expectedOutcome,
      description: updatedFixture.description,
      incorrect: updatedFixture.incorrect,
    });

    fixtureCatalog = nextCatalog;
    fixtures = fixtureCatalog.fixtures;
    updateFixtureOptions();

    if (localWrite.ok) {
      setFixtureResult({
        ok: true,
        mode: "local_write",
        fixtureId: fixture.id,
        expected: { hash: expectedHash, outcome: expectedOutcome },
      });
      return;
    }

    downloadFixtureCatalog(nextCatalog, "m-golden-fixtures.updated.json");
    setFixtureResult({
      ok: true,
      mode: "download_fallback",
      fixtureId: fixture.id,
      expected: { hash: expectedHash, outcome: expectedOutcome },
      localWrite,
    });
  } catch (error) {
    setFixtureResult({
      ok: false,
      error: "update_fixture_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    updateFixtureEl.disabled = false;
  }
});

refreshSelectionLabels();
void (async () => {
  try {
    await loadFixtureCatalog();
    const defaultFixture = getSelectedFixture();
    if (defaultFixture) {
      await loadFixtureIntoPlayground(defaultFixture, { announce: false });
      return;
    }
    await loadDefaultEngineState();
  } catch (error) {
    setActionResult({
      ok: false,
      error: "load_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
})();
}
