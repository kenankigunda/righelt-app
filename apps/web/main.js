const boardEl = document.getElementById("board");
const overlayLinesEl = document.getElementById("overlay-lines");
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
const selectedPieceMovesEl = document.getElementById("selected-piece-moves");
const legalActionsEl = document.getElementById("legal-actions");
const moveLogEl = document.getElementById("move-log");
const fixtureSelectEl = document.getElementById("fixture-select");
const loadFixtureEl = document.getElementById("load-fixture");
const replayFixtureEl = document.getElementById("replay-fixture");
const saveFixtureEl = document.getElementById("save-fixture");
const updateFixtureEl = document.getElementById("update-fixture");
const fixtureResultEl = document.getElementById("fixture-result");

const BOARD_SIZE = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

let state = null;
let legalActions = [];
let selectedPieceMoves = [];
let selectedPieceId = null;
let selectedSource = null;
let selectedTarget = null;
const moveLog = [];
let fixtures = [];
let currentFixtureId = null;
let fixtureCatalog = { id: "M", title: "Milestone 2 Golden Scenarios", fixtures: [] };
let cellByCoordinateKey = new Map();

const coordKey = (coord) => `${coord.row},${coord.col}`;
const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "unset");
const isSupplyPoint = (row, col) => (row === 0 && col === 9) || (row === 9 && col === 0);
const buildPieceToken = (piece, ghost = false) => {
  const token = document.createElement("span");
  token.className = `piece-token ${piece.owner === "P1" ? "p1" : "p2"} ${piece.kind}`;
  if (!piece.supplied || !piece.commanded) {
    token.classList.add("inactive");
  }
  if (ghost) {
    token.classList.add("ghost");
  }
  token.textContent = piece.kind === "commander" ? "C" : "";
  return token;
};

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

const findPieceAt = (row, col) => {
  if (!state) return null;
  return state.pieces.find((piece) => piece.position.row === row && piece.position.col === col) ?? null;
};

const findPieceById = (pieceId) => {
  if (!state || !pieceId) return null;
  return state.pieces.find((piece) => piece.id === pieceId) ?? null;
};

const getSelectedPiece = () => {
  const piece = findPieceById(selectedPieceId);
  if (!piece) {
    selectedPieceId = null;
    return null;
  }
  return piece;
};

const getSupplyArtifactFor = (owner) => {
  if (!state?.artifacts?.supply) {
    return null;
  }
  return state.artifacts.supply.find((entry) => entry.player === owner) ?? null;
};

const getSupplyPathForPiece = (piece) => {
  const supplyArtifact = getSupplyArtifactFor(piece.owner);
  return supplyArtifact?.shortestPathByPieceId?.[piece.id] ?? [];
};

const getCommandPathForPiece = (piece) => state?.artifacts?.command?.shortestPathToCommanderByPieceId?.[piece.id] ?? [];

const getGroupInfoForPiece = (piece) => {
  const groups = state?.artifacts?.groups;
  if (!groups) {
    return {
      componentId: null,
      members: [],
      strength: null,
    };
  }

  const componentId = groups.componentByPieceId[piece.id] ?? null;
  if (!componentId) {
    return {
      componentId: null,
      members: [],
      strength: null,
    };
  }

  return {
    componentId,
    members: groups.membersByComponentId[componentId] ?? [],
    strength: groups.strengthByComponentId[componentId] ?? null,
  };
};

const getSelectedPieceActions = () => selectedPieceMoves;

const ACTION_PRIORITY = ["move", "rush", "project", "push", "follow", "retreat"];

const pickBestActionTypeForTarget = (actionsAtTarget) => {
  if (actionsAtTarget.length === 0) {
    return null;
  }

  const currentType = actionTypeEl.value;
  if (actionsAtTarget.some((action) => action.type === currentType)) {
    return currentType;
  }

  for (const type of ACTION_PRIORITY) {
    if (actionsAtTarget.some((action) => action.type === type)) {
      return type;
    }
  }

  return actionsAtTarget[0]?.type ?? null;
};

const selectPassAction = () => {
  actionTypeEl.value = "pass";
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

const setOverlayViewBox = () => {
  const width = boardEl.clientWidth;
  const height = boardEl.clientHeight;
  overlayLinesEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
};

const getCellCenter = (coord) => {
  const cell = cellByCoordinateKey.get(coordKey(coord));
  if (!cell) {
    return null;
  }

  return {
    x: cell.offsetLeft + cell.offsetWidth / 2,
    y: cell.offsetTop + cell.offsetHeight / 2,
  };
};

const getPreviewOffset = (actionType) => {
  if (actionType === "move") {
    return { x: -14, y: -14 };
  }
  if (actionType === "rush") {
    return { x: 14, y: 14 };
  }
  return { x: 0, y: 0 };
};

const drawPath = (path, stroke, dashPattern = null) => {
  if (!path || path.length < 2) {
    return;
  }

  for (let i = 0; i < path.length - 1; i += 1) {
    const start = getCellCenter(path[i]);
    const end = getCellCenter(path[i + 1]);
    if (!start || !end) {
      continue;
    }

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    if (dashPattern) {
      line.setAttribute("stroke-dasharray", dashPattern);
    }
    overlayLinesEl.appendChild(line);
  }
};

const ensureArrowMarker = () => {
  let defs = overlayLinesEl.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    overlayLinesEl.appendChild(defs);
  }

  let marker = defs.querySelector("#preview-arrow");
  if (!marker) {
    marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "preview-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.setAttribute("markerUnits", "strokeWidth");

    const arrowPath = document.createElementNS(SVG_NS, "path");
    arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrowPath.setAttribute("fill", "#8b5ec0");
    arrowPath.setAttribute("fill-opacity", "0.55");
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
  }
};

const drawArrowLine = (from, to, stroke, endOffset = { x: 0, y: 0 }) => {
  const start = getCellCenter(from);
  const end = getCellCenter(to);
  if (!start || !end) {
    return;
  }

  const rawEnd = {
    x: end.x + endOffset.x,
    y: end.y + endOffset.y,
  };
  const deltaX = rawEnd.x - start.x;
  const deltaY = rawEnd.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);
  const stopBeforeGhost = 16;
  const shortenBy = Math.min(stopBeforeGhost, Math.max(0, distance - 4));
  const unitX = distance > 0 ? deltaX / distance : 0;
  const unitY = distance > 0 ? deltaY / distance : 0;
  const shortenedEnd = {
    x: rawEnd.x - unitX * shortenBy,
    y: rawEnd.y - unitY * shortenBy,
  };

  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(start.x));
  line.setAttribute("y1", String(start.y));
  line.setAttribute("x2", String(shortenedEnd.x));
  line.setAttribute("y2", String(shortenedEnd.y));
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "2.5");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-opacity", "0.5");
  line.setAttribute("marker-end", "url(#preview-arrow)");
  overlayLinesEl.appendChild(line);
};

const clearCellDecorations = () => {
  for (const cell of cellByCoordinateKey.values()) {
    cell.classList.remove("group-member", "selected-piece");
    cell.querySelectorAll(".group-strength-badge,.move-ghost").forEach((node) => node.remove());
  }
};

const renderPieceOverlays = () => {
  clearCellDecorations();
  overlayLinesEl.innerHTML = "";
  setOverlayViewBox();
  ensureArrowMarker();

  const piece = getSelectedPiece();
  if (!piece) {
    return;
  }

  const pieceCell = cellByCoordinateKey.get(coordKey(piece.position));
  if (pieceCell) {
    pieceCell.classList.add("selected-piece");
  }

  const groupInfo = getGroupInfoForPiece(piece);
  if (groupInfo.members.length > 0) {
    const memberPieces = groupInfo.members
      .map((pieceId) => findPieceById(pieceId))
      .filter((candidate) => Boolean(candidate));

    for (const member of memberPieces) {
      const memberCell = cellByCoordinateKey.get(coordKey(member.position));
      memberCell?.classList.add("group-member");
    }

    const anchor = memberPieces
      .map((member) => member.position)
      .sort((a, b) => {
        if (a.row !== b.row) {
          return a.row - b.row;
        }
        return a.col - b.col;
      })[0];

    if (anchor) {
      const anchorCell = cellByCoordinateKey.get(coordKey(anchor));
      if (anchorCell && typeof groupInfo.strength === "number") {
        const badge = document.createElement("span");
        badge.className = "group-strength-badge";
        badge.textContent = String(groupInfo.strength);
        anchorCell.appendChild(badge);
      }
    }
  }

  drawPath(getSupplyPathForPiece(piece), "#2f8e63");
  drawPath(getCommandPathForPiece(piece), "#2470c7");

  const selectedActions = getSelectedPieceActions();
  const seenPreviews = new Set();
  for (const action of selectedActions) {
    if (!action.to) {
      continue;
    }

    const targetKey = coordKey(action.to);
    const previewKey = `${action.type}:${targetKey}`;
    if (seenPreviews.has(previewKey)) {
      continue;
    }
    seenPreviews.add(previewKey);

    if (action.type === "move" || action.type === "rush") {
      drawArrowLine(piece.position, action.to, "#8b5ec0", getPreviewOffset(action.type));
    } else {
      drawPath([piece.position, action.to], "#8b5ec0", "5 5");
    }
    const targetCell = cellByCoordinateKey.get(targetKey);
    if (targetCell) {
      const ghost = buildPieceToken(piece, true);
      ghost.classList.add("move-ghost");
      if (action.type === "move") {
        ghost.classList.add("offset-move");
      } else if (action.type === "rush") {
        ghost.classList.add("offset-rush");
      }
      targetCell.appendChild(ghost);
    }
  }
};

const renderBoard = () => {
  boardEl.innerHTML = "";
  cellByCoordinateKey = new Map();

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
      const marker = piece ? buildPieceToken(piece) : document.createElement("span");
      if (!piece) {
        marker.className = "piece-empty";
        marker.textContent = ".";
      }
      cell.appendChild(marker);

      if (isSupplyPoint(row, col)) {
        const supplyMarker = document.createElement("span");
        supplyMarker.className = "supply-point-marker";
        supplyMarker.textContent = "◆";
        cell.appendChild(supplyMarker);
      }

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${row},${col}`;
      cell.appendChild(coord);

      boardEl.appendChild(cell);
      cellByCoordinateKey.set(`${row},${col}`, cell);
    }
  }

  renderPieceOverlays();
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

  const selectedPiece = getSelectedPiece();
  if (!selectedPiece) {
    selectedPieceMoves = [];
    selectedPieceEl.textContent = "No piece selected.";
    selectedPieceMovesEl.textContent = "[]";
  } else {
    const groupInfo = getGroupInfoForPiece(selectedPiece);
    const selectedActions = getSelectedPieceActions();

    selectedPieceEl.textContent = JSON.stringify(
      {
        id: selectedPiece.id,
        owner: selectedPiece.owner,
        kind: selectedPiece.kind,
        position: selectedPiece.position,
        supplied: selectedPiece.supplied,
        commanded: selectedPiece.commanded,
        groupComponentId: groupInfo.componentId,
        groupStrength: groupInfo.strength,
      },
      null,
      2,
    );

    selectedPieceMovesEl.textContent = JSON.stringify(
      selectedActions.map((action) => ({
        type: action.type,
        from: action.from ?? null,
        to: action.to ?? null,
      })),
      null,
      2,
    );
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
  const selectedPiece = getSelectedPiece();
  if (!state || !selectedPiece) {
    selectedPieceMoves = [];
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
  selectedPieceMoves = [];
  selectedPieceId = null;
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
  const clickedCoord = { row, col };
  const clickedPiece = findPieceAt(row, col);

  if (clickedPiece) {
    selectedPieceId = clickedPiece.id;
    selectedSource = { ...clickedPiece.position };
    selectedTarget = null;
  } else if (!selectedSource) {
    selectedSource = clickedCoord;
    selectPassAction();
  } else {
    selectedTarget = clickedCoord;

    const actionsAtTarget = getSelectedPieceActions().filter(
      (action) => action.to && action.to.row === clickedCoord.row && action.to.col === clickedCoord.col,
    );
    const nextActionType = pickBestActionTypeForTarget(actionsAtTarget);
    if (nextActionType) {
      actionTypeEl.value = nextActionType;
    } else {
      selectPassAction();
    }
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
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (target.closest("button, input, select, textarea, a, label, [role='button'], [role='link']")) {
    return;
  }
  selectPassAction();
  selectedPieceId = null;
  selectedPieceMoves = [];
  selectedSource = null;
  selectedTarget = null;
  refreshSelectionLabels();
  renderBoard();
  renderStatus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  const target = event.target;
  if (
    target instanceof Element &&
    (target.closest("input, textarea, [contenteditable='true']") ||
      target.closest("button, a, [role='button'], [role='link']"))
  ) {
    return;
  }
  if (actionTypeEl.value === "pass" || submitActionEl.disabled) {
    return;
  }
  event.preventDefault();
  submitActionEl.click();
});

resetSelectionEl.addEventListener("click", () => {
  selectedPieceId = null;
  selectedPieceMoves = [];
  selectedSource = null;
  selectedTarget = null;
  refreshSelectionLabels();
  renderBoard();
  renderStatus();
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
      selectedPieceMoves = [];
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
  selectedPieceMoves = [];
  selectedPieceId = null;
  selectedSource = null;
  selectedTarget = null;
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
    selectedPieceMoves = [];
    selectedPieceId = null;
    selectedSource = null;
    selectedTarget = null;
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
