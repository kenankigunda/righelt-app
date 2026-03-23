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
import { loadDebugFlyoutOpen, saveDebugFlyoutOpen, saveTutorialCompleted } from "./persistence.js";
import {
  buildScenarioFromGame,
  canAuthorScenariosLocally,
  loadScenarioCatalog,
  tryLocalScenarioWrite,
} from "./scenarios.js";
import { shouldSkipBoardRuntimeReload } from "./runtime-sync.js";
import {
  FLYOUT_KEYS,
  buildHashForRoute,
  buildGameHash,
  buildHomeHash,
  buildInviteHash,
  buildTutorialHash,
  isShellRootHash,
  parseRouteFromHash,
  resolveFlyoutState,
  shouldLiveSyncRoute,
  toggleScenariosHash,
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
let saveScenarioDraftTitle = "";
let saveScenarioDraftDescription = "";
const inviteChoiceCommittedByGameId = new Set();
const ignoredApprovalRequests = new Set();
let lastRenderedMarkup = "";
let lastRenderedMainMarkup = "";
let lastRenderedFlyoutMarkup = "";
let lastRenderedRouteKey = "";
let lastRenderedBaseRouteKey = "";
const HISTORY_SELECTION_EXIT_MS = 56;
const HISTORY_RELEASE_BOUNCE_MS = 140;
const HOME_SECTION_PAGE_SIZE = 6;
const HOME_CAROUSEL_MOTION_MS = 220;
let pressedHistoryActionEl = null;
let historyReleaseTimer = null;
let pressedControlEl = null;
let controlReleaseTimer = null;
let stickyLayoutFrame = 0;
const SHELL_WIDE_SCREEN_MIN_WIDTH = 901;
const SHELL_VIEWPORT_GUTTER_PX = 16;
const FLYOUT_MOTION_MS = 180;
const miniBoardPreviewRegistry = new Map();
const renderedMiniBoardPreviewPayloads = new Map();
const DEPLOY_SMOKE_PLAYER_ID = "smoke-player";
const lastAnimatedHomeSectionTokenByKey = new Map();
const activeLiveGameIds = new Set();
const createHomeSectionState = (title) => ({
  title,
  page: 0,
  totalPages: 0,
  totalGames: 0,
  gameIds: [],
  slideDirection: "none",
  animationToken: 0,
});
let homeSections = {
  my: createHomeSectionState("My games"),
  other: createHomeSectionState("Other games"),
  smoke: createHomeSectionState("Deploy smoke player"),
};
const getPersistedDebugFlyoutOpen = () => loadDebugFlyoutOpen(storage);

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
const playerToneClassForSeat = (seat) =>
  seat === "Player 1" ? "player-tone-p1" : seat === "Player 2" ? "player-tone-p2" : seat === "Both Players" ? "player-tone-both" : "player-tone-neutral";
const playerToneClassForSide = (side) => (side === "P1" ? "player-tone-p1" : side === "P2" ? "player-tone-p2" : "player-tone-neutral");
const renderSeatLabel = (seat) => `<span class="${playerToneClassForSeat(seat)}">${escapeHtml(seat || "Unknown")}</span>`;
const isDualSeatIdentity = (game) =>
  Boolean(game?.player1?.identityId) && Boolean(game?.player2?.identityId) && game.player1.identityId === game.player2.identityId;
const renderRoleLabel = (role, game = null) => {
  if (isDualSeatIdentity(game) && isPlayerRole(role)) {
    return '<strong class="player-tone-both">both players</strong>';
  }
  if (role === "Player 1" || role === "Player 2") {
    return `<strong class="${playerToneClassForSeat(role)}">${escapeHtml(role)}</strong>`;
  }
  return `<strong>${escapeHtml(role || "Unknown")}</strong>`;
};
const renderConnectionStatusIcon = (status, label) =>
  `<span class="connection-status-icon is-${escapeHtml(status)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>`;
const getMyConnectionMessage = (game) =>
  game?.myConnectionConnected ? "You are connected here" : "You are not connected here";
const renderPlayerSlotStatus = (seat, participant, { verbose = false } = {}) => {
  if (!verbose) {
    if (!participant) {
      const statusLabel = `${seat} is open for someone to join`;
      return `<span class="mini-board-card-connection-item">${renderSeatLabel(seat)}${renderConnectionStatusIcon(
        "open",
        statusLabel,
      )}</span>`;
    }
    const statusLabel = `${seat} ${participant.connected ? "connected" : "disconnected"}`;
    return `<span class="mini-board-card-connection-item">${renderSeatLabel(seat)}${renderConnectionStatusIcon(
      participant.connected ? "connected" : "disconnected",
      statusLabel,
    )}</span>`;
  }
  if (!participant) {
    const statusLabel = `${seat} is open for someone to join`;
    return `<span class="mini-board-card-connection-item">${renderConnectionStatusIcon("open", statusLabel)}<span>${renderSeatLabel(
      seat,
    )} is open for someone to join</span></span>`;
  }
  const statusLabel = `${seat} is ${participant.connected ? "connected" : "not connected"}`;
  return `<span class="mini-board-card-connection-item">${renderConnectionStatusIcon(
    participant.connected ? "connected" : "disconnected",
    statusLabel,
    )}<span>${renderSeatLabel(seat)} is ${participant.connected ? "connected" : "not connected"}</span></span>`;
};
const shouldUseVerboseHomeConnectionCopy = (game) =>
  (isDualSeatIdentity(game) && isPlayerRole(game?.myRole)) || game?.myRole === "Player 1" || game?.myRole === "Player 2";
const renderHomeRoleLine = (game) => {
  if (isDualSeatIdentity(game) && isPlayerRole(game?.myRole)) {
    return `You are ${renderRoleLabel(game.myRole, game)}`;
  }
  if (game?.myRole === "Player 1") {
    return `You are ${renderRoleLabel(game.myRole, game)}`;
  }
  if (game?.myRole === "Player 2") {
    return `You are ${renderRoleLabel(game.myRole, game)}`;
  }
  if (game?.myRole === "Guest") {
    return game?.canJoinAsPlayer ? "Open to join as player" : "Open to view";
  }
  return renderRoleLabel(game?.myRole, game);
};
const renderHomeClientConnectionLine = (game) => {
  if (shouldUseVerboseHomeConnectionCopy(game)) {
    return `<p class="small mini-board-card-connection-line">${renderConnectionStatusIcon(
      Boolean(game?.myConnectionConnected) ? "connected" : "disconnected",
      getMyConnectionMessage(game),
    )}<span>${escapeHtml(getMyConnectionMessage(game))}</span></p>`;
  }
  return "";
};
const renderHomeConnectionSummary = (game) => {
  const slots = [
    { seat: "Player 1", participant: game?.player1 ?? null },
    { seat: "Player 2", participant: game?.player2 ?? null },
  ];
  const filteredSlots = isDualSeatIdentity(game) && isPlayerRole(game?.myRole)
    ? []
    : slots.filter((entry) => {
        if (game?.myRole === "Player 1") return entry.seat !== "Player 1";
        if (game?.myRole === "Player 2") return entry.seat !== "Player 2";
        return true;
      });
  if (filteredSlots.length === 0) {
    return "";
  }
  return filteredSlots
    .map((entry) => renderPlayerSlotStatus(entry.seat, entry.participant, { verbose: shouldUseVerboseHomeConnectionCopy(game) }))
    .join('<span class="mini-board-card-connection-separator">·</span>');
};
const renderHomeSeatConnectionLine = (game) => {
  const connectionSummary = renderHomeConnectionSummary(game);
  if (connectionSummary) {
    return `<p class="small mini-board-card-connection-line">${connectionSummary}</p>`;
  }
  if (shouldUseVerboseHomeConnectionCopy(game)) {
    return '<p class="small mini-board-card-connection-line is-placeholder" aria-hidden="true"><span>&nbsp;</span></p>';
  }
  return "";
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

const registerMiniBoardPreview = ({ previewId, snapshot, selection = null, previewKey, sizeVariant = "compact" }) => {
  renderedMiniBoardPreviewPayloads.set(previewId, {
    snapshot: snapshot ?? null,
    selection: selection ?? null,
    previewKey,
    sizeVariant,
  });
  return previewId;
};

const renderMiniBoardPreviewRoot = ({ previewId, snapshot, selection = null, previewKey, sizeVariant = "compact" }) => {
  const stablePreviewId = registerMiniBoardPreview({
    previewId,
    snapshot,
    selection,
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

const getGamePreviewSnapshot = (game) => game?.liveCurrentSnapshot ?? game?.board?.state ?? game?.currentSnapshot ?? null;
const getScenarioPreviewSnapshot = (scenario) => scenario?.resultingState ?? scenario?.initialState ?? null;
const getScenarioPreviewSelection = (scenario) =>
  scenario?.savedSelection?.source
    ? {
        selectedPieceId: null,
        source: scenario.savedSelection.source,
        target: scenario.savedSelection.target ?? null,
      }
    : null;
const buildSavedSelectionFromAction = (action, snapshot) => {
  if (!action?.from) {
    return null;
  }
  return {
    source: { ...action.from },
    target: action.to ? { ...action.to } : null,
    actorSide: snapshot?.sideToMove === "P2" ? "P2" : "P1",
    turnIndex: Number(snapshot?.turnIndex ?? 0),
  };
};
const buildSavedSelectionFromRuntimeSelection = (selection, snapshot) => {
  if (!selection?.source) {
    return null;
  }
  return {
    source: { ...selection.source },
    target: selection.target ? { ...selection.target } : null,
    actorSide: snapshot?.sideToMove === "P2" ? "P2" : "P1",
    turnIndex: Number(snapshot?.turnIndex ?? 0),
  };
};
const getScenarioEditableFieldText = (field) => {
  const editableEl = appEl?.querySelector?.(`[data-scenario-editable="${field}"]`);
  return editableEl instanceof HTMLElement ? editableEl.textContent?.trim() ?? "" : "";
};
const getSaveScenarioDraft = () => ({
  title: saveScenarioDraftTitle.trim(),
  description: saveScenarioDraftDescription.trim(),
});
const canSubmitSaveScenarioDraft = () => {
  const draft = getSaveScenarioDraft();
  return Boolean(draft.title && draft.description);
};
const canSubmitScenarioUpdate = () => {
  const title = getScenarioEditableFieldText("title");
  const description = getScenarioEditableFieldText("description");
  return Boolean(title && description);
};
const syncScenarioAuthoringControls = () => {
  const updateButtonEl = appEl?.querySelector?.('[data-action="update-scenario"]');
  if (updateButtonEl instanceof HTMLButtonElement) {
    updateButtonEl.disabled = busy || !canSubmitScenarioUpdate();
  }
  const saveButtonEl = appEl?.querySelector?.('[data-action="save-scenario"]');
  if (saveButtonEl instanceof HTMLButtonElement) {
    saveButtonEl.disabled = busy || !canSubmitSaveScenarioDraft();
  }
};
const getScenarioExportContext = (game) => {
  const currentSnapshot = game?.currentSnapshot ?? game?.board?.state ?? null;
  const moveLimit = game?.inHistoryMode && typeof game.historyIndex === "number" ? game.historyIndex : game?.moves?.length ?? 0;
  const savedSelection = game?.inHistoryMode
    ? buildSavedSelectionFromAction(game.historySelectionAction ?? null, currentSnapshot)
    : buildSavedSelectionFromRuntimeSelection(boardRuntime?.getSelection?.() ?? null, currentSnapshot);
  return {
    currentSnapshot,
    moveLimit,
    savedSelection,
  };
};
const resolvePendingScenarioHydration = ({ game, snapshot, legalActions }) => {
  const pendingSelection = game?.pendingScenarioSelection ?? null;
  if (
    !pendingSelection ||
    game?.inHistoryMode ||
    !(game?.canRecordMove || game?.canEndTurn) ||
    pendingSelection.actorSide !== snapshot?.sideToMove ||
    pendingSelection.turnIndex !== snapshot?.turnIndex
  ) {
    return { selectionAction: null, selectionState: null };
  }

  const sourcePiece = snapshot?.pieces?.find(
    (piece) => piece.position?.row === pendingSelection.source.row && piece.position?.col === pendingSelection.source.col,
  );
  if (!sourcePiece) {
    return { selectionAction: null, selectionState: null };
  }

  if (!pendingSelection.target) {
    return {
      selectionAction: null,
      selectionState: {
        selectedPieceId: sourcePiece.id,
        source: pendingSelection.source,
        target: null,
      },
    };
  }

  const matchingAction = (Array.isArray(legalActions) ? legalActions : []).find(
    (action) =>
      action?.from?.row === pendingSelection.source.row &&
      action?.from?.col === pendingSelection.source.col &&
      action?.to?.row === pendingSelection.target.row &&
      action?.to?.col === pendingSelection.target.col,
  );
  if (!matchingAction) {
    return { selectionAction: null, selectionState: null };
  }
  return { selectionAction: matchingAction, selectionState: null };
};
const isPlayerRole = (role) => role === "Player 1" || role === "Player 2";
const gameIncludesIdentity = (game, identityId) => {
  if (!game || !identityId) {
    return false;
  }
  return (
    game.player1?.identityId === identityId ||
    game.player2?.identityId === identityId ||
    (Array.isArray(game.viewers) && game.viewers.some((viewer) => viewer?.identityId === identityId)) ||
    (Array.isArray(game.pendingJoinRequests) && game.pendingJoinRequests.some((request) => request?.identityId === identityId))
  );
};
const getVisibleHomeSectionKeys = (route = currentRoute) => (route?.debug ? ["my", "other", "smoke"] : ["my", "other"]);
const getHomeSection = (sectionKey) => homeSections[sectionKey] ?? createHomeSectionState(sectionKey);
const setHomeSection = (sectionKey, nextState) => {
  homeSections = {
    ...homeSections,
    [sectionKey]: nextState,
  };
};
const getHomeActiveGameIds = () =>
  currentRoute.name === "home" && routeHydrated
    ? getVisibleHomeSectionKeys().flatMap((sectionKey) => getHomeSection(sectionKey).gameIds)
    : [];
const shouldDisableLiveSync = () => window.__righeltOffline === true || navigator.onLine === false;
const resetRouteWsStatus = () => {
  wsStatus = { state: "disconnected", gameId: null, reconnectAttempts: 0 };
  lastWsStatusKey = toStableKey(wsStatus);
};

const renderPlaceholderBadge = () => '<span class="status-chip offline">Not yet implemented</span>';
const renderSectionActions = (actions) => {
  const items = actions.filter((value) => typeof value === "string" && value.trim().length > 0);
  if (items.length === 0) {
    return "";
  }
  return `<div class="row section-actions">${items.join("")}</div>`;
};
const getAnimatedPanels = () => (appEl instanceof HTMLElement ? Array.from(appEl.querySelectorAll(".panel")) : []);
const getAnimatedFlyoutEls = (layoutMode = getShellLayoutMode()) => {
  if (!(appEl instanceof HTMLElement)) {
    return [];
  }
  const mainContentEl = layoutMode === "wide" ? appEl.querySelector(".shell-main-content") : null;
  const flyoutEls = Array.from(appEl.querySelectorAll("[data-flyout]"));
  return [mainContentEl, ...flyoutEls].filter((element) => element instanceof HTMLElement);
};
const getAnimatedFlyoutKey = (element) => {
  if (!(element instanceof HTMLElement)) {
    return "";
  }
  if (element.classList.contains("shell-main-content")) {
    return "main";
  }
  const flyoutKey = element.getAttribute("data-flyout");
  return flyoutKey ? `flyout:${flyoutKey}` : "";
};
const getCssPixelValue = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const getFlyoutContentGapPx = () =>
  getCssPixelValue(window.getComputedStyle(document.documentElement).getPropertyValue("--shell-flyout-content-gap"), 0);
const getShellMainMaxWidthPx = () =>
  getCssPixelValue(window.getComputedStyle(document.documentElement).getPropertyValue("--shell-main-max-width"), 1200);
const getWideShellPaddingRightPx = (openFlyoutCount, viewportWidth = window.innerWidth) => {
  if (openFlyoutCount <= 0) {
    return 0;
  }
  return (getWideFlyoutWidth(viewportWidth) * openFlyoutCount) + getFlyoutContentGapPx();
};
const getWideMainContentWidthPx = (openFlyoutCount, viewportWidth = window.innerWidth) => {
  const rightReserved = openFlyoutCount > 0 ? getWideShellPaddingRightPx(openFlyoutCount, viewportWidth) : SHELL_VIEWPORT_GUTTER_PX;
  return Math.max(0, Math.min(getShellMainMaxWidthPx(), viewportWidth - SHELL_VIEWPORT_GUTTER_PX - rightReserved));
};
const captureFlyoutRects = (layoutMode = getShellLayoutMode()) =>
  new Map(
    getAnimatedFlyoutEls(layoutMode).map((element) => [
      getAnimatedFlyoutKey(element),
      element instanceof HTMLElement ? element.getBoundingClientRect() : null,
    ]),
  );
const animateFlyoutShift = (element, { deltaX = 0, deltaY = 0, fromOpacity = 1, fromWidth = null, toWidth = null } = {}) => {
  if (prefersReducedMotion() || !(element instanceof HTMLElement)) {
    return;
  }
  const hasWidthChange = Number.isFinite(fromWidth) && Number.isFinite(toWidth) && Math.abs(toWidth - fromWidth) >= 1;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(fromOpacity - 1) < 0.01 && !hasWidthChange) {
    return;
  }
  element.style.transition = "none";
  if (hasWidthChange) {
    element.style.width = `${fromWidth}px`;
    element.style.maxWidth = `${fromWidth}px`;
  }
  element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  element.style.opacity = String(fromOpacity);
  void element.offsetHeight;
  element.style.transition = `transform ${FLYOUT_MOTION_MS}ms ease, opacity ${FLYOUT_MOTION_MS}ms ease, width ${FLYOUT_MOTION_MS}ms ease, max-width ${FLYOUT_MOTION_MS}ms ease`;
  if (hasWidthChange) {
    element.style.width = `${toWidth}px`;
    element.style.maxWidth = `${toWidth}px`;
  }
  element.style.transform = "";
  element.style.opacity = "";

  const clearMotion = () => {
    element.style.transition = "";
    element.style.width = "";
    element.style.maxWidth = "";
    element.style.transform = "";
    element.style.opacity = "";
    element.removeEventListener("transitionend", clearMotion);
  };
  element.addEventListener("transitionend", clearMotion);
};
const animateFlyoutPositionChanges = (previousRects) => {
  if (prefersReducedMotion() || !(previousRects instanceof Map)) {
    return;
  }
  const layoutMode = getShellLayoutMode();
  getAnimatedFlyoutEls(layoutMode).forEach((element) => {
    const key = getAnimatedFlyoutKey(element);
    if (!key) {
      return;
    }
    const previousRect = previousRects.get(key);
    const nextRect = element.getBoundingClientRect();
    if (previousRect) {
      animateFlyoutShift(element, {
        deltaX: previousRect.left - nextRect.left,
        deltaY: previousRect.top - nextRect.top,
        fromWidth: previousRect.width,
        toWidth: nextRect.width,
      });
      return;
    }
    animateFlyoutShift(element, {
      deltaX: layoutMode === "wide" ? nextRect.width : 0,
      deltaY: layoutMode === "wide" ? 0 : nextRect.height,
      fromOpacity: 0,
    });
  });
};
const clearCoordinatedFlyoutMotionStyles = () => {
  if (appEl instanceof HTMLElement) {
    appEl.style.transition = "";
    appEl.style.paddingRight = "";
  }
  const mainContentEl = appEl?.querySelector?.(".shell-main-content");
  if (mainContentEl instanceof HTMLElement) {
    mainContentEl.style.transition = "";
    mainContentEl.style.width = "";
    mainContentEl.style.maxWidth = "";
  }
};
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
const getCurrentFlyoutState = () => ({
  ...Object.fromEntries(FLYOUT_KEYS.map((key) => [key, currentRoute[key] === true])),
});
const getBaseRouteRenderKey = (route = currentRoute) => {
  if (!route || typeof route !== "object") {
    return "unknown";
  }
  if (route.name === "game") {
    return `game:${route.gameId || ""}:${route.inviteFromRole || ""}`;
  }
  if (route.name === "invite") {
    return `invite:${route.inviteToken || ""}`;
  }
  if (route.name === "tutorial") {
    return `tutorial:${route.gameId || ""}`;
  }
  return String(route.name || "unknown");
};
const getRouteRenderKey = (route = currentRoute) =>
  `${getBaseRouteRenderKey(route)}|${FLYOUT_KEYS.map((key) => `${key}:${route?.[key] === true}`).join("|")}`;
const isFlyoutOnlyRouteChange = (previousRoute, nextRoute) =>
  getBaseRouteRenderKey(previousRoute) === getBaseRouteRenderKey(nextRoute) &&
  getRouteRenderKey(previousRoute) !== getRouteRenderKey(nextRoute);
let flyoutRenderOrder = FLYOUT_KEYS.filter((key) => currentRoute[key] === true);
const syncFlyoutRenderOrder = (route = currentRoute) => {
  const openKeys = FLYOUT_KEYS.filter((key) => route[key] === true);
  flyoutRenderOrder = flyoutRenderOrder.filter((key) => openKeys.includes(key));
  openKeys.forEach((key) => {
    if (!flyoutRenderOrder.includes(key)) {
      flyoutRenderOrder.push(key);
    }
  });
};
const setFlyoutOpenState = (key, isOpen) => {
  if (!FLYOUT_KEYS.includes(key)) {
    return;
  }
  flyoutRenderOrder = flyoutRenderOrder.filter((entry) => entry !== key);
  if (isOpen) {
    flyoutRenderOrder.push(key);
  }
};
const getOpenFlyoutCount = (route = currentRoute) => FLYOUT_KEYS.reduce((count, key) => count + Number(route?.[key] === true), 0);
const getWideFlyoutWidth = (viewportWidth = window.innerWidth) => {
  const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16") || 16;
  return Math.min(rootFontSize * 34, viewportWidth * 0.36);
};
const getAvailableShellContentWidth = (viewportWidth = window.innerWidth, route = currentRoute) => {
  const totalHorizontalGutter = SHELL_VIEWPORT_GUTTER_PX * 2;
  const openFlyoutCount = getOpenFlyoutCount(route);
  if (openFlyoutCount === 0) {
    return Math.max(0, viewportWidth - totalHorizontalGutter);
  }
  return Math.max(0, viewportWidth - (getWideFlyoutWidth(viewportWidth) * openFlyoutCount) - totalHorizontalGutter);
};
const getShellLayoutModeForRoute = (route = currentRoute, viewportWidth = window.innerWidth) =>
  (getAvailableShellContentWidth(viewportWidth, route) >= SHELL_WIDE_SCREEN_MIN_WIDTH ? "wide" : "narrow");
const normalizeRouteFlyoutState = (route, { preferredFlyoutKey = null } = {}) => {
  if (!route || typeof route !== "object") {
    return route;
  }
  const routeWithPersistedPreferences = {
    ...route,
    debug: getPersistedDebugFlyoutOpen(),
  };
  return {
    ...routeWithPersistedPreferences,
    ...resolveFlyoutState(routeWithPersistedPreferences, {
      allowStacking: getShellLayoutModeForRoute(routeWithPersistedPreferences) === "wide",
      preferredKey: preferredFlyoutKey,
    }),
  };
};
currentRoute = normalizeRouteFlyoutState(currentRoute);
const getShellLayoutMode = (viewportWidth = window.innerWidth) => getShellLayoutModeForRoute(currentRoute, viewportWidth);
const syncShellLayoutMode = () => {
  const layoutMode = getShellLayoutMode();
  if (appEl instanceof HTMLElement) {
    appEl.setAttribute("data-shell-layout-mode", layoutMode);
    FLYOUT_KEYS.forEach((key) => {
      appEl.setAttribute(`data-${key}-open`, currentRoute[key] ? "true" : "false");
    });
    appEl.setAttribute("data-flyout-count", String(getOpenFlyoutCount()));
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
            ? `<a class="button-link secondary" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">Home</a>`
            : ""
        }
        <button
          class="secondary${currentRoute.scenarios ? " is-active" : ""}"
          type="button"
          data-action="${currentRoute.scenarios ? "close-scenarios" : "open-scenarios"}"
          aria-pressed="${currentRoute.scenarios ? "true" : "false"}"
        >Scenarios</button>
        <button
          class="secondary${currentRoute.debug ? " is-active" : ""}"
          type="button"
          data-action="${currentRoute.debug ? "close-debug" : "open-debug"}"
          aria-pressed="${currentRoute.debug ? "true" : "false"}"
        >Debug</button>
        <a class="button-link secondary" href="${buildTutorialHash(null, getCurrentFlyoutState())}" data-flyout-link="tutorial">Tutorial</a>
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
          `${scenario.title}${scenario.incorrect ? " [incorrect]" : ""}`,
        )}</option>`,
    )
    .join("");

const renderScenarioPanel = ({ route, game = null } = {}) => {
  const selectedScenario = getSelectedScenario();
  const scenarioSnapshot = getScenarioPreviewSnapshot(selectedScenario);
  const scenarioPreviewSelection = getScenarioPreviewSelection(selectedScenario);
  const scenarioPreviewKey = toStableKey({ snapshot: scenarioSnapshot, selection: scenarioPreviewSelection });
  const moveLimit = game?.inHistoryMode && typeof game.historyIndex === "number" ? game.historyIndex : game?.moves?.length ?? 0;
  const canAuthorScenarios = Boolean(game) && canAuthorScenariosLocally();
  const canLoadIntoCurrentGame = Boolean(game && Array.isArray(game.moves) && game.moves.length === 0 && selectedScenario);
  const saveDraft = getSaveScenarioDraft();
  const canSaveScenario = canAuthorScenarios && Boolean(saveDraft.title && saveDraft.description);
  const selectedScenarioTitle = selectedScenario?.title ?? "";
  const selectedScenarioDescription = selectedScenario?.description ?? "Scenarios replay canonical shell history into a game.";
  const canUpdateScenario = canAuthorScenarios && Boolean(selectedScenario);
  return `
    <section class="panel debug-panel scenario-panel">
      <h2>Scenarios</h2>
      <div class="form-row">
        <label for="scenario-select">Saved scenario</label>
        <select id="scenario-select">
          ${scenarioCatalog.scenarios.length > 0 ? renderScenarioOptionList() : '<option value="">No scenarios saved yet</option>'}
        </select>
      </div>
      ${
        selectedScenario
          ? `<div class="scenario-selected-summary">
              <div
                class="scenario-selected-title"
                data-scenario-editable="title"
                ${canAuthorScenarios ? 'contenteditable="plaintext-only" role="textbox" aria-label="Scenario title"' : ""}
                ${canAuthorScenarios ? "" : 'tabindex="0"'}
              >${escapeHtml(selectedScenarioTitle)}</div>
              <p
                class="small"
                data-scenario-editable="description"
                ${canAuthorScenarios ? 'contenteditable="plaintext-only" role="textbox" aria-label="Scenario description"' : ""}
                ${canAuthorScenarios ? "" : 'tabindex="0"'}
              >${escapeHtml(selectedScenarioDescription)}</p>
            </div>`
          : `<p class="small">${escapeHtml(selectedScenarioDescription)}</p>`
      }
      ${
        selectedScenario
          ? `<div class="mini-board-card mini-board-card-scenario">
              ${renderMiniBoardPreviewRoot({
                previewId: `scenario:${selectedScenario.id}`,
                snapshot: scenarioSnapshot,
                selection: scenarioPreviewSelection,
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
          canUpdateScenario
            ? `<button class="secondary" data-action="update-scenario"${busy || !selectedScenarioTitle.trim() || !selectedScenarioDescription.trim() ? " disabled" : ""}>Update to match current board</button>`
            : ""
        }
      </div>
      ${
        canAuthorScenarios
          ? `<section class="scenario-save-panel">
              <h3>Save current board as new scenario</h3>
              <div class="form-row">
                <label for="save-scenario-title">Title</label>
                <input id="save-scenario-title" data-scenario-save-field="title" value="${escapeHtml(saveDraft.title)}" />
              </div>
              <div class="form-row">
                <label for="save-scenario-description">Description</label>
                <textarea id="save-scenario-description" data-scenario-save-field="description" rows="4">${escapeHtml(saveDraft.description)}</textarea>
              </div>
              <div class="row">
                <button class="secondary" data-action="save-scenario"${busy || !canSaveScenario ? " disabled" : ""}>Save current board as new scenario</button>
              </div>
            </section>`
          : ""
      }
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

const renderFlyout = ({ title, variant, closeAction, body }) => `
  <aside class="shell-flyout shell-flyout-${variant} is-open" data-flyout="${variant}">
    <header class="shell-flyout-header">
      <h2>${title}</h2>
      <button class="flyout-close-button" type="button" aria-label="Close ${title}" data-action="${closeAction}">x</button>
    </header>
    <div class="shell-flyout-scroll shell-flyout-scroll-${variant}">
      ${body}
    </div>
  </aside>
`;

const renderScenarioFlyout = () => {
  if (!currentRoute.scenarios) {
    return "";
  }
  const route = currentRoute;
  const gameId = route.name === "game" ? route.gameId : route.name === "invite" ? resolvedInvite?.gameId || null : null;
  const game = gameId ? transport.getGameViewModel(gameId) : null;
  return renderFlyout({
    title: "Scenarios",
    variant: "scenarios",
    closeAction: "close-scenarios",
    body: renderScenarioPanel({ route, game }),
  });
};

const renderDebugFlyout = () => {
  if (!currentRoute.debug) {
    return "";
  }
  return renderFlyout({
    title: "Debug mode",
    variant: "debug",
    closeAction: "close-debug",
    body: renderDebugContent(),
  });
};
const FLYOUT_RENDERERS = {
  scenarios: () => renderScenarioFlyout(),
  debug: () => renderDebugFlyout(),
};
const renderFlyoutBodyByKey = (flyoutKey) => {
  if (flyoutKey === "scenarios") {
    const route = currentRoute;
    const scenarioGameId = route.name === "game" ? route.gameId : route.name === "invite" ? resolvedInvite?.gameId || null : null;
    const scenarioGame = scenarioGameId ? transport.getGameViewModel(scenarioGameId) : null;
    return renderScenarioPanel({ route, game: scenarioGame });
  }
  if (flyoutKey === "debug") {
    return renderDebugContent();
  }
  return "";
};

const renderFlyouts = () => {
  const flyouts = flyoutRenderOrder
    .map((key) => {
      const renderFlyoutByKey = FLYOUT_RENDERERS[key];
      return typeof renderFlyoutByKey === "function" ? renderFlyoutByKey() : "";
    })
    .filter(Boolean);
  if (flyouts.length === 0) {
    return "";
  }
  return `
    <div class="shell-flyout-stack" data-shell-flyouts>${flyouts.join("")}</div>
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

const renderHomeGameCard = (game) => {
  const snapshot = getGamePreviewSnapshot(game);
  const previewKey = toStableKey(snapshot);
  const statusText = snapshot ? formatSideToMoveLabel(snapshot) : "Snapshot unavailable";
  const moveLabel = Array.isArray(game.moves) ? `Move ${game.moves.length + 1}` : "Move pending";
  const recoveryChip = game.syncStatus === "desynced" ? '<span class="status-chip">Recovering</span>' : "";
  const myConnectionLine = renderHomeClientConnectionLine(game);
  const seatConnectionLine = renderHomeSeatConnectionLine(game);
  const cardInfoLines = [myConnectionLine, seatConnectionLine]
    .filter(Boolean)
    .join("");
  return `<article class="mini-board-card">
    <a
      class="mini-board-card-link-surface"
      href="${buildGameHash(game.id, null, getCurrentFlyoutState())}"
      data-flyout-link="game"
      data-game-id="${escapeHtml(game.id)}"
    >
      <div class="mini-board-card-header">
        <div>
          <span class="mini-board-card-link">${escapeHtml(formatDisplayGameId(game.id))}</span>
          <p class="small mini-board-card-subtitle">As of ${escapeHtml(formatClientDateTime(game.lastMoveAt || game.createdAt))}</p>
        </div>
        ${recoveryChip}
      </div>
      <div class="mini-board-card-copy">
        <div class="mini-board-card-meta mini-board-card-meta-primary">
          <span>${renderHomeRoleLine(game)}</span>
          <span class="small">${escapeHtml(moveLabel)}</span>
        </div>
        ${cardInfoLines}
      </div>
      ${renderMiniBoardPreviewRoot({
        previewId: `home:${game.id}`,
        snapshot,
        previewKey,
      })}
      <p class="small mini-board-preview-status">${escapeHtml(statusText)}</p>
    </a>
  </article>`;
};

const renderHomeSectionControls = (sectionKey, section, { placement } = { placement: "header" }) => `<div
  class="home-games-section-controls home-games-section-controls-${escapeHtml(placement)}"
>
  <button
    class="secondary"
    data-action="home-page-prev"
    data-home-section="${escapeHtml(sectionKey)}"
    ${busy ? "disabled" : ""}
    aria-label="Previous ${escapeHtml(section.title)} page"
  >&larr;</button>
  <p class="small home-games-section-page-label">Page ${section.page + 1} of ${section.totalPages}</p>
  <button
    class="secondary"
    data-action="home-page-next"
    data-home-section="${escapeHtml(sectionKey)}"
    ${busy ? "disabled" : ""}
    aria-label="Next ${escapeHtml(section.title)} page"
  >&rarr;</button>
</div>`;

const renderHomeGameSection = (sectionKey) => {
  const section = getHomeSection(sectionKey);
  const games = section.gameIds.map((gameId) => transport.getGameViewModel(gameId)).filter(Boolean);
  if (!Array.isArray(games) || games.length === 0 || section.totalGames === 0) {
    return "";
  }
  const showPaging = section.totalPages > 1;
  return `<section class="panel home-games-section" data-home-section-root="${escapeHtml(sectionKey)}">
    <div class="home-games-section-header">
      <div class="home-games-section-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <p class="small">${section.totalGames === 1 ? "1 game" : `${section.totalGames} games`}</p>
      </div>
      ${showPaging ? renderHomeSectionControls(sectionKey, section, { placement: "header" }) : ""}
    </div>
    <div class="home-games-carousel" data-home-carousel="${escapeHtml(sectionKey)}">
      <div class="home-games-carousel-track" data-home-carousel-track="${escapeHtml(sectionKey)}">
        <div class="mini-board-card-list" data-game-count="${games.length}">${games.map((game) => renderHomeGameCard(game)).join("")}</div>
      </div>
    </div>
    ${showPaging ? renderHomeSectionControls(sectionKey, section, { placement: "footer" }) : ""}
  </section>`;
};

const scrollHomeSectionToTop = (sectionKey) => {
  if (getShellLayoutMode() !== "narrow" || !(appEl instanceof HTMLElement)) {
    return;
  }
  const sectionEl = appEl.querySelector(`[data-home-section-root="${sectionKey}"]`);
  if (!(sectionEl instanceof HTMLElement)) {
    return;
  }
  sectionEl.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const renderHome = () => {
  const sectionHtml = getVisibleHomeSectionKeys().map((sectionKey) => renderHomeGameSection(sectionKey)).join("");
  const listHtml = sectionHtml || `<section class="panel"><p class="small">No games yet.</p></section>`;

  return `
    <section class="stack">
      <section class="panel home-start-panel">
        <button class="home-start-button" data-action="create-game" ${busy ? "disabled" : ""}>Start new game</button>
      </section>
      ${listHtml}
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
      <p class="small">Role: ${renderRoleLabel(game.myRole, game)}</p>
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
    `<button data-action="copy-invite" data-game-id="${escapeHtml(game.id)}" data-link="${escapeHtml(inviteLink)}" ${
      game.canInvite && !busy ? "" : "disabled"
    }>Invite someone else</button>`,
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
const getMountedShellPageEl = () =>
  appEl?.querySelector?.(".shell-page-shell") instanceof HTMLElement ? appEl.querySelector(".shell-page-shell") : null;
const getMountedHeaderEl = () =>
  appEl?.querySelector?.(".shell-header") instanceof HTMLElement ? appEl.querySelector(".shell-header") : null;
const createMarkupRoot = (markup) => {
  if (typeof markup !== "string" || markup.trim().length === 0) {
    return null;
  }
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild instanceof HTMLElement ? template.content.firstElementChild : null;
};
const updateMountedHeader = () => {
  const currentHeaderEl = getMountedHeaderEl();
  if (!(currentHeaderEl instanceof HTMLElement)) {
    return false;
  }
  const nextHeaderEl = createMarkupRoot(renderHeader());
  if (!(nextHeaderEl instanceof HTMLElement)) {
    return false;
  }
  currentHeaderEl.replaceWith(nextHeaderEl);
  return true;
};
const getFlyoutAwareHref = (element) => {
  if (!(element instanceof HTMLElement)) {
    return "";
  }
  const target = element.getAttribute("data-flyout-link");
  if (target === "home") {
    return buildHomeHash(getCurrentFlyoutState());
  }
  if (target === "tutorial") {
    return buildTutorialHash(null, getCurrentFlyoutState());
  }
  if (target === "game") {
    const gameId = element.getAttribute("data-game-id");
    return gameId ? buildGameHash(gameId, null, getCurrentFlyoutState()) : "";
  }
  return "";
};
const syncFlyoutAwareLinks = () => {
  if (!(appEl instanceof HTMLElement)) {
    return;
  }
  Array.from(appEl.querySelectorAll("[data-flyout-link]")).forEach((linkEl) => {
    if (!(linkEl instanceof HTMLAnchorElement)) {
      return;
    }
    const href = getFlyoutAwareHref(linkEl);
    if (href) {
      linkEl.setAttribute("href", href);
    }
  });
};
const syncCopyInviteLinks = () => {
  if (!(appEl instanceof HTMLElement)) {
    return;
  }
  Array.from(appEl.querySelectorAll('[data-action="copy-invite"][data-game-id]')).forEach((buttonEl) => {
    if (!(buttonEl instanceof HTMLElement)) {
      return;
    }
    const gameId = buttonEl.getAttribute("data-game-id");
    if (!gameId) {
      return;
    }
    const game = transport.getGameViewModel(gameId);
    const inviteToken = game?.inviteToken || resolvedInvite?.inviteToken || gameId;
    const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(inviteToken, getCurrentFlyoutState())}`;
    buttonEl.setAttribute("data-link", inviteLink);
  });
};
const updateMountedFlyouts = () => {
  const shellPageEl = getMountedShellPageEl();
  if (!(shellPageEl instanceof HTMLElement)) {
    return false;
  }
  const currentFlyoutStack = shellPageEl.querySelector("[data-shell-flyouts]");
  const nextFlyoutMarkup = renderFlyouts();
  if (!nextFlyoutMarkup) {
    currentFlyoutStack?.remove();
    return true;
  }
  const nextFlyoutStack = createMarkupRoot(nextFlyoutMarkup);
  if (!(nextFlyoutStack instanceof HTMLElement)) {
    return false;
  }
  if (currentFlyoutStack instanceof HTMLElement) {
    currentFlyoutStack.replaceWith(nextFlyoutStack);
  } else {
    shellPageEl.append(nextFlyoutStack);
  }
  return true;
};
const shouldPatchMountedFlyouts = (routeKey = getRouteRenderKey(), baseRouteKey = getBaseRouteRenderKey()) =>
  routeKey !== lastRenderedRouteKey &&
  baseRouteKey === lastRenderedBaseRouteKey &&
  appEl instanceof HTMLElement &&
  appEl.querySelector(".shell-main-content") instanceof HTMLElement &&
  getMountedShellPageEl() instanceof HTMLElement;
const syncRenderedMarkupSnapshot = () => {
  const mainContentEl = appEl?.querySelector?.(".shell-main-content");
  lastRenderedMainMarkup = mainContentEl instanceof HTMLElement ? mainContentEl.outerHTML : "";
  lastRenderedFlyoutMarkup = renderFlyouts();
  lastRenderedMarkup = `<div class="shell-page-shell">${lastRenderedMainMarkup}${lastRenderedFlyoutMarkup}</div>`;
  lastRenderedRouteKey = getRouteRenderKey();
  lastRenderedBaseRouteKey = getBaseRouteRenderKey();
};

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
        selection: payload.selection,
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
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(
    game.inviteToken || inviteToken || game.id,
    getCurrentFlyoutState(),
  )}`;

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
  FLYOUT_KEYS.forEach((flyoutKey) => {
    const flyoutEl = appEl?.querySelector?.(`[data-flyout="${flyoutKey}"]`);
    if (!(flyoutEl instanceof HTMLElement)) {
      return;
    }
    flyoutEl.classList.toggle("is-open", currentRoute[flyoutKey] === true);
    const scrollEl = flyoutEl.querySelector(".shell-flyout-scroll");
    if (scrollEl instanceof HTMLElement) {
      const body = renderFlyoutBodyByKey(flyoutKey);
      if (body) {
        scrollEl.innerHTML = body;
      }
    }
  });
  reconcileMiniBoardPreviews();
  scheduleGameShellStickyLayout();
  return true;
};

const doesMountedFlyoutStateMatchRoute = () => {
  if (!(appEl instanceof HTMLElement)) {
    return false;
  }
  return FLYOUT_KEYS.every((flyoutKey) => {
    const flyoutPresent = appEl.querySelector(`[data-flyout="${flyoutKey}"]`) instanceof HTMLElement;
    return flyoutPresent === (currentRoute[flyoutKey] === true);
  });
};

const shouldUseIncrementalGameShell = (gameId = currentRoute.gameId) => {
  if (currentRoute.name !== "game" || !routeHydrated || !gameId) {
    return false;
  }
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return false;
  }
  return !getActiveApprovalRequest(game) && doesMountedFlyoutStateMatchRoute();
};

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  if (!routeHydrated) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Synchronizing current game state.</p></section>`;
  }

  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Fetching latest server state.</p></section>`;
  }
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(
    game.inviteToken || inviteToken || game.id,
    getCurrentFlyoutState(),
  )}`;

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
            <a class="button-link secondary" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">Back home</a>
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
    <a class="button-link" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">Return home</a>
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
  const scenarioSelectionHydration = resolvePendingScenarioHydration({
    game,
    snapshot,
    legalActions: effectiveLegalActions,
  });
  if (!snapshot) {
    return;
  }

  const snapshotKey = toStableKey(snapshot);
  const legalActionsKey = toStableKey(effectiveLegalActions);
  const forceClickTargetSelection = currentRoute.scenarios;
  const overlayKey = toStableKey({
    overlayMode,
    recordedAction: historySelectionAction,
    selectionAction: scenarioSelectionHydration.selectionAction,
    selectionState: scenarioSelectionHydration.selectionState,
    forceClickTargetSelection,
  });

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
        getForceClickTargetSelection: () => forceClickTargetSelection,
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
    boardRuntime.syncInteractionCapabilities?.();
    void boardRuntime.loadSnapshot(snapshot, {
      legalActions: effectiveLegalActions,
      resetSelection: true,
      selectionAction: scenarioSelectionHydration.selectionAction,
      selectionState: scenarioSelectionHydration.selectionState,
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
  boardRuntime.syncInteractionCapabilities?.();
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
    selectionAction: scenarioSelectionHydration.selectionAction,
    selectionState: scenarioSelectionHydration.selectionState,
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

const animateHomeSectionTransitions = () => {
  if (!(appEl instanceof HTMLElement) || prefersReducedMotion()) {
    return;
  }
  for (const sectionKey of getVisibleHomeSectionKeys()) {
    const section = getHomeSection(sectionKey);
    if (!section.animationToken || lastAnimatedHomeSectionTokenByKey.get(sectionKey) === section.animationToken) {
      continue;
    }
    const trackEl = appEl.querySelector(`[data-home-carousel-track="${sectionKey}"]`);
    if (!(trackEl instanceof HTMLElement)) {
      continue;
    }
    lastAnimatedHomeSectionTokenByKey.set(sectionKey, section.animationToken);
    const offsetPx = section.slideDirection === "prev" ? -56 : 56;
    trackEl.animate(
      [
        { transform: `translateX(${offsetPx}px)`, opacity: 0.35 },
        { transform: "translateX(0px)", opacity: 1 },
      ],
      {
        duration: HOME_CAROUSEL_MOTION_MS,
        easing: "cubic-bezier(0.2, 0.72, 0.2, 1)",
      },
    );
  }
};

const loadHomeSectionPage = async (sectionKey, { page = getHomeSection(sectionKey).page, direction = "none" } = {}) => {
  const previous = getHomeSection(sectionKey);
  const response = await transport.loadGamesPage({
    section: sectionKey,
    page,
    pageSize: HOME_SECTION_PAGE_SIZE,
    debug: currentRoute.debug === true,
  });
  const normalizedPage = typeof response.page === "number" ? response.page : 0;
  const normalizedTotalPages = typeof response.totalPages === "number" ? response.totalPages : 0;
  const nextDirection = normalizedTotalPages > 1 && normalizedPage !== previous.page ? direction : "none";
  setHomeSection(sectionKey, {
    ...previous,
    page: normalizedPage,
    totalPages: normalizedTotalPages,
    totalGames: typeof response.totalGames === "number" ? response.totalGames : 0,
    gameIds: Array.isArray(response.games) ? response.games.map((game) => game.id) : [],
    slideDirection: nextDirection,
    animationToken: nextDirection === "none" ? previous.animationToken : previous.animationToken + 1,
  });
};

const syncHomeSections = async () => {
  const visibleSectionKeys = getVisibleHomeSectionKeys();
  await Promise.all(
    visibleSectionKeys.map(async (sectionKey) => {
      const section = getHomeSection(sectionKey);
      await loadHomeSectionPage(sectionKey, { page: section.page, direction: "none" });
    }),
  );
  const hiddenSectionKeys = ["my", "other", "smoke"].filter((sectionKey) => !visibleSectionKeys.includes(sectionKey));
  hiddenSectionKeys.forEach((sectionKey) => {
    const section = getHomeSection(sectionKey);
    setHomeSection(sectionKey, {
      ...section,
      page: 0,
      totalPages: 0,
      totalGames: 0,
      gameIds: [],
      slideDirection: "none",
    });
  });
};

const render = ({ animatePanels = true, includeBoard = true } = {}) => {
  const routeKey = getRouteRenderKey();
  const baseRouteKey = getBaseRouteRenderKey();
  const shouldPatchFlyoutsOnly = shouldPatchMountedFlyouts(routeKey, baseRouteKey);
  const previousPanelHeights = animatePanels && !shouldPatchFlyoutsOnly ? capturePanelHeights() : [];
  const previousFlyoutRects = animatePanels ? captureFlyoutRects() : new Map();
  syncShellLayoutMode();
  if (shouldPatchFlyoutsOnly) {
    updateMountedHeader();
    updateMountedFlyouts();
    syncFlyoutAwareLinks();
    syncCopyInviteLinks();
    updateHeaderFields();
    reconcileMiniBoardPreviews();
    animateHomeSectionTransitions();
    syncScenarioAuthoringControls();
    if (animatePanels) {
      animateFlyoutPositionChanges(previousFlyoutRects);
    }
    scheduleGameShellStickyLayout();
    syncRenderedMarkupSnapshot();
    return;
  }
  const mountedGameShell = getMountedGameShellRoot();
  if (
    shouldUseIncrementalGameShell() &&
    mountedGameShell?.getAttribute("data-game-id") === currentRoute.gameId
  ) {
    updateMountedHeader();
    updateHeaderFields();
    syncScenarioAuthoringControls();
    updateMountedGameShell({
      game: transport.getGameViewModel(currentRoute.gameId),
      inviteFromRole: currentRoute.inviteFromRole,
      includeBoard,
    });
    return;
  }

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

  const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">${renderHeader()}${body}</div>${renderFlyouts()}</div>`;
  if (nextMarkup !== lastRenderedMarkup) {
    appEl.innerHTML = nextMarkup;
    lastRenderedMarkup = nextMarkup;
    lastRenderedMainMarkup = `<div class="shell-main-content">${renderHeader()}${body}</div>`;
    lastRenderedFlyoutMarkup = renderFlyouts();
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
    if (animatePanels) {
      animatePanelHeightChanges(previousPanelHeights);
      animateFlyoutPositionChanges(previousFlyoutRects);
    }
  }
  if (nextMarkup === lastRenderedMarkup) {
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
  }
  syncFlyoutAwareLinks();
  syncCopyInviteLinks();
  updateHeaderFields();
  reconcileMiniBoardPreviews();
  animateHomeSectionTransitions();
  syncScenarioAuthoringControls();
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
    await syncHomeSections();
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

const syncRouteDataAndLiveChannels = async () => {
  await syncRouteData();
  syncLiveChannels();
};

const syncRouteDataPassive = async () => {
  if (busy) {
    return;
  }
  try {
    await syncRouteDataAndLiveChannels();
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

const syncLiveChannels = () => {
  if (shouldDisableLiveSync()) {
    liveSync.disconnectAll();
    activeLiveGameIds.clear();
    resetRouteWsStatus();
    return;
  }
  const routeGameId =
    shouldLiveSyncRoute(currentRoute) &&
    (currentRoute.name === "game"
      ? currentRoute.gameId
      : currentRoute.name === "invite"
        ? resolvedInvite?.gameId || null
        : null);
  const desiredGameIds = new Set(routeGameId ? [routeGameId] : getHomeActiveGameIds());
  for (const gameId of [...activeLiveGameIds]) {
    if (!desiredGameIds.has(gameId)) {
      liveSync.disconnectGame(gameId);
      activeLiveGameIds.delete(gameId);
    }
  }
  for (const gameId of desiredGameIds) {
    if (!activeLiveGameIds.has(gameId)) {
      liveSync.connectGame(gameId);
      activeLiveGameIds.add(gameId);
    }
  }
  if (!routeGameId) {
    resetRouteWsStatus();
  }
};

const liveSync = createLiveSyncClient({
  identityId: transport.getIdentityId(),
  getLastEventSeq: (gameId) => (gameId ? transport.getLastEventSeq(gameId) : 0),
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
    const routeGameId = getCurrentViewedGameId();
    if (!routeGameId || status.gameId !== routeGameId || !shouldLiveSyncRoute(currentRoute)) {
      return;
    }
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

const navigateTo = (hash) => {
  const parsedRoute = parseRouteFromHash(hash);
  const preferredFlyoutKey = FLYOUT_KEYS.find((key) => parsedRoute[key] && !currentRoute[key]) ?? null;
  const nextRoute = normalizeRouteFlyoutState(parsedRoute, { preferredFlyoutKey });
  const nextHash = buildHashForRoute(nextRoute);
  const previousRoute = currentRoute;
  if (window.location.hash === nextHash) {
    currentRoute = nextRoute;
    syncFlyoutRenderOrder(currentRoute);
    if (isFlyoutOnlyRouteChange(previousRoute, nextRoute)) {
      if (currentRoute.name === "home" && previousRoute.debug !== currentRoute.debug) {
        routeHydrated = false;
        void withBusy(async () => {
          await syncRouteDataAndLiveChannels();
        }, { renderStart: false, renderEnd: true });
        return;
      }
      render();
      return;
    }
    routeHydrated = false;
    syncLiveChannels();
    void withBusy(async () => {
      await syncRouteDataAndLiveChannels();
    });
    return;
  }
  window.location.hash = nextHash;
};

window.addEventListener("hashchange", () => {
  const previousRoute = currentRoute;
  const parsedRoute = parseRouteFromHash(window.location.hash);
  currentRoute = normalizeRouteFlyoutState(parsedRoute);
  const normalizedHash = buildHashForRoute(currentRoute);
  if (window.location.hash !== normalizedHash) {
    window.location.hash = normalizedHash;
    return;
  }
  syncFlyoutRenderOrder(currentRoute);
  if (isFlyoutOnlyRouteChange(previousRoute, currentRoute)) {
    if (currentRoute.name === "home" && previousRoute.debug !== currentRoute.debug) {
      routeHydrated = false;
      void withBusy(async () => {
        await syncRouteDataAndLiveChannels();
      }, { renderStart: false, renderEnd: true });
      return;
    }
    render();
    return;
  }
  routeHydrated = false;
  syncLiveChannels();
  void withBusy(async () => {
    await syncRouteDataAndLiveChannels();
  });
});

window.addEventListener("online", () => {
  void withBusy(async () => {
    await transport.setOffline(false);
    syncLiveChannels();
    await syncRouteDataAndLiveChannels();
  });
});

window.addEventListener("offline", () => {
  void withBusy(async () => {
    await transport.setOffline(true);
    liveSync.disconnectAll();
    activeLiveGameIds.clear();
    resetRouteWsStatus();
    await syncRouteDataAndLiveChannels();
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
    action !== "tutorial-skip" &&
    action !== "open-debug" &&
    action !== "open-scenarios" &&
    action !== "close-debug" &&
    action !== "close-scenarios";

  const animateFlyoutClose = async (flyoutKey, closeFlyout) => {
    const flyoutEl = appEl?.querySelector?.(`[data-flyout="${flyoutKey}"]`);
    const mainContentEl = appEl?.querySelector?.(".shell-main-content");
    const layoutMode = getShellLayoutMode();
    if (flyoutEl instanceof HTMLElement && !prefersReducedMotion()) {
      if (layoutMode === "wide") {
        const nextFlyoutCount = Math.max(0, getOpenFlyoutCount() - 1);
        const currentAppPaddingRight = window.getComputedStyle(appEl).paddingRight;
        const nextAppPaddingRight = getWideShellPaddingRightPx(nextFlyoutCount);
        if (appEl instanceof HTMLElement) {
          appEl.style.transition = "none";
          appEl.style.paddingRight = currentAppPaddingRight;
        }
        if (mainContentEl instanceof HTMLElement) {
          const currentMainWidth = mainContentEl.getBoundingClientRect().width;
          mainContentEl.style.transition = "none";
          mainContentEl.style.width = `${currentMainWidth}px`;
          mainContentEl.style.maxWidth = `${currentMainWidth}px`;
        }
        flyoutEl.style.transition = "none";
        flyoutEl.style.width = `${flyoutEl.getBoundingClientRect().width}px`;
        flyoutEl.style.maxWidth = `${flyoutEl.getBoundingClientRect().width}px`;
        void flyoutEl.offsetHeight;
        if (appEl instanceof HTMLElement) {
          appEl.style.transition = `padding-right ${FLYOUT_MOTION_MS}ms ease`;
          appEl.style.paddingRight = nextAppPaddingRight > 0 ? `${nextAppPaddingRight}px` : "0px";
        }
        if (mainContentEl instanceof HTMLElement) {
          const nextMainWidth = getWideMainContentWidthPx(nextFlyoutCount);
          mainContentEl.style.transition = `width ${FLYOUT_MOTION_MS}ms ease, max-width ${FLYOUT_MOTION_MS}ms ease`;
          mainContentEl.style.width = `${nextMainWidth}px`;
          mainContentEl.style.maxWidth = `${nextMainWidth}px`;
        }
        flyoutEl.style.transition = `transform ${FLYOUT_MOTION_MS}ms ease, opacity ${FLYOUT_MOTION_MS}ms ease, width ${FLYOUT_MOTION_MS}ms ease, max-width ${FLYOUT_MOTION_MS}ms ease`;
        flyoutEl.classList.add("is-closing");
        flyoutEl.style.width = "0px";
        flyoutEl.style.maxWidth = "0px";
      } else {
        flyoutEl.style.transition = "none";
        flyoutEl.style.height = `${flyoutEl.getBoundingClientRect().height}px`;
        flyoutEl.style.maxHeight = `${flyoutEl.getBoundingClientRect().height}px`;
        void flyoutEl.offsetHeight;
        flyoutEl.style.transition = `transform ${FLYOUT_MOTION_MS}ms ease, opacity ${FLYOUT_MOTION_MS}ms ease, height ${FLYOUT_MOTION_MS}ms ease, max-height ${FLYOUT_MOTION_MS}ms ease`;
        flyoutEl.classList.add("is-closing");
        flyoutEl.style.height = "0px";
        flyoutEl.style.maxHeight = "0px";
      }
      await delay(FLYOUT_MOTION_MS);
    }
    setFlyoutOpenState(flyoutKey, false);
    closeFlyout();
    window.setTimeout(() => {
      clearCoordinatedFlyoutMotionStyles();
    }, 0);
  };

  await withBusy(async () => {
    if (action === "open-debug") {
      if (!currentRoute.debug) {
        saveDebugFlyoutOpen(storage, true);
        setFlyoutOpenState("debug", true);
        currentRoute = normalizeRouteFlyoutState({ ...currentRoute, debug: true }, { preferredFlyoutKey: "debug" });
        if (currentRoute.name === "home") {
          await syncRouteDataAndLiveChannels();
        }
        render();
      }
      return;
    }
    if (action === "open-scenarios") {
      if (!currentRoute.scenarios) {
        setFlyoutOpenState("scenarios", true);
        navigateTo(toggleScenariosHash(window.location.hash));
      }
      return;
    }
    if (action === "close-debug") {
      if (currentRoute.debug) {
        await animateFlyoutClose("debug", () => {
          saveDebugFlyoutOpen(storage, false);
          currentRoute = normalizeRouteFlyoutState({ ...currentRoute, debug: false });
        });
        if (currentRoute.name === "home") {
          await syncRouteDataAndLiveChannels();
        }
        render();
      }
      return;
    }
    if (action === "close-scenarios") {
      if (currentRoute.scenarios) {
        await animateFlyoutClose("scenarios", () => {
          navigateTo(toggleScenariosHash(window.location.hash));
        });
      }
      return;
    }

    if (action === "create-game") {
      const game = await transport.createGame({ playgroundMode: false, offlineLocal: false });
      navigateTo(buildGameHash(game.id, null, getCurrentFlyoutState()));
      return;
    }

    if (action === "home-page-prev" || action === "home-page-next") {
      const sectionKey = actionEl.getAttribute("data-home-section");
      const section = getHomeSection(sectionKey);
      if (!sectionKey || section.totalPages <= 1) {
        return;
      }
      const delta = action === "home-page-prev" ? -1 : 1;
      const nextPage = (section.page + delta + section.totalPages) % section.totalPages;
      await loadHomeSectionPage(sectionKey, {
        page: nextPage,
        direction: action === "home-page-prev" ? "prev" : "next",
      });
      syncLiveChannels();
      render({ animatePanels: false, includeBoard: false });
      window.requestAnimationFrame(() => {
        scrollHomeSectionToTop(sectionKey);
      });
      return;
    }

    if (action === "create-offline-playground") {
      await transport.setOffline(true);
      const game = await transport.createGame({ playgroundMode: true, offlineLocal: true });
      navigateTo(buildGameHash(game.id, "offline", getCurrentFlyoutState()));
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
      await syncRouteDataAndLiveChannels();
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
        navigateTo(buildGameHash(gameId, null, getCurrentFlyoutState()));
        return;
      }
      await syncRouteDataAndLiveChannels();
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
        navigateTo(buildGameHash(gameId, null, getCurrentFlyoutState()));
        return;
      }
      await syncRouteDataAndLiveChannels();
      return;
    }

    if (action === "play-as-both-players") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.playAsBothPlayers({ gameId });
      await syncRouteDataAndLiveChannels();
      return;
    }

    if (action === "approve-request" || action === "accept-request") {
      const gameId = actionEl.getAttribute("data-game-id");
      const requester = actionEl.getAttribute("data-requester-id");
      if (!gameId || !requester) return;
      ignoredApprovalRequests.delete(getApprovalRequestKey(gameId, requester));
      await transport.approvePendingRequest({ gameId, requesterIdentityId: requester });
      await syncRouteDataAndLiveChannels();
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
      await syncRouteDataAndLiveChannels();
      return;
    }

    if (action === "return-live") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      clearHistoryPress();
      playHistoryReleaseBounce(actionEl);
      await animateHistoryDeselection(actionEl);
      await transport.returnToLive({ gameId });
      await syncRouteDataAndLiveChannels();
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
      navigateTo(gameId ? buildGameHash(gameId, null, getCurrentFlyoutState()) : buildHomeHash(getCurrentFlyoutState()));
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
      const nextHash = buildGameHash(result.game.id, null, {
        ...getCurrentFlyoutState(),
        scenarios: false,
      });
      if (activeGame && !shouldApplyInPlace) {
        window.open(`${window.location.pathname}${window.location.search}${nextHash}`, "_blank", "noopener");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      navigateTo(nextHash);
      return;
    }

    if (action === "update-scenario" || action === "save-scenario") {
      const activeGameId =
        currentRoute.name === "game" ? currentRoute.gameId : currentRoute.name === "invite" ? resolvedInvite?.gameId || null : null;
      const activeGame = activeGameId ? transport.getGameViewModel(activeGameId) : null;
      if (!activeGame) {
        setScenarioFeedback(`Open a game to ${action === "update-scenario" ? "update" : "save"} a scenario.`);
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      if (!canAuthorScenariosLocally()) {
        setScenarioFeedback("Scenario authoring is only available on localhost.");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const exportContext = getScenarioExportContext(activeGame);
      if (action === "update-scenario") {
        const selectedScenario = getSelectedScenario();
        if (!selectedScenario) {
          setScenarioFeedback("No scenario selected.");
          render({ animatePanels: false, includeBoard: false });
          return;
        }
        const title = getScenarioEditableFieldText("title");
        const description = getScenarioEditableFieldText("description");
        if (!title || !description) {
          setScenarioFeedback("Scenario title and description are required.");
          syncScenarioAuthoringControls();
          return;
        }
        const scenario = await buildScenarioFromGame(activeGame, {
          scenarioId: selectedScenario.id,
          title,
          description,
          moveLimit: exportContext.moveLimit,
          resultingStateOverride: exportContext.currentSnapshot,
          savedSelection: exportContext.savedSelection,
        });
        scenario.incorrect = selectedScenario.incorrect === true;
        const localWrite = await tryLocalScenarioWrite("/scenarios/update", { scenario });
        if (!localWrite.ok) {
          setScenarioFeedback("Failed to update scenario locally.");
          render({ animatePanels: false, includeBoard: false });
          return;
        }
        scenarioCatalog = localWrite.body?.catalog ?? {
          ...scenarioCatalog,
          scenarios: scenarioCatalog.scenarios.map((entry) => (entry.id === scenario.id ? scenario : entry)),
        };
        selectedScenarioId = scenario.id;
        setScenarioFeedback(`Scenario ${scenario.id} updated.`);
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const draft = getSaveScenarioDraft();
      if (!draft.title || !draft.description) {
        setScenarioFeedback("Scenario title and description are required.");
        syncScenarioAuthoringControls();
        return;
      }
      const scenario = await buildScenarioFromGame(activeGame, {
        scenarioId: crypto.randomUUID(),
        title: draft.title,
        description: draft.description,
        moveLimit: exportContext.moveLimit,
        resultingStateOverride: exportContext.currentSnapshot,
        savedSelection: exportContext.savedSelection,
      });
      const localWrite = await tryLocalScenarioWrite("/scenarios/save", { scenario });
      if (!localWrite.ok) {
        setScenarioFeedback("Failed to save scenario locally.");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      scenarioCatalog = localWrite.body?.catalog ?? {
        ...scenarioCatalog,
        scenarios: [...scenarioCatalog.scenarios, scenario],
      };
      selectedScenarioId = scenario.id;
      saveScenarioDraftTitle = "";
      saveScenarioDraftDescription = "";
      setScenarioFeedback(`Scenario ${scenario.id} saved.`);
      render({ animatePanels: false, includeBoard: false });
    }
  }, { renderStart: shouldRenderBusyState, renderEnd: shouldRenderBusyState });
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

appEl.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.getAttribute("data-scenario-save-field") === "title") {
    saveScenarioDraftTitle = target.value;
    syncScenarioAuthoringControls();
    return;
  }
  if (target instanceof HTMLTextAreaElement && target.getAttribute("data-scenario-save-field") === "description") {
    saveScenarioDraftDescription = target.value;
    syncScenarioAuthoringControls();
    return;
  }
  if (target instanceof HTMLElement && target.hasAttribute("data-scenario-editable")) {
    syncScenarioAuthoringControls();
  }
});

appEl.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const controlEl = target.closest("button, .button-link, .mini-board-card-link-surface");
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
  syncLiveChannels();
  await withBusy(async () => {
    await syncScenarioCatalog();
    await syncRouteDataAndLiveChannels();
  });
};

void initialRender();
