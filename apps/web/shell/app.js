import { patchSectionContent } from "./dom-patch.js";
import { SWIPE_EASING_CSS } from './navigation-motion.js';
import { getGameResult, createResultTransitions, createRematchDialog } from './game-result.js';
import { createRouteHydration } from './route-hydration.js';
import { createRenderGestureGate, preserveBoardFocus } from './render-gesture.js';
import { participantButton, participantName, createInlineProfiles } from './public-profile.js';
import { createAccountController, safeAccountIntent } from './account-controller.js';
import { createAccountDialog } from './account-dialog.js';
import { renderPieceSymbol } from '../piece-symbols.js';
import { invitationOptions, renderInvitationSurface } from './invitations.js';
import { createIntroductionPreferences, createOpponentSession } from './opponent-session.js';
import { renderWordmark, createBrandController, createBrandGrid, resolveActionAffiliation } from './brand.js';
import { icon, soundToggle, headerActionContent } from './ui.js';
import { createGameSound } from './sound.js';
import { createModal } from './modal.js';
import { createOpponentStoryDialog, OPPONENT_STORIES } from './opponent-stories.js';
import { recoveryMessage, sharedMutationActions } from "./recovery-view.js";
import { assertGameBoardAdapter } from "../board-adapter-contract.js";
import { createEngineBoardAdapter, createInitialBoardSnapshot } from "../board-adapters/engine-board-adapter.js";
import { createMiniBoardPreview, syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createShellBoardHost } from "../board/hosts/shell-host.js";
import { getBootstrapPayload } from "./bootstrap.js";
import { createSyncStore } from "./sync-store.js";
import { ensureHoverCapabilityController } from "../hover-capability.js";
import { applyCommandLegendSwatch, getCommandLegendColor, getCommandLegendSwatchStyle, updateLegendVisibility } from "../legend.js";
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
const inlineProfiles = createInlineProfiles();
let accountInitialized = false;
let accountStartupError = "";
let accountContinuation = null;
let accountContinuationError = false;
const hydrateRoute = createRouteHydration();
const account = createAccountController({ storage,
  onTransition: (next, source) => { if (accountInitialized) { accountDialog.onTransition(source); resetAccountTransport(next); } },
  onChange: () => { document.documentElement.dataset.viewPreference = account.snapshot().session.account?.preferences?.view || "focused"; if (account.snapshot().ready) accountStartupError = ""; if (accountInitialized) { accountDialog.refreshSession(); render({ animatePanels: false, includeBoard: false }); } },
});
const accountDialog = createAccountDialog({ controller: account, onSound:kind=>gameSound.play(kind), onTutorial: () => { tutorial.reset(); navigateTo(buildTutorialHash()); }, getSiteKey: () => account.snapshot().siteKey,
  onComplete: intent => { void completeAccountContinuation(intent); },
  onLayoutChange: () => render({animatePanels:false,includeBoard:false}),
});
const gameSound = createGameSound({ storage });
const brand = createBrandController();
createBrandGrid();
document.addEventListener('pointerdown',()=>{gameSound.gesture();gameSound.cancelPreview();},{passive:true});
document.addEventListener('keydown',()=>gameSound.gesture());
document.addEventListener('visibilitychange',()=>gameSound.activityChanged());
const syncPageActivity = () => { document.documentElement.dataset.pageActive=String(!document.hidden && document.hasFocus()); };
syncPageActivity();
document.addEventListener('visibilitychange',syncPageActivity);
window.addEventListener('blur',()=>{document.documentElement.dataset.pageActive='false';gameSound.activityChanged();});
window.addEventListener('focus',()=>{syncPageActivity();gameSound.activityChanged();});
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

const resultTransitions = createResultTransitions();
let activeResultGameId = null;
let pendingResultReviewFocus = null;
let currentRoute = parseRouteFromHash(window.location.hash);
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
let inviteFallback = null;
let hostInvite = null;
const preparedPlayerInvitations = new Map();
let inviteVisit = 0;
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
let homeReturnPosition = {y:0, gameId:null};
let restoreHomePending = false;
window.history.scrollRestoration = 'manual';
let routeTransitionCoverTimer = null;
let routeTransitionRevealTimer = null;
let headerMenuOpen = false;
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

const formatStatus = (connected) => renderConnectionStatusIcon(connected ? "connected" : "disconnected", connected ? "Connected" : "Disconnected");
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
  `<span class="connection-status-icon is-${escapeHtml(status)}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>`;
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
// Placement CSS owns the motion vector, independently of content layout mode.
const getFlyoutEntryOffset = (element, rect) => {
  const style = getComputedStyle(element);
  return {
    deltaX: getCssPixelValue(style.getPropertyValue('--flyout-offset-x')) * rect.width / 100,
    deltaY: getCssPixelValue(style.getPropertyValue('--flyout-offset-y')) * rect.height / 100,
  };
};
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
      ...getFlyoutEntryOffset(element, nextRect),
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
const panelSizeAnimations = new WeakMap();
const panelPendingFocus = new WeakMap();
const joinMarkupByElement = new WeakMap();
const animatePanelHeightChange = (panelEl, fromHeight) => {
  if (!(panelEl instanceof HTMLElement) || !Number.isFinite(fromHeight)) return;
  panelSizeAnimations.get(panelEl)?.cancel();
  panelSizeAnimations.delete(panelEl);
  const toHeight = panelEl.getBoundingClientRect().height;
  if (prefersReducedMotion() || Math.abs(toHeight-fromHeight)<1) return;
  const animation=panelEl.animate([{height:`${fromHeight}px`},{height:`${toHeight}px`}],{duration:180,easing:'ease-out'});
  panelSizeAnimations.set(panelEl,animation);
  animation.onfinish=()=>{if(panelSizeAnimations.get(panelEl)===animation)panelSizeAnimations.delete(panelEl);};
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
  routeTransition?.type === "game-entry" && (routeTransition.toRoute === "home" ? route?.name === "home" : route?.name === "game" && route?.gameId === routeTransition.gameId);
const syncRouteTransitionLayer = () => {
  if (!(routeTransitionLayerEl instanceof HTMLElement)) {
    return;
  }
  document.documentElement.style.setProperty("--shell-game-entry-easing", SWIPE_EASING_CSS);
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-transition-ms", `${GAME_ENTRY_ROUTE_TRANSITION_MS}ms`);
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-cover-ms", `${GAME_ENTRY_ROUTE_TRANSITION_COVER_MS}ms`);
  routeTransitionLayerEl.style.setProperty("--shell-game-entry-reveal-ms", `${GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS}ms`);
  routeTransitionLayerEl.dataset.direction = routeTransition?.toRoute === "home" ? "back" : "forward";
  routeTransitionLayerEl.setAttribute("data-active", routeTransition ? "true" : "false");
  routeTransitionLayerEl.setAttribute("data-transition", routeTransition?.type || "none");
  routeTransitionLayerEl.setAttribute("data-phase", routeTransition?.phase || "idle");
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
  routeTransition = null;
  syncRouteTransitionLayer();
  if (renderNow) {
    render({ animatePanels: false, includeBoard: false });
  }
};
const finishRouteTransitionReveal = (gameId) => {
  if (!routeTransition || routeTransition.gameId !== gameId || routeTransition.phase !== "revealing") {
    return;
  }
  routeTransition = null;
  syncRouteTransitionLayer();
  render({ animatePanels: false, includeBoard: false });
};
const beginRouteTransitionReveal = (gameId) => {
  if (!routeTransition || routeTransition.gameId !== gameId || routeTransition.phase === "revealing") {
    return;
  }
  routeTransition.phase = "revealing";
  gameSound.play(routeTransition.toRoute === "home" ? "leave" : "enter", {duration:GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS / 1000});
  syncRouteTransitionLayer();
  render({ animatePanels: false, includeBoard: false });
  if (routeTransitionRevealTimer) {
    window.clearTimeout(routeTransitionRevealTimer);
  }
  routeTransitionRevealTimer = window.setTimeout(() => {
    routeTransitionRevealTimer = null;
    finishRouteTransitionReveal(gameId);
  }, GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS);
};
const settleRouteTransitionCover = (gameId) => {
  if (!routeTransition || routeTransition.gameId !== gameId || routeTransition.phase !== "covering") {
    return;
  }
  routeTransition.phase = "covered";
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
  routeTransitionCoverTimer = window.setTimeout(() => {
    routeTransitionCoverTimer = null;
    settleRouteTransitionCover(gameId);
  }, GAME_ENTRY_ROUTE_TRANSITION_COVER_MS);
};
const startGameEntryRouteTransition = (gameId, fromRoute = currentRoute?.name || "unknown", toRoute = 'game') => {
  if(fromRoute === 'home') homeReturnPosition={y:window.scrollY,gameId};
  if (!gameId || prefersReducedMotion()) {
    clearRouteTransition({ renderNow: false });
    return;
  }
  clearRouteTransitionTimers();
  routeTransition = {
    type: "game-entry",
    fromRoute,
    toRoute,
    gameId,
    phase: "covering",
  };
  syncRouteTransitionLayer();
  if (routeTransitionLayerEl instanceof HTMLElement) {
    routeTransitionLayerEl.classList.remove("is-running");
    void routeTransitionLayerEl.offsetHeight;
    routeTransitionLayerEl.classList.add("is-running");
  }
  gameSound.play(toRoute === "home" ? "leave" : "enter", {duration:GAME_ENTRY_ROUTE_TRANSITION_COVER_MS / 1000});
  scheduleRouteTransitionCoverSettle(gameId);
};
const syncRouteTransitionForCurrentRoute = () => {
  if (!routeTransition) {
    syncRouteTransitionLayer();
    return;
  }
  const hashRoute = parseRouteFromHash(window.location.hash);
  const navigationPending = currentRoute.name === routeTransition.fromRoute && isGameEntryRouteTransitionActive(hashRoute);
  if (prefersReducedMotion() || (!isGameEntryRouteTransitionActive(currentRoute) && !navigationPending)) {
    clearRouteTransition({ renderNow: false });
    return;
  }
  syncRouteTransitionLayer();
};
const maybeRevealRouteTransition = () => {
  if(restoreHomePending && currentRoute.name === 'home' && routeHydrated){
    restoreHomePending=false;
    window.requestAnimationFrame(()=>{if(currentRoute.name!=='home')return;window.scrollTo({top:homeReturnPosition.y,behavior:'instant'});const target=homeReturnPosition.gameId?appEl.querySelector(`.mini-board-card-link-surface[data-game-id="${CSS.escape(homeReturnPosition.gameId)}"]`):null;(target || appEl.querySelector('[data-testid="home-create-game"]'))?.focus({preventScroll:true});});
  }
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
const getOpenFlyoutCount = (route = currentRoute) => document.documentElement.dataset.accountFlyout === "true" ? 1 : FLYOUT_KEYS.reduce((count, key) => count + Number(route?.[key] === true), 0);
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
    class="secondary header-icon-action header-utility-action${currentRoute.scenarios ? " is-active" : ""}"
    type="button"
    data-action="${currentRoute.scenarios ? "close-scenarios" : "open-scenarios"}"
    aria-pressed="${currentRoute.scenarios ? "true" : "false"}"
  aria-label="Scenarios" title="Scenarios">${headerActionContent('scenarios','Scenarios')}</button>
  <button
    class="secondary header-icon-action header-utility-action${currentRoute.debug ? " is-active" : ""}"
    type="button"
    data-action="${currentRoute.debug ? "close-debug" : "open-debug"}"
    aria-pressed="${currentRoute.debug ? "true" : "false"}"
  aria-label="Debug" title="Debug">${headerActionContent('debug','Debug')}</button>
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
      <h1><a class="shell-header-title-link" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">${renderWordmark(brand.getState())}</a></h1>
    </div>
    ${renderHeaderAlertZone()}
    ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
    ${account.snapshot().pendingLogout ? '<span role="status">Sign-out pending</span>' : ''}
    ${accountContinuationError ? `<p role="alert">The page could not finish loading. Try again.</p><button class="secondary" data-action="retry-account-continuation">Try again</button>` : ""}
    ${accountStartupError ? `<p role="alert">${escapeHtml(accountStartupError)}</p><button class="secondary" data-action="retry-account-startup">Try again</button>` : !account.snapshot().ready ? `<p role="status">Connecting…</p>` : ""}
    <div class="shell-header-actions">
      <div class="nav-row${isNarrowHeaderMode() ? " nav-row-single" : ""}">
        ${account.snapshot().ready && account.snapshot().enabled && account.snapshot().available && account.snapshot().session.authenticated ? `<button class="secondary header-icon-action" type="button" data-action="account-open" data-testid="account-open" aria-label="Account" title="Account">${headerActionContent('account','Account')}</button>` : ""}
        ${soundToggle(gameSound.enabled())}${isNarrowHeaderMode() ? renderHeaderNarrowMenu() : renderHeaderWideActions()}
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
      <button class="ui-icon-button flyout-close-button" type="button" aria-label="Close ${title}" data-action="${closeAction}">${icon('close')}</button>
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

const renderInviteFeedback = () => `<div class="invite-feedback" role="status" aria-live="polite" data-success="${inviteFeedback === 'Link copied'}">${inviteFeedback ? `${icon(inviteFeedback === 'Link copied' ? 'check' : 'copy')}<span>${escapeHtml(inviteFeedback)}</span>` : ''}</div>`;
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
  if (game?.pendingPlayerRequestSeat) return {gameId:game.id,inviteType:"pending"};
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
      intendedRole:currentRoute.inviteAs,
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

const renderHomeStartButton = () =>
  `<button class="home-start-button" data-action="create-game" data-testid="home-create-game">Start new game</button>`;

const renderHomeGameSection = (sectionKey) => {
  const section = getHomeSection(sectionKey);
  if ((isHomeSectionPending(sectionKey) || !routeHydrated) && section.gameIds.length === 0) {
    return renderHomeSectionSkeleton(sectionKey === "my" ? "Continue playing" : section.title,{sectionKey});
  }
  const games = section.gameIds.map((gameId) => transport.getHomeGameCard(gameId)).filter(Boolean);
  if (games.length === 0 || section.totalGames === 0) {
    return "";
  }
  const showPaging = section.totalPages > 1;
  const showHeaderPaging = showPaging && section.visibleColumnCount > 1;
  const showFooterPaging = showPaging && section.visibleColumnCount === 1;
  const hasHeaderAction = false;
  return `<section class="panel home-games-section" data-home-section-root="${escapeHtml(sectionKey)}">
      <div class="home-games-section-header" data-home-header-has-action="${hasHeaderAction ? "true" : "false"}" data-home-header-paging="${showHeaderPaging ? "true" : "false"}">
      <div class="home-games-section-heading">
        <h2>${sectionKey === "my" ? "Continue playing" : escapeHtml(section.title)}</h2>
        <p class="small">${section.totalGames === 1 ? "1 game" : `${section.totalGames} games`}</p>
      </div>
      <div class="home-games-section-header-center">
        ${showHeaderPaging ? renderHomeSectionControls(sectionKey, section, { placement: "header" }) : ""}
      </div>
      <div class="home-games-section-header-actions">
        ${hasHeaderAction ? renderHomeStartButton() : ""}
      </div>
    </div>
    <div class="home-games-carousel" data-home-carousel="${escapeHtml(sectionKey)}">
      <div class="home-games-carousel-track" data-home-carousel-track="${escapeHtml(sectionKey)}">
        <div class="mini-board-card-list" data-game-count="${games.length}">${games.map((game) => renderHomeGameCard(game)).join("")}</div>
      </div>
    </div>
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

const renderStartChoices = () => `<section class="panel home-start"><p class="home-section-kicker">Take your seat</p><h2 class="home-start-title">Start something new</h2><p class="home-start-description">A familiar rival, or a new challenge? You decide.</p><div class="opponent-picker">${Object.entries(OPPONENT_STORIES).map(([id,story])=>`<button class="opponent-choice" data-action="opponent-story" data-opponent="${id}"><img src="/assets/opponents/${id}-portrait.webp" alt="" width="174" height="116"><strong>${story.name}</strong><span class="opponent-choice-arrow">${icon('right')}</span><span class="small">${story.difficulty}</span></button>`).join('')}<button class="opponent-choice" data-action="create-game" data-testid="home-create-game"><img src="/assets/opponents/friend-portrait.webp" alt="" width="174" height="116"><strong>Friend</strong><span class="opponent-choice-arrow">${icon('right')}</span><span class="small">Share a game</span></button></div><div class="home-start-footer"><span class="small">Computer opponents are being prepared.</span><button class="secondary" data-action="create-self-play">${icon('play')}Play both sides</button></div></section>`;
const renderHome = () => `<section class="stack home-refresh">${renderHomeGameSection('my')}${renderStartChoices()}${getVisibleHomeSectionKeys().filter(key=>key!=='my').map(renderHomeGameSection).join('')}</section>`;

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

const renderHomeSectionSkeleton = (title, { showStartButton = false, sectionKey = "my" } = {}) => `
  <section class="panel home-games-section" data-home-section-root="${escapeHtml(sectionKey)}" data-testid="home-section-skeleton">
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
    <div class="invite-gate-content" aria-hidden="true" inert>
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
  // Pending approval is explained once in the blocking invitation surface.
  const pendingSeatNotice = "";
  const pendingRows =
    game.pendingJoinRequests.length === 0
      ? ""
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
    ...invitationOptions(game).map(option => `<button data-action="copy-invite" data-game-id="${escapeHtml(game.id)}" data-invite-role="${option.role}" ${option.role==='viewer'?'data-testid="copy-viewer-invite"':'data-testid="copy-invite"'}${renderButtonStateAttributes({className:`invite-action invite-${option.role}${option.role==='viewer'?' secondary':''}`,pendingKey:copyInviteButtonKey,disabled:!game.canInvite})}>${icon('invite')}${isButtonPending(copyInviteButtonKey)?'Preparing link…':option.label}</button>`),
    game.canPlayAsBothPlayers
      ? `<button data-action="play-as-both-players" data-game-id="${escapeHtml(game.id)}"${renderButtonStateAttributes({
          className: "secondary",
          pendingKey: playAsBothButtonKey,
        })}>${isButtonPending(playAsBothButtonKey) ? "Claiming seats..." : "Play as both players"}</button>`
      : "",
  ]);

  return `
    <h2 data-testid="join-invite-heading">Players</h2>
    ${renderParticipantsPanel(game)}
    ${pendingSeatNotice}
    ${joinInviteActions}
    ${renderInviteFeedback()}
    ${inviteFallback?.gameId === game.id ? `<input class="invite-link-field" aria-label="Invitation link" value="${escapeHtml(inviteFallback.link)}" readonly>` : ""}
    ${pendingRows ? `<div class="section-followup"><ul class="participant-list">${pendingRows}</ul></div>` : ""}
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
        const pending = preparedPlayerInvitations.get(game.id) === (entry.label === "Player 1" ? "red" : "blue");
        return `<li data-testid="participant-${escapeHtml(entry.label.toLowerCase().replace(/\s+/g, "-"))}">${renderSeatLabel(entry.label)} <span class="small participant-empty" ${pending ? 'data-testid="pending-invitation"' : ''}>${icon('account')}<span>${pending ? 'Awaiting player' : 'Open seat'}</span></span></li>`;
      }
      return `<li data-testid="participant-${escapeHtml(entry.label.toLowerCase().replace(/\s+/g, "-"))}">${renderSeatLabel(entry.label)} ${participantButton(entry.value, {key:entry.label,side:entry.label === "Player 1" ? "p1" : "p2",presence:formatStatus(entry.value.connected)})}</li>`;
    })
    .join("");

  const viewerRows =
    game.viewers.length === 0
      ? `<li><span>Viewers</span><span class="small participant-empty">${icon('account-none')}<span>None</span></span></li>`
      : game.viewers
          .map(
            (viewer) =>
              `<li data-testid="participant-viewer"><span>Viewer</span> ${participantButton(viewer,{presence:formatStatus(viewer.connected)})}</li>`,
          )
          .join("");
  return `

    <ul class="participant-list" data-testid="participants-list">${participantRows}${viewerRows}</ul>
  `;
};

const renderHistoryPanel = (game) => {
  const historyRows = renderTurnHistory(game);
  const currentNames = [...new Map([game.player1,game.player2].filter(person => person?.profile).map(person => [person.profile.username,person])).values()].map(person => `<span class="history-player-name">${participantName(person)}</span>`).join("");
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
    ${getGameResult(transport.getAuthoritativeGame(game.id),transport.getIdentityId()) ? `<button class="secondary" data-action="view-result" data-game-id="${escapeHtml(game.id)}">View result</button>` : ""}
    <div class="section-followup">
      ${historyBanner}
      <ol class="history-list" data-testid="history-list">${historyRows}</ol>
    </div>
  `;
};

const renderBoardPanel = (game) => `
  ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p class="alert" role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
  ${game.ownershipMode === "legacy_guest" && account.snapshot().enabled ? '<p class="alert" role="status">This older guest game is view-only. <button data-action="create-game">Start new game</button></p>' : ''}
  ${account.snapshot().enabled && account.snapshot().available && !account.snapshot().maintenance && !account.canPlay() ? '<p class="alert" role="status">Sign in to play or analyze. The board remains available to view.</p>' : ''}
  <h2 class="board-heading">Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span></h2>
  <p class="board-preview-label" id="shell-board-preview-label">Select a piece to preview moves; click it again for supply and command lines only:</p>
  <div class="board-wrap" data-testid="game-board-wrap">
    <div id="shell-board" class="board" data-testid="game-board"></div>
    <svg id="shell-overlay-lines" class="overlay-lines" aria-hidden="true"></svg>
  </div>
  <div class="overlay-key" aria-label="Board legend">
    <span><i class="swatch commander-key">${renderPieceSymbol('commander')}</i>Commander</span>
    <span><i class="swatch supply-point" style="--supply-owner:var(--player-${game.currentSnapshot?.sideToMove === 'P2' ? 'p2' : 'p1'})">${renderPieceSymbol('supply')}</i>Supply point</span>
    <span data-legend-entry="group" hidden><i class="swatch group"></i>Group strength</span>
    <span data-legend-entry="command" hidden><i id="shell-command-legend-swatch" class="swatch command" style="${escapeHtml(
      getCommandLegendSwatchStyle(game.currentSnapshot ?? null),
    )}"></i>Command line</span>
    <span data-legend-entry="supply" hidden><i class="swatch supply"></i>Supply line</span>
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

        </div>

        <div class="stack game-shell-mobile-panel" data-mobile-panel="board" data-shell-sticky-target="board" data-sticky-enabled="false">
          <section class="panel" data-shell-panel="board" data-turn-side="${game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red'}">
            ${renderBoardPanel(game)}
          </section>
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
// Keep the enabled home control and its ancestor chain mounted while asynchronous
// home sections update. Detaching a pressed/focused button loses native activation.
const patchHomeAroundCreateControl = (markup) => {
  const focusedControl=appEl.contains(document.activeElement) ? document.activeElement.closest('[data-action]') : null;
  const focusedAction=focusedControl?.dataset.action;
  const currentControl = appEl.querySelector('.home-start');
  const nextRoot = document.createElement("div");
  nextRoot.innerHTML = markup;
  const nextControl = nextRoot.querySelector('.home-start');
  if (!currentControl || !nextControl) return false;
  const pressedTop = currentControl.contains(pressedControlEl) ? currentControl.getBoundingClientRect().top : null;
  const comparableControl = currentControl.cloneNode(true);
  comparableControl.style.removeProperty("margin-top");
  if(!comparableControl.getAttribute("style"))comparableControl.removeAttribute("style");
  comparableControl.classList.remove("is-pressing");
  comparableControl.querySelectorAll(".is-pressing,.is-releasing").forEach(el=>el.classList.remove("is-pressing","is-releasing"));
  if (!comparableControl.isEqualNode(nextControl)) return false;
  const pathTo = (control, root) => {
    const path = [];
    for (let node = control; node && node !== root; node = node.parentElement) path.unshift(node);
    return [root, ...path];
  };
  const currentPath = pathTo(currentControl, appEl), nextPath = pathTo(nextControl, nextRoot);
  if (currentPath.length !== nextPath.length || currentPath.some((node, index) => index > 0 && node.tagName !== nextPath[index].tagName)) return false;
  for (let index = 0; index < currentPath.length - 1; index++) {
    const current = currentPath[index], next = nextPath[index], retained = currentPath[index + 1], replacement = nextPath[index + 1];
    if (index > 0) {
      for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
      for (const attribute of next.attributes) current.setAttribute(attribute.name, attribute.value);
    }
    const sectionNodes = new Map([...current.children].filter(el=>el.hasAttribute('data-home-section-root')).map(el=>[el.dataset.homeSectionRoot,el]));
    const nextSectionKeys = new Set([...next.children].filter(el=>el.hasAttribute('data-home-section-root')).map(el=>el.dataset.homeSectionRoot));
    for (const child of [...current.childNodes]) if (!(child instanceof HTMLElement && nextSectionKeys.has(child.dataset.homeSectionRoot)) && child !== retained && !(child instanceof HTMLElement && child.matches("[data-shell-flyouts]"))) child.remove();
    let after = false;
    for (const child of next.childNodes) {
      if (child === replacement) { after = true; continue; }
      if(child instanceof HTMLElement && child.matches("[data-shell-flyouts]"))continue;
      const section=child instanceof HTMLElement ? sectionNodes.get(child.dataset.homeSectionRoot) : null;
      if(section){patchSectionContent(section,child);continue;}
      if (after) current.append(child.cloneNode(true)); else current.insertBefore(child.cloneNode(true), retained);
    }
  }
  if(pressedTop !== null) {
    const shift=pressedTop-currentControl.getBoundingClientRect().top;
    if(shift>0)currentControl.style.marginTop=`${shift}px`;
  }
  updateMountedFlyouts();
  if(focusedAction && !focusedControl.isConnected)appEl.querySelector(`[data-action="${CSS.escape(focusedAction)}"]`)?.focus({preventScroll:true});
  return true;
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
  const focused = currentHeaderEl.contains(document.activeElement) ? document.activeElement : null;
  const focusAction = focused?.getAttribute("data-action");
  currentHeaderEl.replaceWith(nextHeaderEl);
  if (focusAction) nextHeaderEl.querySelector(`[data-action="${CSS.escape(focusAction)}"]`)?.focus({ preventScroll: true });
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
    const keys = new Set([...nextFlyoutStack.children].map(el=>el.dataset.flyout));
    for(const child of [...currentFlyoutStack.children]) if(!keys.has(child.dataset.flyout))child.remove();
    for(const [index,next] of [...nextFlyoutStack.children].entries()) {
      const existing=currentFlyoutStack.querySelector(`[data-flyout="${next.dataset.flyout}"]`);
      if(!existing){currentFlyoutStack.insertBefore(next,currentFlyoutStack.children[index] || null);continue;}
      const scroll=existing.querySelector('.shell-flyout-scroll'), nextScroll=next.querySelector('.shell-flyout-scroll');
      if(scroll && nextScroll && scroll.innerHTML !== nextScroll.innerHTML){const top=scroll.scrollTop;scroll.innerHTML=nextScroll.innerHTML;scroll.scrollTop=top;}
      if(currentFlyoutStack.children[index] !== existing)currentFlyoutStack.insertBefore(existing,currentFlyoutStack.children[index] || null);
    }
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

  shellRoot.querySelector('[data-shell-panel="board"]')?.setAttribute('data-turn-side',game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red');
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
    const markup=renderJoinInvitePanel(game, inviteLink);
    if(joinMarkupByElement.get(joinEl) !== markup){
      const oldHeight=joinEl.getBoundingClientRect().height;
      const focus=joinEl.contains(document.activeElement)?document.activeElement:null;
      const selector=focus?.matches('.invite-link-field')?'.invite-link-field':focus?.dataset.action?`[data-action="${CSS.escape(focus.dataset.action)}"]${focus.dataset.inviteRole?`[data-invite-role="${CSS.escape(focus.dataset.inviteRole)}"]`:''}${focus.dataset.profileKey?`[data-profile-key="${CSS.escape(focus.dataset.profileKey)}"]`:''}`:null;
      const selection=focus instanceof HTMLInputElement?[focus.selectionStart,focus.selectionEnd]:null;
      if(selector)panelPendingFocus.set(joinEl,{selector,selection});
      else if(document.activeElement !== document.body)panelPendingFocus.delete(joinEl);
      joinEl.innerHTML=markup;
      joinMarkupByElement.set(joinEl,markup);
      const savedFocus=panelPendingFocus.get(joinEl);
      if(savedFocus){
        const target=joinEl.querySelector(savedFocus.selector);
        if(target && !target.disabled){
          target.focus({preventScroll:true});
          if(savedFocus.selection && target instanceof HTMLInputElement)target.setSelectionRange(...savedFocus.selection);
          panelPendingFocus.delete(joinEl);
        }else if(!isButtonPending(getCopyInviteButtonKey(game.id)))panelPendingFocus.delete(joinEl);
      }
      animatePanelHeightChange(joinEl,oldHeight);
    }
  }
  if (participantsEl instanceof HTMLElement) {
    participantsEl.innerHTML = renderParticipantsPanel(game);
  }
  if (historyEl instanceof HTMLElement) {
    historyEl.innerHTML = renderHistoryPanel(game);
  }
  if (includeBoard || mountedBoardGameId === game.id || !document.querySelector("#shell-board .cell")) {
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
  return !game.pendingPlayerRequestSeat && activeResultGameId !== game.id && hostInvite?.gameId !== game.id && !getActiveApprovalRequest(game) && !getActiveRevertRequest(game) && !getActivePendingRevertRequest(game) && doesMountedFlyoutStateMatchRoute();
};

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  const game = transport.getGameViewModel(gameId);
  if (!routeHydrated && !game) {
    return renderGameViewSkeleton();
  }
  if (!game) {
    return renderGameViewSkeleton();
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

      </div>

      <div class="stack" data-shell-sticky-target="board" data-sticky-enabled="false">
        <section class="panel" data-shell-panel="board" data-turn-side="${game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red'}">
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
      <div class="invite-gate-content" aria-hidden="true" inert>
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
      <div class="invite-gate-content" aria-hidden="true" inert>
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
      <div class="invite-gate-content" aria-hidden="true" inert>
        ${background}
      </div>
    </section>
  `;
};

const renderResult = game => {
  const result = getGameResult(transport.getAuthoritativeGame(game.id), transport.getIdentityId());
  if (!result) return "";
  const names = game.selfPlayMode ? "Self-play" : [game.player1, game.player2].map((person, i) => person?.profile?.displayName || `Player ${i + 1}`).join(" vs ");
  return `<section class="panel game-result" data-testid="game-result"><p class="small">Game finished</p><h1 tabindex="-1">${escapeHtml(result.title)}</h1><p>${escapeHtml(result.reason)}</p><p>${escapeHtml(names)}</p><p class="small">Game ${escapeHtml(formatDisplayGameId(game.id))}</p><div class="story-modal-actions"><button data-action="analysis" data-game-id="${escapeHtml(game.id)}">${icon('back')}Review game</button><button class="secondary" data-action="rematch" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Play again</button><a class="button-link secondary" href="#/">Home</a></div></section>`;
};

const renderGame = (gameId, inviteFromRole = null, inviteToken = null) => {
  if (!routeHydrated) {
    return renderGameContent(gameId, inviteFromRole, inviteToken);
  }
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return renderGameContent(gameId, inviteFromRole, inviteToken);
  }
  if (activeResultGameId === gameId && getGameResult(transport.getAuthoritativeGame(game.id), transport.getIdentityId())) return renderResult(game);
  if(hostInvite?.gameId === gameId)return renderHostInvite(game);
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

  if(game.pendingPlayerRequestSeat)return renderInvitationSurface({background,content:`
    <p class="small invite-gate-kicker">Invitation</p><h2 id="invite-surface-title">Waiting for approval</h2>
    <p role="status" data-testid="pending-player-request-notice">A player needs to approve your request to join as ${renderSeatLabel(game.pendingPlayerRequestSeat)}.</p>
    <p class="small">The game will open here when your seat is approved.</p>
    <div class="invite-choice-list"><a class="button-link secondary" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">Back home</a></div>`});
  const canJoinPlayer = game.canJoinAsPlayer && game.showJoinActions;
  const canJoinViewer = account.snapshot().enabled || game.canJoinAsViewer;
  const playerActionLabel = inviteContext.intendedRole && inviteContext.intendedRole !== 'viewer' ? `Play as ${inviteContext.intendedRole}` : inviteContext.inviteType === "player" ? "Join as player" : "Request to join as player";
  const inviteMessage =
    inviteContext.inviteType === "player"
      ? "You’re invited to play."
      : currentRoute.name === "game"
        ? "Join this game to play or watch."
        : "You’re invited to watch.";
  const playerExplainer = canJoinPlayer
    ? inviteContext.inviteType === "player"
      ? ""
      : "Ask a player to approve your seat."
    : game.joinAsPlayerDisabledReason || "Player joining is unavailable.";
  const viewerExplainer = canJoinViewer
    ? ""
    : game.joinAsViewerDisabledReason || "Viewer joining is unavailable.";
  const pendingNotice = game.pendingPlayerRequestSeat
    ? `<div class="alert">Player join request pending approval for ${renderSeatLabel(game.pendingPlayerRequestSeat)}.</div>`
    : "";
  const joinPlayerButtonKey = getJoinButtonKey("player", game.id);
  const joinViewerButtonKey = getJoinButtonKey("viewer", game.id);

  return renderInvitationSurface({background,content:`
        <p class="small invite-gate-kicker">Invite received</p>
        <h2 id="invite-surface-title">${inviteContext.intendedRole === "viewer" ? "Watch this game" : inviteContext.intendedRole ? "Take your seat" : "Choose how to enter this game"}</h2>
        <p>${colorizePlayerReferences(inviteMessage)}</p>
        ${pendingNotice}
        <div class="invite-choice-list">
          <div class="invite-choice-row" ${inviteContext.intendedRole === "viewer" ? 'hidden' : ''}>
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
              ? ""
              : "No join mode is currently available for this invite."
          }
        </p>
  `});
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

  document.querySelector('[data-shell-panel="board"]')?.setAttribute('data-turn-side', game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red');
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
          return hostInvite?.gameId !== game.id && canControlLiveBoard(view);
        },
      }),
      controls: {
        onInteractionSound: event => gameSound.interaction(event),
        getAllowFreeSelection: () => false,
        getSupportsHover: () => hoverCapability.getSupportsHover(),
        getForceClickTargetSelection: () => Boolean(currentRoute.scenarios),
        onVisualsUpdated: visible => updateLegendVisibility(document.querySelector('.overlay-key'), visible, prefersReducedMotion()),
        onStateUpdated: ({ state, selectedPieceId }) => {
          applyCommandLegendSwatch(document.getElementById("shell-command-legend-swatch"), state, selectedPieceId);
          applyCommandLegendSwatch(document.querySelector(".commander-key"), state, selectedPieceId);
          document.querySelector('.swatch.supply-point')?.style.setProperty('--supply-owner',getCommandLegendColor(state,selectedPieceId));
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
  const read = captureRouteRead();
  const response = await read.owner.loadGamesPage({
    section: sectionKey,
    page: serverPage,
    pageSize: HOME_SECTION_SERVER_PAGE_SIZE,
    debug: currentRoute.debug === true,
  });
  assertCurrentRouteRead(read);
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
  const read = captureRouteRead();
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
  assertCurrentRouteRead(read);
  setHomeSection(sectionKey, {
    ...nextSection,
    page: normalizedPage,
    totalPages: normalizedTotalPages,
    gameIds: visibleGameIds,
    slideDirection: nextDirection,
    animationToken: nextDirection === "none" ? previous.animationToken : previous.animationToken + 1,
  });
  if(nextDirection !== "none")gameSound.play(nextDirection === "prev" ? "page-back" : "page");
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

const syncHomeSections = async () => {
  const read = captureRouteRead();
  const visibleSectionKeys = getVisibleHomeSectionKeys();
  await Promise.all(
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
  );
  assertCurrentRouteRead(read);
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

// Background shell updates must not interrupt an in-progress scenario draft.
const captureScenarioDraftFocus = (baseRouteKey) => {
  const active = document.activeElement;
  if (baseRouteKey !== lastRenderedBaseRouteKey ||
      !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return null;
  const field = active.getAttribute("data-scenario-save-field");
  if (field !== "title" && field !== "description") return null;
  const { selectionStart, selectionEnd, selectionDirection } = active;
  return () => {
    const replacement = appEl.querySelector(`[data-scenario-save-field="${field}"]`);
    if (!(replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement)) return;
    replacement.focus({ preventScroll: true });
    replacement.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  };
};

const render = ({ animatePanels = true, includeBoard = true } = {}) => {
  if (renderGesture.defer({ animatePanels, includeBoard })) return;
  const result = preserveBoardFocus({ document, getGameId: getCurrentViewedGameId }, () => renderContent({ animatePanels, includeBoard }));
  inlineProfiles.sync();
  if (pendingResultReviewFocus === currentRoute.gameId && getGamePanel() === "history") {
    const heading = appEl.querySelector('[data-game-panel="history"] h2');
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); pendingResultReviewFocus = null; }
  }
  return result;
};
const renderContent = ({ animatePanels, includeBoard }) => {
  const hadResultView = Boolean(appEl.querySelector('.game-result'));
  const resultFocus = document.activeElement?.closest('.game-result') ? {action:document.activeElement.getAttribute('data-action'),href:document.activeElement.getAttribute('href')} : null;
  if(currentRoute.name==='game' && routeHydrated){
    const game=transport.getGameViewModel(currentRoute.gameId), confirmed=transport.getAuthoritativeGame(currentRoute.gameId);
    if (activeResultGameId === currentRoute.gameId && confirmed?.board?.state?.outcome && !getGameResult(confirmed, transport.getIdentityId())) activeResultGameId = null;
    if(resultTransitions.observe(confirmed,{inHistory:game?.inHistoryMode,hidden:document.hidden,storyOpen:storyDialog.isOpen()}))activeResultGameId=currentRoute.gameId;
    if(storyDialog.gameId()===currentRoute.gameId && getGameResult(confirmed,transport.getIdentityId()))storyDialog.setMatchStatus('Game finished',true);
  }
  document.title = getDocumentTitle();
  syncRouteTransitionForCurrentRoute();
  const routeKey = getRouteRenderKey();
  const baseRouteKey = getBaseRouteRenderKey();
  const restoreScenarioDraftFocus = captureScenarioDraftFocus(baseRouteKey);
  const inviteActiveElement = document.activeElement;
  const restoreInviteFocus = Boolean(hostInvite && (inviteActiveElement?.closest('.invite-gate-modal') || inviteActiveElement === document.body));
  if (hostInvite && inviteActiveElement?.closest('.invite-gate-modal')) {
    if (inviteActiveElement.matches('.invite-link-field')) hostInvite.focusTarget = {selector:'.invite-link-field',start:inviteActiveElement.selectionStart,end:inviteActiveElement.selectionEnd};
    else if (inviteActiveElement.dataset.action) hostInvite.focusTarget = {selector:`[data-action="${CSS.escape(inviteActiveElement.dataset.action)}"]${inviteActiveElement.dataset.inviteRole ? `[data-invite-role="${CSS.escape(inviteActiveElement.dataset.inviteRole)}"]` : ''}`};
  }
  const shouldPatchFlyoutsOnly = !hadResultView && activeResultGameId !== currentRoute.gameId && shouldPatchMountedFlyouts(routeKey, baseRouteKey);
  const previousPanelHeights = animatePanels && !shouldPatchFlyoutsOnly && baseRouteKey === lastRenderedBaseRouteKey && !routeTransition ? capturePanelHeights() : [];
  const previousFlyoutRects = animatePanels ? captureFlyoutRects() : new Map();
  syncShellLayoutMode();
  if (shouldPatchFlyoutsOnly) {
    updateMountedHeader();
    updateMountedFlyouts();
    restoreScenarioDraftFocus?.();
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
    restoreScenarioDraftFocus?.();
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

  brand.setHome(currentRoute.name === 'home');
  appEl.dataset.actionAffiliation = resolveActionAffiliation({game:transport.getGameViewModel(currentRoute.gameId),identityId:transport.getIdentityId()});
  const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">${renderHeader()}${body}</div>${renderFlyouts()}</div>`;
  if (nextMarkup !== lastRenderedMarkup) {
    if (currentRoute.name !== "home" || !patchHomeAroundCreateControl(nextMarkup)) {
      const currentMain=appEl.querySelector('.shell-main-content');
      const nextMain=createMarkupRoot(nextMarkup)?.querySelector('.shell-main-content');
      if(currentMain && nextMain){currentMain.replaceWith(nextMain);updateMountedFlyouts();}
      else appEl.innerHTML = nextMarkup;
    }
    restoreScenarioDraftFocus?.();
    if(hostInvite && !hostInvite.focused){document.querySelector('[data-host-invite] [data-action="share-invite"]')?.focus({preventScroll:true});hostInvite.focused=true;}
    if (restoreInviteFocus && hostInvite?.focusTarget) {
      const target = document.querySelector(`.invite-gate-modal ${hostInvite.focusTarget.selector}`);
      if (target && !target.disabled) {
        target.focus({preventScroll:true});
        if (target instanceof HTMLInputElement) target.setSelectionRange(hostInvite.focusTarget.start,hostInvite.focusTarget.end);
      } else document.querySelector('.invite-gate-modal')?.focus({preventScroll:true});
    }
    lastRenderedMarkup = nextMarkup;
    lastRenderedMainMarkup = `<div class="shell-main-content">${renderHeader()}${body}</div>`;
    lastRenderedFlyoutMarkup = renderFlyouts();
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
    lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey();
    if (animatePanels) {
      animatePanelHeightChanges(previousPanelHeights);
      animateFlyoutPositionChanges(previousFlyoutRects);
    }
  }
  if (nextMarkup === lastRenderedMarkup) {
    lastRenderedRouteKey = routeKey;
    lastRenderedBaseRouteKey = baseRouteKey;
    lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey();
  }
  if(resultFocus?.action || resultFocus?.href)appEl.querySelector(resultFocus.action ? `.game-result [data-action="${CSS.escape(resultFocus.action)}"]` : `.game-result a[href="${CSS.escape(resultFocus.href)}"]`)?.focus({preventScroll:true});
  syncFlyoutAwareLinks();
  syncCopyInviteLinks();
  updateHeaderFields();
  syncMountedGameShellPanelUi();
  reconcileMiniBoardPreviews();
  animateHomeSectionTransitions();
  syncScenarioAuthoringControls();
  if(currentRoute.name==='game' && activeResultGameId===currentRoute.gameId){destroyMountedBoardRuntime();if(!hadResultView)appEl.querySelector('.game-result h1')?.focus({preventScroll:true});return;}
  if (currentRoute.name !== "game" && currentRoute.name !== "invite") {
    scheduleGameShellStickyLayout();
    destroyMountedBoardRuntime();
    return;
  }
  if (currentRoute.name === "game") {
    if (shouldUseIncrementalGameShell()) {
      if (updateMountedGameShell({
        game: transport.getGameViewModel(currentRoute.gameId),
        inviteFromRole: currentRoute.inviteFromRole,
        includeBoard,
      })) return;
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

const captureRouteRead = () => ({
  generation: account.snapshot().generation,
  hash: window.location.hash,
  owner: transport,
  route: { ...currentRoute },
  inputs: JSON.stringify(getVisibleHomeSectionKeys().map(key => [key, getHomeSection(key).page, getHomeSectionVisiblePageSize(key), getHomeSectionColumnCount(key)])),
});
const routeReadIsCurrent = read => read.generation === account.snapshot().generation && read.hash === window.location.hash && read.owner === transport;
const assertCurrentRouteRead = read => {
  if (!routeReadIsCurrent(read)) throw Object.assign(new Error("session_changed"), { code: "session_changed" });
};
const syncRouteDataAndLiveChannels = () => {
  const read = captureRouteRead();
  return hydrateRoute(read, async () => {
    assertCurrentRouteRead(read);
    if (read.route.name === "home") await syncHomeSections();
    if (read.route.name === "game") {
      resolvedInvite = null;
      await read.owner.loadGame(read.route.gameId, { openAsViewer: false });
    }
    if (read.route.name === "invite") {
      const invite = await read.owner.resolveInvite(read.route.inviteToken);
      assertCurrentRouteRead(read);
      await read.owner.loadGame(invite.gameId, { openAsViewer: false });
      assertCurrentRouteRead(read);
      resolvedInvite = invite;
    }
    assertCurrentRouteRead(read);
    syncLiveChannels();
  });
};

const retryAccountContinuation = async () => {
  const pending = accountContinuation;
  if (!pending || pending.running || !routeReadIsCurrent(pending)) return;
  pending.running = true;
  accountContinuationError = false;
  render({ animatePanels: false, includeBoard: false });
  try {
    await syncRouteDataAndLiveChannels();
  } catch {
    if (accountContinuation === pending && routeReadIsCurrent(pending)) {
      pending.running = false;
      accountContinuationError = true;
      render({ animatePanels: false, includeBoard: false });
    }
    return;
  }
  if (accountContinuation !== pending || !routeReadIsCurrent(pending)) return;
  // Claim before invoking the original action. A failed write is never replayed.
  accountContinuation = null;
  accountContinuationError = false;
  routeHydrated = true;
  render({ animatePanels: false });
  const intent = pending.intent;
  if (!intent || !account.canPlay() || intent.hash !== window.location.hash) return;
  if (intent.action === "rematch") {
    const result = getGameResult(transport.getAuthoritativeGame(intent.gameId), transport.getIdentityId());
    if (result) rematchDialog.open(result, appEl.querySelector('[data-action="view-result"]'));
    return;
  }
  const selector = `[data-action="${CSS.escape(intent.action)}"]${intent.gameId ? `[data-game-id="${CSS.escape(intent.gameId)}"]` : ""}${intent.moveIndex ? `[data-move-index="${CSS.escape(intent.moveIndex)}"]` : ""}`;
  appEl.querySelector(selector)?.click();
};
const completeAccountContinuation = async intent => {
  accountContinuation = { ...captureRouteRead(), intent, running: false };
  await retryAccountContinuation();
};
const clearAccountContinuation = () => {
  accountContinuation = null;
  accountContinuationError = false;
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
      routeHydrated = true;
      render({ animatePanels: false, includeBoard: false });
      maybeRevealRouteTransition();
    }
  })();
};

const syncRouteDataPassive = async () => {
  try {
    await syncRouteDataAndLiveChannels();
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
  onEvent: (payload, context = {}) => {
    gameSound.observe(payload,{silent:context.initial || currentRoute.name!=='game' || payload?.game?.id!==currentRoute.gameId || Boolean(transport.getGameViewModel(currentRoute.gameId)?.inHistoryMode)});
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
const closeFriendInvite = () => {
  hostInvite=null;inviteVisit++;render({animatePanels:false});
  document.querySelector('[data-action="copy-invite"]')?.focus({preventScroll:true});
};
const copyGameInvitation = async (gameId, role, fromHost=false) => {
  const visit=inviteVisit, generation=account.snapshot().generation;
  const active=()=>generation===account.snapshot().generation && currentRoute.name==='game' && currentRoute.gameId===gameId && (!fromHost || hostInvite?.gameId===gameId && visit===inviteVisit);
  try {
    const handle=transport.getGameHandle?.(gameId);
    if(handle?.status==='pending')await handle.committed;
    if(!active())return;
    const game=transport.getGameViewModel(gameId);
    const option=invitationOptions(game).find(option=>option.role===role);
    if(!option)throw new Error('That seat has been taken. Invite someone to view instead.');
    if(role !== "viewer") preparedPlayerInvitations.set(gameId, role);
    const hash=buildInviteHash(option.token,getCurrentFlyoutState());
    const link=`${window.location.origin}${window.location.pathname}${hash}${hash.includes('?')?'&':'?'}as=${role}`;
    window.__righeltLastInvite=link;
    try { await navigator.clipboard.writeText(link);if(!active())return;inviteFallback=null;setInviteFeedback('Link copied'); }
    catch { if(!active())return;inviteFallback={gameId,link};setInviteFeedback('Copy the link below to share it.'); }
  }catch(error){if(active())setInviteFeedback(error.message || 'Could not prepare the link. Try again.');}
};
const renderHostInvite = game => renderInvitationSurface({host:true,background:renderGameContent(game.id),content:`
  <button class="ui-icon-button invite-close" data-action="close-invite" aria-label="Close invite">${icon('close')}</button>
  <p class="small invite-gate-kicker">Your game is ready</p><h2 id="invite-surface-title">Invite a friend</h2>
  <p>Copy a link and send it their way.</p>
  <div class="invite-choice-list">${invitationOptions(game).map(option=>`<button data-action="share-invite" data-invite-role="${option.role}" data-game-id="${escapeHtml(game.id)}"${renderButtonStateAttributes({className:`invite-action invite-${option.role}${option.role==='viewer'?' secondary':''}`,pendingKey:getCopyInviteButtonKey(game.id)})}>${icon('copy')}${isButtonPending(getCopyInviteButtonKey(game.id))?'Preparing link…':option.label}</button>`).join('')}</div>
  ${renderInviteFeedback()}
  ${inviteFallback?.gameId===game.id?`<input class="invite-link-field" aria-label="Invitation link" value="${escapeHtml(inviteFallback.link)}" readonly>`:''}
`});
const openFriendInvite = gameId => {
  hostInvite={gameId};inviteVisit++;inviteFeedback='';inviteFallback=null;
  // A render while hash navigation is pending still sees Home and cancels
  // the game-entry transition. Let the destination render own its invitation.
  if(currentRoute.name === 'game' && currentRoute.gameId === gameId) render({animatePanels:false});
  window.requestAnimationFrame(() => {
    if(currentRoute.name !== 'game' || currentRoute.gameId !== gameId || hostInvite?.gameId !== gameId) return;
    window.scrollTo({top:0,behavior:'instant'});
    document.querySelector('[data-host-invite] [data-action="share-invite"]')?.focus({preventScroll:true});
  });
};
const rematchDialog = createRematchDialog({createModal,onStart:async({opponent,side},{isCurrent})=>{
  if(!await waitForAccountGate() || !isCurrent())return;
  if(!account.canPlay())throw new Error('Sign in to start another game.');
  if(!['self','friend'].includes(opponent))throw new Error('This opponent is still in training.');
  const handle=transport.createGame({selfPlayMode:opponent==='self',creatorSide:side});
  rematchDialog.close();activeResultGameId=null;
  startGameEntryRouteTransition(handle.result.id,'game');navigateTo(buildGameHash(handle.result.id,null,getCurrentFlyoutState()));
  if(opponent==='friend')openFriendInvite(handle.result.id);
}});
const getComputerReadiness = () => ({ state:'unavailable', message:'This opponent is still in training. Friend games are ready to play.' });
const opponentSession = createOpponentSession({ preferences:createIntroductionPreferences(storage), getReadiness:getComputerReadiness, createGame:async()=>{throw new Error('Trained computer play is not available yet.');} });
const storyDialog = createOpponentStoryDialog({ createModal, getReadiness: opponent => opponent === 'friend' ? {state:'ready',message:'Send an invitation. Let the rivalry begin.'} : getComputerReadiness(),
  onPlay: intent => {
    if(intent.opponent !== 'friend') return opponentSession.play(intent);
    if(!account.canPlay()) return {state:'error',message:'Sign in to start your game.'};
    storyDialog.close('play');
    const handle=transport.createGame({selfPlayMode:false});
    startGameEntryRouteTransition(handle.result.id,currentRoute.name);
    navigateTo(buildGameHash(handle.result.id,null,getCurrentFlyoutState()));
    openFriendInvite(handle.result.id);
    return {state:'started'};
  }, onClose:reason=>{opponentSession.cancel();if(reason === 'dismiss')gameSound.play('intro-back');},
  onPresentation: () => { const root=document.createElement('div');root.className='story-presentation-board';root.setAttribute('aria-hidden','true');document.body.append(root);const preview=createMiniBoardPreview({rootEl:root,preview:{snapshot:createInitialBoardSnapshot(),previewKey:'intro'},createAdapter:createEngineBoardAdapter});return ()=>{preview.destroy();root.remove();}; },
});

const subscribeToTransport = () => transport.subscribe((change) => {
  gameSound.local(change, transport.getGameViewModel(change?.gameId), {silent:currentRoute.name!=='game' || currentRoute.gameId!==change?.gameId || Boolean(transport.getGameViewModel(change?.gameId)?.inHistoryMode)});
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
  clearAccountContinuation();
  resultTransitions.clear();activeResultGameId=null;pendingResultReviewFocus=null;rematchDialog.close();
  hostInvite=null;inviteVisit++;inviteFeedback="";inviteFallback=null;preparedPlayerInvitations.clear();
  gameSound.leaveGame();storyDialog.close();inlineProfiles.close();
  const gameId = getCurrentViewedGameId();
  const visible = gameId ? transport.getAuthoritativeGame?.(gameId) : null;
  routeSyncRequestId++;
  pendingButtonKeys.clear();pendingHomeSectionKeys.clear();inviteChoiceCommittedByGameId.clear();ignoredApprovalRequests.clear();ignoredRevertRequests.clear();
  consumedInitialSelectionActionKeyByGameId.clear();
  transport.retire?.();
  destroyMountedBoardRuntime();
  clearRouteTransition({ renderNow: false });

  homeSections = { my: createHomeSectionState("My games"), other: createHomeSectionState("Other games"), smoke: createHomeSectionState("Deploy smoke player") };
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

const navigateTo = (hash) => {
  clearAccountContinuation();
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
  clearAccountContinuation();
  const previousRoute = currentRoute;
  closeHeaderMenu();
  const parsedRoute = parseRouteFromHash(window.location.hash);
  if(parsedRoute.name!=='game' || parsedRoute.gameId!==currentRoute.gameId)gameSound.leaveGame();
  if(hostInvite && (parsedRoute.name!=='game' || parsedRoute.gameId!==hostInvite.gameId)){hostInvite=null;inviteVisit++;}
  inlineProfiles.close();
  if(parsedRoute.gameId!==previousRoute.gameId){activeResultGameId=null;pendingResultReviewFocus=null;rematchDialog.close();}
  currentRoute = normalizeRouteFlyoutState(parsedRoute);
  if(previousRoute.name !== 'game' && currentRoute.name === 'game' && !routeTransition)gameSound.play('enter');
  else if(previousRoute.name === 'game' && currentRoute.name !== 'game' && (currentRoute.name !== 'home' || prefersReducedMotion()))gameSound.play('leave');
  if(previousRoute.name === 'game' && currentRoute.name === 'home') {
    gameSound.cancelPreview();restoreHomePending=true;
    startGameEntryRouteTransition(previousRoute.gameId,'game','home');
  } else if(previousRoute.name === 'home' && currentRoute.name === 'game') {
    window.scrollTo({top:0,behavior:'instant'});
  }
  syncRouteTransitionForCurrentRoute();
  const normalizedHash = buildHashForRoute(currentRoute);
  if (window.location.hash !== normalizedHash) {
    window.location.hash = normalizedHash;
    return;
  }
  syncFlyoutRenderOrder(currentRoute);
  if (canHydrateRouteFromLocalState(currentRoute)) {
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
  scheduleGameShellStickyLayout();
  scheduleResponsiveHomeSectionPageSizes();
});

window.addEventListener("load", () => {
  scheduleGameShellStickyLayout();
  scheduleResponsiveHomeSectionPageSizes();
});

// The first click may arrive while the initial cookie is still being read.
// Resolve that session before choosing the appropriate account form.
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
  accountDialog.open("login", null, source);
};

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
  if (!(target instanceof Element)) {
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
  const actionGameId = actionEl.getAttribute("data-game-id") || currentRoute.gameId;
  if (action === "public-profile") { void inlineProfiles.open(actionEl.getAttribute("data-username"), actionEl); return; }
  if (action === "retry-account-continuation") { void retryAccountContinuation(); return; }
  if (action === "retry-account-startup") { if (accountStartupError.includes("refresh")) window.location.reload(); else void initialRender(); return; }
  if (action === "account-open") { if (accountDialog.isOpen()) { void accountDialog.close(); return; } accountDialog.open(account.snapshot().session.authenticated ? "account" : "login", null, actionEl); return; }
  const accountGatedActions = new Set(["create-game","create-self-play","rematch","join-player","accept-invite-player","play-as-both-players","load-scenario","launch-history-branch"]);
  if (accountGatedActions.has(action) && (!account.snapshot().ready || account.snapshot().pendingLogout)) {
    event.preventDefault();
    if (!await waitForAccountGate()) return;
  }
  if (accountGatedActions.has(action) && !account.canPlay()) {
    event.preventDefault();
    if (!account.snapshot().available || account.snapshot().maintenance) return;
    const intent = safeAccountIntent({ hash: window.location.hash, action, gameId: actionGameId, moveIndex: actionEl.getAttribute("data-move-index") });
    accountDialog.open("login", intent, actionEl);
    return;
  }
  if (action === "view-result") { if (!getGameResult(transport.getAuthoritativeGame(actionGameId), transport.getIdentityId())) return; activeResultGameId = actionGameId; render({ animatePanels: false }); return; }
  if (action === "analysis") { pendingResultReviewFocus = actionGameId; activeResultGameId = null; render({ animatePanels: false }); navigateTo(buildGameHash(actionGameId, null, getCurrentGameHashState("history"))); return; }
  if (action === "rematch") {
    const result = getGameResult(transport.getAuthoritativeGame(actionGameId), transport.getIdentityId());
    if(result)rematchDialog.open(result,actionEl);return;
  }
  if (sharedMutationActions.has(action) && transport.getGameViewModel(actionGameId)?.sharedMutationsBlocked) return;
  const animateFlyoutClose = async (flyoutKey, closeFlyout) => {
    gameSound.play("flyout-back");
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
      }
      // Slide the intact surface out through its placement edge. Shrinking its
      // dimensions also shrinks percentage translation and causes a collapse.
      flyoutEl.style.transition = `transform ${FLYOUT_MOTION_MS}ms ease, opacity ${FLYOUT_MOTION_MS}ms ease`;
      flyoutEl.classList.add("is-closing");
      await delay(FLYOUT_MOTION_MS);
    }
    setFlyoutOpenState(flyoutKey, false);
    closeFlyout();
    window.setTimeout(() => {
      clearCoordinatedFlyoutMotionStyles();
    }, 0);
  };

  if(action==='close-invite'){closeFriendInvite();return;}
  if(action==='share-invite'){await withPendingButton(getCopyInviteButtonKey(actionEl.dataset.gameId),()=>copyGameInvitation(actionEl.dataset.gameId,actionEl.dataset.inviteRole,true));return;}
  if (action === 'guest-profile') { void inlineProfiles.open(null,actionEl);return; }
  if (action === 'toggle-sound') { const enabled=gameSound.toggle();actionEl.innerHTML=icon(enabled?'sound':'muted');actionEl.setAttribute('aria-label',enabled?'Mute sound':'Enable sound');actionEl.setAttribute('aria-pressed',String(enabled));actionEl.title=`Sound ${enabled?'on':'off'}`;return; }
  if (action === 'opponent-story') { gameSound.play('intro'); storyDialog.open(actionEl.dataset.opponent,{trigger:actionEl}); return; }
  if (action === "create-game" || action === 'create-self-play') {
    if(action === 'create-game'){gameSound.play('intro');storyDialog.open('friend',{trigger:actionEl});return;}
    const handle = transport.createGame({ selfPlayMode: action === 'create-self-play' });
    startGameEntryRouteTransition(handle.result.id, "home");
    navigateTo(buildGameHash(handle.result.id, null, getCurrentFlyoutState()));
    if(action==='create-game') openFriendInvite(handle.result.id,actionEl);
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
        setInviteFeedback("");
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
    await withPendingButton(getCopyInviteButtonKey(gameId),()=>copyGameInvitation(gameId,actionEl.dataset.inviteRole || 'viewer'));

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
    if(transport.getGameViewModel(gameId)?.inHistoryMode)gameSound.play("history");
    return;
  }

  if (action === "return-live") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    clearHistoryPress();
    playHistoryReleaseBounce(actionEl);
    await animateHistoryDeselection(actionEl);
    transport.returnToLive({ gameId });
    gameSound.play("history-back");
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
      gameSound.play("flyout");
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
      gameSound.play("flyout");
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
  if (!(target instanceof Element)) {
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

window.addEventListener("pointercancel",()=>{document.querySelector(".home-start")?.style.removeProperty("margin-top");clearControlPress();});
window.addEventListener("pointerup", (event) => {
  window.setTimeout(()=>document.querySelector('.home-start')?.style.removeProperty('margin-top'),0);
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
  const invitation=document.querySelector('.invite-gate-modal[role="dialog"]');
  if(invitation && event.key==='Escape' && hostInvite){event.preventDefault();closeFriendInvite();return;}
  if(invitation && event.key==='Tab'){
    const controls=[...invitation.querySelectorAll('button:not(:disabled),a[href],input:not([disabled])')].filter(el=>el.getClientRects().length);
    const index=controls.indexOf(document.activeElement);
    if(index<0 || event.shiftKey && index===0 || !event.shiftKey && index===controls.length-1){event.preventDefault();controls[event.shiftKey?controls.length-1:0]?.focus();}
  }
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
