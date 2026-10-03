import { createModal } from "./modal.js";
import { createOpponentStoryDialog, shouldShowOpponentIntroduction, cancelAbandonedOpponentTutorial, createOpponentStartCoordinator } from "./opponent-stories.js";
import { PERSONAL_OPPONENTS, isPersonalSide, isComputerOpponent, getComputerReadiness, selectResumeGames, isAwaitingPlayer, captureHomeFocus, restoreHomeFocus } from "./personal-home.js";
import { createContextualHelp, gamePlayRevision, canRestoreGameView } from "./play-view.js";
import { captureHeaderFocus, restoreHeaderFocus } from "./header-focus.js";
import { createBrandController, renderWordmark, resolveActionAffiliation } from "./brand.js";
import { createRenderGestureGate, preserveBoardFocus } from './render-gesture.js';
import { participantButton, participantName, createPublicProfileDialog } from './public-profile.js';
import { createAccountController, safeAccountIntent } from './account-controller.js';
import { createAccountDialog } from './account-dialog.js';
import { recoveryMessage, sharedMutationActions } from "./recovery-view.js";
import { assertGameBoardAdapter } from "../board-adapter-contract.js";
import { createEngineBoardAdapter, createInitialBoardSnapshot } from "../board-adapters/engine-board-adapter.js";
import { createMiniBoardPreview, syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createShellBoardHost } from "../board/hosts/shell-host.js";
import { getBootstrapPayload } from "./bootstrap.js";
import { createSyncStore } from "./sync-store.js";
import { ensureHoverCapabilityController } from "../hover-capability.js";
import { applyCommandLegendSwatch, getCommandLegendSwatchStyle } from "../legend.js";
import { loadDebugFlyoutOpen, saveDebugFlyoutOpen, saveTutorialCompleted } from "./persistence.js";
import {
  buildHistoryBranchSeedFromGame,
  buildScenarioFromGame,
  canAuthorScenariosLocally,
  loadScenarioCatalog,
  resolveHistoryScenarioExportContext,
  tryLocalScenarioWrite,
} from "./scenarios.js";
import { buildStaticGameCardFromScenario } from "./static-game-cards.js";
import { buildDestroyedPieceOverlays, findRecordedActionStartPiece } from "./history-preview.js";
import { resolveInitialSelectionHydration } from "./selection-hydration.js";
import { shouldResetBoardSelection, shouldSkipBoardRuntimeReload } from "./runtime-sync.js";
import { buildScenarioStaticPreviewModel } from "./static-preview-model.js";
import {
  DEFAULT_GAME_PANEL,
  FLYOUT_KEYS,
  GAME_PANEL_KEYS,
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
const dismissedRecoveryNotices = new Map();
// This node survives header/panel rendering, including repeated heartbeat snapshots.
const syncAnnouncement = document.createElement("div");
syncAnnouncement.id = "shell-sync-announcement";
syncAnnouncement.className = "sr-only";
syncAnnouncement.setAttribute("role", "status");
syncAnnouncement.setAttribute("aria-live", "polite");
syncAnnouncement.setAttribute("aria-atomic", "true");
document.body.appendChild(syncAnnouncement);
const updateRecoveryAnnouncement = (game) => {
  const failures = game ? [...new Set((transport.getFailedOperations?.(game.id) ?? []).map((operation) => operation.error?.message).filter(Boolean))] : [];
  const text = game ? [recoveryMessage(game), game.historyNotice, ...failures].filter(Boolean).join(" ") : "";
  if (syncAnnouncement.textContent !== text) syncAnnouncement.textContent = text;
};
const applySharedMutationGates = (game) => {
  if (!game) return;
  document.querySelectorAll("[data-action]").forEach((element) => {
    if (!sharedMutationActions.has(element.getAttribute("data-action"))) return;
    if (element.getAttribute("data-game-id") && element.getAttribute("data-game-id") !== game.id) return;
    if (game.sharedMutationsBlocked) {
      if (!element.hasAttribute("data-sync-disabled")) element.setAttribute("data-sync-disabled", String(element.hasAttribute("disabled")));
      element.setAttribute("aria-disabled", "true");
      if (element instanceof HTMLButtonElement) element.disabled = true;
    } else if (element.hasAttribute("data-sync-disabled")) {
      if (element instanceof HTMLButtonElement && element.getAttribute("data-sync-disabled") === "false") element.disabled = false;
      element.removeAttribute("data-sync-disabled");
      element.removeAttribute("aria-disabled");
    }
  });
};
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

const ensureRouteTransitionLayer = () => {
  let layerEl = document.getElementById("shell-route-transition-layer");
  if (layerEl instanceof HTMLElement) {
    return layerEl;
  }
  layerEl = document.createElement("div");
  layerEl.id = "shell-route-transition-layer";
  layerEl.className = "shell-route-transition-layer";
  layerEl.setAttribute("data-active", "false");
  layerEl.setAttribute("data-transition", "none");
  layerEl.setAttribute("data-phase", "idle");
  layerEl.setAttribute("aria-hidden", "true");
  layerEl.innerHTML = '<div class="shell-route-transition-layer-backdrop"></div><div class="shell-route-transition-layer-swipe"></div>';
  document.body.append(layerEl);
  return layerEl;
};

ensureShellStylesheet();
const routeTransitionLayerEl = ensureRouteTransitionLayer();
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

const storage = (() => { try { return window.localStorage || createMemoryStorageFallback(); } catch { return createMemoryStorageFallback(); } })();
const publicProfileDialog = createPublicProfileDialog();
let accountInitialized = false;
let accountStartupError = "";
const account = createAccountController({ storage,
  onTransition: (next, source) => { if (accountInitialized) { accountDialog.onTransition(source); resetAccountTransport(next); } },
  onChange: () => { document.documentElement.dataset.viewPreference = account.snapshot().session.account?.preferences?.view || "focused"; if (account.snapshot().ready) accountStartupError = ""; if (accountInitialized) { syncAccountViewPreference(); accountDialog.refreshSession(); render({ animatePanels: false, includeBoard: false }); } },
});
const accountDialog = createAccountDialog({ controller: account, onTutorial: () => { tutorial.reset(); navigateTo(buildTutorialHash()); }, getSiteKey: () => account.snapshot().siteKey,
  onComplete: async intent => {
    const generation = account.snapshot().generation;
    const hash = window.location.hash;
    // A typed start needs account authority, not unrelated home-list data.
    // Admit it synchronously through the current account's transport.
    if (intent?.action === "start-opponent") {
      const start = safeAccountIntent(intent);
      if (!start || !account.snapshot().ready || !account.canPlay() || start.hash !== hash) return;
      homeSide = start.side;
      startPersonalGame(start);
      return;
    }
    try { await syncRouteDataAndLiveChannels(); } catch { return; }
    if (generation !== account.snapshot().generation || hash !== window.location.hash) return;
    // This read has hydrated the current route even if the transport reset's
    // independent background read is still pending. Render the actual action.
    routeHydrated = true;
    render({ animatePanels: false });
    if (!intent || !account.canPlay() || intent.hash !== window.location.hash) return;
    const selector = `[data-action="${CSS.escape(intent.action)}"]${intent.gameId ? `[data-game-id="${CSS.escape(intent.gameId)}"]` : ""}${intent.moveIndex ? `[data-move-index="${CSS.escape(intent.moveIndex)}"]` : ""}`;
    appEl.querySelector(selector)?.click();
  },
});
const tutorial = createTutorialController({ steps: bootstrap.tutorialSteps });
const boardAdapter = createEngineBoardAdapter();
const hoverCapability = ensureHoverCapabilityController();
assertGameBoardAdapter(boardAdapter);
const liveSyncMetricCounts = Object.create(null);
window.__righeltLiveSyncMetrics = liveSyncMetricCounts;

const toStableKey = (value) => {
  if (value === null || typeof value === "undefined") {
    return "null";
  }
  return JSON.stringify(value);
};

let currentRoute = parseRouteFromHash(window.location.hash);
let homeSide = "p1";
let homeStartStatus = "";
let resumeRequestId = 0;
let resumeSection = { gameIds: [], page: 0, totalPages: 0, totalGames: 0, error: false };
const selfPlayStartSides = new Map();
const brandController = createBrandController();
let mountedBoardGameId = null;
let mountedHistoryMoveIndex = null;
let mountedSnapshotKey = null;
let mountedLegalActionsKey = null;
let mountedOverlayKey = null;
let mountedSyncStatusKey = null;
let boardRuntime = null;
const consumedInitialSelectionActionKeyByGameId = new Map();
let wsStatus = { state: "disconnected", gameId: null, reconnectAttempts: 0 };
let lastWsStatusKey = toStableKey(wsStatus);
let wsLastEvent = "none";
let inviteFeedback = "";
let inviteFeedbackTimer = null;
let undoRequestFeedback = "";
let undoRequestFeedbackGameId = null;
let undoRequestFeedbackTimer = null;
const alertStackRotationByGameId = new Map();
const seenUndoRequestOutcomeByGameId = new Map();
let routeHydrated = false;
let resolvedInvite = null;
let scenarioCatalog = { id: "S", title: "Saved Scenarios", scenarios: [] };
let selectedScenarioId = null;
let selectedScenarioFeedback = "";
let saveScenarioFeedback = "";
let saveScenarioDraftTitle = "";
let saveScenarioDraftDescription = "";
const inviteChoiceCommittedByGameId = new Set();
const ignoredApprovalRequests = new Set();
const ignoredRevertRequests = new Set();
const expandedUndoneGroups = new Set();
const pendingButtonKeys = new Set();
const pendingHomeSectionKeys = new Set();
let lastRenderedMarkup = "";
let lastRenderedMainMarkup = "";
let lastRenderedFlyoutMarkup = "";
let lastRenderedRouteKey = "";
let lastRenderedBaseRouteKey = "";
let lastRenderedTransitionPhaseKey = "idle";
let routeSyncRequestId = 0;
const HISTORY_SELECTION_EXIT_MS = 56;
const HISTORY_RELEASE_BOUNCE_MS = 140;
const GAME_ENTRY_ROUTE_TRANSITION_MS = 320;
const GAME_ENTRY_ROUTE_TRANSITION_COVER_MS = 160;
const GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS = 200;
const HOME_SECTION_SERVER_PAGE_SIZE = 4;
const HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT = 3;
const HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE = 4;
const HOME_SECTION_CARD_MIN_WIDTH_REM = 22;
const HOME_SECTION_CARD_GAP_REM = 0.85;
const HOME_CAROUSEL_MOTION_MS = 220;
let pressedHistoryActionEl = null;
let historyReleaseTimer = null;
let pressedControlEl = null;
let controlReleaseTimer = null;
let stickyLayoutFrame = 0;
let homeSectionResizeFrame = 0;
let activePanelSwipe = null;
let panelTransitionResetTimer = null;
let routeTransition = null;
let routeTransitionGeneration = 0;
let routeTransitionCoverTimer = null;
let routeTransitionRevealTimer = null;
let headerMenuOpen = false;
const helpByGame = new Map();
const savedGameViews = new Map();
let homeReturn = null;
let pendingViewRestore = null;
let navigationGeneration = 0;
const SHELL_WIDE_SCREEN_MIN_WIDTH = 901;
const SHELL_VIEWPORT_GUTTER_PX = 16;
const FLYOUT_MOTION_MS = 180;
const GAME_SHELL_PANEL_SWIPE_TRIGGER_PX = 72;
const GAME_SHELL_PANEL_SWIPE_INTENT_PX = 18;
const GAME_SHELL_PANEL_TRANSITION_MS = 220;
const miniBoardPreviewRegistry = new Map();
const renderedMiniBoardPreviewPayloads = new Map();
const lastAnimatedHomeSectionTokenByKey = new Map();
const createHomeSectionState = (title) => ({
  title,
  page: 0,
  totalPages: 0,
  totalGames: 0,
  gameIds: [],
  serverPage: 0,
  serverTotalPages: 0,
  serverPageGameIds: [],
  serverPageGameIdsByPage: {},
  visiblePageSize: HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,
  visibleColumnCount: 1,
  slideDirection: "none",
  animationToken: 0,
});
let homeSections = {
  my: createHomeSectionState("Completed games"),
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

const getJoinButtonKey = (mode, gameId) => `join:${mode}:${gameId}`;
const getPlayAsBothButtonKey = (gameId) => `play-as-both:${gameId}`;
const getApproveRequestButtonKey = (gameId, requesterIdentityId) => `approve-request:${gameId}:${requesterIdentityId}`;
const getCopyInviteButtonKey = (gameId) => `copy-invite:${gameId}`;
const SCENARIO_LOAD_PENDING_KEY = "scenario:load";
const SCENARIO_UPDATE_PENDING_KEY = "scenario:update";
const SCENARIO_SAVE_PENDING_KEY = "scenario:save";
const isButtonPending = (key) => Boolean(key) && pendingButtonKeys.has(key);
const isHomeSectionPending = (sectionKey) => Boolean(sectionKey) && pendingHomeSectionKeys.has(sectionKey);
const renderButtonStateAttributes = ({ className = "", pendingKey = null, disabled = false } = {}) => {
  const classes = className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (isButtonPending(pendingKey)) {
    classes.push("button-pending");
  }
  const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  const pendingAttr = isButtonPending(pendingKey) ? ' data-pending="true" aria-busy="true"' : "";
  const disabledAttr = disabled ? " disabled" : "";
  return `${classAttr}${pendingAttr}${disabledAttr}`;
};
const renderPendingStateAttributes = ({ className = "", pending = false, disabled = false } = {}) => {
  const classes = className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (pending) {
    classes.push("button-pending");
  }
  const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  const pendingAttr = pending ? ' data-pending="true" aria-busy="true"' : "";
  const disabledAttr = disabled ? " disabled" : "";
  return `${classAttr}${pendingAttr}${disabledAttr}`;
};

const formatStatus = (connected) =>
  connected ? '<span class="status-chip live">Connected</span>' : '<span class="status-chip disconnected">Disconnected</span>';
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
    return `<span class="mini-board-card-connection-item"><span>${renderSeatLabel(seat)} is open for someone to join</span>${renderConnectionStatusIcon(
      "open",
      statusLabel,
    )}</span>`;
  }
  const statusLabel = `${seat} is ${participant.connected ? "connected" : "not connected"}`;
  return `<span class="mini-board-card-connection-item"><span>${renderSeatLabel(seat)} is ${
    participant.connected ? "connected" : "not connected"
  }</span>${renderConnectionStatusIcon(participant.connected ? "connected" : "disconnected", statusLabel)}</span>`;
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

const getDocumentTitle = () => {
  const gameId = getCurrentViewedGameId();
  if (gameId) {
    return `${formatDisplayGameId(gameId)} | Righelt`;
  }
  return "Righelt";
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

const registerMiniBoardPreview = ({
  previewId,
  snapshot,
  selection = null,
  overlay = { mode: "none" },
  legalActions = [],
  selectedPieceId = null,
  selectedPieceMoves = [],
  selectedPieceMovePreviews = [],
  currentActionType = "pass",
  selectedPieceOverlayPhase = "actionPreviews",
  previewKey,
  sizeVariant = "compact",
}) => {
  renderedMiniBoardPreviewPayloads.set(previewId, {
    snapshot: snapshot ?? null,
    selection: selection ?? null,
    overlay,
    legalActions,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType,
    selectedPieceOverlayPhase,
    previewKey,
    sizeVariant,
  });
  return previewId;
};

const renderMiniBoardPreviewRoot = ({
  previewId,
  snapshot,
  selection = null,
  overlay = { mode: "none" },
  legalActions = [],
  selectedPieceId = null,
  selectedPieceMoves = [],
  selectedPieceMovePreviews = [],
  currentActionType = "pass",
  selectedPieceOverlayPhase = "actionPreviews",
  previewKey,
  sizeVariant = "compact",
}) => {
  const stablePreviewId = registerMiniBoardPreview({
    previewId,
    snapshot,
    selection,
    overlay,
    legalActions,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType,
    selectedPieceOverlayPhase,
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

const getStaticCardPreviewSnapshot = (card) => card?.previewSnapshot ?? null;
const getStaticCardPreviewSelection = (card) =>
  card?.previewSelection?.source
    ? {
        selectedPieceId: null,
        source: card.previewSelection.source,
        target: card.previewSelection.target ?? null,
      }
    : null;
const getStaticCardPreviewPayload = (card) => ({
  snapshot: getStaticCardPreviewSnapshot(card),
  selection: getStaticCardPreviewSelection(card),
  overlay: { mode: "none" },
  legalActions: [],
  selectedPieceId: null,
  selectedPieceMoves: [],
  selectedPieceMovePreviews: [],
  currentActionType: "pass",
  selectedPieceOverlayPhase: "actionPreviews",
});
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
    updateButtonEl.disabled = !canSubmitScenarioUpdate() || isButtonPending(SCENARIO_UPDATE_PENDING_KEY);
  }
  const saveButtonEl = appEl?.querySelector?.('[data-action="save-scenario"]');
  if (saveButtonEl instanceof HTMLButtonElement) {
    saveButtonEl.disabled = !canSubmitSaveScenarioDraft() || isButtonPending(SCENARIO_SAVE_PENDING_KEY);
  }
};
const getScenarioExportContext = (game) => {
  const historyExportContext = resolveHistoryScenarioExportContext(game);
  if (historyExportContext) {
    return historyExportContext;
  }
  const currentSnapshot = game?.currentSnapshot ?? game?.board?.state ?? null;
  const moveLimit = game?.moves?.length ?? 0;
  const savedSelection = buildSavedSelectionFromRuntimeSelection(boardRuntime?.getSelection?.() ?? null, currentSnapshot);
  return {
    currentSnapshot,
    moveLimit,
    savedSelection,
  };
};
const getActiveScenarioGame = () => {
  const activeGameId =
    currentRoute.name === "game" ? currentRoute.gameId : currentRoute.name === "invite" ? resolvedInvite?.gameId || null : null;
  return activeGameId ? transport.getGameViewModel(activeGameId) : null;
};
const replaceScenarioInCatalog = (scenario) => {
  scenarioCatalog = {
    ...scenarioCatalog,
    scenarios: scenarioCatalog.scenarios.map((entry) => (entry.id === scenario.id ? scenario : entry)),
  };
  selectedScenarioId = scenario.id;
};
const updateSelectedScenarioRecord = async ({
  activeGame,
  title,
  description,
  includeCurrentBoard = false,
  feedbackMessage = null,
} = {}) => {
  const selectedScenario = getSelectedScenario();
  if (!selectedScenario) {
    return { ok: false, reason: "no_selected_scenario" };
  }
  const nextTitle = String(title ?? "").trim();
  const nextDescription = String(description ?? "").trim();
  if (!nextTitle || !nextDescription) {
    return { ok: false, reason: "missing_metadata" };
  }

  const metadataChanged = nextTitle !== selectedScenario.title || nextDescription !== selectedScenario.description;
  const exportContext = includeCurrentBoard ? getScenarioExportContext(activeGame) : null;
  const scenario = includeCurrentBoard
    ? await buildScenarioFromGame(activeGame, {
        scenarioId: selectedScenario.id,
        title: nextTitle,
        description: nextDescription,
        moveLimit: exportContext.moveLimit,
        resultingStateOverride: exportContext.currentSnapshot,
        savedSelection: exportContext.savedSelection,
      })
    : {
        ...selectedScenario,
        title: nextTitle,
        description: nextDescription,
      };
  scenario.incorrect = selectedScenario.incorrect === true;

  if (!includeCurrentBoard && !metadataChanged) {
    return { ok: true, reason: "no_changes", scenario };
  }

  const localWrite = await tryLocalScenarioWrite("/scenarios/update", { scenario });
  if (!localWrite.ok) {
    return { ok: false, reason: "local_update_failed" };
  }
  if (localWrite.body?.catalog?.scenarios) {
    scenarioCatalog = localWrite.body.catalog;
    selectedScenarioId = scenario.id;
  } else {
    replaceScenarioInCatalog(scenario);
  }
  if (feedbackMessage) {
    setSelectedScenarioFeedback(feedbackMessage(scenario));
  }
  return { ok: true, reason: metadataChanged ? "updated" : "state_updated", scenario };
};
const resolvePendingScenarioHydration = ({ game, snapshot, legalActions }) => {
  const pendingSelection = game?.pendingScenarioSelection ?? null;
  const canControlBoard = Boolean(game?.canRecordMove || (game?.canEndTurn && game?.control === "turn-owner"));
  if (
    !pendingSelection ||
    game?.inHistoryMode ||
    !canControlBoard ||
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
const canControlLiveBoard = (game) => account.canPlay() && !game?.sharedMutationsBlocked && Boolean(game?.canRecordMove || (game?.canEndTurn && game?.control === "turn-owner"));
const getVisibleHomeSectionKeys = (route = currentRoute) => (route?.debug ? ["my", "other", "smoke"] : ["my", "other"]);
const getHomeSection = (sectionKey) => homeSections[sectionKey] ?? createHomeSectionState(sectionKey);
const setHomeSection = (sectionKey, nextState) => {
  homeSections = {
    ...homeSections,
    [sectionKey]: nextState,
  };
};
const getHomeSectionVisibleTotalPages = (totalGames, visiblePageSize) =>
  totalGames <= 0 ? 0 : Math.ceil(totalGames / visiblePageSize);
const getHomeSectionSafePage = (totalGames, visiblePageSize, page) => {
  const totalPages = getHomeSectionVisibleTotalPages(totalGames, visiblePageSize);
  return totalPages === 0 ? 0 : Math.min(Math.max(0, page), totalPages - 1);
};
const getHomeSectionVisibleRange = ({ totalGames, visiblePageSize, page }) => {
  const safePage = getHomeSectionSafePage(totalGames, visiblePageSize, page);
  const start = safePage * visiblePageSize;
  const end = Math.min(totalGames, start + visiblePageSize);
  return { safePage, start, end };
};
const getHomeSectionRequiredServerPages = ({ totalGames, visiblePageSize, page }) => {
  if (totalGames <= 0) {
    return [];
  }
  const { start, end } = getHomeSectionVisibleRange({ totalGames, visiblePageSize, page });
  if (end <= start) {
    return [];
  }
  const firstServerPage = Math.floor(start / HOME_SECTION_SERVER_PAGE_SIZE);
  const lastServerPage = Math.floor((end - 1) / HOME_SECTION_SERVER_PAGE_SIZE);
  return Array.from({ length: lastServerPage - firstServerPage + 1 }, (_, index) => firstServerPage + index);
};
const getHomeSectionServerPageGameIds = (section, serverPage) =>
  Array.isArray(section.serverPageGameIdsByPage?.[serverPage]) ? section.serverPageGameIdsByPage[serverPage] : [];
const hasHomeSectionServerPages = (section, serverPages) =>
  serverPages.every((serverPage) => Array.isArray(section.serverPageGameIdsByPage?.[serverPage]));
const getHomeSectionVisibleGameIdsFromCache = (section, { page = section.page, visiblePageSize = section.visiblePageSize } = {}) => {
  const { totalGames } = section;
  if (totalGames <= 0) {
    return [];
  }
  const requiredServerPages = getHomeSectionRequiredServerPages({ totalGames, visiblePageSize, page });
  if (!hasHomeSectionServerPages(section, requiredServerPages)) {
    return null;
  }
  const { start, end } = getHomeSectionVisibleRange({ totalGames, visiblePageSize, page });
  const visibleCount = Math.max(0, end - start);
  if (visibleCount === 0) {
    return [];
  }
  const serverStart = requiredServerPages[0] * HOME_SECTION_SERVER_PAGE_SIZE;
  const flattened = requiredServerPages.flatMap((serverPage) => getHomeSectionServerPageGameIds(section, serverPage));
  const offset = Math.max(0, start - serverStart);
  return flattened.slice(offset, offset + visibleCount);
};
const getHomeSectionCachedGameIndex = (section, gameId) => {
  if (!gameId) {
    return null;
  }
  const pageEntries = Object.entries(section.serverPageGameIdsByPage ?? {}).sort(([left], [right]) => Number(left) - Number(right));
  for (const [pageKey, ids] of pageEntries) {
    const offset = Array.isArray(ids) ? ids.indexOf(gameId) : -1;
    if (offset >= 0) {
      return (Number(pageKey) * HOME_SECTION_SERVER_PAGE_SIZE) + offset;
    }
  }
  return null;
};
const resetRouteWsStatus = () => {
  wsStatus = { state: "disconnected", gameId: null, reconnectAttempts: 0 };
  lastWsStatusKey = toStableKey(wsStatus);
};

const renderPlaceholderBadge = () => '<span class="status-chip disconnected">Not yet implemented</span>';
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
const getRouteTransitionRenderKey = () =>
  routeTransition ? `${routeTransition.type}:${routeTransition.fromRoute}:${routeTransition.toRoute}:${routeTransition.gameId}` : "none";
const getRouteTransitionPhaseKey = () => routeTransition?.phase || "idle";
const isGameEntryRouteTransitionActive = (route = currentRoute) =>
  routeTransition?.type === "game-entry" && route?.name === routeTransition.toRoute && (route?.name !== "game" || route?.gameId === routeTransition.gameId);
const syncRouteTransitionLayer = () => {
  if (!(routeTransitionLayerEl instanceof HTMLElement)) {
    return;
  }
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-transition-ms", `${GAME_ENTRY_ROUTE_TRANSITION_MS}ms`);
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-cover-ms", `${GAME_ENTRY_ROUTE_TRANSITION_COVER_MS}ms`);
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-reveal-ms", `${GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS}ms`);
  routeTransitionLayerEl.setAttribute("data-active", routeTransition ? "true" : "false");
  routeTransitionLayerEl.setAttribute("data-transition", routeTransition?.type || "none");
  routeTransitionLayerEl.setAttribute("data-phase", routeTransition?.phase || "idle");
  routeTransitionLayerEl.setAttribute("data-direction", routeTransition?.toRoute === "home" ? "back" : "forward");
};
const clearRouteTransitionTimers = () => {
  if (routeTransitionCoverTimer) {
    window.clearTimeout(routeTransitionCoverTimer);
    routeTransitionCoverTimer = null;
  }
  if (routeTransitionRevealTimer) {
    window.clearTimeout(routeTransitionRevealTimer);
    routeTransitionRevealTimer = null;
  }
};
const clearRouteTransition = ({ renderNow = true } = {}) => {
  clearRouteTransitionTimers();
  if (!routeTransition) {
    syncRouteTransitionLayer();
    return;
  }
  performance.mark(`route-cancel-${routeTransition.token}`);
  routeTransition = null;
  routeTransitionGeneration += 1;
  syncRouteTransitionLayer();
  if (renderNow) {
    render({ animatePanels: false, includeBoard: false });
  }
};
const finishRouteTransitionReveal = (gameId, token) => {
  if (!routeTransition || routeTransition.token !== token || routeTransition.gameId !== gameId || routeTransition.phase !== "revealing") {
    return;
  }
  performance.mark(`route-end-${routeTransition.token}`);
  routeTransition = null;
  syncRouteTransitionLayer();
  render({ animatePanels: false, includeBoard: false });
  restoreHomePosition();
};
const beginRouteTransitionReveal = (gameId) => {
  if (!routeTransition || routeTransition.gameId !== gameId || routeTransition.phase === "revealing") {
    return;
  }
  routeTransition.phase = "revealing";
  const token = routeTransition.token;
  performance.mark(`route-reveal-${token}`);
  syncRouteTransitionLayer();
  render({ animatePanels: false, includeBoard: false });
  if (routeTransitionRevealTimer) {
    window.clearTimeout(routeTransitionRevealTimer);
  }
  routeTransitionRevealTimer = window.setTimeout(() => {
    routeTransitionRevealTimer = null;
    finishRouteTransitionReveal(gameId, token);
  }, GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS);
};
const settleRouteTransitionCover = (gameId, token) => {
  if (!routeTransition || routeTransition.token !== token || routeTransition.gameId !== gameId || routeTransition.phase !== "covering") {
    return;
  }
  routeTransition.phase = "covered";
  performance.mark(`route-cover-${token}`);
  syncRouteTransitionLayer();
  if (isGameEntryRouteTransitionActive() && routeHydrated) {
    beginRouteTransitionReveal(gameId);
  } else {
    render({ animatePanels: false, includeBoard: false });
  }
};
const scheduleRouteTransitionCoverSettle = (gameId) => {
  if (routeTransitionCoverTimer) {
    window.clearTimeout(routeTransitionCoverTimer);
  }
  const token = routeTransition.token;
  routeTransitionCoverTimer = window.setTimeout(() => {
    routeTransitionCoverTimer = null;
    settleRouteTransitionCover(gameId, token);
  }, GAME_ENTRY_ROUTE_TRANSITION_COVER_MS);
};
const startGameEntryRouteTransition = (gameId, fromRoute = currentRoute?.name || "unknown", toRoute = "game") => {
  if (!gameId || prefersReducedMotion()) {
    clearRouteTransition({ renderNow: false });
    return;
  }
  clearRouteTransitionTimers();
  routeTransition = {
    type: "game-entry",
    fromRoute,
    toRoute,
    token: ++routeTransitionGeneration,
    gameId,
    phase: "covering",
  };
  syncRouteTransitionLayer();
  if (routeTransitionLayerEl instanceof HTMLElement) {
    routeTransitionLayerEl.classList.remove("is-running");
    void routeTransitionLayerEl.offsetHeight;
    routeTransitionLayerEl.classList.add("is-running");
  }
  performance.mark(`route-start-${routeTransition.token}`);
  scheduleRouteTransitionCoverSettle(gameId);
};
const syncRouteTransitionForCurrentRoute = () => {
  if (!routeTransition) {
    syncRouteTransitionLayer();
    return;
  }
  if (prefersReducedMotion() || !isGameEntryRouteTransitionActive(currentRoute)) {
    clearRouteTransition({ renderNow: false });
    return;
  }
  syncRouteTransitionLayer();
};
const maybeRevealRouteTransition = () => {
  if (!routeTransition && routeHydrated) restoreHomePosition();
  if (!routeTransition || !isGameEntryRouteTransitionActive(currentRoute) || !routeHydrated) {
    return;
  }
  if (routeTransition.phase === "covering") {
    return;
  }
  if (routeTransition.phase === "covered") {
    beginRouteTransitionReveal(routeTransition.gameId);
  }
};
const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
const normalizeGamePanel = (panel) => (GAME_PANEL_KEYS.includes(panel) ? panel : DEFAULT_GAME_PANEL);
const getGamePanel = (route = currentRoute) => (route?.name === "game" ? normalizeGamePanel(route.panel) : DEFAULT_GAME_PANEL);
const getGamePanelIndex = (panel = getGamePanel()) => Math.max(0, GAME_PANEL_KEYS.indexOf(normalizeGamePanel(panel)));
const getAdjacentGamePanel = (panel = getGamePanel(), direction = 0) => {
  const nextIndex = Math.min(Math.max(getGamePanelIndex(panel) + direction, 0), GAME_PANEL_KEYS.length - 1);
  return GAME_PANEL_KEYS[nextIndex];
};
const getCurrentFlyoutState = () => ({
  ...Object.fromEntries(FLYOUT_KEYS.map((key) => [key, currentRoute[key] === true])),
});
const getCurrentGameHashState = (panel = getGamePanel()) => ({
  ...getCurrentFlyoutState(),
  panel,
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
  `${getBaseRouteRenderKey(route)}|panel:${route?.name === "game" ? getGamePanel(route) : ""}|${FLYOUT_KEYS.map((key) => `${key}:${route?.[key] === true}`).join("|")}|transition:${getRouteTransitionRenderKey()}`;
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
const getRootFontSizePx = () => Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16") || 16;
const getHomeSectionCardMinWidthPx = () => getRootFontSizePx() * HOME_SECTION_CARD_MIN_WIDTH_REM;
const getHomeSectionCardGapPx = () => getRootFontSizePx() * HOME_SECTION_CARD_GAP_REM;
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
    panel: route.name === "game" ? normalizeGamePanel(route.panel) : route.panel,
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
const getHomeSectionWidthPx = (sectionKey) => {
  const carouselEl = appEl?.querySelector?.(`[data-home-carousel="${sectionKey}"]`);
  if (carouselEl instanceof HTMLElement) {
    return carouselEl.getBoundingClientRect().width;
  }
  const sectionEl = appEl?.querySelector?.(`[data-home-section-root="${sectionKey}"]`);
  if (sectionEl instanceof HTMLElement) {
    const styles = window.getComputedStyle(sectionEl);
    const paddingLeft = Number.parseFloat(styles.paddingLeft || "0") || 0;
    const paddingRight = Number.parseFloat(styles.paddingRight || "0") || 0;
    return Math.max(0, sectionEl.clientWidth - paddingLeft - paddingRight);
  }
  return getAvailableShellContentWidth();
};
const getHomeSectionColumnCount = (sectionKey) => {
  const sectionWidth = getHomeSectionWidthPx(sectionKey);
  const cardWidth = getHomeSectionCardMinWidthPx();
  const gapWidth = getHomeSectionCardGapPx();
  if (sectionWidth <= 0 || cardWidth <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor((sectionWidth + gapWidth) / (cardWidth + gapWidth)));
};
const getHomeSectionVisiblePageSize = (sectionKey) => {
  const columnCount = getHomeSectionColumnCount(sectionKey);
  if (columnCount >= 3) {
    return HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT;
  }
  if (columnCount === 2) {
    return HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE;
  }
  return HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT;
};
const isNarrowHeaderMode = () => getShellLayoutMode() === "narrow";
const closeHeaderMenu = () => {
  headerMenuOpen = false;
};
const syncNarrowHeaderMenuDom = () => {
  if (!isNarrowHeaderMode() || !(appEl instanceof HTMLElement)) {
    return;
  }
  const root = appEl.querySelector("[data-header-menu-root]");
  const panel = appEl.querySelector("[data-header-menu-panel]");
  const button = root?.querySelector?.('[data-action="toggle-header-menu"]');
  if (!(root instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(button instanceof HTMLElement)) {
    return;
  }

  const menuId = panel.id || "shell-header-menu";
  root.setAttribute("data-header-menu-open", headerMenuOpen ? "true" : "false");
  button.setAttribute("aria-expanded", headerMenuOpen ? "true" : "false");
  button.setAttribute("aria-label", headerMenuOpen ? "Close navigation menu" : "Open navigation menu");
  button.setAttribute("aria-controls", menuId);
  panel.setAttribute("aria-hidden", headerMenuOpen ? "false" : "true");

  panel.querySelectorAll("[data-header-menu-close='true']").forEach((itemEl) => {
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }
    itemEl.setAttribute("tabindex", headerMenuOpen ? "0" : "-1");
    const itemAction = itemEl.getAttribute("data-action") || "";
    if (itemAction === "open-scenarios" || itemAction === "close-scenarios") {
      const pressed = currentRoute.scenarios === true;
      itemEl.classList.toggle("is-active", pressed);
      itemEl.setAttribute("aria-pressed", pressed ? "true" : "false");
      itemEl.setAttribute("data-action", pressed ? "close-scenarios" : "open-scenarios");
    } else if (itemAction === "open-debug" || itemAction === "close-debug") {
      const pressed = currentRoute.debug === true;
      itemEl.classList.toggle("is-active", pressed);
      itemEl.setAttribute("aria-pressed", pressed ? "true" : "false");
      itemEl.setAttribute("data-action", pressed ? "close-debug" : "open-debug");
    }
  });

  if (headerMenuOpen) {
    if (!prefersReducedMotion()) {
      panel.classList.remove("is-open");
      void panel.offsetHeight;
      window.requestAnimationFrame(() => {
        const livePanel = appEl.querySelector("[data-header-menu-panel]");
        if (!(livePanel instanceof HTMLElement) || !headerMenuOpen) {
          syncRenderedMarkupSnapshot();
          return;
        }
        livePanel.classList.add("is-open");
        syncRenderedMarkupSnapshot();
      });
      return;
    }
    panel.classList.add("is-open");
  } else {
    panel.classList.remove("is-open");
  }
  syncRenderedMarkupSnapshot();
};
const renderHeaderWideActions = () => `
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
`;
const renderHeaderNarrowMenu = () => {
  const menuId = "shell-header-menu";
  return `
    <div class="shell-header-menu-root" data-header-menu-root data-header-menu-open="${headerMenuOpen ? "true" : "false"}">
      <button
        class="secondary shell-header-menu-button"
        type="button"
        data-action="toggle-header-menu"
        aria-expanded="${headerMenuOpen ? "true" : "false"}"
        aria-controls="${menuId}"
        aria-label="${headerMenuOpen ? "Close navigation menu" : "Open navigation menu"}"
      >
        <span class="shell-header-menu-icon" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
      <div
        class="shell-header-menu-panel${headerMenuOpen ? " is-open" : ""}"
        id="${menuId}"
        data-header-menu-panel
        aria-hidden="${headerMenuOpen ? "false" : "true"}"
      >
        <button
          class="secondary shell-header-menu-item${currentRoute.scenarios ? " is-active" : ""}"
          type="button"
          data-action="${currentRoute.scenarios ? "close-scenarios" : "open-scenarios"}"
          data-header-menu-close="true"
          aria-pressed="${currentRoute.scenarios ? "true" : "false"}"
          tabindex="${headerMenuOpen ? "0" : "-1"}"
        >Scenarios</button>
        <button
          class="secondary shell-header-menu-item${currentRoute.debug ? " is-active" : ""}"
          type="button"
          data-action="${currentRoute.debug ? "close-debug" : "open-debug"}"
          data-header-menu-close="true"
          aria-pressed="${currentRoute.debug ? "true" : "false"}"
          tabindex="${headerMenuOpen ? "0" : "-1"}"
        >Debug</button>
      </div>
    </div>
  `;
};
const renderHeaderAlertZone = () => {
  const viewedGameId = getCurrentViewedGameId();
  const viewedGame = viewedGameId ? transport.getGameViewModel(viewedGameId) : null;
  const gameAlerts = viewedGame ? renderGameAlertsHtml(viewedGame) : "";
  return `
    <div class="shell-header-status" data-shell-alert-zone="${gameAlerts ? "active" : "idle"}">
      <div id="shell-game-alerts">${gameAlerts}</div>
    </div>
  `;
};
const syncShellLayoutMode = () => {
  const layoutMode = getShellLayoutMode();
  if (layoutMode === "wide" && headerMenuOpen) {
    closeHeaderMenu();
  }
  if (appEl instanceof HTMLElement) {
    appEl.setAttribute("data-shell-layout-mode", layoutMode);
    appEl.setAttribute("data-shell-route", currentRoute?.name || "unknown");
    appEl.setAttribute("data-shell-transition", routeTransition?.type || "none");
    appEl.setAttribute("data-shell-transition-active", isGameEntryRouteTransitionActive() ? "true" : "false");
    appEl.setAttribute("data-shell-transition-phase", getRouteTransitionPhaseKey());
    const activeGamePanel = getGamePanel();
    appEl.setAttribute("data-shell-game-panel", activeGamePanel);
    appEl.style.setProperty("--shell-game-panel-index", String(getGamePanelIndex(activeGamePanel)));
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

  if (actionEl instanceof HTMLElement && (actionEl.classList.contains("history-item") || actionEl.classList.contains("history-destruction-item"))) {
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

  if (actionEl.classList.contains("history-item") || actionEl.classList.contains("history-destruction-item")) {
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

const clearActivePanelSwipe = () => {
  activePanelSwipe = null;
};

const shouldHandleGamePanelSwipe = (target) =>
  currentRoute.name === "game" &&
  getShellLayoutMode() === "narrow" &&
  target instanceof HTMLElement &&
  target.closest("[data-game-shell-root]") instanceof HTMLElement &&
  !target.closest(".shell-mobile-tabbar");

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
const getRevertRequestKey = (gameId, requestId) => `${gameId}:${requestId}`;

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

const getActiveRevertRequest = (game) => {
  const request = game?.approvableRevertRequest ?? null;
  if (!request || !request.requestId) {
    return null;
  }
  return ignoredRevertRequests.has(getRevertRequestKey(game.id, request.requestId)) ? null : request;
};

const getActivePendingRevertRequest = (game) => {
  const request = game?.myPendingRevertRequest ?? null;
  if (!request || !request.requestId) {
    return null;
  }
  return request;
};

const getFailedOperationsKey = (gameId) =>
  (transport.getFailedOperations?.(gameId) ?? [])
    .map((operation) => `${operation.id}:${operation.status}`)
    .join("|");

const renderGameAlertCard = ({ tone = "", body = "", action = "", testId = "" } = {}) => {
  const toneClass = tone ? ` ${tone}` : "";
  const testIdAttr = testId ? ` data-testid="${escapeHtml(testId)}"` : "";
  return `<div class="alert${toneClass} shell-game-alert${tone === "danger" ? " sync-failure-banner" : ""}"${testIdAttr}>
      <div class="shell-game-alert-copy${tone === "danger" ? " sync-failure-copy" : ""}">
        ${body}
      </div>
      ${action}
    </div>`;
};

const getGameAlertItems = (game) => {
  const failedOperations = transport.getFailedOperations?.(game.id) ?? [];
  maybeUpdateUndoRequestOutcomeFeedback(game);

  const items = failedOperations.map((operation) => ({
    key: `failed:${operation.id}`,
    html: renderGameAlertCard({
      tone: "danger",
      body: escapeHtml(operation.error?.message || "The operation could not be completed."),
      action: `<button class="secondary mini-button" data-action="dismiss-failed-operation" data-operation-id="${escapeHtml(operation.id)}">Dismiss</button>`,
      testId: "sync-failure-banner",
    }),
  }));

  const message = recoveryMessage(game);
  if (!message) dismissedRecoveryNotices.delete(game.id);
  const dismissed = dismissedRecoveryNotices.get(game.id) === message;
  if (message && (!dismissed || game.storageBlocked)) {
    items.unshift({
      key: `live-sync:${message}`,
      html: renderGameAlertCard({ tone: "warn", body: dismissed ? "Saving is paused." : escapeHtml(message), testId: "sync-recovery-banner",
        action: game.storageBlocked
          ? `<button class="secondary mini-button" data-action="retry-saving" data-game-id="${escapeHtml(game.id)}">Retry saving</button>${dismissed ? "" : `<button class="secondary mini-button" data-action="dismiss-recovery-notice" data-game-id="${escapeHtml(game.id)}">Dismiss</button>`}`
          : "",
      }),
    });
  }
  if (game.historyNotice) items.push({ key: "history-change", html: renderGameAlertCard({ body: escapeHtml(game.historyNotice) }) });

  if (undoRequestFeedback && undoRequestFeedbackGameId === game.id) {
    items.push({
      key: `undo:${game.id}:${undoRequestFeedback}`,
      html: renderGameAlertCard({
        body: escapeHtml(undoRequestFeedback),
      }),
    });
  }

  return items;
};

const getAlertStackRotation = (gameId, alertCount) => {
  if (!gameId || alertCount <= 1) {
    return 0;
  }
  return (alertStackRotationByGameId.get(gameId) ?? 0) % alertCount;
};

const advanceAlertStackRotation = (gameId, alertCount) => {
  if (!gameId || alertCount <= 1) {
    return false;
  }
  const nextRotation = ((alertStackRotationByGameId.get(gameId) ?? 0) + 1) % alertCount;
  alertStackRotationByGameId.set(gameId, nextRotation);
  return true;
};

const focusCurrentAlertStackCard = (gameId) => {
  if (!gameId) {
    return;
  }
  const focusedCard = appEl?.querySelector?.(
    `[data-action="cycle-game-alert-stack"][data-game-id="${gameId}"][tabindex="0"]`,
  );
  if (focusedCard instanceof HTMLElement) {
    focusedCard.focus({ preventScroll: true });
  }
};

const refreshMountedAlertHeader = (gameId = null, actionEl = null) => {
  const shouldRefocus = actionEl instanceof HTMLElement && actionEl.contains(document.activeElement);
  if (!updateMountedHeader()) {
    render({ animatePanels: false, includeBoard: false });
    return;
  }
  syncRenderedMarkupSnapshot();
  if (shouldRefocus && gameId) {
    focusCurrentAlertStackCard(gameId);
  }
};

const cycleGameAlertStack = (gameId, actionEl = null) => {
  const game = gameId ? transport.getGameViewModel(gameId) : null;
  if (!game) {
    return;
  }
  const alertCount = getGameAlertItems(game).length;
  if (!advanceAlertStackRotation(gameId, alertCount)) {
    return;
  }
  refreshMountedAlertHeader(gameId, actionEl);
};

const renderGameAlertStackCard = ({ gameId, item, stackIndex, totalAlerts }) => {
  const isActive = stackIndex === 0;
  const interactive = totalAlerts > 1 && stackIndex === 0;
  const ariaLabel = interactive
    ? `Show next notification. ${stackIndex + 1} of ${totalAlerts} is active.`
    : `Notification ${stackIndex + 1} of ${totalAlerts}.`;
  return `<div
      class="shell-game-alert-stack-card${isActive ? " is-active" : ""}${interactive ? " is-interactive" : ""}"
      data-alert-stack-card
      data-stack-index="${stackIndex}"
      data-stack-count="${totalAlerts}"
      ${interactive
        ? `data-action="cycle-game-alert-stack" data-game-id="${escapeHtml(gameId)}" tabindex="0"`
        : isActive
          ? 'tabindex="-1"'
          : 'aria-hidden="true" tabindex="-1"'}
      aria-label="${escapeHtml(ariaLabel)}"
    >
      ${item.html}
    </div>`;
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

  const moveRowsChronological = (Array.isArray(game.moves) ? game.moves : []).map((move) => {
    const isSelected = game.inHistoryMode ? game.historyIndex === move.index : selectedMoveIndex === move.index;
    const selectedClass = isSelected ? (game.inHistoryMode ? " is-selected" : " is-live-selected") : "";
    const undoneClass = move.undone === true ? " is-undone" : "";
    const branchButton = game.inHistoryMode && game.historyIndex === move.index && move.undone !== true
      ? `<button class="secondary mini-button history-branch-button" data-action="launch-history-branch" data-game-id="${escapeHtml(game.id)}" data-move-index="${escapeHtml(
          String(move.index),
        )}">Create new game at this move</button>`
      : "";
    const revertButton = game.inHistoryMode && game.historyIndex === move.index && move.undone !== true
      ? `<button class="secondary mini-button history-branch-button" data-action="revert-to-move" data-game-id="${escapeHtml(game.id)}" data-move-id="${escapeHtml(
          move.moveId || "",
        )}">Undo back to this move</button>`
      : "";
    const destroyedPieces = Array.isArray(move.destroyedPieces) ? move.destroyedPieces : [];
    const destructionSubBullets = destroyedPieces.length > 0
      ? `<ul class="history-destruction-list">${destroyedPieces.map((record) => {
          const ownerSideClass = playerToneClassForSide(record.ownerSeat === "p1" ? "P1" : record.ownerSeat === "p2" ? "P2" : "neutral");
          return `<li class="history-destruction-item ${ownerSideClass}${move.undone === true ? " is-undone" : ""}" data-testid="history-destruction-item"><span class="history-destruction-label">DESTROYED (${record.position.row},${record.position.col})</span></li>`;
        }).join("")}</ul>`
      : "";
    const actionSection = revertButton || branchButton
      ? `<div class="history-item-actions">${revertButton}${branchButton}</div>`
      : "";
    const sectionClass = actionSection ? " history-item-has-actions" : "";
    return {
      undone: move.undone === true,
      actorSide: move.actorSide || null,
      html: `<li class="history-item${sectionClass} ${playerToneClassForSide(move.actorSide || "P1")}${selectedClass}${undoneClass}" data-action="jump-history" data-game-id="${escapeHtml(
        game.id,
      )}" data-move-index="${move.index}" data-move-id="${escapeHtml(move.moveId || "")}" data-testid="history-move-item">
          <div class="history-item-info">
            <span class="history-move-line">Move ${escapeHtml(
              String(move.displayMoveNumber ?? move.index + 1),
            )}: ${escapeHtml(move.notation)}</span>
            ${destructionSubBullets}
            <span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span>
          </div>
          ${actionSection}
        </li>`,
    };
  });
  const pendingRows = (Array.isArray(game.pendingMoves) ? game.pendingMoves : []).map(
    (move) => `<li class="history-item history-item-pending ${playerToneClassForSide(move.actorSide || (move.turnIndex % 2 === 0 ? "P1" : "P2"))}" data-action="jump-history" data-game-id="${escapeHtml(
      game.id,
    )}" data-move-index="${escapeHtml(String(move.index))}" data-testid="history-pending-move-item" aria-busy="true">
          <span class="history-move-line">Move ${escapeHtml(
            String(move.index + 1),
          )}: ${escapeHtml(move.notation)} · Pending</span>
          <span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span>
        </li>`,
  );
  const reverseChronologicalMoveRows = [];
  const reversedChronological = [...moveRowsChronological].reverse();
  for (let index = 0; index < reversedChronological.length; ) {
    if (!reversedChronological[index].undone) {
      reverseChronologicalMoveRows.push(reversedChronological[index].html);
      index += 1;
      continue;
    }
    let end = index;
    while (end < reversedChronological.length && reversedChronological[end].undone) {
      end += 1;
    }
    const count = end - index;
    const groupKey = `${game.id}:${index}:${end}`;
    const expanded = expandedUndoneGroups.has(groupKey);
    const actorSides = new Set(
      reversedChronological.slice(index, end).map((entry) => (entry.actorSide === "P1" || entry.actorSide === "P2" ? entry.actorSide : null)).filter(Boolean),
    );
    const toneClass =
      actorSides.size > 1
        ? "player-tone-both"
        : actorSides.has("P1")
          ? "player-tone-p1"
          : actorSides.has("P2")
            ? "player-tone-p2"
            : "player-tone-neutral";
    reverseChronologicalMoveRows.push(`
      <li class="history-item history-item-undone-group is-undone ${toneClass}${expanded ? " is-expanded" : ""}" data-action="toggle-undone-group" data-group-key="${escapeHtml(
        groupKey,
      )}" aria-expanded="${expanded ? "true" : "false"}">
        <span class="history-move-line">${count} move${count === 1 ? "" : "s"} undone</span>
      </li>`);
    if (expanded) {
      reverseChronologicalMoveRows.push('<li class="history-undone-group-content"><ul class="history-list history-list-nested">');
      for (let undoIndex = index; undoIndex < end; undoIndex += 1) {
        reverseChronologicalMoveRows.push(reversedChronological[undoIndex].html);
      }
      reverseChronologicalMoveRows.push("</ul></li>");
    }
    index = end;
  }
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
      )}" data-testid="history-return-live">Return to live view</button></li>`
    : liveStatusItem;
  const undoLastMoveItem =
    !game.inHistoryMode && game.canUndoLastMove && game.latestActiveMoveId
      ? `<li class="history-empty-line history-return-live"><button class="secondary" data-action="undo-last-move" data-game-id="${escapeHtml(
          game.id,
        )}" data-move-id="${escapeHtml(game.latestActiveMoveId)}">Undo last move</button></li>`
      : "";

  return `${emptyTurnItem}${undoLastMoveItem}${reverseChronologicalPendingRows.join("")}${reverseChronologicalMoveRows.join("")}`;
};

const renderHeader = () => `
  <header class="shell-header">
    <div class="shell-header-main">
      <h1><a class="shell-header-title-link" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">${renderWordmark(brandController.getState())}</a></h1>
    </div>
    ${renderHeaderAlertZone()}
    ${account.snapshot().ready && account.snapshot().enabled && account.snapshot().available ? `<button class="secondary" data-action="account-open" data-testid="account-open">${account.snapshot().session.authenticated ? "Account" : "Sign in"}</button>` : ""}
    ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
    ${account.snapshot().pendingLogout ? '<span role="status">Sign-out pending</span>' : ''}
    ${accountStartupError ? `<p role="alert">${escapeHtml(accountStartupError)}</p><button class="secondary" data-action="retry-account-startup">Try again</button>` : !account.snapshot().ready ? `<p role="status">Connecting…</p>` : ""}
    <div class="shell-header-actions">
      <div class="nav-row${isNarrowHeaderMode() ? " nav-row-single" : ""}">
        ${isNarrowHeaderMode() ? renderHeaderNarrowMenu() : renderHeaderWideActions()}
      </div>
    </div>
  </header>
`;

const setSelectedScenarioFeedback = (message) => {
  selectedScenarioFeedback = message;
};

const setSaveScenarioFeedback = (message) => {
  saveScenarioFeedback = message;
};

const formatScenarioInfo = (scenario, fallback = "No scenarios available.") =>
  scenario
    ? JSON.stringify(
        {
          id: scenario.id,
          title: scenario.title,
          moves: scenario.moves.length,
          outcome: scenario.expectedOutcome,
        },
        null,
        2,
      )
    : fallback;

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
  const scenarioLoadPending = isButtonPending(SCENARIO_LOAD_PENDING_KEY);
  const scenarioCard = selectedScenario ? buildStaticGameCardFromScenario(selectedScenario) : null;
  const scenarioPreviewPayload = selectedScenario ? buildScenarioStaticPreviewModel(selectedScenario) : null;
  const scenarioPreviewSnapshot = scenarioPreviewPayload?.snapshot ?? getStaticCardPreviewSnapshot(scenarioCard);
  const moveLimit = game?.inHistoryMode && typeof game.historyIndex === "number" ? game.historyIndex : game?.moves?.length ?? 0;
  const canAuthorScenarios = Boolean(game) && canAuthorScenariosLocally();
  const canLoadIntoCurrentGame = Boolean(game && Array.isArray(game.moves) && game.moves.length === 0 && selectedScenario);
  const saveDraft = getSaveScenarioDraft();
  const canSaveScenario = canAuthorScenarios && Boolean(saveDraft.title && saveDraft.description);
  const selectedScenarioTitle = selectedScenario?.title ?? "";
  const selectedScenarioDescription = selectedScenario?.description ?? "Scenarios replay canonical shell history into a game.";
  const canUpdateScenario = canAuthorScenarios && Boolean(selectedScenario);
  if (scenarioLoadPending) {
    return `
      <section class="panel debug-panel scenario-panel scenario-panel-load" data-testid="scenario-load-skeleton">
        <h2>Load a scenario</h2>
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-board"></div>
        <div class="skeleton-pulse skeleton-button"></div>
      </section>
    `;
  }
  return `
    <section class="panel debug-panel scenario-panel scenario-panel-load">
      <h2>Load a scenario</h2>
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
          ? renderStaticMiniBoardCard({
              card: { ...scenarioCard, previewPayload: scenarioPreviewPayload },
              variant: "scenario",
              header: "",
              meta: `<div class="mini-board-card-meta">
                  <span class="small">${escapeHtml(`${scenarioCard.moveCount} move(s)`)}</span>
                  <span class="small">${escapeHtml(`Expected ${formatOutcomeStatus(selectedScenario.expectedOutcome)}`)}</span>
                </div>`,
              statusText: scenarioPreviewSnapshot
                ? formatSideToMoveLabel(scenarioPreviewSnapshot)
                : "Snapshot unavailable",
            })
          : ""
      }
      <div class="row">
        <button data-action="load-scenario"${renderButtonStateAttributes({
          pendingKey: SCENARIO_LOAD_PENDING_KEY,
          disabled: !selectedScenario,
        })}>${route.name === "home" ? "Open Scenario" : canLoadIntoCurrentGame ? "Load into This Game" : "Open in New Tab"}</button>
        ${
          canUpdateScenario
            ? `<button data-action="update-scenario"${renderButtonStateAttributes({
                className: "secondary",
                pendingKey: SCENARIO_UPDATE_PENDING_KEY,
                disabled: !selectedScenarioTitle.trim() || !selectedScenarioDescription.trim(),
              })}>Update to match current board</button>`
            : ""
        }
      </div>
      <pre class="debug-pre" aria-live="polite">${escapeHtml(selectedScenarioFeedback || formatScenarioInfo(selectedScenario))}</pre>
    </section>
    ${
      canAuthorScenarios
        ? `<section class="panel debug-panel scenario-panel scenario-panel-create">
            <h2>Create a scenario</h2>
            <div class="form-row">
              <label for="save-scenario-title">Title</label>
              <input id="save-scenario-title" data-scenario-save-field="title" value="${escapeHtml(saveDraft.title)}" />
            </div>
            <div class="form-row">
              <label for="save-scenario-description">Description</label>
              <textarea id="save-scenario-description" data-scenario-save-field="description" rows="4">${escapeHtml(saveDraft.description)}</textarea>
            </div>
            <div class="row">
              <button data-action="save-scenario"${renderButtonStateAttributes({
                className: "secondary",
                pendingKey: SCENARIO_SAVE_PENDING_KEY,
                disabled: !canSaveScenario,
              })}>Save current board as new scenario</button>
            </div>
            <pre class="debug-pre" aria-live="polite">${escapeHtml(saveScenarioFeedback || "No new scenario saved yet.")}</pre>
          </section>`
        : ""
    }
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
          loadedGames: transport.listGames().map((entry) => ({ id: entry.id, moves: entry.moves.length, role: entry.myRole })),
        }
      : route.name === "tutorial"
        ? {
            tutorial: tutorial.current(),
            completed: account.snapshot().session.account?.preferences?.tutorial === "completed",
          }
        : {
            route: route.name,
            gameId,
          };
  return `
    <section class="panel debug-panel">
      <h2>Live Sync</h2>
      <pre class="debug-pre">Identity <span id="shell-debug-identity" class="mono">${escapeHtml(transport.getIdentityId())}</span>
Live sync: <span id="shell-debug-live-sync" class="mono">${escapeHtml(`${wsStatus.state}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`)}</span>
Last event: <span id="shell-debug-last-event" class="mono">${escapeHtml(wsLastEvent)}</span>
Sync metrics: <span id="shell-debug-sync-metrics" class="mono">${escapeHtml(JSON.stringify(transport.getSyncMetrics()))}</span></pre>
    </section>
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
  const identityEl = document.getElementById("shell-debug-identity");
  const liveSyncEl = document.getElementById("shell-debug-live-sync");
  const lastEventEl = document.getElementById("shell-debug-last-event");
  const syncMetricsEl = document.getElementById("shell-debug-sync-metrics");
  if (identityEl) {
    identityEl.textContent = transport.getIdentityId();
  }
  if (liveSyncEl) {
    liveSyncEl.textContent = `${wsStatus.state}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`;
  }
  if (lastEventEl) {
    lastEventEl.textContent = wsLastEvent;
  }
  if (syncMetricsEl) {
    syncMetricsEl.textContent = JSON.stringify(transport.getSyncMetrics());
  }
};

const setInviteFeedback = (message) => {
  inviteFeedback = message;
  render({ animatePanels: false, includeBoard: false });
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

const setUndoRequestFeedback = (gameId, message) => {
  undoRequestFeedback = message;
  undoRequestFeedbackGameId = gameId || null;
  if (!isBuildingGameAlerts) {
    render({ animatePanels: false, includeBoard: false });
  }
  if (undoRequestFeedbackTimer) {
    clearTimeout(undoRequestFeedbackTimer);
    undoRequestFeedbackTimer = null;
  }
  if (message) {
    undoRequestFeedbackTimer = setTimeout(() => {
      undoRequestFeedback = "";
      undoRequestFeedbackGameId = null;
      render();
    }, 5000);
  }
};

const maybeUpdateUndoRequestOutcomeFeedback = (game) => {
  if (!game || !Array.isArray(game.notifications) || game.notifications.length === 0) {
    return;
  }
  const latestNote = String(game.notifications[0] || "").trim();
  if (!/^Player .+ (accepted|rejected|rescinded) the undo request$/i.test(latestNote)) {
    return;
  }
  const previous = seenUndoRequestOutcomeByGameId.get(game.id) ?? "";
  if (previous === latestNote) {
    return;
  }
  seenUndoRequestOutcomeByGameId.set(game.id, latestNote);
  setUndoRequestFeedback(game.id, latestNote);
};

let isBuildingGameAlerts = false;

const markInviteChoiceCommitted = (gameId) => {
  if (!gameId) {
    return;
  }
  inviteChoiceCommittedByGameId.add(gameId);
};

const getInviteContextForGame = (game, routeName = currentRoute.name) => {
  if (account.snapshot().enabled && (routeName === "game" || game?.ownershipMode === "legacy_guest")) return null;
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

const renderStaticMiniBoardCard = ({ card, variant = "home", href = null, flyoutLink = null, gameId = null, header, meta, statusText }) => {
  const previewPayload = card?.previewPayload ?? getStaticCardPreviewPayload(card);
  const previewKey = toStableKey({
    snapshot: previewPayload.snapshot,
    selection: previewPayload.selection,
    overlay: previewPayload.overlay,
    legalActions: previewPayload.legalActions,
    selectedPieceId: previewPayload.selectedPieceId,
    selectedPieceMoves: previewPayload.selectedPieceMoves,
    selectedPieceMovePreviews: previewPayload.selectedPieceMovePreviews,
    currentActionType: previewPayload.currentActionType,
    selectedPieceOverlayPhase: previewPayload.selectedPieceOverlayPhase,
  });
  const body = `<div class="mini-board-card-header">
      ${header}
    </div>
    <div class="mini-board-card-copy">
      ${meta}
    </div>
    ${renderMiniBoardPreviewRoot({
      previewId: `${variant}:${card.id}`,
      snapshot: previewPayload.snapshot,
      selection: previewPayload.selection,
      overlay: previewPayload.overlay,
      legalActions: previewPayload.legalActions,
      selectedPieceId: previewPayload.selectedPieceId,
      selectedPieceMoves: previewPayload.selectedPieceMoves,
      selectedPieceMovePreviews: previewPayload.selectedPieceMovePreviews,
      currentActionType: previewPayload.currentActionType,
      selectedPieceOverlayPhase: previewPayload.selectedPieceOverlayPhase,
      previewKey,
      sizeVariant: "compact",
    })}
    <p class="small mini-board-preview-status">${escapeHtml(statusText)}</p>`;
  if (!href) {
    return `<div class="mini-board-card mini-board-card-${escapeHtml(variant)}">${body}</div>`;
  }
  return `<article class="mini-board-card">
    <a
      class="mini-board-card-link-surface"
      href="${href}"
      ${flyoutLink ? `data-flyout-link="${escapeHtml(flyoutLink)}"` : ""}
      ${gameId ? `data-game-id="${escapeHtml(gameId)}"` : ""}
    >
      ${body}
    </a>
  </article>`;
};

const renderHomeGameCard = (game) => {
  const snapshot = getStaticCardPreviewSnapshot(game);
  const statusText = snapshot ? formatSideToMoveLabel(snapshot) : "Snapshot unavailable";
  const moveLabel = `Move ${game.moveCount + 1}`;
  const recoveryChip =
    game.syncStatus === "desynced" || game.syncStatus === "confirming" ? '<span class="status-chip">Recovering</span>' : "";
  const seatConnectionLine = renderHomeSeatConnectionLine(game);
  return renderStaticMiniBoardCard({
    card: game,
    href: buildGameHash(game.id, null, getCurrentFlyoutState()),
    flyoutLink: "game",
    gameId: game.id,
    header: `<div>
        <span class="mini-board-card-link">${escapeHtml(formatDisplayGameId(game.id))}</span>
        <p class="small mini-board-card-subtitle">Last move on ${escapeHtml(formatClientDateTime(game.lastMoveAt || game.createdAt))}</p>
      </div>
      ${recoveryChip}`,
    meta: `<div class="mini-board-card-meta mini-board-card-meta-primary">
        <span>${renderHomeRoleLine(game)}</span>
        <span class="small">${escapeHtml(moveLabel)}</span>
      </div>
      ${seatConnectionLine}`,
    statusText,
  });
};

const renderHomeSectionControls = (sectionKey, section, { placement } = { placement: "header" }) => `<div
  class="home-games-section-controls home-games-section-controls-${escapeHtml(placement)}"
>
  <button
    ${renderPendingStateAttributes({ className: "secondary", pending: isHomeSectionPending(sectionKey) })}
    data-action="home-page-prev"
    data-home-section="${escapeHtml(sectionKey)}"
    aria-label="Previous ${escapeHtml(section.title)} page"
  >&larr;</button>
  <p class="small home-games-section-page-label">Page ${section.page + 1} of ${section.totalPages}</p>
  <button
    ${renderPendingStateAttributes({ className: "secondary", pending: isHomeSectionPending(sectionKey) })}
    data-action="home-page-next"
    data-home-section="${escapeHtml(sectionKey)}"
    aria-label="Next ${escapeHtml(section.title)} page"
  >&rarr;</button>
</div>`;

const renderHomeStartButton = () => "";
const renderPersonalStart = () => `<section class="panel home-start" data-zone="home-start">
  <h2>Start a game</h2><p>Choose who you would like to play.</p>
  <div class="opponent-picker">${PERSONAL_OPPONENTS.map((opponent) => `<button class="opponent-choice" data-action="start-opponent" data-opponent="${opponent.id}" ${opponent.id === "friend" ? 'data-testid="home-create-game"' : ""}>
    <strong>${opponent.name}</strong><span>${opponent.detail}</span>${isComputerOpponent(opponent.id) ? '<span class="opponent-availability">Computer play coming soon</span>' : ""}
  </button>`).join("")}</div>
  <fieldset class="home-side"><legend>Your side</legend>
    <label><input type="radio" name="home-side" value="p1" ${homeSide === "p1" ? "checked" : ""}> Player 1 · Red</label>
    <label><input type="radio" name="home-side" value="p2" ${homeSide === "p2" ? "checked" : ""}> Player 2 · Blue</label>
  </fieldset>
  <button class="secondary" data-action="start-opponent" data-opponent="self">Self-play</button>
  <p class="home-start-status" role="status">${escapeHtml(homeStartStatus)}</p>
</section>`;
const renderResumeSection = () => {
  if (resumeSection.error) return '<section class="panel" data-zone="home-resume"><p role="status">Your games could not be loaded.</p><button class="secondary" data-action="retry-resume">Try again</button></section>';
  const games = selectResumeGames(resumeSection.gameIds.map((id) => transport.getHomeGameCard(id)).filter(Boolean), transport.getIdentityId());
  if (!games.length) return "";
  return `<section class="panel home-games-section" data-zone="home-resume" aria-busy="${resumeSection.pending ? "true" : "false"}"><h2>Continue playing</h2>
    ${resumeSection.pending ? '<p role="status">Loading your games…</p>' : ""}
    <div class="mini-board-card-list">${games.map((game) => `<div class="resume-game"><p class="resume-turn">${isAwaitingPlayer(game, transport.getIdentityId()) ? "Your turn" : "Waiting for the other player"}</p>${renderHomeGameCard(game)}</div>`).join("")}</div>
    ${resumeSection.totalPages > 1 ? `<div class="resume-pagination"><button class="secondary" data-action="resume-page" data-page="${resumeSection.page - 1}" ${resumeSection.pending || resumeSection.page === 0 ? "disabled" : ""}>Previous games</button><span>Page ${resumeSection.page + 1} of ${resumeSection.totalPages}</span><button class="secondary" data-action="resume-page" data-page="${resumeSection.page + 1}" ${resumeSection.pending || resumeSection.page + 1 >= resumeSection.totalPages ? "disabled" : ""}>More games</button></div>` : ""}
  </section>`;
};

const renderHomeGameSection = (sectionKey) => {
  const section = getHomeSection(sectionKey);
  if (isHomeSectionPending(sectionKey)) {
    return renderHomeSectionSkeleton(section.title, { showStartButton: sectionKey === "my" });
  }
  const games = section.gameIds.map((gameId) => transport.getHomeGameCard(gameId)).filter(Boolean);
  const shouldAlwaysRender = false;
  if (!Array.isArray(games) || (!shouldAlwaysRender && (games.length === 0 || section.totalGames === 0))) {
    return "";
  }
  const showEmptyState = section.totalGames === 0;
  const showPaging = section.totalPages > 1;
  const showHeaderPaging = showPaging && section.visibleColumnCount > 1;
  const showFooterPaging = showPaging && section.visibleColumnCount === 1;
  const hasHeaderAction = sectionKey === "my";
  return `<section class="panel home-games-section" data-home-section-root="${escapeHtml(sectionKey)}">
      <div class="home-games-section-header" data-home-header-has-action="${hasHeaderAction ? "true" : "false"}" data-home-header-paging="${showHeaderPaging ? "true" : "false"}">
      <div class="home-games-section-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <p class="small">${section.totalGames === 1 ? "1 game" : `${section.totalGames} games`}</p>
      </div>
      <div class="home-games-section-header-center">
        ${showHeaderPaging ? renderHomeSectionControls(sectionKey, section, { placement: "header" }) : ""}
      </div>
      <div class="home-games-section-header-actions">
        ${hasHeaderAction ? renderHomeStartButton() : ""}
      </div>
    </div>
    ${showEmptyState
      ? `<p class="small home-games-empty">No games yet.</p>`
      : `<div class="home-games-carousel" data-home-carousel="${escapeHtml(sectionKey)}">
      <div class="home-games-carousel-track" data-home-carousel-track="${escapeHtml(sectionKey)}">
        <div class="mini-board-card-list" data-game-count="${games.length}">${games.map((game) => renderHomeGameCard(game)).join("")}</div>
      </div>
    </div>`}
    ${showFooterPaging ? renderHomeSectionControls(sectionKey, section, { placement: "footer" }) : ""}
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
  if (!routeHydrated) {
    return `
      <section class="stack">
        ${renderPersonalStart()}
        ${getVisibleHomeSectionKeys().map((sectionKey) => renderHomeSectionSkeleton(getHomeSection(sectionKey).title)).join("")}
      </section>
    `;
  }
  const sectionHtml = getVisibleHomeSectionKeys().map((sectionKey) => renderHomeGameSection(sectionKey)).join("");
  const listHtml = sectionHtml;

  return `
    <section class="stack">
      ${renderResumeSection()}
      ${renderPersonalStart()}
      ${listHtml}
    </section>
  `;
};

const renderGameAlertsHtml = (game, inviteFromRole = null) => {
  isBuildingGameAlerts = true;
  try {
    const items = getGameAlertItems(game);
    if (items.length === 0) {
      return "";
    }
    const rotation = getAlertStackRotation(game.id, items.length);
    const orderedItems = items.map((_, index) => items[(rotation + index) % items.length]);
    return orderedItems
      .map((item, stackIndex) =>
        renderGameAlertStackCard({
          gameId: game.id,
          item,
          stackIndex,
          totalAlerts: orderedItems.length,
        }),
      )
      .join("");
  } finally {
    isBuildingGameAlerts = false;
  }
};

const renderHomeCardSkeleton = () => `
  <article class="mini-board-card mini-board-card-skeleton" data-testid="home-card-skeleton">
    <div class="mini-board-card-copy">
      <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
      <div class="skeleton-pulse skeleton-line skeleton-line-subtitle"></div>
    </div>
    <div class="skeleton-pulse skeleton-board"></div>
    <div class="skeleton-pulse skeleton-line skeleton-line-status"></div>
  </article>
`;

const renderHomeSectionSkeleton = (title, { showStartButton = false } = {}) => `
  <section class="panel home-games-section" data-testid="home-section-skeleton">
    <div class="home-games-section-header" data-home-header-has-action="${showStartButton ? "true" : "false"}" data-home-header-paging="false">
      <div class="home-games-section-heading">
        <h2>${escapeHtml(title)}</h2>
        <p class="small">Loading games...</p>
      </div>
      <div class="home-games-section-header-center"></div>
      <div class="home-games-section-header-actions">
        ${showStartButton ? renderHomeStartButton() : ""}
      </div>
    </div>
    <div class="home-games-carousel">
      <div class="mini-board-card-list mini-board-card-list-skeleton">
        ${Array.from({ length: 3 }, () => renderHomeCardSkeleton()).join("")}
      </div>
    </div>
  </section>
`;

const renderGameViewSkeleton = () => `
  <section class="layout-grid layout-grid-skeleton" data-testid="game-view-skeleton">
    <div class="stack">
      <section class="panel skeleton-panel">
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-line skeleton-line-short"></div>
      </section>
      <section class="panel skeleton-panel">
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-button"></div>
        <div class="skeleton-pulse skeleton-line skeleton-line-short"></div>
      </section>
      <section class="panel skeleton-panel">
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-line skeleton-line-short"></div>
      </section>
    </div>
    <div class="stack">
      <section class="panel skeleton-panel">
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-board"></div>
      </section>
    </div>
    <div class="stack">
      <section class="panel skeleton-panel">
        <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-line skeleton-line-short"></div>
      </section>
    </div>
  </section>
`;

const renderInvitePageSkeleton = () => `
  <section class="invite-gate" data-testid="invite-view-skeleton">
    <section class="panel invite-gate-modal skeleton-panel">
      <div class="skeleton-pulse skeleton-line skeleton-line-kicker"></div>
      <div class="skeleton-pulse skeleton-line skeleton-line-title"></div>
      <div class="skeleton-pulse skeleton-line"></div>
      <div class="invite-choice-list">
        <div class="skeleton-pulse skeleton-button"></div>
        <div class="skeleton-pulse skeleton-button"></div>
      </div>
    </section>
    <div class="invite-gate-content" aria-hidden="true">
      ${renderGameViewSkeleton()}
    </div>
  </section>
`;

const renderGameSummaryPanel = (game) => {
  const latestNote = game.notifications[0] || "Ready";
  return `
    <h2>Game <span class="mono">${escapeHtml(formatDisplayGameId(game.id))}</span></h2>
    <div class="section-stack">
      <p class="small">Started ${escapeHtml(formatClientDateTime(game.createdAt))}</p>
      <p class="small" data-testid="game-role">Role: ${renderRoleLabel(game.myRole, game)}</p>
      <div class="section-followup">
        <p class="small" data-testid="active-turn-label">Active turn: ${
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
  const joinViewerButtonKey = getJoinButtonKey("viewer", game.id);
  const joinPlayerButtonKey = getJoinButtonKey("player", game.id);
  const playAsBothButtonKey = getPlayAsBothButtonKey(game.id);
  const copyInviteButtonKey = getCopyInviteButtonKey(game.id);
  const pendingSeatNotice = game.pendingPlayerRequestSeat
    ? `<div class="alert" data-testid="pending-player-request-notice">Player join request pending approval for ${renderSeatLabel(game.pendingPlayerRequestSeat)}.</div>`
    : "";
  const pendingRows =
    game.pendingJoinRequests.length === 0
      ? "<li class=\"small\">No pending join requests</li>"
      : game.pendingJoinRequests
          .map(
            (request) => {
              const approveRequestButtonKey = getApproveRequestButtonKey(game.id, request.identityId);
              return `<li data-testid="pending-join-request" data-requester-id="${escapeHtml(request.identityId)}">
              ${participantButton(request)} requests ${renderSeatLabel(request.requestedSeat)}
              <button data-action="approve-request" data-game-id="${escapeHtml(game.id)}" data-requester-id="${escapeHtml(
                request.identityId,
              )}" data-testid="approve-request-inline"${renderButtonStateAttributes({
                className: "secondary",
                pendingKey: approveRequestButtonKey,
                disabled: !Array.isArray(game.approvableRequesterIds) || !game.approvableRequesterIds.includes(request.identityId),
              })}>${isButtonPending(approveRequestButtonKey) ? "Approving..." : "Approve"}</button>
            </li>`;
            },
          )
          .join("");
  const joinInviteActions = renderSectionActions([
    game.canJoinAsViewer
      ? `<button data-action="join-viewer" data-game-id="${escapeHtml(game.id)}" data-testid="join-viewer"${renderButtonStateAttributes({
          className: "secondary",
          pendingKey: joinViewerButtonKey,
        })}>${isButtonPending(joinViewerButtonKey) ? "Joining..." : "Join as viewer"}</button>`
      : "",
    game.canJoinAsPlayer && game.showJoinActions
      ? `<button data-action="join-player" data-game-id="${escapeHtml(game.id)}" data-testid="join-player"${renderButtonStateAttributes({
          pendingKey: joinPlayerButtonKey,
        })}>${isButtonPending(joinPlayerButtonKey) ? "Joining..." : "Join as player"}</button>`
      : "",
    game.canPlayAsBothPlayers
      ? `<button data-action="play-as-both-players" data-game-id="${escapeHtml(game.id)}"${renderButtonStateAttributes({
          className: "secondary",
          pendingKey: playAsBothButtonKey,
        })}>${isButtonPending(playAsBothButtonKey) ? "Claiming seats..." : "Play as both players"}</button>`
      : "",
    `<button data-action="copy-invite" data-game-id="${escapeHtml(game.id)}" data-link="${escapeHtml(inviteLink)}" data-testid="copy-invite"${renderButtonStateAttributes({
      pendingKey: copyInviteButtonKey,
      disabled: !game.canInvite,
    })}>${isButtonPending(copyInviteButtonKey) ? "Creating invite..." : "Invite someone else"}</button>`,
  ]);

  return `
    <h2 data-testid="join-invite-heading">Join / Invite</h2>
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
        return `<li data-testid="participant-${escapeHtml(entry.label.toLowerCase().replace(/\s+/g, "-"))}">${renderSeatLabel(entry.label)}: <span class="small">Open seat</span></li>`;
      }
      return `<li data-testid="participant-${escapeHtml(entry.label.toLowerCase().replace(/\s+/g, "-"))}">${renderSeatLabel(entry.label)}: ${participantButton(entry.value)} ${formatStatus(entry.value.connected)}</li>`;
    })
    .join("");

  const viewerRows =
    game.viewers.length === 0
      ? '<li>Viewers: <span class="small">None</span></li>'
      : game.viewers
          .map(
            (viewer) =>
              `<li data-testid="participant-viewer">Viewer: ${participantButton(viewer)} ${formatStatus(viewer.connected)}</li>`,
          )
          .join("");
  return `
    <h2>Participants</h2>
    <ul class="participant-list" data-testid="participants-list">${participantRows}${viewerRows}</ul>
  `;
};

const renderHistoryPanel = (game) => {
  const historyRows = renderTurnHistory(game);
  const currentNames = [game.player1,game.player2].filter(person => person?.profile).map(participantName).join(" · ");
  const selectedMove = typeof game.historyIndex === "number" && Array.isArray(game.moves) ? game.moves[game.historyIndex] ?? null : null;
  const historyMoveNumber = typeof selectedMove?.displayMoveNumber === "number" ? String(selectedMove.displayMoveNumber) : "?";
  const hasHistoryMoves = Array.isArray(game.moves) && game.moves.length > 0;
  const historyBanner = game.inHistoryMode
    ? `<p class="small">Viewing history snapshot for move ${escapeHtml(historyMoveNumber)}.</p>
       <p class="small">Incoming live moves will appear at top.</p>`
    : hasHistoryMoves
      ? '<p class="small">You are on the live view.</p><p class="small">Click moves below to see historical state.</p>'
      : '<p class="small">You are on the live view.</p>';

  return `
    <h2>History</h2>
    ${currentNames ? `<p class="small" data-testid="history-player-names">${currentNames}</p>` : ""}
    <div class="section-followup">
      ${historyBanner}
      <ol class="history-list" data-testid="history-list">${historyRows}</ol>
    </div>
  `;
};

const viewPreferenceByIdentity = new Map();
function syncAccountViewPreference() {
  const identity = transport.getIdentityId();
  const preference = account.snapshot().session.account?.preferences?.view || "focused";
  if (viewPreferenceByIdentity.get(identity) === preference) return;
  viewPreferenceByIdentity.set(identity, preference);
  for (const [key, help] of helpByGame) if (key.startsWith(`${identity}:`)) help.setManual(preference === "explanatory");
  boardRuntime?.refreshPresentation?.();
}

const getGameHelp = (gameId) => {
  const key = `${transport.getIdentityId()}:${gameId}`;
  if (!helpByGame.has(key)) {
    const help = createContextualHelp();
    help.setManual(account.snapshot().session.account?.preferences?.view === "explanatory");
    helpByGame.set(key, help);
  }
  return helpByGame.get(key);
};
const renderGameHelp = (gameId) => {
  const state = getGameHelp(gameId).getState();
  return `<section class="game-help" data-zone="game-help" data-expanded="${state.expanded}" aria-label="Rules explanation">
    <div class="game-help-controls"><button class="secondary" data-action="toggle-explain" aria-pressed="${state.manual}">Explain</button>
    <button class="secondary" data-action="${state.expanded ? "collapse-help" : "expand-help"}">${state.expanded ? "Collapse" : "Expand"}</button></div>
    <p class="game-help-copy" aria-live="polite">${escapeHtml(state.text)}</p>
  </section>`;
};
const updateGameHelp = (gameId, event = null) => {
  const help = getGameHelp(gameId);
  if (event?.kind === "blocked") help.explain(event.reason, event.text);
  else if (event?.kind === "commit") help.commit(event.text);
  else if (event?.text) help.select(event.text);
  const existing = appEl.querySelector('[data-zone="game-help"]');
  if (!existing) return;
  const state = help.getState();
  existing.dataset.expanded = String(state.expanded);
  existing.querySelector('.game-help-copy').textContent = state.text;
  const toggle = existing.querySelector('[data-action="toggle-explain"]');
  toggle.setAttribute('aria-pressed', String(state.manual));
  const disclosure = existing.querySelector('[data-action="collapse-help"], [data-action="expand-help"]');
  disclosure.dataset.action = state.expanded ? "collapse-help" : "expand-help";
  disclosure.textContent = state.expanded ? "Collapse" : "Expand";
  // Keep required destinations visible without changing the board's dimensions.
  // Shrink the sheet to the free space first; retain its disclosure when the
  // viewport has too little room for an expanded explanation.
  existing.style.maxHeight = "";
  if (state.expanded && getShellLayoutMode() === "narrow") {
    const targets = [...appEl.querySelectorAll('#shell-board [data-legal-target="true"], #shell-board .target')];
    const sheet = existing.getBoundingClientRect();
    const requiredBottom = Math.max(0, ...targets.map((target) => target.getBoundingClientRect().bottom));
    if (requiredBottom > sheet.top - 8) {
      const available = sheet.bottom - requiredBottom - 8;
      if (available >= 112) existing.style.maxHeight = `${available}px`;
      else {
        help.collapseForBoard();
        existing.dataset.expanded = "false";
        disclosure.dataset.action = "expand-help";
        disclosure.textContent = "Expand";
      }
    }
  }
};

const renderBoardPanel = (game) => `
  ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p class="alert" role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
  ${game.ownershipMode === "legacy_guest" && account.snapshot().enabled ? '<p class="alert" role="status">This older guest game is view-only. <button data-action="create-game">Start new game</button></p>' : ''}
  ${account.snapshot().enabled && account.snapshot().available && !account.snapshot().maintenance && !account.canPlay() ? '<p class="alert" role="status">Sign in to play or analyze. The board remains available to view.</p>' : ''}
  <h2 class="board-heading">Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span></h2>
  <p class="board-preview-label" id="shell-board-preview-label" aria-live="polite">Select a piece to preview moves; click it again for supply and command lines only:</p>
  <div class="board-wrap" data-testid="game-board-wrap">
    <div id="shell-board" class="board" data-testid="game-board"></div>
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

const renderGameShellPanelTab = (panelKey, label) => `
  <button
    class="secondary shell-mobile-tab"
    type="button"
    data-action="switch-game-panel"
    data-panel="${panelKey}"
    aria-pressed="${getGamePanel() === panelKey ? "true" : "false"}"
    aria-current="${getGamePanel() === panelKey ? "page" : "false"}"
  >${label}</button>
`;

const renderGameShellFrame = (game) => `
  <section class="game-shell-frame" data-game-shell-root data-game-id="${escapeHtml(game.id)}" data-testid="game-shell">
    <div class="game-shell-track-wrap">
      <section class="layout-grid game-shell-track" data-game-shell-track>
        <div class="stack game-shell-mobile-panel" data-mobile-panel="players" data-shell-sticky-target="left" data-sticky-enabled="false">
          <section class="panel" data-game-panel="summary"></section>
          <section class="panel" data-game-panel="join"></section>
          <section class="panel" data-game-panel="participants"></section>
        </div>

        <div class="stack game-shell-mobile-panel" data-mobile-panel="board" data-shell-sticky-target="board" data-sticky-enabled="false">
          <section class="panel" data-shell-panel="board" data-zone="game-board">
            ${renderBoardPanel(game)}
          </section>
          ${renderGameHelp(game.id)}
        </div>

        <div class="stack game-shell-mobile-panel" data-mobile-panel="history">
          <section class="panel" data-game-panel="history"></section>
        </div>
      </section>
    </div>
    <nav class="shell-mobile-tabbar" aria-label="Game panels">
      ${renderGameShellPanelTab("players", "Players")}
      ${renderGameShellPanelTab("board", "Board")}
      ${renderGameShellPanelTab("history", "History")}
    </nav>
  </section>
`;

const getMountedGameShellRoot = () =>
  appEl?.querySelector?.("[data-game-shell-root]") instanceof HTMLElement ? appEl.querySelector("[data-game-shell-root]") : null;
const syncMountedGameShellPanelUi = (shellRoot = getMountedGameShellRoot()) => {
  if (!(shellRoot instanceof HTMLElement)) {
    return;
  }
  const help = shellRoot.querySelector('[data-zone="game-help"]');
  const helpParent = getShellLayoutMode() === "narrow" ? shellRoot : shellRoot.querySelector('[data-mobile-panel="board"]');
  if (help && helpParent && help.parentElement !== helpParent) helpParent.appendChild(help);
  const activePanel = getGamePanel();
  const nextPanelIndex = getGamePanelIndex(activePanel);
  shellRoot.querySelectorAll("[data-action='switch-game-panel'][data-panel]").forEach((buttonEl) => {
    if (!(buttonEl instanceof HTMLElement)) {
      return;
    }
    const isActive = buttonEl.getAttribute("data-panel") === activePanel;
    buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
    buttonEl.setAttribute("aria-current", isActive ? "page" : "false");
  });
  const trackEl = shellRoot.querySelector("[data-game-shell-track]");
  if (trackEl instanceof HTMLElement) {
    const previousPanelIndex = Number.parseInt(trackEl.dataset.panelIndex || String(nextPanelIndex), 10);
    const shouldAnimate =
      getShellLayoutMode() === "narrow" &&
      !prefersReducedMotion() &&
      trackEl.dataset.hasMounted === "true" &&
      previousPanelIndex !== nextPanelIndex;
    trackEl.dataset.panelIndex = String(nextPanelIndex);
    trackEl.dataset.hasMounted = "true";
    if (shouldAnimate) {
      trackEl.dataset.transitionState = nextPanelIndex > previousPanelIndex ? "forward" : "backward";
      if (panelTransitionResetTimer) {
        window.clearTimeout(panelTransitionResetTimer);
      }
      panelTransitionResetTimer = window.setTimeout(() => {
        panelTransitionResetTimer = null;
        if (trackEl instanceof HTMLElement) {
          trackEl.dataset.transitionState = "";
        }
      }, GAME_SHELL_PANEL_TRANSITION_MS);
    } else {
      trackEl.dataset.transitionState = "";
    }
  }
};
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
  if (currentHeaderEl.isEqualNode(nextHeaderEl)) return true;
  const savedFocus = captureHeaderFocus(currentHeaderEl, document.activeElement);
  currentHeaderEl.replaceWith(nextHeaderEl);
  restoreHeaderFocus(nextHeaderEl, savedFocus, document);
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
  getRouteTransitionPhaseKey() === lastRenderedTransitionPhaseKey &&
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
  lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey();
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
        overlay: payload.overlay,
        legalActions: payload.legalActions,
        selectedPieceId: payload.selectedPieceId,
        selectedPieceMoves: payload.selectedPieceMoves,
        selectedPieceMovePreviews: payload.selectedPieceMovePreviews,
        currentActionType: payload.currentActionType,
        selectedPieceOverlayPhase: payload.selectedPieceOverlayPhase,
        previewKey: payload.previewKey,
        sizeVariant: payload.sizeVariant,
      };
    })
    .filter(Boolean);

  syncMiniBoardPreviews({
    previews,
    registry: miniBoardPreviewRegistry,
    createAdapter: () => {
      const adapter = createEngineBoardAdapter();
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
    const html = renderGameAlertsHtml(game, inviteFromRole);
    if (alertsEl.innerHTML !== html) alertsEl.innerHTML = html;
    updateRecoveryAnnouncement(game);
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
  if (includeBoard || mountedBoardGameId === game.id) {
    mountBoardForGame(game);
  }
  applySharedMutationGates(game);
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
  syncMountedGameShellPanelUi(shellRoot);
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
  return !getActiveApprovalRequest(game) && !getActiveRevertRequest(game) && !getActivePendingRevertRequest(game) && doesMountedFlyoutStateMatchRoute();
};

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  const game = transport.getGameViewModel(gameId);
  if (!routeHydrated && !game) {
    return renderGameViewSkeleton();
  }
  if (!game) {
    return `<section class="panel" role="status"><h2>Game unavailable</h2><p>We could not open this game. Try again or return home.</p><button data-action="retry-game-route">Try again</button> <a class="button-link secondary" href="#/">Back to home</a></section>`;
  }
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(
    game.inviteToken || inviteToken || game.id,
    getCurrentFlyoutState(),
  )}`;
  return `
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
    <section class="invite-gate" data-testid="approval-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Approval required</p>
        <h2>Respond to this player request</h2>
        <p>${participantButton(request)} wants to join as ${renderSeatLabel(request.requestedSeat)}.</p>
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button
              data-action="accept-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              data-testid="accept-request"
            >Accept</button>
            <span class="small invite-choice-note">Approve the request and promote this participant into the requested player seat.</span>
          </div>
          <div class="invite-choice-row">
            <button
              class="secondary"
              data-action="ignore-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              data-testid="ignore-request"
            >Ignore</button>
            <span class="small invite-choice-note">Dismiss this prompt for now. The request remains visible in Join / Invite.</span>
          </div>
        </div>
      </section>
      <div class="invite-gate-content" aria-hidden="true">
        ${background}
      </div>
    </section>
  `;
};

const renderRevertApprovalGate = (game, request) => {
  const background = renderGameContent(game.id);
  const move = Array.isArray(game.moves) ? game.moves.find((entry) => entry.moveId === request.targetMoveId) : null;
  return `
    <section class="invite-gate" data-testid="invite-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Approval required</p>
        <h2>Respond to undo request</h2>
        <p><span class="mono">${escapeHtml(request.requesterIdentityId)}</span> wants to undo this game to Move ${escapeHtml(
          String(move?.displayMoveNumber ?? "?"),
        )}: ${escapeHtml(move?.notation ?? "Unknown move")}.</p>
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button
              data-action="accept-revert-request"
              data-game-id="${escapeHtml(game.id)}"
              data-request-id="${escapeHtml(request.requestId)}"
            >Accept</button>
            <span class="small invite-choice-note">Approve and mark selected/future moves undone.</span>
          </div>
          <div class="invite-choice-row">
            <button
              class="secondary"
              data-action="reject-revert-request"
              data-game-id="${escapeHtml(game.id)}"
              data-request-id="${escapeHtml(request.requestId)}"
            >Reject</button>
            <span class="small invite-choice-note">Dismiss this request and keep both players on the current live game state.</span>
          </div>
        </div>
      </section>
      <div class="invite-gate-content" aria-hidden="true">
        ${background}
      </div>
    </section>
  `;
};

const renderRevertWaitingGate = (game, request) => {
  const background = renderGameContent(game.id);
  const move = Array.isArray(game.moves) ? game.moves.find((entry) => entry.moveId === request.targetMoveId) : null;
  return `
    <section class="invite-gate" data-testid="invite-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Approval pending</p>
        <h2>Waiting for undo approval</h2>
        <p>Your undo request for Move ${escapeHtml(String(move?.displayMoveNumber ?? "?"))}: ${escapeHtml(
          move?.notation ?? "Unknown move",
        )} is pending the other player's response.</p>
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button
              class="secondary"
              data-action="rescind-revert-request"
              data-game-id="${escapeHtml(game.id)}"
              data-request-id="${escapeHtml(request.requestId)}"
            >Rescind</button>
            <span class="small invite-choice-note">Cancel this request and unlock both players to continue without undoing.</span>
          </div>
        </div>
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
  const revertRequest = getActiveRevertRequest(game);
  if (revertRequest) {
    return renderRevertApprovalGate(game, revertRequest);
  }
  const pendingRevertRequest = getActivePendingRevertRequest(game);
  if (pendingRevertRequest) {
    return renderRevertWaitingGate(game, pendingRevertRequest);
  }
  if (currentRoute.name === "game") {
    return renderGameShellFrame(game);
  }
  return renderGameContent(gameId, inviteFromRole, inviteToken);
};

const renderInviteLanding = (inviteContext) => {
  if (!routeHydrated || !inviteContext?.gameId) {
    return renderInvitePageSkeleton();
  }

  const game = transport.getGameViewModel(inviteContext.gameId);
  const background = renderGameContent(inviteContext.gameId, inviteContext.inviteFromRole, inviteContext.inviteToken);
  if (!game) {
    return background;
  }

  const canJoinPlayer = game.canJoinAsPlayer && game.showJoinActions;
  const canJoinViewer = account.snapshot().enabled || game.canJoinAsViewer;
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
  const joinPlayerButtonKey = getJoinButtonKey("player", game.id);
  const joinViewerButtonKey = getJoinButtonKey("viewer", game.id);

  return `
    <section class="invite-gate">
      <section class="panel invite-gate-modal">
        <p class="small invite-gate-kicker">Invite received</p>
        <h2>Choose how to enter this game</h2>
        <p>${colorizePlayerReferences(inviteMessage)} Join now to enter the live game route and receive updates.</p>
        ${pendingNotice}
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button data-action="accept-invite-player" data-game-id="${escapeHtml(game.id)}" data-testid="invite-join-player"${renderButtonStateAttributes({
              pendingKey: joinPlayerButtonKey,
              disabled: !canJoinPlayer,
            })}>${isButtonPending(joinPlayerButtonKey) ? "Joining..." : escapeHtml(playerActionLabel)}</button>
            <span class="small invite-choice-note">${escapeHtml(playerExplainer)}</span>
          </div>
          <div class="invite-choice-row">
            <button data-action="accept-invite-viewer" data-game-id="${escapeHtml(game.id)}" data-testid="invite-join-viewer"${renderButtonStateAttributes({
              className: "secondary",
              pendingKey: joinViewerButtonKey,
              disabled: !canJoinViewer,
            })}>${isButtonPending(joinViewerButtonKey) ? "Joining..." : "Join as viewer"}</button>
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
        <button class="secondary" data-action="tutorial-skip-all" data-game-id="${escapeHtml(gameId || "")}">Skip tutorial</button>
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

const getHistoryDestroyedPieceOverlays = (game) => {
  if (!game?.inHistoryMode || typeof game.historyIndex !== "number") {
    return [];
  }
  const move = Array.isArray(game.moves) ? game.moves[game.historyIndex] : null;
  return buildDestroyedPieceOverlays({
    destroyedPieceRecords: move?.destroyedPieces ?? [],
    preActionSnapshot: move?.selectionSnapshot ?? null,
  });
};

const getHistoryRecordedActionStartPiece = (game) => {
  if (!game?.inHistoryMode || typeof game.historyIndex !== "number") {
    return null;
  }
  const move = Array.isArray(game.moves) ? game.moves[game.historyIndex] : null;
  if (!move?.selectionSnapshot || !move?.action) {
    return null;
  }
  return findRecordedActionStartPiece(move.selectionSnapshot, move.action);
};

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

  applySharedMutationGates(game);
  updateRecoveryAnnouncement(game);
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
  const initialSelectionHydration = resolveInitialSelectionHydration({
    gameId: game.id,
    initialSelectionAction: !game.inHistoryMode ? game.initialSelectionAction ?? null : null,
    legalActions: effectiveLegalActions,
    consumedActionKey: consumedInitialSelectionActionKeyByGameId.get(game.id) ?? null,
    toStableKey,
  });
  if (!snapshot) {
    return;
  }

  const snapshotKey = toStableKey(snapshot);
  const legalActionsKey = toStableKey(effectiveLegalActions);
  const historyDestroyedPieces = getHistoryDestroyedPieceOverlays(game);
  const historyRecordedActionStartPiece = getHistoryRecordedActionStartPiece(game);
  const forceClickTargetSelection = currentRoute.scenarios;
  const hydratedSelectionAction = scenarioSelectionHydration.selectionAction ?? initialSelectionHydration.selectionAction;
  const overlayKey = toStableKey({
    overlayMode,
    recordedAction: historySelectionAction,
    recordedActionStartPiece: historyRecordedActionStartPiece,
    destroyedPieces: historyDestroyedPieces,
    selectionAction: hydratedSelectionAction,
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
          return canControlLiveBoard(view);
        },
      }),
      controls: {
        getAllowFreeSelection: () => false,
        getExplanatoryMode: () => { const help = getGameHelp(game.id).getState(); return help.manual || help.expanded; },
        onContextHelp: (event) => {
          updateGameHelp(game.id, event);
          window.requestAnimationFrame(() => {
            if (currentRoute.name === "game" && currentRoute.gameId === game.id) updateGameHelp(game.id);
          });
        },
        getSupportsHover: () => hoverCapability.getSupportsHover(),
        getForceClickTargetSelection: () => Boolean(currentRoute.scenarios),
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
      failedOperationsKey: getFailedOperationsKey(game.id),
    });
    boardRuntime.bindElements({ boardEl, overlayLinesEl, boardPreviewLabelEl, boardTurnIndicatorEl });
    boardRuntime.syncInteractionCapabilities?.();
    if (initialSelectionHydration.shouldConsume) {
      consumedInitialSelectionActionKeyByGameId.set(game.id, initialSelectionHydration.nextConsumedActionKey);
    }
    void boardRuntime.loadSnapshot(snapshot, {
      legalActions: effectiveLegalActions,
      resetSelection: true,
      selectionAction: hydratedSelectionAction,
      selectionState: scenarioSelectionHydration.selectionState,
      overlayMode,
      recordedAction: historySelectionAction,
      recordedActionStartPiece: historyRecordedActionStartPiece,
      destroyedPieces: historyDestroyedPieces,
    });
    return;
  }

  const failedOperationsKey = getFailedOperationsKey(game.id);
  const syncStatusKey = toStableKey({
    syncStatus: game.syncStatus ?? "ready",
    failedOperationsKey,
  });
  const resetSelection =
    mountedHistoryMoveIndex !== historyMoveIndex ||
    (mountedSyncStatusKey !== syncStatusKey && failedOperationsKey.length > 0) ||
    shouldResetBoardSelection({
      currentSnapshot: boardRuntime.getState?.() ?? null,
      nextSnapshot: snapshot,
      currentSelection: boardRuntime.getSelection?.() ?? null,
      nextLegalActions: effectiveLegalActions,
    });
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
  if (initialSelectionHydration.shouldConsume) {
    consumedInitialSelectionActionKeyByGameId.set(game.id, initialSelectionHydration.nextConsumedActionKey);
  }
  void boardRuntime.loadSnapshot(snapshot, {
    legalActions: effectiveLegalActions,
    resetSelection,
    selectionAction: hydratedSelectionAction,
    selectionState: scenarioSelectionHydration.selectionState,
    overlayMode,
    recordedAction: historySelectionAction,
    recordedActionStartPiece: historyRecordedActionStartPiece,
    destroyedPieces: historyDestroyedPieces,
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

const loadHomeSectionServerPage = async (
  sectionKey,
  serverPage,
  {
    visiblePageSize = getHomeSectionVisiblePageSize(sectionKey),
    visibleColumnCount = getHomeSectionColumnCount(sectionKey),
  } = {},
) => {
  const previous = getHomeSection(sectionKey);
  const accountGeneration = account.snapshot().generation;
  const response = await transport.loadGamesPage({
    section: sectionKey,
    page: serverPage,
    pageSize: HOME_SECTION_SERVER_PAGE_SIZE,
    finished: sectionKey === "my",
    debug: currentRoute.debug === true,
  });
  if (accountGeneration !== account.snapshot().generation) throw Object.assign(new Error("session_changed"), {code:"session_changed"});
  const normalizedServerPage = typeof response.page === "number" ? response.page : 0;
  const serverPageGameIds = Array.isArray(response.games) ? response.games.map((game) => game.id) : [];
  const nextSection = {
    ...previous,
    totalGames: typeof response.totalGames === "number" ? response.totalGames : 0,
    serverPage: normalizedServerPage,
    serverTotalPages: typeof response.totalPages === "number" ? response.totalPages : 0,
    serverPageGameIds,
    serverPageGameIdsByPage: {
      ...previous.serverPageGameIdsByPage,
      [normalizedServerPage]: serverPageGameIds,
    },
    visiblePageSize,
    visibleColumnCount,
  };
  setHomeSection(sectionKey, nextSection);
  return nextSection;
};

const loadHomeSectionPage = async (
  sectionKey,
  {
    page = getHomeSection(sectionKey).page,
    direction = "none",
    visiblePageSize = getHomeSectionVisiblePageSize(sectionKey),
    visibleColumnCount = getHomeSectionColumnCount(sectionKey),
  } = {},
) => {
  const previous = getHomeSection(sectionKey);
  let nextSection = {
    ...previous,
    visiblePageSize,
    visibleColumnCount,
  };
  const initialServerPage = Math.floor((Math.max(0, page) * visiblePageSize) / HOME_SECTION_SERVER_PAGE_SIZE);
  const shouldPrimeCache = Object.keys(nextSection.serverPageGameIdsByPage ?? {}).length === 0;
  if (shouldPrimeCache) {
    nextSection = await loadHomeSectionServerPage(sectionKey, initialServerPage, { visiblePageSize, visibleColumnCount });
  }
  const requiredServerPages = getHomeSectionRequiredServerPages({
    totalGames: nextSection.totalGames,
    visiblePageSize,
    page,
  });
  for (const serverPage of requiredServerPages) {
    if (!hasHomeSectionServerPages(nextSection, [serverPage])) {
      nextSection = await loadHomeSectionServerPage(sectionKey, serverPage, { visiblePageSize, visibleColumnCount });
    }
  }
  const normalizedPage = getHomeSectionSafePage(nextSection.totalGames, visiblePageSize, page);
  const normalizedTotalPages = getHomeSectionVisibleTotalPages(nextSection.totalGames, visiblePageSize);
  const visibleGameIds = getHomeSectionVisibleGameIdsFromCache(nextSection, {
    page: normalizedPage,
    visiblePageSize,
  }) ?? [];
  const nextDirection = normalizedTotalPages > 1 && normalizedPage !== previous.page ? direction : "none";
  setHomeSection(sectionKey, {
    ...nextSection,
    page: normalizedPage,
    totalPages: normalizedTotalPages,
    gameIds: visibleGameIds,
    slideDirection: nextDirection,
    animationToken: nextDirection === "none" ? previous.animationToken : previous.animationToken + 1,
  });
};

const syncResponsiveHomeSectionPageSizes = async () => {
  const visibleSectionKeys = getVisibleHomeSectionKeys();
  let updated = false;
  for (const sectionKey of visibleSectionKeys) {
    const section = getHomeSection(sectionKey);
    const nextVisibleColumnCount = getHomeSectionColumnCount(sectionKey);
    const nextVisiblePageSize = getHomeSectionVisiblePageSize(sectionKey);
    if (section.visiblePageSize === nextVisiblePageSize && section.visibleColumnCount === nextVisibleColumnCount) {
      continue;
    }
    const anchorGameId = section.gameIds[0] ?? null;
    const anchorIndex = getHomeSectionCachedGameIndex(section, anchorGameId);
    const nextPage = anchorIndex === null ? section.page : Math.floor(anchorIndex / nextVisiblePageSize);
    if (section.visiblePageSize === nextVisiblePageSize) {
      const visibleGameIds = getHomeSectionVisibleGameIdsFromCache(section, {
        page: nextPage,
        visiblePageSize: nextVisiblePageSize,
      }) ?? section.gameIds;
      setHomeSection(sectionKey, {
        ...section,
        page: nextPage,
        totalPages: getHomeSectionVisibleTotalPages(section.totalGames, nextVisiblePageSize),
        gameIds: visibleGameIds,
        visibleColumnCount: nextVisibleColumnCount,
      });
    } else {
      await loadHomeSectionPage(sectionKey, {
        page: nextPage,
        direction: "none",
        visiblePageSize: nextVisiblePageSize,
        visibleColumnCount: nextVisibleColumnCount,
      });
    }
    updated = true;
  }
  return updated;
};

const loadResumePage = async (page = 0, { renderPending = false } = {}) => {
  const requestId = ++resumeRequestId;
  resumeSection = { ...resumeSection, pending: true };
  if (renderPending) render({ animatePanels: false });
  const generation = account.snapshot().generation;
  try {
    const response = await transport.loadGamesPage({ section: "my", page, pageSize: 4, unfinished: true });
    if (generation !== account.snapshot().generation || requestId !== resumeRequestId) return;
    resumeSection = { gameIds: response.games.map((game) => game.id), page: response.page, totalPages: response.totalPages, totalGames: response.totalGames, error: false, pending: false };
  } catch { if (generation === account.snapshot().generation && requestId === resumeRequestId) resumeSection = { ...resumeSection, error: true, pending: false }; }
};

const syncHomeSections = async () => {
  const visibleSectionKeys = getVisibleHomeSectionKeys();
  await Promise.all([loadResumePage(resumeSection.page), ...
    visibleSectionKeys.map(async (sectionKey) => {
      const section = getHomeSection(sectionKey);
      setHomeSection(sectionKey, {
        ...section,
        totalGames: 0,
        totalPages: 0,
        gameIds: [],
        serverPage: 0,
        serverTotalPages: 0,
        serverPageGameIds: [],
        serverPageGameIdsByPage: {},
        visiblePageSize: getHomeSectionVisiblePageSize(sectionKey),
        visibleColumnCount: getHomeSectionColumnCount(sectionKey),
        slideDirection: "none",
      });
      await loadHomeSectionPage(sectionKey, { page: section.page, direction: "none" });
    }),
  ]);
  const hiddenSectionKeys = ["my", "other", "smoke"].filter((sectionKey) => !visibleSectionKeys.includes(sectionKey));
  hiddenSectionKeys.forEach((sectionKey) => {
    const section = getHomeSection(sectionKey);
    setHomeSection(sectionKey, {
      ...section,
      page: 0,
      totalPages: 0,
      totalGames: 0,
      gameIds: [],
      serverPage: 0,
      serverTotalPages: 0,
      serverPageGameIds: [],
      serverPageGameIdsByPage: {},
      visiblePageSize: HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,
      visibleColumnCount: 1,
      slideDirection: "none",
    });
  });
};

const scheduleResponsiveHomeSectionPageSizes = () => {
  window.cancelAnimationFrame(homeSectionResizeFrame);
  homeSectionResizeFrame = window.requestAnimationFrame(() => {
    homeSectionResizeFrame = 0;
    void (async () => {
      if (currentRoute.name !== "home") {
        return;
      }
      const didUpdate = await syncResponsiveHomeSectionPageSizes();
      if (!didUpdate) {
        return;
      }
      syncLiveChannels();
      render({ animatePanels: false, includeBoard: false });
    })();
  });
};

const renderGesture = createRenderGestureGate({ render: options => render(options) });
window.addEventListener("pointerdown", event => {
  if (appEl.contains(event.target) && event.target.closest?.("button, a, [data-action]")) renderGesture.begin();
}, true);
window.addEventListener("keydown", event => {
  if (!event.repeat && (event.key === " " || event.key === "Enter") && appEl.contains(event.target) && event.target.closest?.("button, a, [data-action]")) renderGesture.begin();
}, true);
window.addEventListener("keyup", event => { if (event.key === " " || event.key === "Enter") renderGesture.end(); }, true);
for (const type of ["pointerup", "pointercancel", "touchcancel", "lostpointercapture", "click"])
  window.addEventListener(type, () => renderGesture.end(), true);
window.addEventListener("blur", event => { if (event.target === window) renderGesture.end(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") renderGesture.end(); });

const render = ({ animatePanels = true, includeBoard = true } = {}) => {
  if (renderGesture.defer({ animatePanels, includeBoard })) return;
  return preserveBoardFocus({ document, getGameId: getCurrentViewedGameId }, () => renderContent({ animatePanels, includeBoard }));
};
const renderContent = ({ animatePanels, includeBoard }) => {
  document.title = getDocumentTitle();
  brandController.setHome(currentRoute.name === "home");
  const affiliationGameId = getCurrentViewedGameId();
  appEl.setAttribute("data-action-affiliation", resolveActionAffiliation({
    game: affiliationGameId ? transport.getGameViewModel(affiliationGameId) : null,
    identityId: transport.getIdentityId(),
    pendingSide: currentRoute.name === "home" ? homeSide : null,
    selfPlaySide: transport.getGameViewModel(affiliationGameId)?.selfPlayStartSide ?? selfPlayStartSides.get(`${transport.getIdentityId()}:${affiliationGameId}`) ?? "p1",
  }));
  syncRouteTransitionForCurrentRoute();
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
    syncMountedGameShellPanelUi();
    reconcileMiniBoardPreviews();
    if (includeBoard) {
      if (currentRoute.name === "game") {
        mountBoardForGame(transport.getGameViewModel(currentRoute.gameId));
      } else if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
        mountBoardForGame(transport.getGameViewModel(resolvedInvite.gameId));
      }
    }
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
    getRouteTransitionPhaseKey() === lastRenderedTransitionPhaseKey &&
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
    if (!routeHydrated) {
      body = renderInvitePageSkeleton();
    } else {
      const game = resolvedInvite?.gameId ? transport.getGameViewModel(resolvedInvite.gameId) : null;
      const inviteContext = getInviteContextForGame(game, "invite");
      body = inviteContext
        ? renderInviteLanding(inviteContext)
        : renderGame(resolvedInvite?.gameId || null, resolvedInvite?.inviteFromRole || null, resolvedInvite?.inviteToken || null);
    }
  } else if (currentRoute.name === "tutorial") {
    body = renderTutorial(currentRoute.gameId);
  } else {
    body = renderNotFound();
  }

  const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">${renderHeader()}${body}</div>${renderFlyouts()}</div>`;
  if (nextMarkup !== lastRenderedMarkup) {
    const savedHomeFocus = currentRoute.name === "home" ? captureHomeFocus(appEl, document.activeElement) : null;
    const savedHeaderFocus = captureHeaderFocus(getMountedHeaderEl(), document.activeElement);
    appEl.innerHTML = nextMarkup;
    restoreHeaderFocus(getMountedHeaderEl(), savedHeaderFocus, document);
    restoreHomeFocus(appEl, savedHomeFocus);
    lastRenderedMarkup = nextMarkup;
    lastRenderedMainMarkup = `<div class="shell-main-content">${renderHeader()}${body}</div>`;
    lastRenderedFlyoutMarkup = renderFlyouts();
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
    lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey();
    if (animatePanels) {
      if (currentRoute.name !== "home") animatePanelHeightChanges(previousPanelHeights);
      animateFlyoutPositionChanges(previousFlyoutRects);
    }
  }
  if (nextMarkup === lastRenderedMarkup) {
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
    lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey();
  }
  syncFlyoutAwareLinks();
  syncCopyInviteLinks();
  updateHeaderFields();
  syncMountedGameShellPanelUi();
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

const withPendingButton = async (pendingKey, fn, { renderStart = true, renderEnd = true } = {}) => {
  if (!pendingKey || pendingButtonKeys.has(pendingKey)) {
    return;
  }
  const pendingGeneration=account.snapshot().generation;
  pendingButtonKeys.add(pendingKey);
  if (renderStart) {
    render({ animatePanels: false, includeBoard: false });
  }
  try {
    return await fn();
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
    return undefined;
  } finally {
    if(pendingGeneration!==account.snapshot().generation)return;
    pendingButtonKeys.delete(pendingKey);
    if (renderEnd) {
      render({ animatePanels: false, includeBoard: false });
    }
  }
};

const syncRouteData = async () => {
  const requestRoute = currentRoute;
  const generation = navigationGeneration;
  if (requestRoute.name === "home") {
    await syncHomeSections();
    return;
  }
  if (requestRoute.name === "game") {
    resolvedInvite = null;
    await transport.loadGame(requestRoute.gameId, { openAsViewer: false });
    return;
  }
  if (requestRoute.name === "invite") {
    const invitation = await transport.resolveInvite(requestRoute.inviteToken);
    if (generation !== navigationGeneration) return;
    resolvedInvite = invitation;
    await transport.loadGame(invitation.gameId, { openAsViewer: false });
    return;
  }
};

const syncRouteDataAndLiveChannels = async () => {
  const generation = navigationGeneration;
  await syncRouteData();
  if (generation === navigationGeneration) syncLiveChannels();
};

const canHydrateRouteFromLocalState = (route = currentRoute) => {
  if (route?.name !== "game" || !route?.gameId) {
    return false;
  }
  return Boolean(transport.getGameViewModel(route.gameId));
};

const startRouteSync = ({ renderStart = true } = {}) => {
  const requestId = ++routeSyncRequestId;
  routeHydrated = false;
  syncLiveChannels();
  if (renderStart) {
    render({ animatePanels: false, includeBoard: false });
  }
  void (async () => {
    try {
      await syncRouteDataAndLiveChannels();
    } catch (error) {
      window.__righeltLastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (requestId !== routeSyncRequestId) {
        return;
      }
      restoreGamePosition();
      routeHydrated = true;
      render({ animatePanels: false, includeBoard: false });
      maybeRevealRouteTransition();
    }
  })();
};

const syncRouteDataPassive = async () => {
  const generation = navigationGeneration;
  const requestId = routeSyncRequestId;
  try {
    await syncRouteDataAndLiveChannels();
    if (generation !== navigationGeneration || requestId !== routeSyncRequestId) return;
    routeHydrated = true;
    render({ animatePanels: false, includeBoard: false });
    maybeRevealRouteTransition();
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
    selectedScenarioFeedback = error instanceof Error ? error.message : "Failed to load scenarios";
  }
};

const makeAccountSyncStore = auth => createSyncStore({
  storage,
  auth,
  fetcher: account.fetch,
  onAuthLost: () => account.authorityLost(),
  onEvent: (payload) => {
    wsLastEvent = payload?.type
      ? `${payload.type}${payload?.reason ? `:${payload.reason}` : ""}`
      : "unknown";
    if (document.getElementById("shell-debug-last-event")) {
      updateHeaderFields();
    } else {
      render({ animatePanels: false, includeBoard: false });
    }
  },
  onError: (error) => {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  },
  onMetric: (metric) => {
    const key = metric?.type || "unknown";
    liveSyncMetricCounts[key] = (liveSyncMetricCounts[key] ?? 0) + 1;
    liveSyncMetricCounts.last = metric;
    liveSyncMetricCounts.activeSocketCount = metric?.activeSocketCount ?? 0;
    liveSyncMetricCounts.desiredSocketCount = metric?.desiredSocketCount ?? 0;
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
    if (document.getElementById("shell-debug-live-sync")) {
      updateHeaderFields();
    } else {
      render({ animatePanels: false, includeBoard: false });
    }
  },
});
let syncStore = makeAccountSyncStore(account.snapshot());
let transport = syncStore;
const subscribeToTransport = () => transport.subscribe((change) => {
  if (change?.type === "upgrade_required") {
    try {
      const key = "righelt.sync-v2-refresh";
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        window.location.reload();
        return;
      }
    } catch { /* Keep the visible update notice if session storage cannot guard a reload. */ }
  }
  render({
    animatePanels: false,
    includeBoard: change?.type !== "optimistic_enqueue",
  });
});

subscribeToTransport();
accountInitialized = true;
function resetAccountTransport(next) {
  storyStart.cancel();
  if (pendingOpponentTutorial) { pendingOpponentTutorial.reject(new Error("Account changed. Choose your opponent again.")); pendingOpponentTutorial = null; }
  storyDialog.refresh();
  const gameId = getCurrentViewedGameId();
  const visible = gameId ? transport.getAuthoritativeGame?.(gameId) : null;
  routeSyncRequestId++;
  pendingButtonKeys.clear();pendingHomeSectionKeys.clear();inviteChoiceCommittedByGameId.clear();ignoredApprovalRequests.clear();ignoredRevertRequests.clear();
  consumedInitialSelectionActionKeyByGameId.clear();
  transport.retire?.();
  destroyMountedBoardRuntime();
  clearRouteTransition({ renderNow: false });

  resumeSection = { gameIds: [], page: 0, totalPages: 0, totalGames: 0, error: false };
  homeStartStatus = "";
  homeSections = { my: createHomeSectionState("Completed games"), other: createHomeSectionState("Other games"), smoke: createHomeSectionState("Deploy smoke player") };
  syncStore = makeAccountSyncStore(next);transport = syncStore;subscribeToTransport();
  if (visible) {
    for (const key of ['canRecordMove','canEndTurn','canInvite','canPlayAsBothPlayers','canUndoLastMove']) visible[key] = false;
    visible.legalActions=[];visible.myRoles=[];visible.myRole=null;visible.inviteToken=null;delete visible.inviteTokens;
    visible.pendingJoinRequests=[];visible.pendingRevertRequest=null;visible.myPendingRevertRequest=null;visible.approvableRevertRequest=null;visible.approvableRequesterIds=[];visible.pendingPlayerRequestSeat=null;
    transport.applyLiveGameUpdate({ game: visible });
  }
  queueMicrotask(() => { if (account.snapshot().ready) startRouteSync(); });
}
const syncLiveChannels = () => {
  const routeGameId =
    shouldLiveSyncRoute(currentRoute) &&
    (currentRoute.name === "game"
      ? currentRoute.gameId
      : currentRoute.name === "invite"
        ? resolvedInvite?.gameId || null
        : null);
  syncStore.setActiveGameId(routeGameId);
  if (!routeGameId) {
    resetRouteWsStatus();
  }
};

const restoreHomePosition = () => {
  if (currentRoute.name !== "home" || !routeHydrated || !homeReturn?.pending) return;
  const saved = homeReturn;
  homeReturn = { ...saved, pending: false };
  const generation = navigationGeneration;
  window.requestAnimationFrame(() => {
    if (generation !== navigationGeneration || currentRoute.name !== "home") return;
    const card = [...appEl.querySelectorAll('.mini-board-card-link-surface')].find((el) => el.dataset.gameId === saved.gameId);
    const target = card ?? appEl.querySelector('h1 a');
    target?.focus({ preventScroll: true });
    window.scrollTo({ top: saved.scrollY, behavior: "instant" });
  });
};
const restoreGamePosition = () => {
  if (!pendingViewRestore || currentRoute.name !== "game" || currentRoute.gameId !== pendingViewRestore.gameId) return;
  const game = transport.getGameViewModel(currentRoute.gameId);
  if (!game) return;
  const saved = pendingViewRestore;
  pendingViewRestore = null;
  const restore = canRestoreGameView(saved, game, transport.getIdentityId());
  if (restore && typeof saved.historyIndex === "number") transport.selectHistoryMove({ gameId: game.id, moveIndex: saved.historyIndex });
  else if (game.inHistoryMode) transport.returnToLive({ gameId: game.id });
  currentRoute = { ...currentRoute, panel: restore ? saved.panel : "board" };
  window.history.replaceState(null, "", buildHashForRoute(currentRoute));
};

const navigateTo = (hash) => {
  const parsedRoute = parseRouteFromHash(hash);
  const preferredFlyoutKey = FLYOUT_KEYS.find((key) => parsedRoute[key] && !currentRoute[key]) ?? null;
  const nextRoute = normalizeRouteFlyoutState(parsedRoute, { preferredFlyoutKey });
  const nextHash = buildHashForRoute(nextRoute);
  const previousRoute = currentRoute;
  closeHeaderMenu();
  if (window.location.hash === nextHash) {
    currentRoute = nextRoute;
    syncFlyoutRenderOrder(currentRoute);
    if (isFlyoutOnlyRouteChange(previousRoute, nextRoute)) {
      if (currentRoute.name === "home" && previousRoute.debug !== currentRoute.debug) {
        startRouteSync({ renderStart: false });
        return;
      }
      render();
      return;
    }
    startRouteSync();
    return;
  }
  window.location.hash = nextHash;
};

window.addEventListener("hashchange", () => {
  const previousRoute = currentRoute;
  if (previousRoute.name === "game") {
    const game = transport.getGameViewModel(previousRoute.gameId);
    if (game) savedGameViews.set(`${transport.getIdentityId()}:${game.id}`, { gameId: game.id, identity: transport.getIdentityId(), revision: gamePlayRevision(game), panel: getGamePanel(previousRoute), historyIndex: game.inHistoryMode ? game.historyIndex : null });
  }
  closeHeaderMenu();
  const parsedRoute = parseRouteFromHash(window.location.hash);
  currentRoute = normalizeRouteFlyoutState(parsedRoute);
  if (cancelAbandonedOpponentTutorial(previousRoute, currentRoute, pendingOpponentTutorial, () => storyStart.cancel())) pendingOpponentTutorial = null;
  if (previousRoute.name !== currentRoute.name || previousRoute.gameId !== currentRoute.gameId || previousRoute.inviteToken !== currentRoute.inviteToken) {
    navigationGeneration += 1;
    routeSyncRequestId += 1;
  }
  if (previousRoute.name === "home" && currentRoute.name === "game") {
    homeReturn = { scrollY: homeReturn?.gameId === currentRoute.gameId ? homeReturn.scrollY : window.scrollY, gameId: currentRoute.gameId, pending: false };
    if (!routeTransition) startGameEntryRouteTransition(currentRoute.gameId, "home");
  } else if (previousRoute.name === "game" && currentRoute.name === "home") {
    if (homeReturn) homeReturn.pending = true;
    startGameEntryRouteTransition(previousRoute.gameId, "game", "home");
  }
  if (currentRoute.name === "game" && (previousRoute.name !== "game" || previousRoute.gameId !== currentRoute.gameId)) {
    pendingViewRestore = savedGameViews.get(`${transport.getIdentityId()}:${currentRoute.gameId}`) ?? null;
  }
  syncRouteTransitionForCurrentRoute();
  const normalizedHash = buildHashForRoute(currentRoute);
  if (window.location.hash !== normalizedHash) {
    window.location.hash = normalizedHash;
    return;
  }
  syncFlyoutRenderOrder(currentRoute);
  if (canHydrateRouteFromLocalState(currentRoute) && !pendingViewRestore) {
    routeHydrated = true;
    syncLiveChannels();
    render();
    maybeRevealRouteTransition();
    return;
  }
  if (isFlyoutOnlyRouteChange(previousRoute, currentRoute)) {
    if (currentRoute.name === "home" && previousRoute.debug !== currentRoute.debug) {
      startRouteSync({ renderStart: false });
      return;
    }
    render();
    return;
  }
  startRouteSync();
});

window.addEventListener("resize", () => {
  syncMountedGameShellPanelUi();
  if (currentRoute.name === "game") updateGameHelp(currentRoute.gameId);
  scheduleGameShellStickyLayout();
  scheduleResponsiveHomeSectionPageSizes();
});

window.addEventListener("load", () => {
  scheduleGameShellStickyLayout();
  scheduleResponsiveHomeSectionPageSizes();
});

// The first click may arrive while the initial cookie is still being read.
// Resolve that session before choosing login versus recovery acknowledgment.
const waitForAccountGate = async () => {
  const hash = window.location.hash;
  let awaitedLogout = false;
  try {
    if (!account.snapshot().ready) await account.start();
    if (account.snapshot().pendingLogout) {
      awaitedLogout = true;
      await account.hydrate();
    }
  } catch { return false; }
  const state = account.snapshot();
  return hash === window.location.hash && state.ready && !state.pendingLogout
    && (!awaitedLogout || !state.session.authenticated);
};
const openBoardAccountGate = async source => {
  if (!await waitForAccountGate()) return;
  const state = account.snapshot();
  if (state.available === false || state.maintenance || account.canPlay() || accountDialog.isOpen()) return;
  accountDialog.open(state.session.recoveryAcknowledgmentRequired ? "replacement" : "login", null, source);
};

let pendingOpponentTutorial = null;
const storyStart = createOpponentStartCoordinator({
  getAccount: () => ({ canPlay: account.canPlay(), generation: account.snapshot().generation, tutorial: account.snapshot().session.account?.preferences?.tutorial || "new" }),
  getReadiness: getComputerReadiness,
  markIntroduced: bit => account.updateAccount({ preferences: { introducedOpponents: bit } }),
  runTutorial: intent => new Promise((resolve, reject) => {
    pendingOpponentTutorial = { intent, resolve, reject, generation: account.snapshot().generation };
    storyDialog.close("handoff");
    tutorial.reset(); navigateTo(buildTutorialHash());
  }),
  createGame: async () => { throw new Error("The trained opponent is not available yet."); },
});
const storyDialog = createOpponentStoryDialog({ createModal, getReadiness: getComputerReadiness,
  onPresentation: () => {
    const root = document.createElement("div"); root.className = "story-presentation-board";
    root.inert = true; root.setAttribute("aria-hidden", "true"); document.body.append(root);
    const preview = createMiniBoardPreview({ rootEl: root, preview: { snapshot: createInitialBoardSnapshot(), previewKey: "initial-story-board" }, createAdapter: createEngineBoardAdapter });
    return () => { preview.destroy(); root.remove(); };
  },
  onPlay: intent => {
    if (!account.canPlay()) {
      storyDialog.close();
      accountDialog.open(account.snapshot().session.recoveryAcknowledgmentRequired ? "replacement" : "login", safeAccountIntent({ hash: window.location.hash, action: "start-opponent", ...intent }));
      return { state: "account-required" };
    }
    return storyStart.accept(intent);
  }, onClose: reason => { if (reason !== "handoff") storyStart.cancel(); },
});
const startPersonalGame = ({ opponent, side }, trigger = null) => {
  if (!account.canPlay() || !isPersonalSide(side)) return;
  if (isComputerOpponent(opponent)) {
    const readiness = getComputerReadiness(opponent);
    homeStartStatus = readiness.message;
    if (shouldShowOpponentIntroduction(opponent, account.snapshot().session.account?.preferences?.introducedOpponents || 0, readiness)) storyDialog.open(opponent, { side, trigger: trigger?.isConnected ? trigger : appEl.querySelector(`button[data-opponent="${opponent}"]`) || document.activeElement });
    else void storyStart.accept({ opponent, side }).then(result => {
      if (result.state !== "started" && result.state !== "cancelled") { homeStartStatus = result.message || readiness.message; render(); }
    });
    return;
  }
  if (opponent !== "friend" && opponent !== "self") return;
  const handle = transport.createGame({ selfPlayMode: opponent === "self", creatorSide: side });
  selfPlayStartSides.set(`${transport.getIdentityId()}:${handle.result.id}`, side);
  startGameEntryRouteTransition(handle.result.id, "home");
  navigateTo(buildGameHash(handle.result.id, null, getCurrentFlyoutState()));
};
appEl.addEventListener("change", (event) => {
  if (event.target.name !== "home-side" || !isPersonalSide(event.target.value)) return;
  homeSide = event.target.value;
  appEl.setAttribute("data-action-affiliation", homeSide === "p2" ? "blue" : "red");
});

appEl.addEventListener("keydown", event => {
  if (event.target.closest?.("#shell-board") && (event.key === "Enter" || event.key === " ") && !account.canPlay()) {
    event.preventDefault(); event.stopImmediatePropagation();
    void openBoardAccountGate(event.target);
  }
}, true);
appEl.addEventListener("pointerdown", event => {
  if (event.target.closest?.("#shell-board") && !account.canPlay()) {
    event.preventDefault();event.stopImmediatePropagation();
    void openBoardAccountGate(event.target.closest?.("button, [tabindex]"));
  }
}, true);
appEl.addEventListener("click", event => {
  if (event.target.closest?.("#shell-board") && !account.canPlay()) {
    event.preventDefault();event.stopImmediatePropagation();
    void openBoardAccountGate(event.target.closest?.("button, [tabindex]"));
  }
}, true);
appEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const gameLinkEl = target.closest(".mini-board-card-link-surface[data-game-id]");
  if (
    gameLinkEl instanceof HTMLAnchorElement &&
    currentRoute.name === "home" &&
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  ) {
    const gameId = gameLinkEl.getAttribute("data-game-id");
    if (gameId) {
      homeReturn = { scrollY: window.scrollY, gameId, pending: false };
      startGameEntryRouteTransition(gameId, "home");
    }
  }

  if (target.closest("[data-header-menu-close='true']")) {
    closeHeaderMenu();
    if (isNarrowHeaderMode()) {
      syncNarrowHeaderMenuDom();
    }
  }

  const actionEl = target.closest("[data-action]");
  if (!actionEl) {
    return;
  }

  const action = actionEl.getAttribute("data-action");
  const startIntent = { hash: window.location.hash, opponent: actionEl.getAttribute("data-opponent"), side: homeSide };
  if (action === "retry-game-route") { startRouteSync(); return; }
  if (["toggle-explain", "collapse-help", "expand-help"].includes(action)) {
    const gameId = getCurrentViewedGameId();
    if (!gameId) return;
    const help = getGameHelp(gameId);
    if (action === "toggle-explain") {
      const previous = help.getState().manual;
      help.toggleManual();
      if (account.canPlay() && account.snapshot().session.authenticated) {
        const generation = account.snapshot().generation;
        void account.updateAccount({ preferences: { view: help.getState().manual ? "explanatory" : "focused" } }).catch(() => {
          if (generation !== account.snapshot().generation) return;
          help.setManual(previous);
          help.select("Your view preference could not be saved. Try Explain again.");
          updateGameHelp(gameId);
          boardRuntime?.refreshPresentation?.();
        });
      }
    }
    else if (action === "collapse-help") help.dismiss();
    else help.expand();
    updateGameHelp(gameId);
    boardRuntime?.refreshPresentation?.();
    return;
  }
  const actionGameId = actionEl.getAttribute("data-game-id") || currentRoute.gameId;
  if (action === "public-profile") { void publicProfileDialog.open(actionEl.getAttribute("data-username"), actionEl); return; }
  if (action === "retry-account-startup") { if (accountStartupError.includes("refresh")) window.location.reload(); else void initialRender(); return; }
  if (action === "account-open") { accountDialog.open(account.snapshot().session.authenticated ? "account" : "login", null, actionEl); return; }
  const accountGatedActions = new Set(["start-opponent","create-game","join-player","accept-invite-player","play-as-both-players","load-scenario","launch-history-branch"]);
  if (accountGatedActions.has(action) && (!account.snapshot().ready || account.snapshot().pendingLogout)) {
    event.preventDefault();
    if (!await waitForAccountGate()) return;
  }
  if (accountGatedActions.has(action) && !account.canPlay()) {
    event.preventDefault();
    if (!account.snapshot().available || account.snapshot().maintenance) return;
    const intent = safeAccountIntent({ ...startIntent, action, gameId: actionGameId, moveIndex: actionEl.getAttribute("data-move-index") });
    accountDialog.open(account.snapshot().session.recoveryAcknowledgmentRequired ? "replacement" : "login", intent, actionEl);
    return;
  }
  if (sharedMutationActions.has(action) && transport.getGameViewModel(actionGameId)?.sharedMutationsBlocked) return;
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

  if (action === "start-opponent") { startPersonalGame(startIntent, actionEl); return; }
  if (action === "resume-page" || action === "retry-resume") { await loadResumePage(action === "resume-page" ? Number(actionEl.dataset.page) : resumeSection.page, { renderPending: true }); if (currentRoute.name === "home") render(); return; }

  if (action === "create-game") {
    const handle = transport.createGame({ selfPlayMode: false });
    startGameEntryRouteTransition(handle.result.id, "home");
    navigateTo(buildGameHash(handle.result.id, null, getCurrentFlyoutState()));
    return;
  }

  if (action === "launch-history-branch") {
    const gameId = actionEl.getAttribute("data-game-id");
    const moveIndex = Number.parseInt(actionEl.getAttribute("data-move-index") || "-1", 10);
    const activeGame = gameId ? transport.getGameViewModel(gameId) : null;
    if (!activeGame || !Number.isFinite(moveIndex)) {
      return;
    }
    const branchSeed = buildHistoryBranchSeedFromGame(activeGame, moveIndex);
    const handle = transport.launchHistoryBranch({
      sourceGameId: activeGame.id,
      sourceMoveIndex: moveIndex,
      scenario: branchSeed.scenario,
      initialSelectionAction: branchSeed.initialSelectionAction,
      participantCopyMode: branchSeed.participantCopyMode,
    });
    const nextHash = buildGameHash(handle.result.game.id, null, {
      ...getCurrentFlyoutState(),
      scenarios: false,
    });
    window.open(`${window.location.pathname}${window.location.search}${nextHash}`, "_blank", "noopener");
    render({ animatePanels: false, includeBoard: false });
    return;
  }

  if (action === "accept-revert-request") {
    const gameId = actionEl.getAttribute("data-game-id");
    const requestId = actionEl.getAttribute("data-request-id");
    if (!gameId || !requestId) return;
    ignoredRevertRequests.delete(getRevertRequestKey(gameId, requestId));
    transport.approveRevertRequest({ gameId, requestId });
    return;
  }

  if (action === "reject-revert-request") {
    const gameId = actionEl.getAttribute("data-game-id");
    const requestId = actionEl.getAttribute("data-request-id");
    if (!gameId || !requestId) return;
    ignoredRevertRequests.add(getRevertRequestKey(gameId, requestId));
    transport.rejectRevertRequest({ gameId, requestId });
    return;
  }

  if (action === "rescind-revert-request") {
    const gameId = actionEl.getAttribute("data-game-id");
    const requestId = actionEl.getAttribute("data-request-id");
    if (!gameId || !requestId) return;
    transport.rescindRevertRequest({ gameId, requestId });
    return;
  }

  if (action === "revert-to-move" || action === "undo-last-move") {
    const gameId = actionEl.getAttribute("data-game-id");
    const moveId = actionEl.getAttribute("data-move-id");
    if (!gameId || !moveId) {
      return;
    }
    transport.requestRevertToMove({ gameId, targetMoveId: moveId });
    return;
  }

  if (action === "join-viewer" || action === "accept-invite-viewer") {
    if (account.snapshot().enabled && (!account.snapshot().session.authenticated || transport.getGameViewModel(actionGameId)?.ownershipMode === "legacy_guest")) {
      markInviteChoiceCommitted(actionGameId);navigateTo(buildGameHash(actionGameId, null, getCurrentFlyoutState()));return;
    }
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    void withPendingButton(getJoinButtonKey("viewer", gameId), async () => {
      await transport.joinGame({
        gameId,
        mode: "viewer",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      markInviteChoiceCommitted(gameId);
      if (currentRoute.name === "invite" || currentRoute.name === "game") {
        navigateTo(buildGameHash(gameId, null, getCurrentGameHashState(currentRoute.name === "game" ? getGamePanel() : DEFAULT_GAME_PANEL)));
        return;
      }
      await syncRouteDataAndLiveChannels();
    });
    return;
  }

  if (action === "join-player" || action === "accept-invite-player") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    void withPendingButton(getJoinButtonKey("player", gameId), async () => {
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
        navigateTo(buildGameHash(gameId, null, getCurrentGameHashState(currentRoute.name === "game" ? getGamePanel() : DEFAULT_GAME_PANEL)));
        return;
      }
      await syncRouteDataAndLiveChannels();
    });
    return;
  }

  if (action === "play-as-both-players") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    void withPendingButton(getPlayAsBothButtonKey(gameId), async () => {
      await transport.playAsBothPlayers({ gameId });
      await syncRouteDataAndLiveChannels();
    });
    return;
  }

  if (action === "approve-request" || action === "accept-request") {
    const gameId = actionEl.getAttribute("data-game-id");
    const requester = actionEl.getAttribute("data-requester-id");
    if (!gameId || !requester) return;
    ignoredApprovalRequests.delete(getApprovalRequestKey(gameId, requester));
    void withPendingButton(getApproveRequestButtonKey(gameId, requester), async () => {
      await transport.approvePendingRequest({ gameId, requesterIdentityId: requester });
      await syncRouteDataAndLiveChannels();
    });
    return;
  }

  if (action === "copy-invite") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) {
      return;
    }
    const gameHandle = transport.getGameHandle?.(gameId) ?? null;
    const copyInvite = async () => {
      if (gameHandle?.status === "pending") {
        await gameHandle.committed;
      }
      const game = transport.getGameViewModel(gameId);
      const inviteToken = game?.inviteToken || resolvedInvite?.inviteToken || gameId;
      const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(inviteToken, getCurrentFlyoutState())}`;
      let copied = false;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
        copied = true;
      }
      window.__righeltLastInvite = inviteLink;
      setInviteFeedback(copied ? "Invite link copied to clipboard" : "Clipboard unavailable");
    };
    if (gameHandle?.status === "pending") {
      void withPendingButton(getCopyInviteButtonKey(gameId), copyInvite);
      return;
    }
    await copyInvite();
    return;
  }

  if (action === "retry-saving") {
    const gameId = actionEl.getAttribute("data-game-id");
    dismissedRecoveryNotices.delete(gameId);
    await transport.retrySaving(gameId).catch(() => {});
    render({ animatePanels: false, includeBoard: false });
    return;
  }
  if (action === "dismiss-recovery-notice") {
    const gameId = actionEl.getAttribute("data-game-id");
    dismissedRecoveryNotices.set(gameId, recoveryMessage(transport.getGameViewModel(gameId)));
    render({ animatePanels: false, includeBoard: false });
    document.querySelector('[data-action="return-live"], [data-action="open-history"], .shell-logo, a[href="#/"]')?.focus({ preventScroll: true });
    return;
  }
  if (action === "dismiss-failed-operation") {
    const operationId = actionEl.getAttribute("data-operation-id");
    if (!operationId) {
      return;
    }
    transport.dismissFailedOperation?.(operationId);
    render({ animatePanels: false, includeBoard: false });
    document.querySelector('[data-action="return-live"], .shell-header-title-link')?.focus({ preventScroll: true });
    return;
  }

  if (action === "cycle-game-alert-stack") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) {
      return;
    }
    cycleGameAlertStack(gameId, actionEl);
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
    transport.selectHistoryMove({ gameId, moveIndex });
    return;
  }

  if (action === "return-live") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    clearHistoryPress();
    playHistoryReleaseBounce(actionEl);
    await animateHistoryDeselection(actionEl);
    transport.returnToLive({ gameId });
    return;
  }

  if (action === "toggle-header-menu") {
    headerMenuOpen = !headerMenuOpen;
    if (isNarrowHeaderMode()) {
      syncNarrowHeaderMenuDom();
    } else {
      render({ animatePanels: false, includeBoard: false });
    }
    return;
  }
  if (action === "open-debug") {
    if (!currentRoute.debug) {
      saveDebugFlyoutOpen(storage, true);
      setFlyoutOpenState("debug", true);
      currentRoute = normalizeRouteFlyoutState({ ...currentRoute, debug: true }, { preferredFlyoutKey: "debug" });
      if (currentRoute.name === "home") {
        startRouteSync({ renderStart: false });
        return;
      }
      render({ animatePanels: false, includeBoard: false });
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
        startRouteSync({ renderStart: false });
        return;
      }
      render({ animatePanels: false, includeBoard: false });
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

  if (action === "switch-game-panel") {
    if (currentRoute.name !== "game" || getShellLayoutMode() !== "narrow") {
      return;
    }
    const nextPanel = normalizeGamePanel(actionEl.getAttribute("data-panel"));
    if (nextPanel === getGamePanel()) {
      return;
    }
    navigateTo(buildGameHash(currentRoute.gameId, currentRoute.inviteFromRole, getCurrentGameHashState(nextPanel)));
    return;
  }

  if (action === "home-page-prev" || action === "home-page-next") {
    const sectionKey = actionEl.getAttribute("data-home-section");
    const section = getHomeSection(sectionKey);
    if (!sectionKey || section.totalPages <= 1 || isHomeSectionPending(sectionKey)) {
      return;
    }
    const delta = action === "home-page-prev" ? -1 : 1;
    const nextPage = (section.page + delta + section.totalPages) % section.totalPages;
    const pageGeneration=account.snapshot().generation;
    pendingHomeSectionKeys.add(sectionKey);
    render({ animatePanels: false, includeBoard: false });
    try {
      await loadHomeSectionPage(sectionKey, {
        page: nextPage,
        direction: action === "home-page-prev" ? "prev" : "next",
      });
      syncLiveChannels();
    } catch (error) {
      window.__righeltLastError = error instanceof Error ? error.message : String(error);
    } finally {
      if(pageGeneration!==account.snapshot().generation)return;
      pendingHomeSectionKeys.delete(sectionKey);
      render({ animatePanels: false, includeBoard: false });
      window.requestAnimationFrame(() => {
        scrollHomeSectionToTop(sectionKey);
      });
    }
    return;
  }

  if (action === "ignore-request") {
    const gameId = actionEl.getAttribute("data-game-id");
    const requester = actionEl.getAttribute("data-requester-id");
    if (!gameId || !requester) return;
    ignoredApprovalRequests.add(getApprovalRequestKey(gameId, requester));
    render({ animatePanels: false, includeBoard: false });
    return;
  }

  if (action === "toggle-undone-group") {
    const groupKey = actionEl.getAttribute("data-group-key");
    if (!groupKey) return;
    if (expandedUndoneGroups.has(groupKey)) {
      expandedUndoneGroups.delete(groupKey);
    } else {
      expandedUndoneGroups.add(groupKey);
    }
    render({ animatePanels: false, includeBoard: false });
    return;
  }

  if (action === "tutorial-next" || action === "tutorial-skip") {
    tutorial.next();
    render({ animatePanels: false, includeBoard: false });
    return;
  }

  if (action === "tutorial-complete" || action === "tutorial-skip-all") {
    if (account.snapshot().enabled && account.snapshot().session.authenticated) {
      const epoch = account.snapshot().generation;
      try { await account.updateAccount({ preferences: { tutorial: action === "tutorial-complete" ? "completed" : "skipped" } }); if (account.snapshot().generation !== epoch) return; }
      catch { window.__righeltLastError = "Could not save tutorial progress. Try again."; return; }
    } else if (!account.snapshot().enabled) saveTutorialCompleted(storage, true);
    tutorial.reset();
    if (pendingOpponentTutorial) {
      const pending = pendingOpponentTutorial; pendingOpponentTutorial = null;
      if (pending.generation === account.snapshot().generation && account.canPlay()) pending.resolve();
      else pending.reject(new Error("Sign in again before playing."));
      navigateTo(buildHomeHash(getCurrentFlyoutState()));
      return;
    }
    const gameId = actionEl.getAttribute("data-game-id");
    navigateTo(gameId ? buildGameHash(gameId, null, getCurrentFlyoutState()) : buildHomeHash(getCurrentFlyoutState()));
    return;
  }

  if (action === "load-scenario") {
    const selectedScenario = getSelectedScenario();
    if (!selectedScenario || isButtonPending(SCENARIO_LOAD_PENDING_KEY)) {
      if (!selectedScenario) {
        setSelectedScenarioFeedback("No scenario selected.");
        render({ animatePanels: false, includeBoard: false });
      }
      return;
    }
    const activeGameId =
      currentRoute.name === "game" ? currentRoute.gameId : currentRoute.name === "invite" ? resolvedInvite?.gameId || null : null;
    const activeGame = activeGameId ? transport.getGameViewModel(activeGameId) : null;
    const shouldApplyInPlace = Boolean(activeGame && activeGame.moves.length === 0);
    await withPendingButton(
      SCENARIO_LOAD_PENDING_KEY,
      async () => {
        try {
          const result = await transport.importScenario({
            scenario: selectedScenario,
            targetGameId: shouldApplyInPlace ? activeGameId : null,
            sourceGameId: activeGame && !shouldApplyInPlace ? activeGame.id : null,
          });
          setSelectedScenarioFeedback(`Scenario ${selectedScenario.id} loaded.`);
          if (!result?.game?.id) {
            return;
          }
          const nextHash = buildGameHash(result.game.id, null, {
            ...getCurrentFlyoutState(),
            scenarios: false,
          });
          if (activeGame && !shouldApplyInPlace) {
            window.open(`${window.location.pathname}${window.location.search}${nextHash}`, "_blank", "noopener");
            return;
          }
          navigateTo(nextHash);
        } catch (error) {
          setSelectedScenarioFeedback("Failed to load scenario.");
          window.__righeltLastError = error instanceof Error ? error.message : String(error);
        }
      },
      { renderEnd: true },
    );
    return;
  }

  if (action === "update-scenario" || action === "save-scenario") {
    const activeGame = getActiveScenarioGame();
    if (!activeGame) {
      if (action === "update-scenario") {
        setSelectedScenarioFeedback("Open a game to update the selected scenario.");
      } else {
        setSaveScenarioFeedback("Open a game to save a new scenario.");
      }
      render({ animatePanels: false, includeBoard: false });
      return;
    }
    if (!canAuthorScenariosLocally()) {
      if (action === "update-scenario") {
        setSelectedScenarioFeedback("Scenario authoring is only available on localhost.");
      } else {
        setSaveScenarioFeedback("Scenario authoring is only available on localhost.");
      }
      render({ animatePanels: false, includeBoard: false });
      return;
    }
    if (action === "update-scenario") {
      if (!getSelectedScenario()) {
        setSelectedScenarioFeedback("No scenario selected.");
        render({ animatePanels: false, includeBoard: false });
        return;
      }
      const title = getScenarioEditableFieldText("title");
      const description = getScenarioEditableFieldText("description");
      if (!title || !description) {
        setSelectedScenarioFeedback("Scenario title and description are required.");
        syncScenarioAuthoringControls();
        return;
      }
      await withPendingButton(
        SCENARIO_UPDATE_PENDING_KEY,
        async () => {
          const updated = await updateSelectedScenarioRecord({
            activeGame,
            title,
            description,
            includeCurrentBoard: true,
            feedbackMessage: (scenario) => `Scenario ${scenario.id} updated.`,
          });
          if (!updated.ok) {
            setSelectedScenarioFeedback("Failed to update scenario locally.");
          }
          render({ animatePanels: false, includeBoard: false });
        },
        { renderEnd: false },
      );
      return;
    }
    const draft = getSaveScenarioDraft();
    if (!draft.title || !draft.description) {
      setSaveScenarioFeedback("Scenario title and description are required.");
      syncScenarioAuthoringControls();
      return;
    }
    const exportContext = getScenarioExportContext(activeGame);
    await withPendingButton(
      SCENARIO_SAVE_PENDING_KEY,
      async () => {
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
          setSaveScenarioFeedback("Failed to save scenario locally.");
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
        setSaveScenarioFeedback(formatScenarioInfo(scenario, "No new scenario saved yet."));
        setSelectedScenarioFeedback("");
        render({ animatePanels: false, includeBoard: false });
      },
      { renderEnd: false },
    );
  }
});

appEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (target.id === "scenario-select") {
    selectedScenarioId = target.value || null;
    selectedScenarioFeedback = "";
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

appEl.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.hasAttribute("data-scenario-editable")) {
    return;
  }
  window.setTimeout(async () => {
    if (!canAuthorScenariosLocally()) {
      return;
    }
    const activeGame = getActiveScenarioGame();
    if (!activeGame || !getSelectedScenario()) {
      return;
    }
    const title = getScenarioEditableFieldText("title");
    const description = getScenarioEditableFieldText("description");
    if (!title || !description) {
      return;
    }
    const updated = await updateSelectedScenarioRecord({
      activeGame,
      title,
      description,
      includeCurrentBoard: false,
      feedbackMessage: (scenario) => `Scenario ${scenario.id} details saved.`,
    });
    if (updated.ok && updated.reason === "updated") {
      render({ animatePanels: false, includeBoard: false });
    }
  }, 0);
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

window.addEventListener("click", (event) => {
  const target = event.target;
  if (!headerMenuOpen || !(target instanceof HTMLElement)) {
    return;
  }
  if (target.closest("[data-header-menu-root]")) {
    return;
  }
  closeHeaderMenu();
  syncNarrowHeaderMenuDom();
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.matches('[data-action="cycle-game-alert-stack"]') &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    const gameId = target.getAttribute("data-game-id");
    if (gameId) {
      cycleGameAlertStack(gameId, target);
    }
    return;
  }
  if (event.key !== "Escape" || !headerMenuOpen) {
    return;
  }
  closeHeaderMenu();
  syncNarrowHeaderMenuDom();
});

appEl.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  const target = event.target;
  if (!touch || !shouldHandleGamePanelSwipe(target)) {
    clearActivePanelSwipe();
    return;
  }
  activePanelSwipe = {
    startX: touch.clientX,
    startY: touch.clientY,
    deltaX: 0,
    deltaY: 0,
    intentLocked: false,
  };
}, { passive: true });

appEl.addEventListener("touchmove", (event) => {
  if (!activePanelSwipe) {
    return;
  }
  const touch = event.touches[0];
  if (!touch) {
    clearActivePanelSwipe();
    return;
  }
  activePanelSwipe.deltaX = touch.clientX - activePanelSwipe.startX;
  activePanelSwipe.deltaY = touch.clientY - activePanelSwipe.startY;
  if (!activePanelSwipe.intentLocked) {
    const absX = Math.abs(activePanelSwipe.deltaX);
    const absY = Math.abs(activePanelSwipe.deltaY);
    if (absX < GAME_SHELL_PANEL_SWIPE_INTENT_PX) {
      return;
    }
    if (absX <= absY * 1.15) {
      clearActivePanelSwipe();
      return;
    }
    activePanelSwipe.intentLocked = true;
  }
  event.preventDefault();
}, { passive: false });

appEl.addEventListener("touchend", () => {
  if (!activePanelSwipe) {
    return;
  }
  const deltaX = activePanelSwipe.deltaX;
  clearActivePanelSwipe();
  if (Math.abs(deltaX) < GAME_SHELL_PANEL_SWIPE_TRIGGER_PX || currentRoute.name !== "game") {
    return;
  }
  const nextPanel = deltaX < 0 ? getAdjacentGamePanel(getGamePanel(), 1) : getAdjacentGamePanel(getGamePanel(), -1);
  if (nextPanel === getGamePanel()) {
    return;
  }
  navigateTo(buildGameHash(currentRoute.gameId, currentRoute.inviteFromRole, getCurrentGameHashState(nextPanel)));
});

window.addEventListener("touchcancel", () => {
  clearActivePanelSwipe();
});

let startupFlight = false, startupComplete = false, startupRetryTimer = null, startupRetryDelay = 1000;
const initialRender = async () => {
  if (startupFlight || startupComplete) return;
  clearTimeout(startupRetryTimer);
  startupFlight = true;
  try {
  routeHydrated = false;
  render({ animatePanels: false, includeBoard: false });
  try {
    await account.start();
    void account.activity(true);
  } catch (error) {
    window.__righeltLastError = error.code || error.message;
    if (error.code === "upgrade_required") {
      try { const key="righelt.auth-refresh"; if(!window.sessionStorage.getItem(key)){window.sessionStorage.setItem(key,"1");window.location.reload();return;} } catch {}
      accountStartupError="Please refresh to update Righelt. Play is unavailable until the update completes.";render({animatePanels:false,includeBoard:false});
    }
    if (error.code !== "upgrade_required") {
      accountStartupError = "Could not connect. Retrying when the connection is available.";
      render({animatePanels:false,includeBoard:false});
      if (navigator.onLine !== false) {
        startupRetryTimer = setTimeout(() => void initialRender(), startupRetryDelay);
        startupRetryDelay = Math.min(startupRetryDelay * 2, 30000);
      }
    }
    return;
  }
  startupComplete = true;
  accountStartupError = "";
  syncLiveChannels();
  render({ animatePanels: false, includeBoard: false });
  const scenarioCatalogPromise = (async () => {
    try {
      await syncScenarioCatalog();
    } catch (error) {
      window.__righeltLastError = error instanceof Error ? error.message : String(error);
    } finally {
      render({ animatePanels: false, includeBoard: false });
    }
  })();
  startRouteSync({ renderStart: false });
  try {
    await scenarioCatalogPromise;
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  }
  } finally { startupFlight = false; }
};
window.addEventListener("offline", () => clearTimeout(startupRetryTimer));
window.addEventListener("online", () => { startupRetryDelay = 1000; if (!startupComplete) void initialRender(); });

void initialRender();
