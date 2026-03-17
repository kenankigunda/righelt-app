import { assertGameBoardAdapter } from "../board-adapter-contract.js";
import { createEnginePlaygroundBoardAdapter } from "../board-adapters/engine-playground-adapter.js";
import { syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createShellBoardHost } from "../board/hosts/shell-host.js";
import { getBootstrapPayload } from "./bootstrap.js";
import { createLiveTransportStore } from "./live-transport.js";
import { createLiveSyncClient } from "./live-sync.js";
import { ensureHoverCapabilityController } from "../hover-capability.js";
import { applyCommandLegendSwatch, getCommandLegendSwatchStyle } from "../legend.js";
import { saveTutorialCompleted } from "./persistence.js";
import {
  buildScenarioFromGame,
  downloadScenarioCatalog,
  getNextScenarioId,
  loadScenarioCatalog,
  tryLocalScenarioWrite,
} from "./scenarios.js";
import { shouldSkipBoardRuntimeReload } from "./runtime-sync.js";
import {
  buildGameHash,
  buildHomeHash,
  buildInviteHash,
  buildTutorialHash,
  isShellRootHash,
  parseRouteFromHash,
  shouldLiveSyncRoute,
  toggleDebugHash,
} from "./routes.js";
import { createTutorialController } from "./tutorial.js";

const appEl = document.getElementById("app");
const bootstrap = getBootstrapPayload();

if (isShellRootHash(window.location.hash)) {
  window.location.replace(`${window.location.pathname}${window.location.search}${buildHomeHash()}`);
}

const ensureShellStylesheet = () => {
  if (document.getElementById("shell-stylesheet")) {
    return;
  }
  const link = document.createElement("link");
  link.id = "shell-stylesheet";
  link.rel = "stylesheet";
  link.href = "./shell/shell.css";
  document.head.appendChild(link);
};

ensureShellStylesheet();
if (appEl) {
  appEl.hidden = false;
  appEl.setAttribute("data-shell-layout-mode", "narrow");
}

const createMemoryStorageFallback = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const storage = typeof window.localStorage !== "undefined" ? window.localStorage : createMemoryStorageFallback();
const transport = createLiveTransportStore({ storage });
const tutorial = createTutorialController({ steps: bootstrap.tutorialSteps });
const boardAdapter = createEnginePlaygroundBoardAdapter();
const hoverCapability = ensureHoverCapabilityController();
assertGameBoardAdapter(boardAdapter);

const toStableKey = (value) => {
  if (value === null || typeof value === "undefined") {
    return "null";
  }
  return JSON.stringify(value);
};

let currentRoute = parseRouteFromHash(window.location.hash);
let mountedBoardGameId = null;
let mountedHistoryMoveIndex = null;
let mountedSnapshotKey = null;
let mountedLegalActionsKey = null;
let mountedOverlayKey = null;
let mountedSyncStatusKey = null;
let boardRuntime = null;
let busy = false;
let liveSyncConnectedRoute = "";
let wsStatus = { state: "disconnected", gameId: null, reconnectAttempts: 0 };
let lastWsStatusKey = toStableKey(wsStatus);
let wsLastEvent = "none";
let inviteFeedback = "";
let inviteFeedbackTimer = null;
let routeHydrated = false;
let resolvedInvite = null;
let scenarioCatalog = { id: "S", title: "Saved Scenarios", scenarios: [] };
let selectedScenarioId = null;
let scenarioFeedback = "";
const inviteChoiceCommittedByGameId = new Set();
const ignoredApprovalRequests = new Set();
let lastRenderedMarkup = "";
const HISTORY_SELECTION_EXIT_MS = 56;
const HISTORY_RELEASE_BOUNCE_MS = 140;
let pressedHistoryActionEl = null;
let historyReleaseTimer = null;
let pressedControlEl = null;
let controlReleaseTimer = null;
let stickyLayoutFrame = 0;
const SHELL_WIDE_SCREEN_MIN_WIDTH = 901;
const SHELL_VIEWPORT_GUTTER_PX = 16;
const miniBoardPreviewRegistry = new Map();
const renderedMiniBoardPreviewPayloads = new Map();

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatStatus = (connected) =>
  connected ? '<span class="status-chip live">Connected</span>' : '<span class="status-chip offline">Disconnected</span>';
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getControlSeatForTurn = (state, turnOwnerSeat) => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};
const playerToneClassForSeat = (seat) => (seat === "Player 1" ? "player-tone-p1" : seat === "Player 2" ? "player-tone-p2" : "player-tone-neutral");
const playerToneClassForSide = (side) => (side === "P1" ? "player-tone-p1" : side === "P2" ? "player-tone-p2" : "player-tone-neutral");
const renderSeatLabel = (seat) => `<span class="${playerToneClassForSeat(seat)}">${escapeHtml(seat || "Unknown")}</span>`;
const renderRoleLabel = (role) => {
  if (role === "Player 1" || role === "Player 2") {
    return `<strong class="${playerToneClassForSeat(role)}">${escapeHtml(role)}</strong>`;
  }
  return `<strong>${escapeHtml(role || "Unknown")}</strong>`;
};
const colorizePlayerReferences = (text) =>
  escapeHtml(text || "")
    .replaceAll("Player 1", '<span class="player-tone-p1">Player 1</span>')
    .replaceAll("Player 2", '<span class="player-tone-p2">Player 2</span>');

const formatDisplayGameId = (gameId) => {
  const value = String(gameId || "");
  if (!value.startsWith("game-")) {
    return value.slice(0, 6);
  }
  return `game-${value.slice(5, 11)}`;
};

const formatClientDateTime = (value) => {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
};

const registerMiniBoardPreview = ({ previewId, snapshot, previewKey, sizeVariant = "compact" }) => {
  renderedMiniBoardPreviewPayloads.set(previewId, {
    snapshot: snapshot ?? null,
    previewKey,
    sizeVariant,
  });
  return previewId;
};

const renderMiniBoardPreviewRoot = ({ previewId, snapshot, previewKey, sizeVariant = "compact" }) => {
  const stablePreviewId = registerMiniBoardPreview({
    previewId,
    snapshot,
    previewKey,
    sizeVariant,
  });
  return `<div class="mini-board-preview-surface" data-mini-board-preview data-preview-id="${escapeHtml(stablePreviewId)}"></div>`;
};

const formatOutcomeStatus = (outcome) => {
  if (typeof outcome === "string" && outcome.trim().length > 0) {
    return outcome;
  }
  if (outcome && typeof outcome === "object" && typeof outcome.status === "string" && outcome.status.trim().length > 0) {
    return outcome.status;
  }
  return "unknown";
};

const formatSideToMoveLabel = (snapshot) => {
  if (snapshot?.sideToMove === "P1") {
    return "Player 1 to play";
  }
  if (snapshot?.sideToMove === "P2") {
    return "Player 2 to play";
  }
  return "Turn unknown";
};

const getGamePreviewSnapshot = (game) => game?.currentSnapshot ?? game?.board?.state ?? null;
const getScenarioPreviewSnapshot = (scenario) => scenario?.resultingState ?? scenario?.initialState ?? null;

const renderPlaceholderBadge = () => '<span class="status-chip offline">Not yet implemented</span>';
const renderSectionActions = (actions) => {
  const items = actions.filter((value) => typeof value === "string" && value.trim().length > 0);
  if (items.length === 0) {
    return "";
  }
  return `<div class="row section-actions">${items.join("")}</div>`;
};
const getAnimatedPanels = () => (appEl instanceof HTMLElement ? Array.from(appEl.querySelectorAll(".panel")) : []);
const capturePanelHeights = () =>
  getAnimatedPanels().map((panelEl) => (panelEl instanceof HTMLElement ? panelEl.getBoundingClientRect().height : null));
const animatePanelHeightChange = (panelEl, fromHeight) => {
  if (prefersReducedMotion() || !(panelEl instanceof HTMLElement) || !Number.isFinite(fromHeight)) {
    return;
  }
  const toHeight = panelEl.getBoundingClientRect().height;
  if (Math.abs(toHeight - fromHeight) < 1) {
    return;
  }

  panelEl.style.overflow = "hidden";
  panelEl.style.height = `${fromHeight}px`;
  void panelEl.offsetHeight;
  panelEl.style.transition = "height 180ms ease";
  panelEl.style.height = `${toHeight}px`;

  const clearHeightAnimation = () => {
    panelEl.style.transition = "";
    panelEl.style.height = "";
    panelEl.style.overflow = "";
    panelEl.removeEventListener("transitionend", clearHeightAnimation);
  };
  panelEl.addEventListener("transitionend", clearHeightAnimation);
};
const animatePanelHeightChanges = (previousPanelHeights) => {
  if (!appEl || !Array.isArray(previousPanelHeights) || previousPanelHeights.length === 0) {
    return;
  }
  getAnimatedPanels().forEach((panelEl, index) => {
    const fromHeight = previousPanelHeights[index];
    if (!(panelEl instanceof HTMLElement) || !Number.isFinite(fromHeight)) {
      return;
    }
    animatePanelHeightChange(panelEl, fromHeight);
  });
};
const renderFeedbackReveal = (message) => `
  <div class="feedback-reveal${message ? " is-visible" : ""}" aria-live="polite">
    <div class="feedback-reveal-body">
      ${message ? `<p class="small">${escapeHtml(message)}</p>` : ""}
    </div>
  </div>
`;
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
const getWideDebugFlyoutWidth = (viewportWidth = window.innerWidth) => {
  const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16") || 16;
  return Math.min(rootFontSize * 34, viewportWidth * 0.36);
};
const getAvailableShellContentWidth = (viewportWidth = window.innerWidth) => {
  const totalHorizontalGutter = SHELL_VIEWPORT_GUTTER_PX * 2;
  if (!currentRoute.debug) {
    return Math.max(0, viewportWidth - totalHorizontalGutter);
  }
  return Math.max(0, viewportWidth - getWideDebugFlyoutWidth(viewportWidth) - totalHorizontalGutter);
};
const getShellLayoutMode = (viewportWidth = window.innerWidth) =>
  (getAvailableShellContentWidth(viewportWidth) >= SHELL_WIDE_SCREEN_MIN_WIDTH ? "wide" : "narrow");
const syncShellLayoutMode = () => {
  const layoutMode = getShellLayoutMode();
  if (appEl instanceof HTMLElement) {
    appEl.setAttribute("data-shell-layout-mode", layoutMode);
    appEl.setAttribute("data-debug-open", currentRoute.debug ? "true" : "false");
    appEl.setAttribute("data-shell-content-width", String(Math.round(getAvailableShellContentWidth())));
  }
  return layoutMode;
};

const animateHistoryDeselection = async (actionEl) => {
  if (prefersReducedMotion() || !appEl) {
    return;
  }
  const currentSelected = appEl.querySelector(".history-item.is-selected, .history-item.is-live-selected");
  if (!(currentSelected instanceof HTMLElement) || currentSelected === actionEl) {
    return;
  }

  currentSelected.classList.add("is-deselecting");
  currentSelected.classList.remove("is-selected");
  currentSelected.classList.remove("is-live-selected");
  await delay(HISTORY_SELECTION_EXIT_MS);
};

const clearHistoryPress = () => {
  const boardWrapEl = appEl.querySelector(".board-wrap");
  if (boardWrapEl instanceof HTMLElement) {
    boardWrapEl.classList.remove("history-board-pressing");
  }

  if (pressedHistoryActionEl instanceof HTMLElement) {
    pressedHistoryActionEl.classList.remove("is-pressing");
  }
  pressedHistoryActionEl = null;
};

const clearControlPress = () => {
  if (pressedControlEl instanceof HTMLElement) {
    pressedControlEl.classList.remove("is-pressing");
  }
  pressedControlEl = null;
};

const playHistoryReleaseBounce = (actionEl) => {
  if (prefersReducedMotion() || !appEl) {
    return;
  }

  const boardWrapEl = appEl.querySelector(".board-wrap");
  if (boardWrapEl instanceof HTMLElement) {
    boardWrapEl.classList.remove("history-board-release");
    void boardWrapEl.offsetWidth;
    boardWrapEl.classList.add("history-board-release");
  }

  if (actionEl instanceof HTMLElement && actionEl.classList.contains("history-item")) {
    actionEl.classList.remove("history-item-release");
    void actionEl.offsetWidth;
    actionEl.classList.add("history-item-release");
  }

  if (historyReleaseTimer) {
    window.clearTimeout(historyReleaseTimer);
  }
  historyReleaseTimer = window.setTimeout(() => {
    const currentBoardWrapEl = appEl.querySelector(".board-wrap");
    if (currentBoardWrapEl instanceof HTMLElement) {
      currentBoardWrapEl.classList.remove("history-board-release");
    }
    if (actionEl instanceof HTMLElement) {
      actionEl.classList.remove("history-item-release");
    }
    historyReleaseTimer = null;
  }, HISTORY_RELEASE_BOUNCE_MS);
};

const playControlReleaseBounce = (controlEl) => {
  if (prefersReducedMotion() || !(controlEl instanceof HTMLElement)) {
    return;
  }

  controlEl.classList.remove("button-release-bounce");
  void controlEl.offsetWidth;
  controlEl.classList.add("button-release-bounce");

  if (controlReleaseTimer) {
    window.clearTimeout(controlReleaseTimer);
  }
  controlReleaseTimer = window.setTimeout(() => {
    controlEl.classList.remove("button-release-bounce");
    controlReleaseTimer = null;
  }, HISTORY_RELEASE_BOUNCE_MS);
};

hoverCapability.subscribe(() => {
  boardRuntime?.syncInteractionCapabilities?.();
});

const startHistoryPress = (actionEl) => {
  if (prefersReducedMotion() || !appEl || !(actionEl instanceof HTMLElement)) {
    return;
  }
  clearHistoryPress();

  const boardWrapEl = appEl.querySelector(".board-wrap");
  if (boardWrapEl instanceof HTMLElement) {
    boardWrapEl.classList.add("history-board-pressing");
  }

  if (actionEl.classList.contains("history-item")) {
    actionEl.classList.add("is-pressing");
    pressedHistoryActionEl = actionEl;
  }
};

const startControlPress = (controlEl) => {
  if (prefersReducedMotion() || !(controlEl instanceof HTMLElement)) {
    return;
  }
  clearControlPress();
  controlEl.classList.add("is-pressing");
  pressedControlEl = controlEl;
};

const getCurrentViewedGameId = () => {
  if (currentRoute.name === "game") {
    return currentRoute.gameId;
  }
  if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
    return resolvedInvite.gameId;
  }
  return null;
};

const getApprovalRequestKey = (gameId, requesterId) => `${gameId}:${requesterId}`;

const getActiveApprovalRequest = (game) => {
  if (!game || !Array.isArray(game.pendingJoinRequests) || !Array.isArray(game.approvableRequesterIds)) {
    return null;
  }
  return (
    game.pendingJoinRequests.find(
      (request) =>
        game.approvableRequesterIds.includes(request.identityId) &&
        !ignoredApprovalRequests.has(getApprovalRequestKey(game.id, request.identityId)),
    ) ?? null
  );
};

const renderTurnHistory = (game) => {
  if (!Array.isArray(game.turns) || game.turns.length === 0) {
    return "<li class=\"small\">No turns yet.</li>";
  }

  const activeTurnIndex = typeof game.currentTurn?.index === "number" ? game.currentTurn.index : null;
  const activeTurn = activeTurnIndex !== null ? game.turns.find((turn) => turn.index === activeTurnIndex) : null;
  const liveState = game.currentSnapshot ?? game.board?.state ?? null;
  const controlSeat = activeTurn ? getControlSeatForTurn(liveState, activeTurn.playerSeat) : null;
  const liveContinuationText =
    !game.inHistoryMode && activeTurn && liveState?.continuation
      ? `Live: Waiting for ${controlSeat || "next player"} to continue...`
      : null;
  const liveWaitingText =
    !game.inHistoryMode && activeTurn && activeTurn.moveIndexes.length === 0
      ? `Live: Waiting on ${activeTurn.playerSeat || "next player"} to move...`
      : null;
  const liveStatusText = liveContinuationText ?? liveWaitingText;
  const selectedMoveIndex =
    typeof game.historyIndex === "number"
      ? game.historyIndex
      : liveStatusText
        ? null
        : game.moves.length > 0
          ? game.moves.length - 1
          : null;

  const moveRows = game.turns.flatMap((turn) =>
    turn.moveIndexes
      .map((moveIndex) => game.moves[moveIndex])
      .filter(Boolean)
      .map((move) => {
        const isSelected = game.inHistoryMode ? game.historyIndex === move.index : selectedMoveIndex === move.index;
        const selectedClass = isSelected ? (game.inHistoryMode ? " is-selected" : " is-live-selected") : "";
        return `<li class="history-item ${playerToneClassForSide(move.actorSide || (turn.playerSeat === "Player 1" ? "P1" : "P2"))}${selectedClass}" data-action="jump-history" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}">
          <span class="history-move-line">Move ${escapeHtml(
            String(move.index + 1),
          )}: ${escapeHtml(move.notation)}</span>
          <span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span>
        </li>`;
      }),
  );
  const pendingRows = (Array.isArray(game.pendingMoves) ? game.pendingMoves : []).map(
    (move) => `<li class="history-item history-item-pending ${playerToneClassForSide(move.actorSide || (move.turnIndex % 2 === 0 ? "P1" : "P2"))}" aria-disabled="true">
          <span class="history-move-line">Move ${escapeHtml(
            String(move.index + 1),
          )}: ${escapeHtml(move.notation)} · Pending</span>
          <span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span>
        </li>`,
  );
  const reverseChronologicalMoveRows = [...moveRows].reverse();
  const reverseChronologicalPendingRows = [...pendingRows].reverse();

  const liveStatusItem =
    liveStatusText && activeTurn
      ? `<li class="history-item history-item-waiting history-empty-line ${playerToneClassForSeat(
          liveContinuationText ? controlSeat : activeTurn.playerSeat,
        )} is-live-selected" aria-disabled="true"><span class="history-move-line">${escapeHtml(liveStatusText)}</span></li>`
      : "";
  if (!activeTurn) {
    return `${reverseChronologicalPendingRows.join("")}${reverseChronologicalMoveRows.join("")}`;
  }
  if (!game.inHistoryMode && !liveStatusItem && activeTurn.moveIndexes.length > 0) {
    return `${reverseChronologicalPendingRows.join("")}${reverseChronologicalMoveRows.join("")}`;
  }
  const emptyTurnItem = game.inHistoryMode
    ? `<li class="history-empty-line history-return-live"><button class="secondary" data-action="return-live" data-game-id="${escapeHtml(
        game.id,
      )}" ${busy ? "disabled" : ""}>Return to live view</button></li>`
    : liveStatusItem;

  return `${emptyTurnItem}${reverseChronologicalPendingRows.join("")}${reverseChronologicalMoveRows.join("")}`;
};

const renderHeader = () => `
  <header class="shell-header">
    <div class="shell-header-main">
      <h1>Righelt Web Shell</h1>
      <p class="small">Identity <span id="shell-header-identity" class="mono">${escapeHtml(transport.getIdentityId())}</span></p>
      <p class="small shell-header-status">Live sync: <span id="shell-header-live-sync" class="mono">${escapeHtml(
        `${wsStatus.state}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`,
      )}</span></p>
      <p class="small shell-header-status">Last event: <span id="shell-header-last-event" class="mono">${escapeHtml(wsLastEvent)}</span></p>
    </div>
    <div class="shell-header-actions">
      <div class="nav-row">
        ${
          currentRoute.name !== "home"
            ? `<a class="button-link secondary" href="${buildHomeHash(currentRoute.debug)}">Home</a>`
            : ""
        }
        <button class="secondary" data-action="toggle-debug">${currentRoute.debug ? "Hide Debug" : "Show Debug"}</button>
        <a class="button-link secondary" href="${buildTutorialHash(null, currentRoute.debug)}">Tutorial</a>
      </div>
    </div>
  </header>
`;

const setScenarioFeedback = (message) => {
  scenarioFeedback = message;
};

const getSelectedScenario = () =>
  scenarioCatalog.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarioCatalog.scenarios[0] ?? null;

const renderScenarioOptionList = () =>
  scenarioCatalog.scenarios
    .map(
      (scenario) =>
        `<option value="${escapeHtml(scenario.id)}"${scenario.id === selectedScenarioId ? " selected" : ""}>${escapeHtml(
          `${scenario.id} - ${scenario.title}${scenario.incorrect ? " [incorrect]" : ""}`,
        )}</option>`,
    )
    .join("");

const renderScenarioPanel = ({ route, game = null } = {}) => {
  const selectedScenario = getSelectedScenario();
  const scenarioSnapshot = getScenarioPreviewSnapshot(selectedScenario);
  const scenarioPreviewKey = toStableKey(scenarioSnapshot);
  const moveLimit = game?.inHistoryMode && typeof game.historyIndex === "number" ? game.historyIndex + 1 : game?.moves?.length ?? 0;
  const canSaveScenario = Boolean(game);
  const canLoadIntoCurrentGame = Boolean(game && Array.isArray(game.moves) && game.moves.length === 0 && selectedScenario);
  return `
    <section class="panel debug-panel">
      <h2>Scenarios</h2>
      <div class="form-row">
        <label for="scenario-select">Saved scenario</label>
        <select id="scenario-select">
          ${scenarioCatalog.scenarios.length > 0 ? renderScenarioOptionList() : '<option value="">No scenarios saved yet</option>'}
        </select>
      </div>
      <p class="small">${escapeHtml(selectedScenario?.description || "Scenarios replay canonical shell history into a game.")}</p>
      ${
        selectedScenario
          ? `<div class="mini-board-card mini-board-card-scenario">
              ${renderMiniBoardPreviewRoot({
                previewId: `scenario:${selectedScenario.id}`,
                snapshot: scenarioSnapshot,
                previewKey: scenarioPreviewKey,
                sizeVariant: "compact",
              })}
              <div class="mini-board-card-meta">
                <span class="small">${escapeHtml(`${selectedScenario.moves.length} move(s)`)}</span>
                <span class="small">${escapeHtml(`Expected ${formatOutcomeStatus(selectedScenario.expectedOutcome)}`)}</span>
              </div>
              <p class="small mini-board-preview-status">${escapeHtml(
                scenarioSnapshot ? formatSideToMoveLabel(scenarioSnapshot) : "Snapshot unavailable",
              )}</p>
            </div>`
          : ""
      }
      <div class="row">
        <button data-action="load-scenario" ${selectedScenario ? "" : "disabled"}>${route.name === "home" ? "Open Scenario" : canLoadIntoCurrentGame ? "Load into This Game" : "Open in New Tab"}</button>
        ${
          canSaveScenario
            ? `<button class="secondary" data-action="save-scenario"${busy ? " disabled" : ""}>Save Scenario${moveLimit < (game?.moves?.length ?? 0) ? " from Here" : ""}</button>`
            : ""
        }
      </div>
      <pre class="debug-pre" aria-live="polite">${escapeHtml(
        scenarioFeedback ||
          (selectedScenario
            ? JSON.stringify(
                {
                  id: selectedScenario.id,
                  moves: selectedScenario.moves.length,
                  outcome: selectedScenario.expectedOutcome,
                },
                null,
                2,
              )
            : "No scenarios available."),
      )}</pre>
    </section>
  `;
};

const renderDebugContent = () => {
  const route = currentRoute;
  const gameId = route.name === "game" ? route.gameId : route.name === "invite" ? resolvedInvite?.gameId || null : null;
  const game = gameId ? transport.getGameViewModel(gameId) : null;
  const selection = boardRuntime?.getSelection?.() ?? null;
  const legalActions = boardRuntime?.getLegalActions?.() ?? (game?.legalActions ?? []);
  const currentSnapshot = game?.currentSnapshot ?? null;
  const routeDiagnostics =
    route.name === "home"
      ? {
          identityId: transport.getIdentityId(),
          offline: window.__righeltOffline || false,
          loadedGames: transport.listGames().map((entry) => ({ id: entry.id, moves: entry.moves.length, role: entry.myRole })),
        }
      : route.name === "tutorial"
        ? {
            tutorial: tutorial.current(),
            completed: bootstrap.tutorialCompleted ?? false,
          }
        : {
            route: route.name,
            gameId,
          };
  return `
    ${renderScenarioPanel({ route, game })}
    <section class="panel debug-panel">
      <h2>Engine Status</h2>
      <pre class="debug-pre">${escapeHtml(
        JSON.stringify(
          game
            ? {
                gameId: game.id,
                moves: game.moves.length,
                inHistoryMode: game.inHistoryMode,
                historyIndex: game.historyIndex ?? null,
                sideToMove: currentSnapshot?.sideToMove ?? null,
                turnIndex: currentSnapshot?.turnIndex ?? null,
                continuation: currentSnapshot?.continuation ?? null,
                legalActions: legalActions.length,
                selection,
              }
            : routeDiagnostics,
          null,
          2,
        ),
      )}</pre>
    </section>
    <section class="panel debug-panel">
      <h2>Actions Diagnostics</h2>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(legalActions.slice(0, 20), null, 2))}</pre>
    </section>
  `;
};

const renderDebugFlyout = () => {
  if (!currentRoute.debug) {
    return "";
  }
  return `
  <aside class="debug-flyout is-open" data-debug-flyout>
    <header class="debug-flyout-header">
      <h2>Debug mode</h2>
    </header>
    <div class="debug-flyout-scroll">
      ${renderDebugContent()}
    </div>
  </aside>
`;
};

const updateHeaderFields = () => {
  const identityEl = document.getElementById("shell-header-identity");
  const liveSyncEl = document.getElementById("shell-header-live-sync");
  const lastEventEl = document.getElementById("shell-header-last-event");
  if (identityEl) {
    identityEl.textContent = transport.getIdentityId();
  }
  if (liveSyncEl) {
    liveSyncEl.textContent = `${wsStatus.state}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`;
  }
  if (lastEventEl) {
    lastEventEl.textContent = wsLastEvent;
  }
};

const setInviteFeedback = (message) => {
  inviteFeedback = message;
  if (inviteFeedbackTimer) {
    clearTimeout(inviteFeedbackTimer);
    inviteFeedbackTimer = null;
  }
  if (message) {
    inviteFeedbackTimer = setTimeout(() => {
      inviteFeedback = "";
      render();
    }, 1800);
  }
};

const markInviteChoiceCommitted = (gameId) => {
  if (!gameId) {
    return;
  }
  inviteChoiceCommittedByGameId.add(gameId);
};

const getInviteContextForGame = (game, routeName = currentRoute.name) => {
  if (!game || game.myRole !== "Guest") {
    return null;
  }
  if (routeName === "game" && inviteChoiceCommittedByGameId.has(game.id)) {
    return null;
  }
  if (routeName === "invite" && resolvedInvite?.gameId === game.id) {
    const inviteType =
      resolvedInvite.inviteFromRole === "Player 1" || resolvedInvite.inviteFromRole === "Player 2" ? "player" : "non-player";
    return {
      gameId: game.id,
      inviteToken: resolvedInvite.inviteToken,
      inviteFromRole: resolvedInvite.inviteFromRole,
      inviteType,
    };
  }
  return {
    gameId: game.id,
    inviteToken: null,
    inviteFromRole: null,
    inviteType: "non-player",
  };
};

const renderHome = () => {
  const games = transport.listGames();
  const listHtml =
    games.length === 0
      ? "<p class=\"small\">No games yet.</p>"
      : `<div class="mini-board-card-list">${games
          .map((game) => {
            const snapshot = getGamePreviewSnapshot(game);
            const previewKey = toStableKey(snapshot);
            const statusText = snapshot ? formatSideToMoveLabel(snapshot) : "Snapshot unavailable";
            const liveStateLabel = game.inHistoryMode ? "History view" : "Live view";
            const turnLabel =
              game.currentTurn && typeof game.currentTurn.index === "number"
                ? `Turn ${game.currentTurn.index + 1}`
                : "Turn pending";
            return `<article class="mini-board-card">
              <div class="mini-board-card-header">
                <div>
                  <a class="mini-board-card-link" href="${buildGameHash(game.id, null, currentRoute.debug)}">${escapeHtml(
                    formatDisplayGameId(game.id),
                  )}</a>
                  <p class="small mini-board-card-subtitle">Latest ${escapeHtml(formatClientDateTime(game.lastMoveAt || game.createdAt))}</p>
                </div>
                <span class="status-chip">${escapeHtml(game.syncStatus === "desynced" ? "Recovering" : liveStateLabel)}</span>
              </div>
              <div class="mini-board-card-meta">
                <span>${renderRoleLabel(game.myRole)}</span>
                <span class="small">${escapeHtml(turnLabel)}</span>
              </div>
              ${renderMiniBoardPreviewRoot({
                previewId: `home:${game.id}`,
                snapshot,
                previewKey,
              })}
              <p class="small mini-board-preview-status">${escapeHtml(statusText)}</p>
            </article>`;
          })
          .join("")}</div>`;

  return `
    <section class="layout-grid">
      <div class="stack">
        <section class="panel">
          <h2>Start</h2>
          <div class="row">
            <button data-action="create-game" ${busy ? "disabled" : ""}>Play with friends</button>
            <button data-action="create-offline-playground" class="warn" ${busy ? "disabled" : ""}>Play locally</button>
          </div>
          <p class="small">Server-backed game sessions with live state transitions.</p>
        </section>

        <section class="panel">
          <h2>Active Games</h2>
          ${listHtml}
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2>Preview Board ${renderPlaceholderBadge()}</h2>
          <p class="small">Non-authoritative preview sequence.</p>
          <div class="preview">Preview replay surface</div>
        </section>
      </div>
    </section>
  `;
};

const renderGameAlertsHtml = (game, inviteFromRole = null) => {
  const liveSyncBanner =
    game.rollbackNotice && game.rollbackNotice.trim().length > 0
      ? `<div class="alert danger">${escapeHtml(game.rollbackNotice)}</div>`
      : game.syncStatus === "desynced"
        ? `<div class="alert warn">Live sync is recovering. The board is showing the last authoritative state.</div>`
        : "";
  const offlineBanner =
    game.showOfflineState || inviteFromRole === "offline"
      ? `<div class="alert warn">Offline mode: invite and remote join actions are disabled.</div>`
      : "";

  return `
    ${offlineBanner ? `<section class="panel">${offlineBanner}</section>` : ""}
    ${liveSyncBanner ? `<section class="panel">${liveSyncBanner}</section>` : ""}
  `;
};

const renderGameSummaryPanel = (game) => {
  const latestNote = game.notifications[0] || "Ready";
  return `
    <h2>Game <span class="mono">${escapeHtml(formatDisplayGameId(game.id))}</span></h2>
    <div class="section-stack">
      <p class="small">Started ${escapeHtml(formatClientDateTime(game.createdAt))}</p>
      <p class="small">Role: ${renderRoleLabel(game.myRole)}</p>
      <div class="section-followup">
        <p class="small">Active turn: ${
          game.currentTurn
            ? `${escapeHtml(String(game.currentTurn.index + 1))} · ${renderSeatLabel(game.currentTurn.playerSeat)} · ${escapeHtml(
                String(game.currentTurn.moveIndexes.length),
              )} move(s)`
            : "n/a"
        }</p>
        <p class="small">Latest: ${colorizePlayerReferences(latestNote)}</p>
      </div>
    </div>
  `;
};

const renderJoinInvitePanel = (game, inviteLink) => {
  const pendingSeatNotice = game.pendingPlayerRequestSeat
    ? `<div class="alert">Player join request pending approval for ${renderSeatLabel(game.pendingPlayerRequestSeat)}.</div>`
    : "";
  const pendingRows =
    game.pendingJoinRequests.length === 0
      ? "<li class=\"small\">No pending join requests</li>"
      : game.pendingJoinRequests
          .map(
            (request) => `<li>
              <span class="mono">${escapeHtml(request.identityId)}</span> requests ${renderSeatLabel(request.requestedSeat)}
              <button class="secondary" data-action="approve-request" data-game-id="${escapeHtml(
                game.id,
              )}" data-requester-id="${escapeHtml(request.identityId)}" ${
                !busy && Array.isArray(game.approvableRequesterIds) && game.approvableRequesterIds.includes(request.identityId)
                  ? ""
                  : "disabled"
              }>Approve</button>
            </li>`,
          )
          .join("");
  const joinInviteActions = renderSectionActions([
    game.canJoinAsViewer
      ? `<button data-action="join-viewer" data-game-id="${escapeHtml(game.id)}" class="secondary" ${!busy ? "" : "disabled"}>Join as viewer</button>`
      : "",
    game.canJoinAsPlayer && game.showJoinActions
      ? `<button data-action="join-player" data-game-id="${escapeHtml(game.id)}" ${!busy ? "" : "disabled"}>Join as player</button>`
      : "",
    game.canPlayAsBothPlayers
      ? `<button data-action="play-as-both-players" data-game-id="${escapeHtml(game.id)}" class="secondary" ${
          !game.showOfflineState && !busy ? "" : "disabled"
        }>Play as both players</button>`
      : "",
    `<button data-action="copy-invite" data-link="${escapeHtml(inviteLink)}" ${game.canInvite && !busy ? "" : "disabled"}>Invite someone else</button>`,
  ]);

  return `
    <h2>Join / Invite</h2>
    ${pendingSeatNotice}
    ${joinInviteActions}
    ${renderFeedbackReveal(inviteFeedback)}
    <div class="section-followup">
      <ul class="participant-list">${pendingRows}</ul>
    </div>
  `;
};

const renderParticipantsPanel = (game) => {
  const participants = [
    { label: "Player 1", value: game.player1 },
    { label: "Player 2", value: game.player2 },
  ];

  const participantRows = participants
    .map((entry) => {
      if (!entry.value) {
        return `<li>${renderSeatLabel(entry.label)}: <span class="small">Open seat</span></li>`;
      }
      return `<li>${renderSeatLabel(entry.label)}: <span class="mono">${escapeHtml(entry.value.identityId)}</span> ${formatStatus(entry.value.connected)}</li>`;
    })
    .join("");

  const viewerRows =
    game.viewers.length === 0
      ? '<li>Viewers: <span class="small">None</span></li>'
      : game.viewers
          .map(
            (viewer) =>
              `<li>Viewer: <span class="mono">${escapeHtml(viewer.identityId)}</span> ${formatStatus(viewer.connected)}</li>`,
          )
          .join("");
  return `
    <h2>Participants</h2>
    <ul class="participant-list">${participantRows}${viewerRows}</ul>
  `;
};

const renderHistoryPanel = (game) => {
  const historyRows = renderTurnHistory(game);
  const historyMoveNumber = typeof game.historyIndex === "number" ? String(game.historyIndex + 1) : "?";
  const hasHistoryMoves = Array.isArray(game.moves) && game.moves.length > 0;
  const historyBanner = game.inHistoryMode
    ? `<p class="small">Viewing history snapshot for move ${escapeHtml(historyMoveNumber)}.</p>
       <p class="small">Incoming live moves will appear at top.</p>`
    : hasHistoryMoves
      ? '<p class="small">You are on the live view.</p><p class="small">Click moves below to see historical state.</p>'
      : '<p class="small">You are on the live view.</p>';

  return `
    <h2>History</h2>
    <div class="section-followup">
      ${historyBanner}
      <ol class="history-list">${historyRows}</ol>
    </div>
  `;
};

const renderBoardPanel = (game) => `
  <h2 class="board-heading">Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span></h2>
  <p class="board-preview-label" id="shell-board-preview-label">Select a piece to see it supply and command lines + what it can do:</p>
  <div class="board-wrap">
    <div id="shell-board" class="board"></div>
    <svg id="shell-overlay-lines" class="overlay-lines" aria-hidden="true"></svg>
  </div>
  <div class="overlay-key" aria-label="Overlay color key">
    <span><i class="swatch supply-point"></i>Supply point</span>
    <span><i class="swatch supply"></i>Supply line</span>
    <span><i id="shell-command-legend-swatch" class="swatch command" style="${escapeHtml(
      getCommandLegendSwatchStyle(game.currentSnapshot ?? null),
    )}"></i>Command line</span>
    <span><i class="swatch group"></i>Group strength</span>
  </div>
`;

const shouldEnableStickyShellColumn = ({ matchesWideScreen, columnHeight, viewportHeight }) =>
  matchesWideScreen &&
  Number.isFinite(columnHeight) &&
  Number.isFinite(viewportHeight) &&
  columnHeight <= viewportHeight;

const renderGameShellFrame = (game) => `
  <div id="shell-game-alerts"></div>
  <section class="layout-grid" data-game-shell-root data-game-id="${escapeHtml(game.id)}">
    <div class="stack" data-shell-sticky-target="left" data-sticky-enabled="false">
      <section class="panel" data-game-panel="summary"></section>
      <section class="panel" data-game-panel="join"></section>
      <section class="panel" data-game-panel="participants"></section>
    </div>

    <div class="stack" data-shell-sticky-target="board" data-sticky-enabled="false">
      <section class="panel" data-shell-panel="board">
        ${renderBoardPanel(game)}
      </section>
    </div>

    <div class="stack">
      <section class="panel" data-game-panel="history"></section>
    </div>
  </section>
`;

const getMountedGameShellRoot = () =>
  appEl?.querySelector?.("[data-game-shell-root]") instanceof HTMLElement ? appEl.querySelector("[data-game-shell-root]") : null;

const reconcileMiniBoardPreviews = () => {
  if (!(appEl instanceof HTMLElement)) {
    return;
  }
  const previews = Array.from(appEl.querySelectorAll("[data-mini-board-preview]"))
    .map((rootEl) => {
      if (!(rootEl instanceof HTMLElement)) {
        return null;
      }
      const previewId = rootEl.getAttribute("data-preview-id");
      const payload = previewId ? renderedMiniBoardPreviewPayloads.get(previewId) : null;
      if (!payload) {
        return null;
      }
      return {
        rootEl,
        snapshot: payload.snapshot,
        previewKey: payload.previewKey,
        sizeVariant: payload.sizeVariant,
      };
    })
    .filter(Boolean);

  syncMiniBoardPreviews({
    previews,
    registry: miniBoardPreviewRegistry,
    createAdapter: () => {
      const adapter = createEnginePlaygroundBoardAdapter();
      assertGameBoardAdapter(adapter);
      return adapter;
    },
  });
};

const applyGameShellStickyLayout = () => {
  if (!(appEl instanceof HTMLElement)) {
    return;
  }
  const layoutMode = syncShellLayoutMode();
  const stickyTargets = Array.from(appEl.querySelectorAll("[data-shell-sticky-target]"));
  if (stickyTargets.length === 0) {
    return;
  }

  const matchesWideScreen = layoutMode === "wide";
  const viewportHeight = window.innerHeight;
  stickyTargets.forEach((targetEl) => {
    if (!(targetEl instanceof HTMLElement)) {
      return;
    }
    const columnHeight = Math.round(targetEl.getBoundingClientRect().height);
    const stickyEnabled = shouldEnableStickyShellColumn({
      matchesWideScreen,
      columnHeight,
      viewportHeight,
    });
    targetEl.setAttribute("data-sticky-enabled", stickyEnabled ? "true" : "false");
  });
};

const scheduleGameShellStickyLayout = () => {
  if (stickyLayoutFrame) {
    window.cancelAnimationFrame(stickyLayoutFrame);
  }
  stickyLayoutFrame = window.requestAnimationFrame(() => {
    stickyLayoutFrame = 0;
    applyGameShellStickyLayout();
  });
};

const updateMountedGameShell = ({ game, inviteFromRole = null, inviteToken = null, includeBoard = true } = {}) => {
  const shellRoot = getMountedGameShellRoot();
  if (!(shellRoot instanceof HTMLElement) || !game) {
    return false;
  }

  const alertsEl = document.getElementById("shell-game-alerts");
  const summaryEl = shellRoot.querySelector('[data-game-panel="summary"]');
  const joinEl = shellRoot.querySelector('[data-game-panel="join"]');
  const participantsEl = shellRoot.querySelector('[data-game-panel="participants"]');
  const historyEl = shellRoot.querySelector('[data-game-panel="history"]');
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(game.inviteToken || inviteToken || game.id, currentRoute.debug)}`;

  if (alertsEl instanceof HTMLElement) {
    alertsEl.innerHTML = renderGameAlertsHtml(game, inviteFromRole);
  }
  if (summaryEl instanceof HTMLElement) {
    summaryEl.innerHTML = renderGameSummaryPanel(game);
  }
  if (joinEl instanceof HTMLElement) {
    joinEl.innerHTML = renderJoinInvitePanel(game, inviteLink);
  }
  if (participantsEl instanceof HTMLElement) {
    participantsEl.innerHTML = renderParticipantsPanel(game);
  }
  if (historyEl instanceof HTMLElement) {
    historyEl.innerHTML = renderHistoryPanel(game);
  }
  if (includeBoard) {
    mountBoardForGame(game);
  }
  const debugFlyoutEl = appEl?.querySelector?.("[data-debug-flyout]");
  if (debugFlyoutEl instanceof HTMLElement) {
    debugFlyoutEl.classList.toggle("is-open", currentRoute.debug === true);
    const scrollEl = debugFlyoutEl.querySelector(".debug-flyout-scroll");
    if (scrollEl instanceof HTMLElement) {
      scrollEl.innerHTML = renderDebugContent();
    }
  }
  reconcileMiniBoardPreviews();
  scheduleGameShellStickyLayout();
  return true;
};

const shouldUseIncrementalGameShell = (gameId = currentRoute.gameId) => {
  if (currentRoute.name !== "game" || !routeHydrated || !gameId) {
    return false;
  }
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return false;
  }
  return !getActiveApprovalRequest(game);
};

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  if (!routeHydrated) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Synchronizing current game state.</p></section>`;
  }

  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Fetching latest server state.</p></section>`;
  }
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(game.inviteToken || inviteToken || game.id, currentRoute.debug)}`;

  return `
    ${renderGameAlertsHtml(game, inviteFromRole)}
    <section class="layout-grid">
      <div class="stack" data-shell-sticky-target="left" data-sticky-enabled="false">
        <section class="panel">${renderGameSummaryPanel(game)}</section>
        <section class="panel">${renderJoinInvitePanel(game, inviteLink)}</section>
        <section class="panel">${renderParticipantsPanel(game)}</section>
      </div>

      <div class="stack" data-shell-sticky-target="board" data-sticky-enabled="false">
        <section class="panel" data-shell-panel="board">
          ${renderBoardPanel(game)}
        </section>
      </div>

      <div class="stack">
        <section class="panel">${renderHistoryPanel(game)}</section>
      </div>
    </section>
  `;
};

const renderApprovalGate = (game, request) => {
  const background = renderGameContent(game.id);
  return `
    <section class="invite-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Approval required</p>
        <h2>Respond to this player request</h2>
        <p><span class="mono">${escapeHtml(request.identityId)}</span> wants to join as ${renderSeatLabel(request.requestedSeat)}.</p>
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button
              data-action="accept-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              ${busy ? "disabled" : ""}
            >Accept</button>
            <span class="small invite-choice-note">Approve the request and promote this participant into the requested player seat.</span>
          </div>
          <div class="invite-choice-row">
            <button
              class="secondary"
              data-action="ignore-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              ${busy ? "disabled" : ""}
            >Ignore</button>
            <span class="small invite-choice-note">Dismiss this prompt for now. The request remains visible in Join / Invite.</span>
          </div>
        </div>
        <p class="small">The game is shown below, but it stays locked until you accept or ignore this request.</p>
      </section>
      <div class="invite-gate-content" aria-hidden="true">
        ${background}
      </div>
    </section>
  `;
};

const renderGame = (gameId, inviteFromRole = null, inviteToken = null) => {
  if (!routeHydrated) {
    return renderGameContent(gameId, inviteFromRole, inviteToken);
  }
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return renderGameContent(gameId, inviteFromRole, inviteToken);
  }
  const approvalRequest = getActiveApprovalRequest(game);
  if (approvalRequest) {
    return renderApprovalGate(game, approvalRequest);
  }
  if (currentRoute.name === "game") {
    return renderGameShellFrame(game);
  }
  return renderGameContent(gameId, inviteFromRole, inviteToken);
};

const renderInviteLanding = (inviteContext) => {
  if (!routeHydrated || !inviteContext?.gameId) {
    return `<section class="panel"><h2>Loading invite...</h2><p class="small">Resolving invite destination.</p></section>`;
  }

  const game = transport.getGameViewModel(inviteContext.gameId);
  const background = renderGameContent(inviteContext.gameId, inviteContext.inviteFromRole, inviteContext.inviteToken);
  if (!game) {
    return background;
  }

  const canJoinPlayer = game.canJoinAsPlayer && game.showJoinActions;
  const canJoinViewer = game.canJoinAsViewer;
  const playerActionLabel = inviteContext.inviteType === "player" ? "Join as player" : "Request to join as player";
  const inviteMessage =
    inviteContext.inviteType === "player"
      ? `${inviteContext.inviteFromRole} shared a player invite.`
      : currentRoute.name === "game"
        ? "You opened this game's direct link from a different device."
        : "A non-player invite was shared with you.";
  const playerExplainer = canJoinPlayer
    ? inviteContext.inviteType === "player"
      ? "Joining as player will be applied immediately."
      : "Joining as player will send a request to the approving player and add you as viewer in the interim."
    : game.joinAsPlayerDisabledReason || "Player joining is unavailable.";
  const viewerExplainer = canJoinViewer
    ? "Joining as viewer is applied immediately."
    : game.joinAsViewerDisabledReason || "Viewer joining is unavailable.";
  const pendingNotice = game.pendingPlayerRequestSeat
    ? `<div class="alert">Player join request pending approval for ${renderSeatLabel(game.pendingPlayerRequestSeat)}.</div>`
    : "";

  return `
    <section class="invite-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Invite received</p>
        <h2>Choose how to enter this game</h2>
        <p>${colorizePlayerReferences(inviteMessage)} Join now to enter the live game route and receive updates.</p>
        ${pendingNotice}
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button data-action="accept-invite-player" data-game-id="${escapeHtml(game.id)}" ${
              canJoinPlayer && !busy ? "" : "disabled"
            }>${escapeHtml(playerActionLabel)}</button>
            <span class="small invite-choice-note">${escapeHtml(playerExplainer)}</span>
          </div>
          <div class="invite-choice-row">
            <button data-action="accept-invite-viewer" data-game-id="${escapeHtml(game.id)}" class="secondary" ${
              canJoinViewer && !busy ? "" : "disabled"
            }>Join as viewer</button>
            <span class="small invite-choice-note">${escapeHtml(viewerExplainer)}</span>
          </div>
          <div class="invite-choice-row">
            <a class="button-link secondary" href="${buildHomeHash(currentRoute.debug)}">Back home</a>
          </div>
        </div>
        <p class="small">
          ${
            canJoinPlayer || canJoinViewer
              ? "The game preview is shown below, but it stays locked until you choose a role."
              : "No join mode is currently available for this invite."
          }
        </p>
      </section>
      <div class="invite-gate-content" aria-hidden="true">
        ${background}
      </div>
    </section>
  `;
};

const renderTutorial = (gameId) => {
  const state = tutorial.current();
  return `
    <section class="panel">
      <h2>Tutorial ${renderPlaceholderBadge()}</h2>
      <p class="small">Step ${state.index + 1} of ${state.total}</p>
      <p>${escapeHtml(state.step)}</p>
      <div class="row">
        <button data-action="tutorial-next">Next</button>
        <button class="secondary" data-action="tutorial-skip">Skip Step</button>
        <button class="secondary" data-action="tutorial-complete" data-game-id="${escapeHtml(gameId || "")}">Finish Tutorial</button>
      </div>
    </section>
  `;
};

const renderNotFound = () => `
  <section class="panel">
    <h2>Route not found</h2>
    <a class="button-link" href="${buildHomeHash(currentRoute.debug)}">Return home</a>
  </section>
`;

const mountBoardForGame = (game) => {
  const boardEl = document.getElementById("shell-board");
  const overlayLinesEl = document.getElementById("shell-overlay-lines");
  const boardPreviewLabelEl = document.getElementById("shell-board-preview-label");
  const boardTurnIndicatorEl = document.getElementById("shell-board-turn-indicator");
  if (!boardEl || !overlayLinesEl || !boardPreviewLabelEl || !boardTurnIndicatorEl || !game) {
    mountedBoardGameId = null;
    mountedHistoryMoveIndex = null;
    mountedSnapshotKey = null;
    mountedLegalActionsKey = null;
    mountedOverlayKey = null;
    mountedSyncStatusKey = null;
    if (boardRuntime) {
      boardRuntime.destroy();
      boardRuntime = null;
    }
    return;
  }

  const snapshot = game.currentSnapshot ?? null;
  const historyMoveIndex = game.inHistoryMode ? game.historyIndex : null;
  const historySelectionAction = game.inHistoryMode ? game.historySelectionAction ?? null : null;
  const overlayMode = game.inHistoryMode ? "recorded-action" : "interactive";
  const effectiveLegalActions = Array.isArray(game.legalActions) && !game.inHistoryMode ? game.legalActions : [];
  if (!snapshot) {
    return;
  }

  const snapshotKey = toStableKey(snapshot);
  const legalActionsKey = toStableKey(effectiveLegalActions);
  const overlayKey = toStableKey({ overlayMode, recordedAction: historySelectionAction });

  if (mountedBoardGameId !== game.id || !boardRuntime) {
    if (boardRuntime) {
      boardRuntime.destroy();
    }
    boardRuntime = createBoardRuntime({
      boardAdapter,
      host: createShellBoardHost({
        transport,
        gameId: game.id,
        canInteract: () => {
          const view = transport.getGameViewModel(game.id);
          return Boolean(view?.canRecordMove || view?.canEndTurn);
        },
      }),
      controls: {
        getAllowFreeSelection: () => false,
        getSupportsHover: () => hoverCapability.getSupportsHover(),
        onStateUpdated: ({ state, selectedPieceId }) => {
          applyCommandLegendSwatch(document.getElementById("shell-command-legend-swatch"), state, selectedPieceId);
        },
      },
    });
    mountedBoardGameId = game.id;
    mountedHistoryMoveIndex = historyMoveIndex;
    mountedSnapshotKey = snapshotKey;
    mountedLegalActionsKey = legalActionsKey;
    mountedOverlayKey = overlayKey;
    mountedSyncStatusKey = toStableKey({
      syncStatus: game.syncStatus ?? "ready",
      rollbackNotice: game.rollbackNotice ?? "",
    });
    boardRuntime.bindElements({ boardEl, overlayLinesEl, boardPreviewLabelEl, boardTurnIndicatorEl });
    void boardRuntime.loadSnapshot(snapshot, {
      legalActions: effectiveLegalActions,
      resetSelection: true,
      overlayMode,
      recordedAction: historySelectionAction,
    });
    return;
  }

  const syncStatusKey = toStableKey({
    syncStatus: game.syncStatus ?? "ready",
    rollbackNotice: game.rollbackNotice ?? "",
  });
  const resetSelection = mountedHistoryMoveIndex !== historyMoveIndex || (mountedSyncStatusKey !== syncStatusKey && Boolean(game.rollbackNotice));
  mountedHistoryMoveIndex = historyMoveIndex;
  boardRuntime.bindElements({ boardEl, overlayLinesEl, boardPreviewLabelEl, boardTurnIndicatorEl });
  const runtimeSnapshotKey = toStableKey(boardRuntime.getState());
  const runtimeLegalActionsKey = toStableKey(boardRuntime.getLegalActions());
  if (shouldSkipBoardRuntimeReload({
    runtimeSnapshotKey,
    runtimeLegalActionsKey,
    snapshotKey,
    legalActionsKey,
    mountedOverlayKey,
    overlayKey,
    resetSelection,
  })) {
    mountedSnapshotKey = snapshotKey;
    mountedLegalActionsKey = legalActionsKey;
    mountedOverlayKey = overlayKey;
    mountedSyncStatusKey = syncStatusKey;
    return;
  }
  const shouldReloadSnapshot =
    mountedSnapshotKey !== snapshotKey ||
    mountedLegalActionsKey !== legalActionsKey ||
    mountedOverlayKey !== overlayKey ||
    resetSelection;
  if (!shouldReloadSnapshot) {
    return;
  }
  mountedSnapshotKey = snapshotKey;
  mountedLegalActionsKey = legalActionsKey;
  mountedOverlayKey = overlayKey;
  mountedSyncStatusKey = syncStatusKey;
  void boardRuntime.loadSnapshot(snapshot, {
    legalActions: effectiveLegalActions,
    resetSelection,
    overlayMode,
    recordedAction: historySelectionAction,
  });
};

const destroyMountedBoardRuntime = () => {
  mountedBoardGameId = null;
  mountedHistoryMoveIndex = null;
  mountedSnapshotKey = null;
  mountedLegalActionsKey = null;
  mountedOverlayKey = null;
  mountedSyncStatusKey = null;
  if (boardRuntime) {
    boardRuntime.destroy();
    boardRuntime = null;
  }
};

const render = ({ animatePanels = true, includeBoard = true } = {}) => {
  syncShellLayoutMode();
  const mountedGameShell = getMountedGameShellRoot();
  if (
    shouldUseIncrementalGameShell() &&
    mountedGameShell?.getAttribute("data-game-id") === currentRoute.gameId
  ) {
    updateHeaderFields();
    updateMountedGameShell({
      game: transport.getGameViewModel(currentRoute.gameId),
      inviteFromRole: currentRoute.inviteFromRole,
      includeBoard,
    });
    return;
  }

  const previousPanelHeights = animatePanels ? capturePanelHeights() : [];
  let body = "";
  if (currentRoute.name === "home") {
    body = renderHome();
  } else if (currentRoute.name === "game") {
    const game = transport.getGameViewModel(currentRoute.gameId);
    const inviteContext = getInviteContextForGame(game, "game");
    body = inviteContext ? renderInviteLanding(inviteContext) : renderGame(currentRoute.gameId, currentRoute.inviteFromRole);
  } else if (currentRoute.name === "invite") {
    const game = resolvedInvite?.gameId ? transport.getGameViewModel(resolvedInvite.gameId) : null;
    const inviteContext = getInviteContextForGame(game, "invite");
    body = inviteContext ? renderInviteLanding(inviteContext) : renderGame(resolvedInvite?.gameId || null, resolvedInvite?.inviteFromRole || null, resolvedInvite?.inviteToken || null);
  } else if (currentRoute.name === "tutorial") {
    body = renderTutorial(currentRoute.gameId);
  } else {
    body = renderNotFound();
  }

  const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">${renderHeader()}${body}</div>${renderDebugFlyout()}</div>`;
  if (nextMarkup !== lastRenderedMarkup) {
    appEl.innerHTML = nextMarkup;
    lastRenderedMarkup = nextMarkup;
    if (animatePanels) {
      animatePanelHeightChanges(previousPanelHeights);
    }
  }
  updateHeaderFields();
  reconcileMiniBoardPreviews();
  if (currentRoute.name !== "game" && currentRoute.name !== "invite") {
    scheduleGameShellStickyLayout();
    destroyMountedBoardRuntime();
    return;
  }
  if (currentRoute.name === "game") {
    if (shouldUseIncrementalGameShell()) {
      updateMountedGameShell({
        game: transport.getGameViewModel(currentRoute.gameId),
        inviteFromRole: currentRoute.inviteFromRole,
        includeBoard,
      });
      return;
    }
    mountBoardForGame(transport.getGameViewModel(currentRoute.gameId));
    scheduleGameShellStickyLayout();
  }
  if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
    mountBoardForGame(transport.getGameViewModel(resolvedInvite.gameId));
    scheduleGameShellStickyLayout();
  }
};

const withBusy = async (fn, { renderStart = true, renderEnd = true } = {}) => {
  busy = true;
  if (renderStart) {
    render();
  }
  try {
    await fn();
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    if (renderEnd) {
      render();
    }
  }
};

const syncRouteData = async () => {
  if (currentRoute.name === "home") {
    await transport.refreshGames();
    routeHydrated = true;
    return;
  }
  if (currentRoute.name === "game") {
    resolvedInvite = null;
    await transport.loadGame(currentRoute.gameId, { openAsViewer: false });
    routeHydrated = true;
    return;
  }
  if (currentRoute.name === "invite") {
    resolvedInvite = await transport.resolveInvite(currentRoute.inviteToken);
    await transport.loadGame(resolvedInvite.gameId, { openAsViewer: false });
    routeHydrated = true;
    return;
  }
  routeHydrated = true;
};

const syncRouteDataPassive = async () => {
  if (busy) {
    return;
  }
  try {
    await syncRouteData();
    render();
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  }
};

const syncScenarioCatalog = async () => {
  try {
    scenarioCatalog = await loadScenarioCatalog();
    selectedScenarioId = selectedScenarioId && scenarioCatalog.scenarios.some((scenario) => scenario.id === selectedScenarioId)
      ? selectedScenarioId
      : scenarioCatalog.scenarios[0]?.id ?? null;
  } catch (error) {
    scenarioCatalog = { id: "S", title: "Saved Scenarios", scenarios: [] };
    selectedScenarioId = null;
    scenarioFeedback = error instanceof Error ? error.message : "Failed to load scenarios";
  }
};

transport.subscribe((change) => {
  render({
    animatePanels: false,
    includeBoard: change?.type !== "optimistic_enqueue",
  });
});

const liveSync = createLiveSyncClient({
  identityId: transport.getIdentityId(),
  getLastEventSeq: () => {
    const gameId = getCurrentViewedGameId();
    return gameId ? transport.getLastEventSeq(gameId) : 0;
  },
  onEvent: (payload) => {
    wsLastEvent = payload?.type
      ? `${payload.type}${payload?.reason ? `:${payload.reason}` : ""}`
      : "unknown";
    if (
      (payload?.type === "state_sync" ||
        payload?.type === "event_appended" ||
        payload?.type === "presence_changed" ||
        payload?.type === "join_request_created" ||
        payload?.type === "join_request_resolved") &&
      payload?.game
    ) {
      transport.applyLiveGameUpdate({ game: payload.game, eventSeq: payload.eventSeq, clientCommandId: payload.clientCommandId ?? null });
    }
    if (document.getElementById("shell-header-last-event")) {
      updateHeaderFields();
    } else {
      render({ animatePanels: false, includeBoard: false });
    }
  },
  onError: (error) => {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  },
  onStatus: (status) => {
    const statusKey = toStableKey(status);
    if (statusKey === lastWsStatusKey) {
      return;
    }
    lastWsStatusKey = statusKey;
    wsStatus = status;
    if (status.state === "closed" && status.reconnectAttempts >= 3) {
      void syncRouteDataPassive();
    }
    if (document.getElementById("shell-header-live-sync")) {
      updateHeaderFields();
    } else {
      render({ animatePanels: false, includeBoard: false });
    }
  },
});

const syncLiveChannel = () => {
  const liveGameId =
    currentRoute.name === "game"
      ? currentRoute.gameId
      : currentRoute.name === "invite"
        ? resolvedInvite?.gameId || null
        : null;
  const routeKey = liveGameId ? `game:${liveGameId}` : "none";

  if (routeKey === liveSyncConnectedRoute && (wsStatus.state === "connected" || wsStatus.state === "connecting")) {
    return;
  }
  liveSyncConnectedRoute = routeKey;

  liveSync.disconnect();

  if (!shouldLiveSyncRoute(currentRoute)) {
    return;
  }
  if (liveGameId) {
    liveSync.resume();
    liveSync.connectGame(liveGameId);
  }
};

const navigateTo = (hash) => {
  if (window.location.hash === hash) {
    currentRoute = parseRouteFromHash(hash);
    routeHydrated = false;
    syncLiveChannel();
    void withBusy(async () => {
      await syncRouteData();
      syncLiveChannel();
    });
    return;
  }
  window.location.hash = hash;
};

window.addEventListener("hashchange", () => {
  currentRoute = parseRouteFromHash(window.location.hash);
  routeHydrated = false;
  syncLiveChannel();
  void withBusy(async () => {
    await syncRouteData();
    syncLiveChannel();
  });
});

window.addEventListener("online", () => {
  void withBusy(async () => {
    await transport.setOffline(false);
    liveSync.resume();
    syncLiveChannel();
    await syncRouteData();
  });
});

window.addEventListener("offline", () => {
  void withBusy(async () => {
    await transport.setOffline(true);
    liveSync.disconnect();
    liveSyncConnectedRoute = "";
    await syncRouteData();
  });
});

window.addEventListener("resize", () => {
  scheduleGameShellStickyLayout();
});

window.addEventListener("load", () => {
  scheduleGameShellStickyLayout();
});

appEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionEl = target.closest("[data-action]");
  if (!actionEl) {
    return;
  }

  const action = actionEl.getAttribute("data-action");
  const shouldRenderBusyState =
    action !== "copy-invite" &&
    action !== "jump-history" &&
    action !== "return-live" &&
    action !== "tutorial-next" &&
    action !== "tutorial-skip";

  await withBusy(async () => {
    if (action === "toggle-debug") {
      navigateTo(toggleDebugHash(window.location.hash));
      return;
    }

    if (action === "create-game") {
      const game = await transport.createGame({ playgroundMode: false, offlineLocal: false });
      navigateTo(buildGameHash(game.id, null, currentRoute.debug));
      return;
    }

    if (action === "create-offline-playground") {
      await transport.setOffline(true);
      const game = await transport.createGame({ playgroundMode: true, offlineLocal: true });
      navigateTo(buildGameHash(game.id, "offline", currentRoute.debug));
      return;
    }

    if (action === "toggle-offline") {
      const gameId = actionEl.getAttribute("data-game-id");
      const next = !(window.__righeltOffline || false);
      if (!next && gameId) {
        const game = transport.getGameViewModel(gameId);
        if (game?.offlineLocal) {
          const confirmed = window.confirm("Go online with this local game?");
          await transport.goOnlineGame({ gameId, confirmed });
        }
      }
      window.__righeltOffline = next;
      await transport.setOffline(next);
      await syncRouteData();
      return;
    }

    if (action === "join-viewer" || action === "accept-invite-viewer") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.joinGame({
        gameId,
        mode: "viewer",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      markInviteChoiceCommitted(gameId);
      if (currentRoute.name === "invite" || currentRoute.name === "game") {
        navigateTo(buildGameHash(gameId, null, currentRoute.debug));
        return;
      }
      await syncRouteData();
      return;
    }

    if (action === "join-player" || action === "accept-invite-player") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      const result = await transport.joinGame({
        gameId,
        mode: "player",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      markInviteChoiceCommitted(gameId);
      if (result.pendingApproval) {
        setInviteFeedback("Player join request sent. You are now viewing the game while approval is pending.");
      }
      if (currentRoute.name === "invite" || currentRoute.name === "game") {
        navigateTo(buildGameHash(gameId, null, currentRoute.debug));
        return;
      }
      await syncRouteData();
      return;
    }

    if (action === "play-as-both-players") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.playAsBothPlayers({ gameId });
      await syncRouteData();
      return;
    }

    if (action === "approve-request" || action === "accept-request") {
      const gameId = actionEl.getAttribute("data-game-id");
      const requester = actionEl.getAttribute("data-requester-id");
      if (!gameId || !requester) return;
      ignoredApprovalRequests.delete(getApprovalRequestKey(gameId, requester));
      await transport.approvePendingRequest({ gameId, requesterIdentityId: requester });
      await syncRouteData();
      return;
    }

    if (action === "ignore-request") {
      const gameId = actionEl.getAttribute("data-game-id");
      const requester = actionEl.getAttribute("data-requester-id");
      if (!gameId || !requester) return;
      ignoredApprovalRequests.add(getApprovalRequestKey(gameId, requester));
      render();
      return;
    }

    if (action === "copy-invite") {
      const link = actionEl.getAttribute("data-link") || "";
      let copied = false;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
      window.__righeltLastInvite = link;
      setInviteFeedback(copied ? "Invite link copied to clipboard" : "Clipboard unavailable");
      return;
    }

    if (action === "jump-history") {
      const gameId = actionEl.getAttribute("data-game-id");
      const moveIndex = Number.parseInt(actionEl.getAttribute("data-move-index") || "-1", 10);
      if (!gameId || !Number.isFinite(moveIndex)) return;
      clearControlPress();
      clearHistoryPress();
      playHistoryReleaseBounce(actionEl);
      await animateHistoryDeselection(actionEl);
      await transport.selectHistoryMove({ gameId, moveIndex });
      await syncRouteData();
      return;
    }

    if (action === "return-live") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      clearHistoryPress();
      playHistoryReleaseBounce(actionEl);
      await animateHistoryDeselection(actionEl);
      await transport.returnToLive({ gameId });
      await syncRouteData();
      return;
    }

    if (action === "tutorial-next" || action === "tutorial-skip") {
      tutorial.next();
      return;
    }

    if (action === "tutorial-complete") {
      saveTutorialCompleted(storage, true);
      tutorial.reset();
      const gameId = actionEl.getAttribute("data-game-id");
      navigateTo(gameId ? buildGameHash(gameId, null, currentRoute.debug) : buildHomeHash(currentRoute.debug));
      return;
    }

    if (action === "load-scenario") {
      const selectedScenario = getSelectedScenario();
      if (!selectedScenario) {
        setScenarioFeedback("No scenario selected.");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const activeGameId =
        currentRoute.name === "game" ? currentRoute.gameId : currentRoute.name === "invite" ? resolvedInvite?.gameId || null : null;
      const activeGame = activeGameId ? transport.getGameViewModel(activeGameId) : null;
      const shouldApplyInPlace = Boolean(activeGame && activeGame.moves.length === 0);
      const result = await transport.importScenario({
        scenario: selectedScenario,
        targetGameId: shouldApplyInPlace ? activeGameId : null,
        sourceGameId: activeGame && !shouldApplyInPlace ? activeGame.id : null,
      });
      setScenarioFeedback(`Scenario ${selectedScenario.id} loaded.`);
      if (!result?.game?.id) {
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const nextHash = buildGameHash(result.game.id, null, currentRoute.debug);
      if (activeGame && !shouldApplyInPlace) {
        window.open(`${window.location.pathname}${window.location.search}${nextHash}`, "_blank", "noopener");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      navigateTo(nextHash);
      return;
    }

    if (action === "save-scenario") {
      const activeGameId =
        currentRoute.name === "game" ? currentRoute.gameId : currentRoute.name === "invite" ? resolvedInvite?.gameId || null : null;
      const activeGame = activeGameId ? transport.getGameViewModel(activeGameId) : null;
      if (!activeGame) {
        setScenarioFeedback("Open a game to save a scenario.");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const scenarioId = getNextScenarioId(scenarioCatalog);
      const title = window.prompt("Scenario title:", `Saved scenario ${scenarioId}`);
      if (!title) {
        return;
      }
      const moveLimit = activeGame.inHistoryMode && typeof activeGame.historyIndex === "number" ? activeGame.historyIndex + 1 : activeGame.moves.length;
      const scenario = await buildScenarioFromGame(activeGame, { scenarioId, title, moveLimit });
      const nextCatalog = {
        ...scenarioCatalog,
        scenarios: [...scenarioCatalog.scenarios, scenario],
      };
      const localWrite = await tryLocalScenarioWrite("/scenarios/save", { scenario });
      scenarioCatalog = nextCatalog;
      selectedScenarioId = scenario.id;
      if (!localWrite.ok) {
        downloadScenarioCatalog(nextCatalog, "scenarios.catalog.updated.json");
      }
      setScenarioFeedback(localWrite.ok ? `Scenario ${scenario.id} saved.` : `Scenario ${scenario.id} saved via download fallback.`);
      render({ animatePanels: false, includeBoard: false });
    }
  }, { renderStart: shouldRenderBusyState });
});

appEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (target.id === "scenario-select") {
    selectedScenarioId = target.value || null;
    scenarioFeedback = "";
    render({ animatePanels: false, includeBoard: false });
  }
});

appEl.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const controlEl = target.closest("button, .button-link");
  if (controlEl instanceof HTMLElement) {
    startControlPress(controlEl);
  }
  const actionEl = target.closest("[data-action]");
  if (!(actionEl instanceof HTMLElement)) {
    return;
  }
  const action = actionEl.getAttribute("data-action");
  if (action !== "jump-history" && action !== "return-live") {
    return;
  }
  startHistoryPress(actionEl);
});

window.addEventListener("pointerup", (event) => {
  const target = event.target;
  if (pressedControlEl instanceof HTMLElement) {
    playControlReleaseBounce(pressedControlEl);
  }
  clearControlPress();
  if (target instanceof HTMLElement) {
    const actionEl = target.closest("[data-action]");
    const action = actionEl?.getAttribute("data-action");
    if (action === "jump-history" || action === "return-live") {
      return;
    }
  }
  clearHistoryPress();
});

window.addEventListener("pointercancel", () => {
  clearHistoryPress();
});

const initialRender = async () => {
  if (navigator.onLine === false) {
    await transport.setOffline(true);
  }

  routeHydrated = false;
  syncLiveChannel();
  await withBusy(async () => {
    await syncScenarioCatalog();
    await syncRouteData();
    syncLiveChannel();
  });
};

void initialRender();
