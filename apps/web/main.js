const boardEl = document.getElementById("board");
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
const legalActionsEl = document.getElementById("legal-actions");
const moveLogEl = document.getElementById("move-log");

const BOARD_SIZE = 10;

let state = null;
let legalActions = [];
let selectedSource = null;
let selectedTarget = null;
const moveLog = [];

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "unset");

const setActionResult = (value) => {
  actionResultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const refreshSelectionLabels = () => {
  sourceValueEl.textContent = formatCoordinate(selectedSource);
  targetValueEl.textContent = formatCoordinate(selectedTarget);
};

const findPieceAt = (row, col) => {
  if (!state) return null;
  return state.pieces.find((piece) => piece.position.row === row && piece.position.col === col) ?? null;
};

const renderBoard = () => {
  boardEl.innerHTML = "";
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      const isSource = selectedSource && selectedSource.row === row && selectedSource.col === col;
      const isTarget = selectedTarget && selectedTarget.row === row && selectedTarget.col === col;
      if (isSource) cell.classList.add("source");
      if (isTarget) cell.classList.add("target");

      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      const piece = findPieceAt(row, col);
      const marker = document.createElement("span");
      marker.className = "piece";
      marker.textContent = piece
        ? `${piece.kind === "commander" ? "C" : "U"}${piece.owner === "P1" ? "1" : "2"}`
        : ".";
      cell.appendChild(marker);

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${row},${col}`;
      cell.appendChild(coord);
      boardEl.appendChild(cell);
    }
  }
};

const renderStatus = () => {
  if (!state) return;
  sideToMoveEl.textContent = state.sideToMove;
  turnIndexEl.textContent = String(state.turnIndex);
  continuationEl.textContent = state.continuation
    ? `${state.continuation.type} (owner ${state.continuation.owner})`
    : "none";

  const c1 = state.pieces.find((piece) => piece.id === "C1");
  const c2 = state.pieces.find((piece) => piece.id === "C2");
  commanderSupplyEl.textContent = `C1=${c1?.supplied ?? "-"} | C2=${c2?.supplied ?? "-"}`;
  legalActionsEl.textContent = JSON.stringify(legalActions, null, 2);
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
  legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
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
  renderBoard();
  renderStatus();
  renderMoveLog();
};

const buildActionPayload = () => {
  const type = actionTypeEl.value;
  if (type === "pass") {
    return { type };
  }
  return {
    type,
    from: selectedSource,
    to: selectedTarget,
  };
};

boardEl.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const clicked = { row, col };

  if (!selectedSource) {
    selectedSource = clicked;
  } else if (!selectedTarget) {
    selectedTarget = clicked;
  } else {
    selectedSource = clicked;
    selectedTarget = null;
  }

  refreshSelectionLabels();
  renderBoard();
});

resetSelectionEl.addEventListener("click", () => {
  selectedSource = null;
  selectedTarget = null;
  refreshSelectionLabels();
  renderBoard();
});

submitActionEl.addEventListener("click", async () => {
  if (!state) return;
  submitActionEl.disabled = true;
  setActionResult("Applying action...");
  const action = buildActionPayload();

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
      moveLog.push(`${action.type.toUpperCase()} ${formatCoordinate(action.from)} -> ${formatCoordinate(action.to)}`);
      selectedSource = null;
      selectedTarget = null;
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      renderMoveLog();
      setActionResult({ accepted: true, outcome: body.outcome ?? state.outcome });
      return;
    }

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
});

refreshSelectionLabels();
void loadInitialState().catch((error) => {
  setActionResult({
    ok: false,
    error: "load_failed",
    message: error instanceof Error ? error.message : "Unknown error",
  });
});
