const normalizeCoord = (coord) => {
  if (!coord || typeof coord !== "object") {
    return null;
  }
  const row = Number(coord.row);
  const col = Number(coord.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return null;
  }
  return { row, col };
};

const normalizeSavedSelection = (savedSelection) => {
  if (!savedSelection || typeof savedSelection !== "object") {
    return null;
  }
  const source = normalizeCoord(savedSelection.source);
  const target = savedSelection.target == null ? null : normalizeCoord(savedSelection.target);
  const actorSide = savedSelection.actorSide === "P2" ? "P2" : savedSelection.actorSide === "P1" ? "P1" : null;
  const turnIndex = Number(savedSelection.turnIndex);
  if (!source || (savedSelection.target != null && !target) || !actorSide || !Number.isFinite(turnIndex)) {
    return null;
  }
  return {
    source,
    target,
    actorSide,
    turnIndex,
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeScenario = (scenario) => ({
  formatVersion: 2,
  id: String(scenario?.id || ""),
  title: String(scenario?.title || ""),
  description: typeof scenario?.description === "string" ? scenario.description : String(scenario?.title || ""),
  incorrect: scenario?.incorrect === true,
  initialState: structuredClone(scenario?.initialState ?? scenario?.initial_state ?? null),
  moves: Array.isArray(scenario?.moves)
    ? scenario.moves.map((move) => ({
        turnIndex: Number(move?.turnIndex ?? 0),
        turnMoveIndex: Number(move?.turnMoveIndex ?? 0),
        actorSide: move?.actorSide === "P2" ? "P2" : "P1",
        notation: String(move?.notation || ""),
        action: structuredClone(move?.action ?? null),
      }))
    : [],
  resultingState: structuredClone(scenario?.resultingState ?? scenario?.resulting_state ?? null),
  expectedFinalStateHash: String(scenario?.expectedFinalStateHash ?? scenario?.expected_final_state_hash ?? ""),
  expectedOutcome: String(scenario?.expectedOutcome ?? scenario?.expected_outcome ?? "ongoing"),
  savedSelection: normalizeSavedSelection(scenario?.savedSelection ?? scenario?.saved_selection ?? null),
});

export const getLaunchParticipantCopyMode = (game) => {
  const roles = Array.isArray(game?.myRoles) ? game.myRoles : typeof game?.myRole === "string" ? [game.myRole] : [];
  return roles.includes("Player 1") || roles.includes("Player 2")
    ? "copy_source_participants"
    : "viewer_as_player1";
};

export const loadScenarioCatalog = async () => {
  const response = await fetch("/scenarios/catalog.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load scenarios: HTTP ${response.status}`);
  }
  const catalog = await response.json();
  return {
    id: typeof catalog?.id === "string" ? catalog.id : "S",
    title: typeof catalog?.title === "string" ? catalog.title : "Saved Scenarios",
    scenarios: Array.isArray(catalog?.scenarios) ? catalog.scenarios.map(normalizeScenario) : [],
  };
};

export const getScenarioWriterBaseUrl = () => {
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

export const canAuthorScenariosLocally = () => Boolean(getScenarioWriterBaseUrl());

export const tryLocalScenarioWrite = async (pathSuffix, payload) => {
  const base = getScenarioWriterBaseUrl();
  if (!base) {
    return { ok: false, reason: "not_localhost" };
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${base}${pathSuffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    window.clearTimeout(timeout);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, reason: "local_write_failed", body };
    }
    return { ok: true, body: await response.json() };
  } catch {
    window.clearTimeout(timeout);
    return { ok: false, reason: "local_writer_unreachable" };
  }
};

export const downloadScenarioCatalog = (catalog, filename = "scenarios.catalog.json") => {
  const blob = new Blob([`${JSON.stringify(catalog, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const computeStateHash = async (candidateState) => {
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

export const buildScenarioFromGame = async (
  game,
  { scenarioId, title, description, moveLimit = null, resultingStateOverride = null, savedSelection = null } = {},
) => {
  if (!UUID_PATTERN.test(String(scenarioId || ""))) {
    throw new Error("Scenario IDs must be UUID v4 values.");
  }
  const safeMoveLimit = Number.isFinite(moveLimit) ? Math.max(0, Math.min(moveLimit, game.moves.length)) : game.moves.length;
  const selectedMoves = game.moves.slice(0, safeMoveLimit);
  const resolvedResultingState =
    resultingStateOverride ?? game.board?.state ?? game.currentSnapshot ?? selectedMoves[selectedMoves.length - 1]?.snapshot ?? null;
  const initialState = structuredClone(selectedMoves[0]?.selectionSnapshot ?? resolvedResultingState);
  const resultingStateSource = resolvedResultingState;
  const resultingState = structuredClone(resultingStateSource);
  const expectedFinalStateHash = await computeStateHash(resultingState);
  return normalizeScenario({
    formatVersion: 2,
    id: scenarioId,
    title,
    description: description || title,
    incorrect: false,
    initialState,
    moves: selectedMoves.map((move) => ({
      turnIndex: move.turnIndex,
      turnMoveIndex: move.turnMoveIndex,
      actorSide: move.actorSide,
      notation: move.notation,
      action: structuredClone(move.action),
    })),
    resultingState,
    expectedFinalStateHash,
    expectedOutcome: resultingState?.outcome?.status ?? "ongoing",
    savedSelection: normalizeSavedSelection(savedSelection),
  });
};

export const buildHistoryBranchSeedFromGame = (game, moveIndex) => {
  const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
  if (!move?.selectionSnapshot || !move?.action) {
    throw new Error("invalid_history_branch_move");
  }
  const selectedMoves = game.moves.slice(0, moveIndex);
  const initialState = structuredClone(selectedMoves[0]?.selectionSnapshot ?? game.moves?.[0]?.selectionSnapshot ?? game.board?.state ?? game.currentSnapshot);
  const resultingState = structuredClone(move.selectionSnapshot);
  const sourceLabel = String(game?.id || "").startsWith("game-") ? String(game.id).slice(0, 11) : String(game?.id || "game");
  return {
    title: `Branch from ${sourceLabel} move ${move.index + 1}`,
    scenario: normalizeScenario({
      formatVersion: 2,
      id: `history-branch:${game?.id || "game"}:${move.index}`,
      title: `Branch from ${sourceLabel} move ${move.index + 1}`,
      description: `Replay through move ${move.index} and open before move ${move.index + 1}.`,
      incorrect: false,
      initialState,
      moves: selectedMoves.map((selectedMove) => ({
        turnIndex: selectedMove.turnIndex,
        turnMoveIndex: selectedMove.turnMoveIndex,
        actorSide: selectedMove.actorSide,
        notation: selectedMove.notation,
        action: structuredClone(selectedMove.action),
      })),
      resultingState,
      expectedFinalStateHash: "",
      expectedOutcome: resultingState?.outcome?.status ?? "ongoing",
    }),
    initialSelectionAction: structuredClone(move.action),
    participantCopyMode: getLaunchParticipantCopyMode(game),
  };
};
