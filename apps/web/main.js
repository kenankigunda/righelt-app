import {
  buildActionPayload,
  pickBestActionTypeForTarget,
  shouldResetSelectionOnDocumentClick,
  shouldSubmitOnEnter,
} from "./interaction.js";
import { assertGameBoardAdapter } from "./board-adapter-contract.js";
import { createEnginePlaygroundBoardAdapter } from "./board-adapters/engine-playground-adapter.js";
import { buildHomeHash, isShellRouteHash, isShellRootHash } from "./shell/routes.js";

if (isShellRootHash(window.location.hash)) {
  window.location.replace(`${window.location.pathname}${window.location.search}${buildHomeHash()}`);
}
const shouldMountShell = isShellRouteHash(window.location.hash);
window.addEventListener("hashchange", () => {
  if (isShellRouteHash(window.location.hash) !== shouldMountShell) {
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
  const actionTypeEl = document.getElementById("action-type");
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
  const loadFixtureEl = document.getElementById("load-fixture");
  const replayFixtureEl = document.getElementById("replay-fixture");
  const saveFixtureEl = document.getElementById("save-fixture");
  const updateFixtureEl = document.getElementById("update-fixture");
  const fixtureResultEl = document.getElementById("fixture-result");
  const allowFreeSelectionEl = document.getElementById("allow-free-selection");

let state = null;
let legalActions = [];
let selectedPieceMoves = [];
let selectedPieceMovePreviews = [];
let selectedPieceId = null;
let selectedSource = null;
let selectedTarget = null;
const moveLog = [];
let fixtures = [];
let currentFixtureId = null;
let fixtureCatalog = { id: "M", title: "Milestone 2 Golden Scenarios", fixtures: [] };

const boardAdapter = createEnginePlaygroundBoardAdapter();
assertGameBoardAdapter(boardAdapter);
boardAdapter.mount({
  boardEl,
  overlayLinesEl,
  onCellClick: handleBoardCellClick,
});

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "unset");
const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);
const actionPreviewLabel = (actionType, snapshot) => {
  if (snapshot?.continuation?.type === "rush" && actionType === "rush") {
    return "Continue rush on this square";
  }
  if (snapshot?.continuation?.type === "push" && actionType === "follow") {
    return "Continue push on this square";
  }
  switch (actionType) {
    case "move":
      return "Move commander to this square";
    case "project":
      return "Project new piece to this square";
    case "rush":
      return "Rush piece to this square";
    case "push":
      return "Push piece onto this square";
    case "follow":
      return "Follow piece to this square";
    case "retreat":
      return "Retreat piece to this square";
    default:
      return "Move to this square";
  }
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
};

const actionsAtTarget = (coord) =>
  selectedPieceMoves.filter((action) => action.to && action.to.row === coord.row && action.to.col === coord.col);

const submitCurrentAction = async () => {
  if (!state) return;
  submitActionEl.disabled = true;
  setActionResult("Applying action...");
  const action = buildActionPayload(actionTypeEl.value, selectedSource, selectedTarget);

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
      state = body.state;
      legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      moveLog.push(`${action.type.toUpperCase()} ${formatCoordinate(action.from)} -> ${formatCoordinate(action.to)}`);
      selectedTarget = null;
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      renderMoveLog();
      setActionResult({ accepted: true, outcome: body.outcome ?? state.outcome });
      return;
    }

    state = body.state ?? state;
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    setActionResult({
      accepted: false,
      validation: body.validation,
    });
    await reloadLegalActions();
    moveLog.push(`REJECTED ${action.type.toUpperCase()}: ${body.validation?.code ?? "unknown"}`);
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

  applySelection(result.selection);
  actionTypeEl.value = result.nextActionType;

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

const refreshSelectionLabels = () => {
  sourceValueEl.textContent = formatCoordinate(selectedSource);
  targetValueEl.textContent = formatCoordinate(selectedTarget);
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
    li.textContent = entry;
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
    selectedPieceMoves,
    selectedPieceMovePreviews,
    allowFreeSelection: Boolean(allowFreeSelectionEl?.checked),
    currentActionType: actionTypeEl.value,
  });
};

const renderStatus = () => {
  if (!state) return;

  sideToMoveEl.textContent = state.sideToMove;
  turnIndexEl.textContent = String(state.turnIndex);
  continuationEl.textContent = state.continuation
    ? `${state.continuation.type} (owner ${state.continuation.owner})`
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
    boardPreviewLabelEl.innerHTML = "<strong>No move preview selected.</strong>";
  } else {
    selectedPieceEl.textContent = JSON.stringify(pieceSummary.details, null, 2);
    selectedPieceMovesEl.textContent = JSON.stringify(pieceSummary.actions, null, 2);

    if (!selectedTarget) {
      selectedMovePreviewEl.textContent = "No destination selected.";
      boardPreviewLabelEl.innerHTML = "<strong>No move preview selected.</strong>";
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
        boardPreviewLabelEl.innerHTML = "<strong>No move preview selected.</strong>";
      } else {
        const disallowedReason =
          preferredPreview.legal === false && preferredPreview.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED"
            ? "Disallowed: destination would be unsupplied."
            : preferredPreview.legal === false
              ? `Disallowed: ${preferredPreview.blockedReason ?? "rule violation"}.`
              : null;

        selectedMovePreviewEl.textContent = JSON.stringify(
          {
            actionLabel: actionPreviewLabel(preferredPreview.type, state),
            destination: selectedTarget,
            legal: legalAtTarget.some((action) => action.type === preferredPreview.type),
            reason: disallowedReason ?? "Legal preview.",
          },
          null,
          2,
        );
        boardPreviewLabelEl.innerHTML = `<strong>${actionPreviewLabel(preferredPreview.type, state)}</strong>`;
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

  const response = await fetch("/api/engine/playground/piece-moves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, pieceId: selectedPiece.id }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch selected piece moves: HTTP ${response.status}`);
  }
  const body = await response.json();
  state = body.state ?? state;
  selectedPieceMoves = Array.isArray(body.actions) ? body.actions : [];
  selectedPieceMovePreviews = Array.isArray(body.previewActions) ? body.previewActions : selectedPieceMoves;
  renderBoard();
  renderStatus();
};

const loadInitialState = async () => {
  const response = await fetch("/api/engine/playground/state", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load initial state: HTTP ${response.status}`);
  }
  const body = await response.json();
  state = body.state;
  legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
  clearSelection();
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
    option.textContent = `${fixture.id} - ${fixture.title}`;
    fixtureSelectEl.appendChild(option);
  }
  if (fixtures.length === 0) {
    currentFixtureId = null;
    return;
  }
  currentFixtureId = selectedId && fixtures.some((fixture) => fixture.id === selectedId) ? selectedId : fixtures[0].id;
  fixtureSelectEl.value = currentFixtureId;
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
    fixtures: Array.isArray(catalog.fixtures) ? catalog.fixtures : [],
  };
  fixtures = fixtureCatalog.fixtures;
  updateFixtureOptions();
};

const getSelectedFixture = () => fixtures.find((fixture) => fixture.id === currentFixtureId) ?? null;

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
});

loadFixtureEl.addEventListener("click", () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setFixtureResult({ ok: false, error: "fixture_not_found" });
    return;
  }
  state = structuredClone(fixture.initial_state);
  legalActions = [];
  clearSelection();
  moveLog.length = 0;
  moveLog.push(`Loaded fixture ${fixture.id}`);
  refreshSelectionLabels();
  renderBoard();
  renderStatus();
  renderMoveLog();
  void reloadLegalActions().catch(() => {});
  setFixtureResult({
    ok: true,
    fixtureId: fixture.id,
    title: fixture.title,
    expected: {
      hash: fixture.expected_final_state_hash,
      outcome: fixture.expected_outcome,
    },
  });
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
Promise.all([loadInitialState(), loadFixtureCatalog()]).catch((error) => {
  setActionResult({
    ok: false,
    error: "load_failed",
    message: error instanceof Error ? error.message : "Unknown error",
  });
});
}
