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
});

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

export const getNextScenarioId = (catalog) => {
  const prefix = String(catalog?.id || "S").toUpperCase();
  let maxNumeric = 0;
  let maxDigits = 3;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const scenario of Array.isArray(catalog?.scenarios) ? catalog.scenarios : []) {
    const match = pattern.exec(String(scenario?.id || ""));
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
  return `${prefix}-${String(maxNumeric + 1).padStart(maxDigits, "0")}`;
};

export const buildScenarioFromGame = async (game, { scenarioId, title, description, moveLimit = null } = {}) => {
  const safeMoveLimit = Number.isFinite(moveLimit) ? Math.max(0, Math.min(moveLimit, game.moves.length)) : game.moves.length;
  const selectedMoves = game.moves.slice(0, safeMoveLimit);
  const initialState = structuredClone(selectedMoves[0]?.selectionSnapshot ?? game.board?.state ?? game.currentSnapshot);
  const resultingState = structuredClone(selectedMoves[selectedMoves.length - 1]?.snapshot ?? game.board?.state ?? game.currentSnapshot);
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
  });
};
