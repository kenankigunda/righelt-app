import {boardTurnCaption,liveHistoryLabel,historyActorLabel,sideColorName,playerDisplayName} from './perspective-labels.js';
import {renderSummarySlots,renderSummaryLoading,renderPlayersLoading,renderHistorySlots,renderHistoryLoading,renderInvitationLoading} from './panel-loading.js';
import { createDesktopBoardFit } from './desktop-board-fit.js';
import { buildTurnReplay, createComputerReplay } from './computer-replay.js';
import { deriveBoardView, createViewingIntent } from './viewing-state.js';
import { mountMobileNavigation } from './mobile-navigation.js';
import { opponentBoardMessage, latestOpponentTurn, ownsBoardActor } from './opponent-narration.js';
import { renderBoardHeadingSlot, renderBoardMessageSlot, updateComputerBoardLoading } from './board-message-layout.js';
import { activityActorSide, activityStateActorSide, setActivityActor, undoApprovalActorSide } from './activity-affiliation.js';
import { applyDecisionNotes } from './decision-notes.js';
import { createUtilityMemory } from './utility-memory.js';
import { createReplayRequest } from './replay-request.js';
import { activeDecisionLineage } from './decision-history.js';
import { createAdditionalHistory, canReadAdditionalHistory } from './additional-history.js';
import { createJoinFeedback } from './join-feedback.js';
import { beginScenarioCapture, scenarioCapturePosition, canLoadScenarioInPlace } from './scenario-capture.js';
import { createComputerPreparation } from './computer-preparation.js';
import { createComputerSession, COMPUTER_PRESENTATION } from './computer-session.js';
import { createFramePresentation, COMPUTER_UI_FRAME_MEASURE } from './frame-presentation.js';
import { renderComputerProgress, renderDecisionDebug } from './computer-view.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
let computerSession = null;
const viewingIntent = createViewingIntent();
let mobileNavigation = null;
let replayController = null;
const replayRequests = createReplayRequest({onChange:() => boardRuntime?.refreshStatus()});
const viewingScope = () => `${account.snapshot().generation}:${activeStorageGeneration}`;
const getBoardGame = game => deriveBoardView(game, { narrow: getShellLayoutMode() === "narrow", identityId: transport.getIdentityId() });
const decisionDebugStates = new Map();
const getDecisionDebugState = (gameId) => {
  if (!decisionDebugStates.has(gameId)) decisionDebugStates.set(gameId, { items: [], notes: [], drafts: new Map(), attempts: new Map(), attemptPages: { computer: { items: [], cursor: null }, analysis: { items: [], cursor: null } }, open: new Set(), cursor: null, partial: false, flaggedOnly: false, error: null });
  return decisionDebugStates.get(gameId);
};
const patchToolHtml = (element, html) => {
  const next = element.cloneNode(false); next.innerHTML = html;
  patchSectionContent(element, next);
};
import { createDestructionTransitions } from "./destruction-transitions.js";
import { isPassivePageClick } from "./passive-click.js";
import {mountLoadingEdges} from './loading-edge.js';
import {mountRecoverySpace} from './recovery-space.js';
import { mountLoadingFeedback, loadingAttributes, LOADING_CUE_DELAY_MS } from "./loading.js";
import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";
import { latestRequestEvidence } from "./request-evidence.js";
import { issueDiagnostics } from "./issue-diagnostics.js";
import { renderDiagnosticDisclosure, handleDiagnosticAction, isDiagnosticOpen, closeDiagnostic } from "./diagnostic-disclosure.js";
import { patchSectionContent } from "./dom-patch.js";
import { SWIPE_EASING_CSS } from './navigation-motion.js';
import { getGameResult, createResultTransitions, createRematchDialog } from './game-result.js';
import { renderResultMark, createResultPresentation } from './result-presentation.js';
import { createRouteHydration } from './route-hydration.js';
import { invitationLoadFailureKind, renderInviteLoadRecovery } from './invite-load-recovery.js';
import { createRenderGestureGate, preserveBoardFocus } from './render-gesture.js';
import { participantButton, participantName, participantDisplayName, createInlineProfiles } from './public-profile.js';
import { renderPlayersPanel } from './players-panel.js';
import { createAccountController, safeAccountIntent } from './account-controller.js';
import { createAccountDialog } from './account-dialog.js';
import { renderPieceSymbol } from '../piece-symbols.js';
import { invitationOptions, renderInvitationSurface, createHostInvitation, hostInvitationSettled } from './invitations.js';
import { createIntroductionPreferences, createOpponentSession } from './opponent-session.js';
import { renderWordmark, createBrandController, createBrandGrid, resolveActionAffiliation } from './brand.js';
import { icon, soundToggle, headerActionContent } from './ui.js';
import { createGameSound } from './sound.js';
import { createModal } from './modal.js';
import { createOpponentStoryDialog, OPPONENT_STORIES } from './opponent-stories.js';
import { recoveryMessage, needsRecoveryAction, sharedMutationActions, isBoardRecoveryPending } from "./recovery-view.js";
import { createForegroundRecoveryWait } from './foreground-recovery.js';
import { renderGameAlertCard } from "./game-alert.js";
import { createNotificationStack, recoveryActivity } from "./notification-state.js";
import { patchNotificationTree, patchNotificationHtml, replaceMainPreservingHeader } from "./notification-dom.js";
import { assertGameBoardAdapter } from "../board-adapter-contract.js";
import { createEngineBoardAdapter, createInitialBoardSnapshot, listBoardLegalActions } from "../board-adapters/engine-board-adapter.js";
import { createMiniBoardPreview, syncMiniBoardPreviews } from "../board/mini-board-preview.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createShellBoardHost } from "../board/hosts/shell-host.js";
import { getBootstrapPayload } from "./bootstrap.js";
import { createSyncStore } from "./sync-store.js";
import { ensureHoverCapabilityController } from "../hover-capability.js";
import { getCommandLegendSwatchStyle, updateLegendVisibility, updateInspectionLegend } from "../legend.js";
import { loadDebugFlyoutOpen, saveDebugFlyoutOpen, saveTutorialCompleted } from "./persistence.js";
import {
  buildHistoryBranchSeedFromGame,
  buildScenarioFromGame,
  canAuthorScenariosLocally,
  loadScenarioCatalog,
  resolveHistoryScenarioExportContext,
  tryLocalScenarioWrite,
} from "./scenarios.js";
import { renderHomeCardIdentity } from "./home-card-identity.js";
import { buildStaticGameCardFromScenario } from "./static-game-cards.js";
import { historyTurnSide, buildMovePreview, buildTurnPreview, buildDestroyedPieceOverlays, findRecordedActionStartPiece } from "./history-preview.js";
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

let slowLoadingContexts=[];
const loadingContextScope=()=>`${account.snapshot().generation}:${activeStorageGeneration}:${window.location.hash}`;
mountLoadingEdges(document);
void fetch("/deploy-meta.json", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then(response => response.json()).then(meta => { globalThis.__righeltClientBuild = meta.sha ?? meta.commitSha ?? "unavailable"; }).catch(() => {});
const appEl = document.getElementById("app");
mountRecoverySpace(appEl);
const utilityMemory = createUtilityMemory({ root: appEl, getScope: key => `${account.snapshot().generation}:${key === 'debug' ? getCurrentViewedGameId() ?? 'home' : 'scenarios'}` });
const dismissedRecoveryNotices = new Map();
// This node survives header/panel rendering, including repeated heartbeat snapshots.
const syncAnnouncement = document.createElement("div");
syncAnnouncement.id = "shell-sync-announcement";
syncAnnouncement.className = "sr-only";
syncAnnouncement.setAttribute("role", "status");
syncAnnouncement.setAttribute("aria-live", "polite");
syncAnnouncement.setAttribute("aria-atomic", "true");
document.body.appendChild(syncAnnouncement);
const quietComputerRenewal = game => Boolean(game?.id === getCurrentViewedGameId() && computerSession?.snapshot().activity?.quietRenewal);
const foregroundRecoveryWait = createForegroundRecoveryWait({ onChange: () => {
  updateMountedHeader();
  const game = currentRoute.name === 'game' ? transport.getGameViewModel(currentRoute.gameId) : null;
  updateRecoveryAnnouncement(game);
} });
const recoveryPresentationOptions = game => ({
  foregroundWaitMs: foregroundRecoveryWait.update({
    scope: `${viewingScope()}:${currentRoute.name === 'game' ? currentRoute.gameId : ''}:${game?.recoveryEpisodeId ?? ''}`,
    active: !document.hidden && currentRoute.name === 'game' && currentRoute.gameId === game?.id && !game?.inHistoryMode,
    blocked: Boolean(game?.sharedMutationsBlocked && (game.recovering || game.syncStatus === 'confirming' || game.confirmationOverdue)),
  }),
  computerSaveActive: game?.id === getCurrentViewedGameId() && computerSession?.snapshot().phase === 'saving',
  quietComputerRenewal: quietComputerRenewal(game),
});
const presentedRecoveryMessage = game => recoveryMessage(game, Date.now(), recoveryPresentationOptions(game));
document.addEventListener('visibilitychange', () => {
  foregroundRecoveryWait.reset();
  updateMountedHeader();
  updateRecoveryAnnouncement(currentRoute.name === 'game' ? transport.getGameViewModel(currentRoute.gameId) : null);
});
window.addEventListener('pagehide', () => foregroundRecoveryWait.reset());
const updateRecoveryAnnouncement = (game) => {
  const failures = game ? [...new Set((transport.getFailedOperations?.(game.id) ?? []).map((operation) => operation.error?.message).filter(Boolean))] : [];
  const text = game ? [presentedRecoveryMessage(game), game.historyNotice, ...failures].filter(Boolean).join(" ") : "";
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
let storageResetPending = false;
let storageResetNotice = false;
let accountContinuation = null;
let accountContinuationError = false;
let accountContinuationIncidentId = null;
const hydrateRoute = createRouteHydration();
const account = createAccountController({ storage,
  onTransition: (next, source) => { if (accountInitialized) { accountDialog.onTransition(source); resetAccountTransport(next); } },
  onChange: () => { document.documentElement.dataset.viewPreference = account.snapshot().session.account?.preferences?.view || "focused"; if (account.snapshot().ready) accountStartupError = ""; if (accountInitialized) { accountDialog.refreshSession(); render({ animatePanels: false, includeBoard: false }); if(storageResetPending && account.snapshot().ready){storageResetPending=false;queueMicrotask(()=>{navigateTo("#/");startRouteSync();});} } },
});
const accountDialog = createAccountDialog({ controller: account, onSound:kind=>gameSound.play(kind), onTutorial: () => { tutorial.reset(); navigateTo(buildTutorialHash()); }, getSiteKey: () => account.snapshot().siteKey,
  onComplete: intent => { void completeAccountContinuation(intent); },
  onLayoutChange: () => render({animatePanels:false,includeBoard:false}),
});
const gameSound = createGameSound({ storage, getIdentityId:()=>transport.getIdentityId() });
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
let tutorialSavingError = null;
let tutorialSaveOwner = null;
let tutorialVisit = 0;
const retireTutorialSave = () => { tutorialVisit++; tutorialSaveOwner = null; tutorialSavingError = null; };
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
const resultPresentation = createResultPresentation();
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
const notificationStack = createNotificationStack();
const seenUndoRequestOutcomeByGameId = new Map();
let routeHydrated = false;
let resolvedInvite = null;
let inviteLoadState = null;
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
let desktopBoardFit = null;
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
  const disabledAttr = disabled || isButtonPending(pendingKey) ? " disabled" : "";
  return `${classAttr}${pendingAttr}${disabledAttr}${pendingKey ? ` data-loading-key="${escapeHtml(pendingKey)}"` : ""}`;
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
  const disabledAttr = disabled || pending ? " disabled" : "";
  return `${classAttr}${pendingAttr}${disabledAttr} data-loading-state="${pending ? "pending" : "idle"}"`;
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
  if (isPlayerRole(role) && (game?.player1?.computerProfile || game?.player2?.computerProfile)) {
    if (game.player1?.computerProfile && game.player2?.computerProfile) return '<strong>watching computers</strong>';
    const humanSeat = game.player1?.computerProfile ? 'Player 2' : 'Player 1';
    return `<strong class="${playerToneClassForSeat(humanSeat)}">${humanSeat}</strong>`;
  }
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
    return "Red to play";
  }
  if (snapshot?.sideToMove === "P2") {
    return "Blue to play";
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
    saveButtonEl.disabled = !scenarioCapture || !canSubmitSaveScenarioDraft() || isButtonPending(SCENARIO_SAVE_PENDING_KEY);
  }
};
let scenarioCapture = null;
let scenarioEditingId = null;
const scenarioMetadataDrafts = new Map();
const capturePosition = () => scenarioCapturePosition(scenarioCapture, scenarioCapture ? transport.getAuthoritativeGame(scenarioCapture.gameId) : null);
const getScenarioExportContext = (game) => {
  if (scenarioCapture?.gameId === game?.id) {
    const currentSnapshot = capturePosition();
    const displayedCapture = currentRoute.scenarios && toStableKey(boardRuntime?.getState?.()) === toStableKey(currentSnapshot);
    if (displayedCapture) scenarioCapture.selection = buildSavedSelectionFromRuntimeSelection(boardRuntime?.getSelection?.() ?? null, currentSnapshot);
    return { currentSnapshot, moveLimit: 0, savedSelection: scenarioCapture.selection };
  }
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
// Undo records retain the old action for provenance, not an ordinary move
// preview. Forced continuations still restore only currently legal selections;
// independent branch/scenario seeds have no restoration or no initial action.
const getSelectionHydrationGame = game => game.lastRestoration && game.initialSelectionAction && !game.board?.state?.continuation
  ? { ...game, pendingScenarioSelection: null, initialSelectionAction: null } : game;
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
  const reserved = (getWideFlyoutWidth(viewportWidth) * openFlyoutCount) + getFlyoutContentGapPx();
  if (openFlyoutCount <= 0 || viewportWidth - reserved - SHELL_VIEWPORT_GUTTER_PX < SHELL_WIDE_SCREEN_MIN_WIDTH) return 0;
  return reserved;
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
const preparePanelTransition = (previous, next) => {
  if (previous.name === 'game' && (next.gameId !== previous.gameId || getGamePanel(previous) !== getGamePanel(next))) {
    viewingIntent.saveScroll(previous.gameId, getGamePanel(previous), window.scrollY);
  }
  if (next.name !== 'game') { if(previous.gameId)viewingIntent.cancelUndo(previous.gameId); replayController?.stop('navigation'); return; }
  const changedPanel = next.gameId !== previous.gameId || getGamePanel(previous) !== getGamePanel(next);
  if (changedPanel) { replayRequests.cancel(); replayController?.stop("navigation"); }
  if (getShellLayoutModeForRoute(next) === 'narrow' && changedPanel) {
    if (getGamePanel(next) === 'board') {
      const selected = transport.getGameViewModel(next.gameId)?.inHistoryMode;
      if (selected) transport.returnToLive({gameId:next.gameId});
    }
    window.requestAnimationFrame(() => mobileNavigation?.restoreScroll(viewingIntent.scrollTop(next.gameId, getGamePanel(next))));
  }
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
  const remaining = viewportWidth - (getWideFlyoutWidth(viewportWidth) * openFlyoutCount) - totalHorizontalGutter;
  // A utility should not force a previously usable page into a cramped layout.
  return remaining >= SHELL_WIDE_SCREEN_MIN_WIDTH ? remaining : Math.max(0, viewportWidth - totalHorizontalGutter);
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
      allowStacking: false,
      preferredKey: preferredFlyoutKey,
    }),
  };
};
currentRoute = normalizeRouteFlyoutState(currentRoute);
syncFlyoutRenderOrder(currentRoute);
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
        <button class="secondary shell-header-menu-item" type="button" data-action="account-open" data-testid="account-open" data-authenticated="${account.snapshot().session.authenticated}" data-header-menu-close="true" tabindex="${headerMenuOpen ? "0" : "-1"}" ${!account.snapshot().ready || !account.snapshot().enabled || !account.snapshot().available ? 'disabled' : ''}>${icon('account')}Account</button>
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
  const gameAlerts = renderGameAlertsHtml(viewedGame);
  const startupStatus = accountStartupError
    ? `<p role="alert">${escapeHtml(accountStartupError)}</p><button class="secondary" data-action="retry-account-startup">Try again</button>`
    : !account.snapshot().ready
      ? `<p class="loading-region" ${loadingAttributes("account-startup", "Connecting is taking a little longer than usual.")}><span class="sr-only" role="status">Connecting</span></p>`
      : "";
  return `
    <div class="shell-header-status" data-shell-alert-zone="${gameAlerts || startupStatus ? "active" : "idle"}">
      <div id="shell-game-alerts">${gameAlerts}</div>
      ${startupStatus}
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
    appEl.dataset.flyoutOverlay = String(window.innerWidth - getWideFlyoutWidth() * getOpenFlyoutCount() - SHELL_VIEWPORT_GUTTER_PX * 2 < SHELL_WIDE_SCREEN_MIN_WIDTH);
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

const getGameAlertItems = (game) => {
  const failedOperations = transport.getFailedOperations?.(game.id) ?? [];
  maybeUpdateUndoRequestOutcomeFeedback(game);

  const items = failedOperations.map((operation) => ({
    key: `failed:${operation.id}`, priority: "urgent",
    html: renderGameAlertCard({
      tone: "danger",
      body: escapeHtml(operation.error?.message || "The operation could not be completed."),
      action: `<button class="secondary mini-button" data-action="dismiss-failed-operation" data-operation-id="${escapeHtml(operation.id)}">${icon('close')}Dismiss</button>`,
      testId: "sync-failure-banner", incidentId: (issueDiagnostics.list().find(r => r.key === `operation:${operation.id}`)?.id ?? issueDiagnostics.capture(`operation:${operation.id}`, { operation: operation.kind ?? "game_operation", code: operation.error?.code, gameId: game.id, stage: "operation_failed" })),
    }),
  }));

  const message = presentedRecoveryMessage(game);
  const recoveryNeedsAction = needsRecoveryAction(game, Date.now(), recoveryPresentationOptions(game));
  for (const report of issueDiagnostics.list().filter(r => r.initial.gameId === game.id && r.key.startsWith("operation:"))) if (!failedOperations.some(op => `operation:${op.id}` === report.key)) issueDiagnostics.resolve(report.key);
  const retained = issueDiagnostics.list().filter(r => r.initial.gameId === game.id && r.resolvedAt && isDiagnosticOpen(r.id));
  for (const report of retained) items.push({ key: `resolved:${report.id}`, html: renderGameAlertCard({ body: "Resolved", incidentId: report.id, action: `<button class="secondary mini-button" data-action="dismiss-diagnostic" data-incident-id="${report.id}">${icon('close')}Dismiss</button>` }) });
  if (!message) dismissedRecoveryNotices.delete(game.id);
  const dismissed = dismissedRecoveryNotices.get(game.id) === message;
  if (message && (!dismissed || game.storageBlocked)) {
    items.unshift({
      key: `live-sync:${game.id}:${game.recoveryEpisodeId ?? "current"}`, priority: recoveryNeedsAction ? "urgent" : "normal",
      html: renderGameAlertCard({ tone: recoveryNeedsAction ? "warn" : "neutral", activity: recoveryActivity(game), actorSide: activityActorSide(game), body: dismissed ? "Saving is paused." : escapeHtml(message), testId: "sync-recovery-banner", incidentId: recoveryNeedsAction ? game.incidentId : null,
        action: !recoveryNeedsAction ? "" : game.storageBlocked
          ? `<button class="secondary mini-button" data-action="retry-saving" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Retry saving</button>${dismissed ? "" : `<button class="secondary mini-button" data-action="dismiss-recovery-notice" data-game-id="${escapeHtml(game.id)}">${icon('close')}Dismiss</button>`}`
          : game.upgradeRequired ? `<button class="secondary mini-button" data-action="refresh-game">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a>`
          : ["session_changed", "invalid_credentials"].includes(game.recoveryIssue) ? `<button class="secondary mini-button" data-action="account-open">${icon('account')}Sign in</button>`
          : `<button class="secondary mini-button" data-action="reconnect-safely" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a>`,
      }),
    });
  }
  if (game.historyNotice) items.push({ key: `history-change:${game.id}`, html: renderGameAlertCard({ body: escapeHtml(game.historyNotice) }) });

  const computerNotice=renderComputerProgress(game,computerSession?.snapshot());
  if(computerNotice) items.push({key:`computer:${game.id}`,priority:computerSession?.snapshot().phase==='recovery'?'urgent':'normal',html:computerNotice});
  const approval = getActiveRevertRequest(game), waiting = getActivePendingRevertRequest(game);
  const request = approval ?? waiting;
  if (request) {
    const move = game.moves?.find(entry => entry.moveId === request.targetMoveId);
    const attrs = `data-game-id="${escapeHtml(game.id)}" data-request-id="${escapeHtml(request.requestId)}"`;
    items.push({key:`undo-request:${request.requestId}`, html:renderGameAlertCard({activity:'waiting', actorSide:undoApprovalActorSide(game,request), testId:approval?'undo-approval-notice':'undo-waiting-notice',
      body:approval ? `Undo requested before ${escapeHtml(move?.notation ?? 'this move')}` : 'Waiting for undo approval',
      action:approval ? `<button data-action="accept-revert-request" ${attrs}>${icon('check')}Accept</button><button class="secondary" data-action="reject-revert-request" ${attrs}>${icon('close')}Reject</button>` : `<button class="secondary" data-action="rescind-revert-request" ${attrs}>${icon('close')}Cancel request</button>`})});
  }

  if (undoRequestFeedback && undoRequestFeedbackGameId === game.id) {
    items.push({
      key: `undo:${game.id}`,
      html: renderGameAlertCard({
        body: escapeHtml(undoRequestFeedback),
      }),
    });
  }

  return items;
};

const focusCurrentAlertStackCard = (gameId) => {
  if (!gameId) {
    return;
  }
  const focusedCard = appEl?.querySelector?.(
    `[data-action="cycle-game-alert-stack"][data-game-id="${CSS.escape(gameId)}"][tabindex="0"]`,
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
  const scope=game?.id ?? `loading:${loadingContextScope()}`;
  if(gameId!==scope)return;
  const items = getHeaderAlertItems(game);
  if (!notificationStack.advance(scope, items)) {
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
      data-key="${escapeHtml(item.key)}"
      data-notification-id="${escapeHtml(item.key)}"
      data-stack-index="${stackIndex}"
      data-stack-count="${totalAlerts}"
      ${interactive
        ? `data-action="cycle-game-alert-stack" data-game-id="${escapeHtml(gameId)}" tabindex="0"`
        : isActive
          ? 'tabindex="-1"'
          : 'aria-hidden="true" tabindex="-1" inert'}
      aria-label="${escapeHtml(ariaLabel)}"
    >
      ${item.html}
    </div>`;
};

const renderHistoryPreview = (game, preview, key) => getShellLayoutMode() === "narrow"
  ? `<div class="history-inline-preview" data-testid="history-inline-preview">${preview.snapshot ? renderMiniBoardPreviewRoot({previewId:key,...preview,previewKey:toStableKey(preview)}) : '<p role="status">Preview unavailable</p>'}</div>` : "";

const renderTurnHistory = (game) => {
  const moves = [...(game.moves ?? []), ...(game.pendingMoves ?? [])];
  if (!game.inHistoryMode && !moves.length && !game.turns?.length) return '<li class="small">No turns yet.</li>';
  if (game.historyTurnIndex != null || game.historyContextMoves) {
    for (const frozen of game.historyTurnMoves ?? game.historyContextMoves ?? []) if (!moves.some(move=>move.moveId===frozen.moveId)) moves.push(frozen);
  }
  const turns = new Map((game.turns ?? []).map(turn => [turn.index,{...turn,moves:[]}]));
  for (const move of moves) {
    if (!turns.has(move.turnIndex)) turns.set(move.turnIndex,{index:move.turnIndex,moves:[]});
    turns.get(move.turnIndex).moves.push(move);
  }
  const row = move => {
    const selected = game.inHistoryMode && (game.inspectedDecision?.moveId ? game.inspectedDecision.moveId === move.moveId : game.historyIndex === move.index);
    const pending = (game.pendingMoves ?? []).includes(move);
    const liveSelected = !game.inHistoryMode && move === moves.at(-1) && !game.currentSnapshot?.continuation && game.currentTurn?.moveIndexes?.length;
    const actor = historyActorLabel(game,move,{identityId:transport.getIdentityId()});
    const revertButton = selected && !move.undone && game.myRoles?.some(role=>role==='Player 1'||role==='Player 2')
      ? `<button class="secondary mini-button history-branch-button" data-action="revert-to-move" data-game-id="${escapeHtml(game.id)}" data-move-id="${escapeHtml(move.moveId || '')}">${icon('back')}Undo before this move</button>` : '';
    const branchButton = selected && !move.undone
      ? `<button class="secondary mini-button history-branch-button" data-action="launch-history-branch" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}">${icon('play')}New game before this move</button>` : '';
    const actions = revertButton || branchButton ? `<div class="history-item-actions">${revertButton}${branchButton}</div>` : '';
    const destroyedPieces = Array.isArray(move.destroyedPieces) ? move.destroyedPieces : [];
    const destroyed = destroyedPieces.map((record)=>`<li class="history-destruction-item ${playerToneClassForSide(record.ownerSeat === "p1" ? "P1" : record.ownerSeat === "p2" ? "P2" : "neutral")}" data-testid="history-destruction-item"><span class="history-destruction-label">DESTROYED (${record.position.row},${record.position.col})</span></li>`).join('');
    return `<li class="history-item ${playerToneClassForSide(move.actorSide)}${selected?' is-selected':liveSelected?' is-live-selected':''}${move.undone?' is-undone':''}${pending?' history-item-pending':''}${actions?' history-item-has-actions':''}" ${selected?'':`data-action="jump-history" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}" tabindex="0" role="button"`} data-key="${escapeHtml(move.moveId || move.clientCommandId || String(move.index))}" data-move-id="${escapeHtml(move.moveId || '')}" ${pending?'data-testid="history-pending-move-item"':'data-testid="history-move-item"'} aria-label="${escapeHtml(actor)} · Move ${move.displayMoveNumber ?? move.index+1}: ${escapeHtml(move.notation)}" ${selected?'aria-current="true"':''} ${pending?'aria-busy="true"':''}>
      <div class="history-item-info"><span class="history-move-line">Move ${move.displayMoveNumber ?? move.index+1}: ${escapeHtml(move.notation)}${pending?' · Pending':''}</span>${destroyedPieces.length > 0 ? `<ul class="history-destruction-list">${destroyed}</ul>` : ""}<span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span></div>
      ${selected ? renderHistoryPreview(game,buildMovePreview(game.inspectedDecision ?? move),`history:${game.id}:${move.moveId}`) : ''}${actions}</li>`;
  };
  const groups = [...turns.values()].sort((a,b)=>b.index-a.index).map(turn=>{
    const ordered = turn.moves.sort((a,b)=>(a.turnMoveIndex ?? a.index)-(b.turnMoveIndex ?? b.index));
    const selected = game.inHistoryMode && game.historyTurnIndex === turn.index;
    const first = ordered.find(move=>!move.undone) ?? ordered[0];
    const side = historyTurnSide(turn,ordered);
    const turnActor = ordered.find(move=>move.actorSide===side) ?? first;
    const name = COMPUTER_PROFILES[turnActor?.computerProof?.profile]?.name ?? playerDisplayName(game,turn.playerSeat ?? side);
    const active = ordered.some(move=>!move.undone && !(game.pendingMoves??[]).includes(move));
    const undone = ordered.filter(move=>move.undone);
    const key = `${game.id}:turn:${turn.index}`;
    const expanded = expandedUndoneGroups.has(key);
    return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="history-turn:${escapeHtml(game.id)}:${turn.index}" data-testid="history-turn"><div class="history-turn-heading${selected?' is-selected':''}" data-key="turn:${escapeHtml(game.id)}:${turn.index}" ${selected||!active?'':`data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${turn.index}" tabindex="0" role="button"`} ${selected?'aria-current="true"':''}>Turn ${turn.index+1} · <span dir="auto">${escapeHtml(name)}</span></div>
      ${selected?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves),`turn:${game.id}:${turn.index}`):''}
      <ol class="history-list history-list-nested">${ordered.filter(move=>!move.undone).map(row).join('')}${undone.length?`<li class="history-item history-item-undone-group is-undone${expanded?' is-expanded':''}" data-action="toggle-undone-group" data-group-key="${escapeHtml(key)}" aria-expanded="${expanded}">${undone.length} move${undone.length===1?'':'s'} undone</li>${expanded?undone.map(row).join(''):''}`:''}</ol></li>`;
  }).join('');
  const live = game.inHistoryMode ? `<li class="history-empty-line history-return-live"><button class="secondary" data-action="return-live" data-game-id="${escapeHtml(game.id)}" data-testid="history-return-live">${icon('board')}Return to live view</button></li>` : '';
  const state = game.currentSnapshot ?? game.board?.state;
  const current = !game.inHistoryMode && game.currentTurn;
  const waiting = current && (state?.continuation || !current.moveIndexes?.length) ? `<li class="history-item history-item-waiting ${playerToneClassForSeat(game.controlSeat ?? current.playerSeat)} is-live-selected" aria-disabled="true"><span class="history-move-line">${escapeHtml(liveHistoryLabel(game,state,{identityId:transport.getIdentityId()}))}</span></li>` : '';
  return live + waiting + groups;
};

const renderHeader = () => `
  <header class="shell-header">
    <div class="shell-header-main">
      <h1><a class="shell-header-title-link" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">${renderWordmark(brand.getState())}</a></h1>
    </div>
    ${renderHeaderAlertZone()}
    ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
    ${account.snapshot().pendingLogout ? '<span role="status">Sign-out pending</span>' : ''}
    ${accountContinuationError ? `<div role="alert" data-testid="account-continuation-error"><p>We couldn’t finish loading. Please try again.</p><button class="secondary" data-action="retry-account-continuation">Try again</button>${renderDiagnosticDisclosure(accountContinuationIncidentId)}</div>` : issueDiagnostics.list().filter(report => report.key === "account-continuation" && isDiagnosticOpen(report.id)).map(report => renderDiagnosticDisclosure(report.id)).join("")}
    <div class="shell-header-actions">
      <div class="nav-row${isNarrowHeaderMode() ? " nav-row-single" : ""}">
        ${soundToggle(gameSound.enabled())}
        ${!isNarrowHeaderMode() ? `<button class="secondary header-icon-action" type="button" data-action="account-open" data-testid="account-open" data-authenticated="${account.snapshot().session.authenticated}" aria-label="Account" title="Account" ${!account.snapshot().ready || !account.snapshot().enabled || !account.snapshot().available ? 'disabled' : ''}>${headerActionContent('account','Account')}</button>` : ""}
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
  const canLoadIntoCurrentGame = canLoadScenarioInPlace(game, transport.getIdentityId());
  const capturing = scenarioCapture?.gameId === game?.id;
  const editing = scenarioEditingId === selectedScenario?.id;
  const saveDraft = getSaveScenarioDraft();
  const canSaveScenario = canAuthorScenarios && capturing && Boolean(saveDraft.title && saveDraft.description);
  const selectedScenarioTitle = scenarioMetadataDrafts.get(selectedScenario?.id)?.title ?? selectedScenario?.title ?? "";
  const selectedScenarioDescription = scenarioMetadataDrafts.get(selectedScenario?.id)?.description ?? selectedScenario?.description ?? "Scenarios replay canonical shell history into a game.";
  const canUpdateScenario = canAuthorScenarios && Boolean(selectedScenario);
  if (scenarioLoadPending) {
    return `
      <section class="panel debug-panel scenario-panel scenario-panel-load loading-region" ${loadingAttributes("scenarios", "The scenarios are taking a little longer to load.")} data-testid="scenario-load-skeleton">
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
                data-persist data-decision-id="${escapeHtml(selectedScenario?.id)}" ${canAuthorScenarios && editing ? 'contenteditable="plaintext-only" role="textbox" aria-label="Scenario title"' : ""}
                ${canAuthorScenarios && editing ? "" : 'tabindex="0"'}
              >${escapeHtml(selectedScenarioTitle)}</div>
              <p
                class="small"
                data-scenario-editable="description"
                data-persist data-decision-id="${escapeHtml(selectedScenario?.id)}" ${canAuthorScenarios && editing ? 'contenteditable="plaintext-only" role="textbox" aria-label="Scenario description"' : ""}
                ${canAuthorScenarios && editing ? "" : 'tabindex="0"'}
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
          canUpdateScenario && capturing
            ? `<button data-action="update-scenario"${renderButtonStateAttributes({
                className: "secondary",
                pendingKey: SCENARIO_UPDATE_PENDING_KEY,
                disabled: !selectedScenarioTitle.trim() || !selectedScenarioDescription.trim(),
              })}>Replace position with capture</button>`
            : ""
        }
      </div>
      ${canUpdateScenario ? `<button class="secondary" data-action="${editing ? 'save-scenario-details' : 'edit-scenario-details'}">${editing ? 'Save details' : 'Edit details'}</button>` : ''}
      <pre class="debug-pre" aria-live="polite">${escapeHtml(selectedScenarioFeedback || formatScenarioInfo(selectedScenario))}</pre>
    </section>
    ${
      canAuthorScenarios
        ? `<section class="panel debug-panel scenario-panel scenario-panel-create">
            <h2>Capture a position</h2>
            <p>${!capturing && game?.historyLoading ? 'Loading the selected position before capture.' : capturing ? scenarioCapture.mode === 'live' ? 'Following this manual game until you save. History inspection does not change the capture.' : 'Position frozen when capture began. Live play may continue separately.' : 'Start a capture to choose a piece and target, then save explicitly.'}</p>
            <button class="secondary" data-action="${capturing ? 'end-scenario-capture' : 'begin-scenario-capture'}"${!capturing && game?.historyLoading ? ' disabled aria-disabled="true"' : ''}>${capturing ? 'End capture' : 'Capture this position'}</button>
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
              })}>Save capture as new scenario</button>
            </div>
            <pre class="debug-pre" aria-live="polite">${escapeHtml(saveScenarioFeedback || "No new scenario saved yet.")}</pre>
          </section>`
        : ""
    }
  `;
};

let inspectedLegal = { key: null, actions: [] };
const renderDebugContent = () => {
  const gameId = getCurrentViewedGameId();
  const game = gameId ? transport.getGameViewModel(gameId) : null;
  const issuesHtml = `<section class="panel debug-panel"><h2>Recent issues</h2>
    <button class="secondary" data-action="clear-diagnostics">Clear diagnostics</button>
    ${issueDiagnostics.list().map(report => `<article class="recent-issue"><p class="small">${escapeHtml(new Date(report.startedAt).toISOString())} · ${escapeHtml(report.initial.operation ?? "Issue")} · ${report.resolvedAt ? "Resolved" : "Open"}</p>${renderDiagnosticDisclosure(report.id, "recent")}</article>`).join("")}</section>`;
  const status = computerSession?.snapshot() ?? {};
  const state = getDecisionDebugState(gameId);
  const position = game?.currentSnapshot;
  if (position && state.open.has('position')) {
    const key = toStableKey(position);
    if (inspectedLegal.key !== key) inspectedLegal = { key, actions: listBoardLegalActions(position) };
  }
  return renderDecisionDebug({ game, selection: boardRuntime?.getSelection?.() ?? null,
    legalActions: state.open.has('position') ? inspectedLegal.actions : null, status,
    diagnostics: { connection: wsStatus, lastEvent: wsLastEvent, sync: transport.getSyncMetrics(), pendingCommands: game?.pendingCommandCount, revision: game?.gameplayRevision, computer: game?.computer, runtime: { ...status, analysis: undefined } },
    state: getDecisionDebugState(gameId), signedIn: account.snapshot().session.authenticated }) + issuesHtml;
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

const renderInviteFeedback = (scope = "invite-panel") => {
  const reports = issueDiagnostics.list().filter(report => report.key === `invite:${currentRoute.gameId}` && (!report.resolvedAt || isDiagnosticOpen(report.id)));
  return `<div class="invite-feedback" role="status" aria-live="polite" data-success="${inviteFeedback === 'Link copied! Ready to share.'}">${inviteFeedback ? `${icon(inviteFeedback === 'Link copied! Ready to share.' ? 'check' : 'copy')}<span>${escapeHtml(inviteFeedback)}</span>` : ""}${reports.map(report => renderDiagnosticDisclosure(report.id, scope)).join("")}</div>`;
};
const setInviteFeedback = (message) => {
  inviteFeedback = message;
  render({ animatePanels: false, includeBoard: false });
  if (inviteFeedbackTimer) {
    clearTimeout(inviteFeedbackTimer);
    inviteFeedbackTimer = null;
  }
  if (message && !issueDiagnostics.list().some(r => r.key === `invite:${currentRoute.gameId}` && !r.resolvedAt)) {
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
  if (!/accepted/i.test(latestNote)) viewingIntent.cancelUndo(game.id);
  const undoMessage = /accepted/i.test(latestNote) ? "Undo request accepted" : /rejected/i.test(latestNote) ? "Undo request declined. Play can continue." : "Undo request cancelled. Play can continue.";
  setUndoRequestFeedback(game.id, undoMessage);
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
        ${renderHomeCardIdentity(game, {identityId: transport.getIdentityId()})}
        <span class="small">${escapeHtml(moveLabel)}</span>
      </div>`,
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

const renderStartChoices = () => `<section class="panel home-start"><p class="home-section-kicker">Take your seat</p><h2 class="home-start-title">Start something new</h2><p class="home-start-description">A familiar rival, or a new challenge? You decide.</p><div class="opponent-picker">${Object.entries(OPPONENT_STORIES).map(([id,story])=>`<button class="opponent-choice" data-action="opponent-story" data-opponent="${id}"><img src="/assets/opponents/${id}-portrait.webp" alt="" width="174" height="116"><strong>${story.name}</strong><span class="opponent-choice-arrow">${icon('right')}</span><span class="small">${story.difficulty}</span></button>`).join('')}<button class="opponent-choice" data-action="create-game" data-testid="home-create-game"><img src="/assets/opponents/friend-portrait.webp" alt="" width="174" height="116"><strong>Friend</strong><span class="opponent-choice-arrow">${icon('right')}</span><span class="small">Share a game</span></button></div><div class="home-start-footer"><span class="small">Choose your opponent</span><button class="secondary" data-action="create-self-play">${icon('play')}Play both sides</button></div></section>`;
const renderHome = () => `<section class="stack home-refresh">${storageResetNotice ? '<p class="small" role="status">The saved data was reset. You can start a new game.</p>' : ""}${renderHomeGameSection('my')}${renderStartChoices()}${getVisibleHomeSectionKeys().filter(key=>key!=='my').map(renderHomeGameSection).join('')}</section>`;

const getHeaderAlertItems = game => {
  const scope=loadingContextScope();
  const slow=accountStartupError?[]:slowLoadingContexts.filter(context=>context.scope===scope).map(context=>({
    key:context.key,
    html:renderGameAlertCard({tone:'neutral',activity:'processing',body:`<span role="status">${escapeHtml(context.message)}</span>`,testId:'slow-loading-notice'}),
  }));
  return [...(game?getGameAlertItems(game):[]),...slow];
};

const renderGameAlertsHtml = (game, inviteFromRole = null) => {
  isBuildingGameAlerts = true;
  try {
    const items = getHeaderAlertItems(game);
    const scope=game?.id ?? `loading:${loadingContextScope()}`;
    const orderedItems = notificationStack.order(scope, items);
    if (orderedItems.length === 0) return "";
    return orderedItems
      .map((item, stackIndex) =>
        renderGameAlertStackCard({
          gameId: scope,
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
  <article class="mini-board-card mini-board-card-skeleton" data-testid="home-card-skeleton" aria-hidden="true">
    <div class="mini-board-card-link-surface">
      <div class="mini-board-card-header"><div><span class="skeleton-pulse skeleton-line-title">&nbsp;</span><p class="small mini-board-card-subtitle skeleton-pulse">&nbsp;</p></div></div>
      <div class="mini-board-card-copy"><div class="mini-board-card-meta mini-board-card-meta-primary skeleton-pulse">&nbsp;</div></div>
      <div class="mini-board-preview-surface"><div class="board-wrap mini-board-preview-wrap"><div class="board mini-board-preview-board">${Array.from({length:100},()=>'<div class="cell skeleton-pulse"></div>').join('')}</div></div></div>
      <p class="small mini-board-preview-status skeleton-pulse">&nbsp;</p>
    </div>
  </article>
`;

const renderHomeSectionSkeleton = (title, { showStartButton = false, sectionKey = "my" } = {}) => `
  <section class="panel home-games-section loading-region" ${loadingAttributes(`home:${sectionKey}`, "Your games are taking a little longer to load.")} data-home-section-root="${escapeHtml(sectionKey)}" data-testid="home-section-skeleton">
    <div class="home-games-section-header" data-home-header-has-action="${showStartButton ? "true" : "false"}" data-home-header-paging="false">
      <div class="home-games-section-heading">
        <h2>${escapeHtml(title)}</h2>
        <p class="small">Games</p>
      </div>
      <div class="home-games-section-header-center"></div>
      <div class="home-games-section-header-actions">
        ${showStartButton ? renderHomeStartButton() : ""}
      </div>
    </div>
    <div class="home-games-carousel">
      <div class="mini-board-card-list mini-board-card-list-skeleton">
        ${Array.from({ length: Math.min(3, getHomeSectionColumnCount(sectionKey)) }, () => renderHomeCardSkeleton()).join("")}
      </div>
    </div>
  </section>
`;

const renderBoardLoadingPreview = gameId => `<div class="board-loading-preview" aria-busy="true">${renderBoardHeadingSlot({loading:true})}${renderBoardMessageSlot({loading:true,loadingKey:`game:${gameId}`})}<div class="board-wrap"><div class="loading-board-silhouette board" aria-hidden="true">${Array.from({length:100},()=>'<div class="cell"></div>').join('')}</div></div><div class="overlay-key" aria-hidden="true"><span class="legend-inspection">Commander</span><span class="legend-inspection">Supply point</span></div></div>`;
const renderGameViewSkeleton = () => `<div data-testid="game-view-skeleton">${renderGameShellFrame({id:currentRoute.gameId || 'loading',currentSnapshot:null},{loading:true})}</div>`;

const renderInvitePageSkeleton = () => `
  <section class="invite-gate" data-testid="invite-view-skeleton">
    <section class="panel invite-gate-modal skeleton-panel loading-region" ${loadingAttributes("invite", "Your invitation is taking a little longer to load.")}>
      ${renderInvitationLoading({actions:currentRoute.inviteAs==='viewer'?2:3})}
    </section>
    <div class="invite-gate-content" aria-hidden="true" inert>
      ${renderGameViewSkeleton()}
    </div>
  </section>
`;

const renderGameSummaryPanel = (game) => {
  const rawNote = game.notifications[0] || "Ready";
  const latestNote = ({ "Player request approved": "Join request approved", "Play as both players enabled": "You’re now playing both sides", "Undo applied": "Move undone" })[rawNote] ?? (/accepted the undo request$/.test(rawNote) ? "Undo request accepted" : /rejected the undo request$/.test(rawNote) ? "Undo request declined. Play can continue." : /rescinded the undo request$/.test(rawNote) ? "Undo request cancelled. Play can continue." : rawNote);
  return renderSummarySlots({title:`Game <span class="mono">${escapeHtml(formatDisplayGameId(game.id))}</span>`,
      started:`Started ${escapeHtml(formatClientDateTime(game.createdAt))}`,
      role:`Role: ${renderRoleLabel(game.myRole, game)}`,
      turn:`Active turn: ${
          game.currentTurn
            ? `${escapeHtml(String(game.currentTurn.index + 1))} · ${renderSeatLabel(game.currentTurn.playerSeat)} · ${escapeHtml(
                String(game.currentTurn.moveIndexes.length),
              )} move(s)`
            : "n/a"
        }`,latest:`Latest: ${colorizePlayerReferences(latestNote)}`});
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
              ${participantButton(request)} requests <span class="${playerToneClassForSeat(request.requestedSeat)}">${sideColorName(request.requestedSeat)}</span>
              <button data-action="approve-request" data-game-id="${escapeHtml(game.id)}" data-requester-id="${escapeHtml(
                request.identityId,
              )}" data-testid="approve-request-inline"${renderButtonStateAttributes({
                className: "secondary",
                pendingKey: approveRequestButtonKey,
                disabled: !Array.isArray(game.approvableRequesterIds) || !game.approvableRequesterIds.includes(request.identityId),
              })}>${icon("check")}Approve</button>
            </li>`;
            },
          )
          .join("");
  const joinInviteActions = renderSectionActions([
    game.canJoinAsViewer
      ? `<button data-action="join-viewer" data-game-id="${escapeHtml(game.id)}" data-testid="join-viewer"${renderButtonStateAttributes({
          className: "secondary",
          pendingKey: joinViewerButtonKey,
        })}>${icon("players")}Join as viewer</button>`
      : "",
    game.canJoinAsPlayer && game.showJoinActions
      ? `<button data-action="join-player" data-game-id="${escapeHtml(game.id)}" data-testid="join-player"${renderButtonStateAttributes({
          pendingKey: joinPlayerButtonKey,
        })}>${icon("play")}Join as player</button>`
      : "",
    ...invitationOptions(game).map(option => `<button data-action="copy-invite" data-game-id="${escapeHtml(game.id)}" data-invite-role="${option.role}" ${option.role==='viewer'?'data-testid="copy-viewer-invite"':'data-testid="copy-invite"'}${renderButtonStateAttributes({className:`invite-action invite-${option.role}${option.role==='viewer'?' secondary':''}`,pendingKey:copyInviteButtonKey,disabled:!game.canInvite})}>${icon('invite')}${option.label}</button>`),
    game.canPlayAsBothPlayers
      ? `<button data-action="play-as-both-players" data-game-id="${escapeHtml(game.id)}"${renderButtonStateAttributes({
          className: "secondary",
          pendingKey: playAsBothButtonKey,
        })}>${icon("players")}Play both sides</button>`
      : "",
  ]);

  return `
    <h2 data-testid="join-invite-heading">Players</h2>
    ${renderParticipantsPanel(game)}
    ${pendingSeatNotice}
    ${joinInviteActions}
    ${joinFeedback.message(game.id)?`<p class="alert error" role="status" data-testid="join-failure">${escapeHtml(joinFeedback.message(game.id))}</p>`:""}
    ${renderInviteFeedback()}
    ${inviteFallback?.gameId === game.id ? `<input class="invite-link-field" aria-label="Invitation link" value="${escapeHtml(inviteFallback.link)}" readonly>` : ""}
    ${pendingRows ? `<div class="section-followup"><ul class="participant-list">${pendingRows}</ul></div>` : ""}
  `;
};

const expandedViewerGames = new Set();
const expandedComputerCards = new Map();
const renderParticipantsPanel = game => renderPlayersPanel(game, {
  identityId:transport.getIdentityId(), expanded:expandedViewerGames.has(game.id),
  pendingSeat:preparedPlayerInvitations.get(game.id), icon, formatStatus,
  computerActivity:computerSession?.snapshot().activity,
  expandedComputers:expandedComputerCards.get(game.id) ?? new Set(),
});
const updateParticipantCards = game => {
  const panel=appEl.querySelector('[data-testid="participants-list"]');
  if(!panel || !game)return;
  const focused=document.activeElement;
  const restoreSide=panel.contains(focused) && focused?.dataset.control==='resume-here' ? focused.dataset.computerSide : null;
  const next=document.createElement('div');next.innerHTML=renderParticipantsPanel(game);
  patchSectionContent(panel,next.firstElementChild);
  if(restoreSide && (!focused.isConnected || focused.disabled))panel.querySelector(`[data-action="toggle-computer-card"][data-computer-side="${restoreSide}"]`)?.focus({preventScroll:true});
  inlineProfiles.sync();
};

const joinFeedback=createJoinFeedback({getScope:gameId=>({gameId,owner:transport,generation:account.snapshot().generation,visit:inviteVisit,route:window.location.hash})});
// A deliberate focus or pointer move retires only the join's focus intent.
document.addEventListener('focusin',event=>joinFeedback.noteFocus(event.target));
document.addEventListener('pointerdown',event=>joinFeedback.noteFocus(event.target),true);
const additionalHistory=createAdditionalHistory({
  getScope:gameId=>{const game=transport.getAuthoritativeGame(gameId),state=account.snapshot();return canReadAdditionalHistory(game,state)?{gameId,owner:transport,generation:state.generation,revision:game.gameplayRevision}:null;},
  load:(scope,values)=>scope.owner.additionalHistory(scope.gameId,values),
  onChange:gameId=>{if(getCurrentViewedGameId()===gameId)render({animatePanels:false,includeBoard:false});},
});
const renderAdditionalHistory = game => {
  if(!canReadAdditionalHistory(game,account.snapshot()))return '<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history"></ol></div>';
  const state=additionalHistory.snapshot(game.id);
  if(!state)return "";
  if(!state.metadata&&!state.loading&&!state.error)queueMicrotask(()=>void additionalHistory.ensure(game.id));
  const archiveTurns = new Map();
  const archiveItems = state.items.filter(entry=>!game.historyContextMoves?.some(move=>move.moveId===entry.id));
  const inspected = game.inspectedDecision;
  if (inspected && !game.moves?.some(move=>move.moveId===inspected.moveId) && !archiveItems.some(entry=>entry.id===inspected.moveId)) archiveItems.unshift({id:inspected.moveId,move:inspected,at:inspected.at});
  for (const entry of archiveItems) {
    const index = entry.move.turnIndex;
    if (!archiveTurns.has(index)) archiveTurns.set(index,[]);
    archiveTurns.get(index).push(entry);
  }
  const rows=[...archiveTurns.entries()].sort(([a],[b])=>b-a).map(([index,entries])=>{
    entries.sort((a,b)=>(a.move.turnMoveIndex ?? a.move.index)-(b.move.turnMoveIndex ?? b.move.index));
    const first=entries[0].move;
    const side=historyTurnSide({index},entries.map(entry=>entry.move));
    const turnActor=entries.find(entry=>entry.move.actorSide===side)?.move ?? first;
    const selectedTurn=game.inHistoryMode && game.historyTurnIndex===index;
    const selectableTurn=entries.some(entry=>entry.move.undone!==true && entry.historyStatus!=="unknown");
    const heading=`<div class="history-turn-heading${selectedTurn?' is-selected':''}" data-key="archive-turn:${escapeHtml(game.id)}:${index}" ${selectedTurn?'aria-current="true"':!selectableTurn?'':`data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${index}" role="button" tabindex="0"`}>Turn ${index+1} · ${escapeHtml(COMPUTER_PROFILES[turnActor.computerProof?.profile]?.name ?? playerDisplayName(game,side))}</div>`;
    const contents=entries.sort((a,b)=>a.move.turnMoveIndex-b.move.turnMoveIndex).map(entry=>{
    const selected=Boolean(game.inHistoryMode&&game.inspectedDecision?.moveId===entry.id);
    const preview=selected?renderHistoryPreview(game,buildMovePreview(game.inspectedDecision ?? entry.move),`archive:${game.id}:${entry.id}`):'';
    return `<li class="history-item ${playerToneClassForSide(entry.move.actorSide)}${selected?' is-selected':''}${entry.move.undone?' is-undone':''}" data-key="archive:${escapeHtml(entry.id)}" data-archive-move-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(historyActorLabel(game,entry.move,{identityId:transport.getIdentityId()}))}"><${selected?'div':'button'} class="history-item-info history-archive-select" ${selected?'':'data-action="inspect-history-archive"'} data-game-id="${escapeHtml(game.id)}" data-decision-id="${escapeHtml(entry.id)}" aria-current="${selected?'true':'false'}"><span class="history-move-line">${escapeHtml(entry.move.notation)}${entry.move.undone?' · Undone':entry.historyStatus==='unknown'?' · Status unavailable':''}</span><span class="history-move-at small">${escapeHtml(formatClientDateTime(entry.at))}</span></${selected?'div':'button'}>${preview}</li>`;
    }).join('');
    return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="archive-history-turn:${escapeHtml(game.id)}:${index}">${heading}${selectedTurn?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves),`archive-turn:${game.id}:${index}`):''}<ol class="history-list history-list-nested">${contents}</ol></li>`;
  }).join('');
  const action=state.error?`<p role="status">We couldn’t load more history</p><button class="secondary" data-action="retry-history-archive" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Retry</button>`
    : state.available&&(!state.loaded||state.cursor)?`<button class="secondary" data-action="load-history-archive" data-game-id="${escapeHtml(game.id)}" ${state.loading?'disabled aria-busy="true"':''}>${icon('history')}${state.loaded?'Load more history':'More game history'}</button>`:"";
  return `<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history">${rows}</ol>${action}${state.loaded&&state.partial?'<p class="small">Some earlier history is unavailable</p>':''}</div>`;
};

let revealedHistoryKey = null;
const revealSelectedHistory = () => {
  if (getShellLayoutMode() !== 'narrow' || getGamePanel() !== 'history') return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const selected = appEl.querySelector('[data-game-panel="history"] [aria-current="true"]');
    if (!selected) { revealedHistoryKey=null; return; }
    const preview = selected.querySelector('.history-inline-preview') ?? (selected.nextElementSibling?.matches('.history-inline-preview') ? selected.nextElementSibling : null);
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const nav = appEl.querySelector('.shell-mobile-tabbar');
    // Reserve the controls' full height even while hidden. Revealing the entry
    // can scroll upward and reveal the navigation at the same time.
    const navigationHeight = Math.max(nav?.getBoundingClientRect().height ?? 0, nav?.querySelector('[data-mobile-nav-controls]')?.getBoundingClientRect().height ?? 0) + (nav?.querySelector('[data-mobile-nav-reveal]')?.getBoundingClientRect().height ?? 0);
    const bottomInset = 20 + navigationHeight;
    if (preview) {
      // Measure natural geometry each time. DOM patching can replace inline
      // sizing, and rotation/text enlargement changes the available height.
      preview.style.removeProperty('zoom');
      preview.style.removeProperty('width');
      const bounds = preview.getBoundingClientRect();
      const headingHeight = bounds.top - selected.getBoundingClientRect().top;
      const available = Math.max(1, viewport - 12 - bottomInset - headingHeight);
      if (bounds.height > available && bounds.width > 0) {
        // Scale the complete mini-board, including its axes, token shapes and
        // overlay strokes. Compact-board minimum cell sizes remain unchanged.
        preview.style.width = `${bounds.width}px`;
        preview.style.zoom = String(available / bounds.height);
      }
    }
    const key = `${getCurrentViewedGameId()}:${selected.closest('[data-key]')?.getAttribute('data-key') ?? selected.textContent}:${window.innerWidth}:${viewport}`;
    if (revealedHistoryKey === key) return;
    revealedHistoryKey = key;
    const top = selected.getBoundingClientRect().top;
    const bottom = (preview || selected).getBoundingClientRect().bottom;
    if (top < 12 || bottom > viewport - bottomInset) window.scrollBy({top:top-12,behavior:'instant'});
  }));
};

const renderHistoryPanel = (game) => {
  const historyRows = renderTurnHistory(game);
  return renderHistorySlots({rows:historyRows,extra:renderAdditionalHistory(game),
    before:game.historyLoading || game.historyLoadError ? `<div class="history-load-status" role="status" aria-live="polite" data-testid="history-load-status"><p class="small">${game.historyLoading ? (game.historyLoadTurnIndex != null ? "Loading this turn" : "Loading this move") : (game.historyLoadTurnIndex != null ? "This turn couldn’t load. Your current view is still available." : "This move couldn’t load. Your current view is still available.")}</p>${game.historyLoadError ? `<button class="secondary mini-button" ${game.historyLoadTurnIndex != null ? `data-action="jump-history-turn" data-turn-index="${game.historyLoadTurnIndex}"` : `data-action="jump-history" data-move-index="${game.historyLoadIndex}"`} data-game-id="${escapeHtml(game.id)}">Retry</button>` : ""}</div>` : "",
    after:getGameResult(transport.getAuthoritativeGame(game.id),transport.getIdentityId()) ? `<button class="secondary" data-action="view-result" data-game-id="${escapeHtml(game.id)}">${icon("history")}View result</button>` : ""});
};

const renderBoardPanel = (game) => `
  ${account.snapshot().enabled && (account.snapshot().maintenance || !account.snapshot().available) ? '<p class="alert" role="status">Play is temporarily paused. You can still browse and watch games.</p>' : ''}
  ${game.ownershipMode === "legacy_guest" && account.snapshot().enabled ? '<p class="alert" role="status">This older guest game is view-only. <button data-action="create-game">Start new game</button></p>' : ''}
  ${account.snapshot().enabled && account.snapshot().available && !account.snapshot().maintenance && !account.canPlay() ? '<p class="alert" role="status">Sign in to play or analyze. The board remains available to view.</p>' : ''}
  ${renderBoardHeadingSlot()}
  ${renderBoardMessageSlot({id:"shell-board-preview-label"})}
  <div class="board-wrap" data-testid="game-board-wrap">
    <div id="shell-board" class="board" data-testid="game-board"></div>
    <div class="reconnect-background" aria-hidden="true"></div>
    <svg id="shell-overlay-lines" class="overlay-lines" aria-hidden="true"></svg>
  </div>
  <div class="overlay-key" aria-label="Board legend">
    <button type="button" class="legend-inspection" data-board-inspection="command" aria-pressed="false"><i class="swatch commander-key">${renderPieceSymbol('commander')}</i><span class="legend-inspection-label">Commander</span></button>
    <button type="button" class="legend-inspection" data-board-inspection="supply" aria-pressed="false"><i class="swatch supply-point" style="--supply-owner:var(--player-${game.currentSnapshot?.sideToMove === 'P2' ? 'p2' : 'p1'})">${renderPieceSymbol('supply')}</i><span class="legend-inspection-label">Supply point</span></button>
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
  >${icon({players:"players",board:"board",history:"history"}[panelKey])}<span class="sr-only">${label}</span></button>
`;

const renderGameShellFrame = (game, { loading = false } = {}) => `
  <section class="game-shell-frame" data-game-shell-root data-game-id="${escapeHtml(game.id)}" data-testid="${loading ? "game-loading-shell" : "game-shell"}">
    <div class="game-shell-track-wrap">
      <section class="layout-grid game-shell-track" data-game-shell-track>
        <div class="stack game-shell-mobile-panel" data-mobile-panel="players" data-shell-sticky-target="left" data-sticky-enabled="false">
          <section class="panel" data-game-panel="summary">${loading ? renderSummaryLoading(`Game <span class="mono">${escapeHtml(formatDisplayGameId(game.id))}</span>`) : ""}</section>
          <section class="panel" data-game-panel="join">${loading ? renderPlayersLoading() : ""}</section>

        </div>

        <div class="stack game-shell-mobile-panel" data-mobile-panel="board" data-shell-sticky-target="board" data-sticky-enabled="false">
          <section class="panel" data-shell-panel="board" data-turn-side="${game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red'}">
            ${loading ? renderBoardLoadingPreview(game.id) : renderBoardPanel(game)}
          </section>
        </div>

        <div class="stack game-shell-mobile-panel" data-mobile-panel="history">
          <section class="panel" data-game-panel="history">${loading ? renderHistoryLoading() : ""}</section>
        </div>
      </section>
    </div>
    <nav class="shell-mobile-tabbar" aria-label="Game panels" data-visible="true">
      <button type="button" class="mobile-nav-reveal" data-mobile-nav-reveal aria-label="Show game navigation" aria-expanded="true"></button>
      <div class="mobile-nav-controls" data-mobile-nav-controls>
      ${renderGameShellPanelTab("players", "Players")}
      ${renderGameShellPanelTab("board", "Board")}
      ${renderGameShellPanelTab("history", "History")}
      </div>
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
  shellRoot.querySelectorAll('[data-mobile-panel]').forEach(panel => {
    const inactive = getShellLayoutMode() === 'narrow' && panel.dataset.mobilePanel !== activePanel;
    panel.toggleAttribute('inert', inactive);
    panel.setAttribute('aria-hidden', String(inactive));
    panel.dataset.active = String(!inactive);
  });
  mobileNavigation?.sync();
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
    const retainedHeader = [...current.children].find(child => child.matches('.shell-header'));
    const freshHeader = [...next.children].find(child => child.matches('.shell-header'));
    if (retainedHeader && freshHeader) patchNotificationTree(retainedHeader, freshHeader);
    const sectionNodes = new Map([...current.children].filter(el=>el.hasAttribute('data-home-section-root')).map(el=>[el.dataset.homeSectionRoot,el]));
    const nextSectionKeys = new Set([...next.children].filter(el=>el.hasAttribute('data-home-section-root')).map(el=>el.dataset.homeSectionRoot));
    for (const child of [...current.childNodes]) if (!(child instanceof HTMLElement && nextSectionKeys.has(child.dataset.homeSectionRoot)) && child !== retained && child !== retainedHeader && !(child instanceof HTMLElement && child.matches("[data-shell-flyouts]"))) child.remove();
    let after = false;
    for (const child of next.childNodes) {
      if (child === replacement) { after = true; continue; }
      if (child === freshHeader && retainedHeader) continue;
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
  const focusIncident = focused?.getAttribute("data-incident-id");
  patchNotificationTree(currentHeaderEl, nextHeaderEl);
  if (focusAction && !focused.isConnected) currentHeaderEl.querySelector(`[data-action="${CSS.escape(focusAction)}"]${focusIncident ? `[data-incident-id="${CSS.escape(focusIncident)}"]` : ""}`)?.focus({ preventScroll: true });
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
      if(scroll && nextScroll && scroll.innerHTML !== nextScroll.innerHTML){const top=scroll.scrollTop;patchSectionContent(scroll,nextScroll);scroll.scrollTop=top;}
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
  (currentRoute.name !== "game" || getMountedGameShellRoot()?.querySelector('[data-action="switch-game-panel"][aria-pressed="true"]')?.getAttribute("data-panel") === getGamePanel()) &&
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
  desktopBoardFit ??= createDesktopBoardFit({
    appEl, requestLayout: scheduleGameShellStickyLayout,
    onSizeChange: () => boardRuntime?.refreshVisuals?.(),
  });
  desktopBoardFit.sync({wide: layoutMode === 'wide'});
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

const updateMountedGameShell = ({ game, inviteFromRole = null, inviteToken = null, includeBoard = true, animatePanels = false } = {}) => {
  const shellRoot = getMountedGameShellRoot();
  if (!(shellRoot instanceof HTMLElement) || !game) {
    return false;
  }

  shellRoot.querySelector('[data-shell-panel="board"]')?.setAttribute('data-turn-side',game.currentSnapshot?.sideToMove === 'P2' ? 'blue' : 'red');
  const alertsEl = document.getElementById("shell-game-alerts");
  const summaryEl = shellRoot.querySelector('[data-game-panel="summary"]');
  const joinEl = shellRoot.querySelector('[data-game-panel="join"]');
  const participantsEl = shellRoot.querySelector('[data-testid="participants-list"]');
  const historyEl = shellRoot.querySelector('[data-game-panel="history"]');
  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(
    game.inviteToken || inviteToken || game.id,
    getCurrentFlyoutState(),
  )}`;

  if (alertsEl instanceof HTMLElement) {
    const html = renderGameAlertsHtml(game, inviteFromRole);
    if (alertsEl.innerHTML !== html) patchNotificationHtml(alertsEl, html);
    updateRecoveryAnnouncement(game);
  }
  if (summaryEl instanceof HTMLElement) {
    summaryEl.innerHTML = renderGameSummaryPanel(game);
  }
  if (participantsEl instanceof HTMLElement) updateParticipantCards(game);
  if (joinEl instanceof HTMLElement) {
    const markup=renderJoinInvitePanel(game, inviteLink);
    if(joinMarkupByElement.get(joinEl) !== markup){
      const animateJoin = animatePanels && !routeTransition && joinMarkupByElement.has(joinEl);
      const oldHeight=joinEl.getBoundingClientRect().height;
      const focus=joinEl.contains(document.activeElement)?document.activeElement:null;
      const selector=focus?.matches('.invite-link-field')?'.invite-link-field':focus?.dataset.action?`[data-action="${CSS.escape(focus.dataset.action)}"]${focus.dataset.inviteRole?`[data-invite-role="${CSS.escape(focus.dataset.inviteRole)}"]`:''}${focus.dataset.profileKey?`[data-profile-key="${CSS.escape(focus.dataset.profileKey)}"]`:''}${focus.dataset.computerSide?`[data-computer-side="${CSS.escape(focus.dataset.computerSide)}"]`:''}`:null;
      const selection=focus instanceof HTMLInputElement?[focus.selectionStart,focus.selectionEnd]:null;
      if(selector)panelPendingFocus.set(joinEl,{selector,selection});
      else if(document.activeElement !== document.body)panelPendingFocus.delete(joinEl);
      // Preserve Players/profile controls across unrelated presence updates (canonical160 b0604f1).
      patchToolHtml(joinEl,markup);
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
      if (animateJoin) animatePanelHeightChange(joinEl,oldHeight);
      else {
        panelSizeAnimations.get(joinEl)?.cancel();
        panelSizeAnimations.delete(joinEl);
      }
    }
  }
  if (historyEl instanceof HTMLElement) {
    patchToolHtml(historyEl, renderHistoryPanel(game));
    revealSelectedHistory();
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
        patchToolHtml(scrollEl, body);
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
  if (!appEl.querySelector('[data-game-shell-root][data-testid="game-shell"]') || getInviteContextForGame(game, "game")) return false;
  return !game.pendingPlayerRequestSeat && activeResultGameId !== game.id && hostInvite?.gameId !== game.id && !getActiveApprovalRequest(game) && doesMountedFlyoutStateMatchRoute();
};

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  const game = transport.getGameViewModel(gameId);
  if (!game && transport.isUpgradeRequired?.(gameId)) {
    return `<section class="panel" data-testid="sync-recovery-banner" role="status"><p>Righelt has an update. Refresh to keep playing.</p><button class="secondary" data-action="refresh-game">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a></section>`;
  }
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
        <p>Someone wants to join. Request awaiting approval.</p><p>${participantButton(request)} · <span class="${playerToneClassForSeat(request.requestedSeat)}">${sideColorName(request.requestedSeat)}</span></p>
        <div class="invite-choice-list">
          <div class="invite-choice-row">
            <button
              data-action="accept-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              data-testid="accept-request"
            >${icon('check')}Accept</button>
          </div>
          <div class="invite-choice-row">
            <button
              class="secondary"
              data-action="ignore-request"
              data-game-id="${escapeHtml(game.id)}"
              data-requester-id="${escapeHtml(request.identityId)}"
              data-testid="ignore-request"
            >${icon('close')}Ignore</button>
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
  const confirmed = transport.getAuthoritativeGame(game.id);
  const result = getGameResult(confirmed, transport.getIdentityId());
  if (!result) return "";
  const names = ['P1','P2'].map(side => playerDisplayName(confirmed,side));
  const isolatedName = name => `<bdi dir="auto">${escapeHtml(name)}</bdi>`;
  const namedText = text => {
    if (result.side) return escapeHtml(text);
    const winnerName = result.winner ? playerDisplayName(confirmed,result.winner) : null;
    if (winnerName && text === `${winnerName} won`) return `${isolatedName(winnerName)} won`;
    const unique = [...new Set(names)].sort((a,b) => b.length-a.length);
    let remaining = text, html = '';
    while (remaining) {
      const matches = unique.map(name => ({name,index:remaining.indexOf(`${name}’s commander`)})).filter(match => match.index >= 0).sort((a,b) => a.index-b.index || b.name.length-a.name.length);
      if (!matches.length) return html + escapeHtml(remaining);
      const {name,index} = matches[0];
      html += escapeHtml(remaining.slice(0,index)) + isolatedName(name);
      remaining = remaining.slice(index+name.length);
    }
    return html;
  };
  return `<section class="panel game-result" data-testid="game-result" data-result-tone="${result.tone}" data-winner="${result.winner ?? ''}"><p class="small">Game finished</p>${renderResultMark(result)}<h1 tabindex="-1">${namedText(result.title)}</h1><p>${namedText(result.reason)}</p><p>${result.controlsBothSides ? "You play both sides" : names.map(isolatedName).join(" vs ")}</p><p class="small">Game ${escapeHtml(formatDisplayGameId(game.id))}</p><div class="story-modal-actions"><button data-action="analysis" data-game-id="${escapeHtml(game.id)}">${icon('back')}Review game</button><button${result.tone === "victory" ? "" : ' class="secondary"'} data-action="rematch" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Play again</button><a class="button-link secondary" href="#/">${icon('home')}Home</a></div></section>`;
};

const renderGame = (gameId, inviteFromRole = null, inviteToken = null) => {
  // A socket may supply the snapshot before route hydration finishes. Keep
  // that known game in the same shell and gates as its settled render.
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return renderGameContent(gameId, inviteFromRole, inviteToken);
  }
  if (activeResultGameId === gameId && getGameResult(transport.getAuthoritativeGame(game.id), transport.getIdentityId())) return renderResult(game);
  const approvalRequest = getActiveApprovalRequest(game);
  if (approvalRequest) {
    return renderApprovalGate(game, approvalRequest);
  }
  if(hostInvite?.gameId === gameId)return renderHostInvite(game);
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
    <p role="status" data-testid="pending-player-request-notice">Your request to play as <span class="${playerToneClassForSeat(game.pendingPlayerRequestSeat)}">${sideColorName(game.pendingPlayerRequestSeat)}</span> is awaiting approval.</p>
    <div class="invite-choice-list"><a class="button-link secondary" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">${icon("home")}Back home</a></div>`});
  const intendedTaken=Boolean(inviteContext.intendedRole==='red'?game.player1:inviteContext.intendedRole==='blue'?game.player2:false);
  const canJoinPlayer = !game.selfPlayMode && inviteContext.intendedRole !== 'viewer' && game.canJoinAsPlayer && game.showJoinActions && !intendedTaken;
  const canJoinViewer = account.snapshot().enabled || game.canJoinAsViewer;
  const playerActionLabel = inviteContext.intendedRole && inviteContext.intendedRole !== 'viewer' ? `Play as ${inviteContext.intendedRole === "blue" ? "Blue" : "Red"}` : inviteContext.inviteType === "player" ? "Join as player" : "Request to join as player";
  const heading = !canJoinPlayer && canJoinViewer ? "Watch this game" : canJoinPlayer && inviteContext.intendedRole ? "Take your seat" : canJoinPlayer ? "Choose how to enter this game" : "Invitation unavailable";
  const seatNotice = intendedTaken && !game.selfPlayMode && inviteContext.intendedRole !== 'viewer' ? '<p role="status">That seat is taken</p>' : '';
  const joinPlayerButtonKey = getJoinButtonKey("player", game.id);
  const joinViewerButtonKey = getJoinButtonKey("viewer", game.id);

  return renderInvitationSurface({background,content:`
        <p class="small invite-gate-kicker">Invite received</p>
        <h2 id="invite-surface-title">${heading}</h2>
        ${seatNotice}
        <div class="invite-choice-list">
          ${canJoinPlayer ? `<div class="invite-choice-row">
            <button data-action="accept-invite-player" data-game-id="${escapeHtml(game.id)}" data-testid="invite-join-player"${renderButtonStateAttributes({
              pendingKey: joinPlayerButtonKey,
              disabled: !canJoinPlayer,
              className: `invite-action invite-${inviteContext.intendedRole === "blue" ? "blue" : inviteContext.intendedRole === "red" ? "red" : !game.player1 ? "red" : "blue"}`,
            })}>${icon("play")}${escapeHtml(playerActionLabel)}</button>
          </div>` : ""}
          ${canJoinViewer ? `<div class="invite-choice-row">
            <button data-action="accept-invite-viewer" data-game-id="${escapeHtml(game.id)}" data-testid="invite-join-viewer"${renderButtonStateAttributes({
              className: "secondary",
              pendingKey: joinViewerButtonKey,
              disabled: !canJoinViewer,
            })}>${icon("players")}Join as viewer</button>
          </div>` : ""}
          <div class="invite-choice-row">
            <a class="button-link secondary" href="${buildHomeHash(getCurrentFlyoutState())}" data-flyout-link="home">${icon("home")}Back home</a>
          </div>
        </div>
        ${joinFeedback.message(game.id)?`<p class="alert error" role="status" data-testid="join-failure">${escapeHtml(joinFeedback.message(game.id))}</p>`:""}
        <p class="small">
          ${
            canJoinPlayer || canJoinViewer
              ? ""
              : "This invitation is no longer available"
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
      ${tutorialSavingError ? `<div role="alert" data-testid="tutorial-saving-error"><p>${escapeHtml(tutorialSavingError.message)}</p>${renderDiagnosticDisclosure(tutorialSavingError.incidentId)}</div>` : issueDiagnostics.list().filter(report => report.key === "tutorial-saving" && isDiagnosticOpen(report.id)).map(report => renderDiagnosticDisclosure(report.id)).join("")}
      <div class="row">
        <button data-action="tutorial-next">Next</button>
        <button class="secondary" data-action="tutorial-skip">Skip Step</button>
        <button class="secondary" data-action="tutorial-skip-all" ${tutorialSaveOwner ? "disabled" : ""} data-game-id="${escapeHtml(gameId || "")}">Skip tutorial</button>
        <button class="secondary" data-action="tutorial-complete" ${tutorialSaveOwner ? "disabled" : ""} data-game-id="${escapeHtml(gameId || "")}">Finish Tutorial</button>
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
  const move = game.inspectedDecision ?? (Array.isArray(game.moves) ? game.moves[game.historyIndex] : null);
  return buildDestroyedPieceOverlays({
    destroyedPieceRecords: move?.destroyedPieces ?? [],
    preActionSnapshot: move?.selectionSnapshot ?? null,
  });
};

const getHistoryRecordedActionStartPiece = (game) => {
  if (!game?.inHistoryMode || typeof game.historyIndex !== "number") {
    return null;
  }
  const move = game.inspectedDecision ?? (Array.isArray(game.moves) ? game.moves[game.historyIndex] : null);
  if (!move?.selectionSnapshot || !move?.action) {
    return null;
  }
  return findRecordedActionStartPiece(move.selectionSnapshot, move.action);
};

let reconnectPresentationTimer;
const updateReconnectPresentation = game => {
  const wrap = document.querySelector('[data-testid="game-board-wrap"]');
  const recovering = isBoardRecoveryPending(game, { quietComputerRenewal: quietComputerRenewal(game) });
  if (wrap) {
    setActivityActor(wrap, activityActorSide(game));
    wrap.dataset.reconnecting = String(recovering);
    wrap.dataset.loadingState = recovering ? "pending" : "idle";
    // A retry or socket generation change does not restart an uninterrupted cue.
    wrap.dataset.loadingKey = `recovery:${game.id}`;
    wrap.dataset.loadingContext = "external";
    wrap.setAttribute("aria-busy", String(recovering));
  }
  clearTimeout(reconnectPresentationTimer);
  if (recovering && game.recoveryStartedAt) {
    const elapsed = Date.now() - game.recoveryStartedAt;
    const remaining = elapsed < LOADING_CUE_DELAY_MS ? LOADING_CUE_DELAY_MS - elapsed : elapsed < SYNC_TIMING.reconnectAlertMs ? SYNC_TIMING.reconnectAlertMs - elapsed : elapsed < SYNC_TIMING.confirmationBudgetMs ? SYNC_TIMING.confirmationBudgetMs - elapsed : null;
    if (remaining !== null) reconnectPresentationTimer = setTimeout(() => { const next = transport.getGameViewModel(game.id); updateReconnectPresentation(next); updateMountedHeader(); }, remaining + 1);
  }
};
const mountBoardForGame = (game) => {
  game = getBoardGame(game);
  updateReconnectPresentation(game);
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
  const capturing = currentRoute.scenarios && scenarioCapture?.gameId === game.id;
  const snapshot = capturing ? capturePosition() : game.currentSnapshot ?? null;
  const historyPreview = game.inHistoryMode ? (game.historyTurnIndex != null ? buildTurnPreview(game.historyTurnMoves) : buildMovePreview(game.inspectedDecision ?? game.moves?.find(move=>move.index===game.historyIndex))) : null;
  const historyMoveIndex = game.inHistoryMode ? (game.historyTurnIndex != null ? `turn:${game.historyTurnIndex}` : game.historyIndex) : null;
  const historySelectionAction = game.inHistoryMode && !capturing ? game.historySelectionAction ?? null : null;
  const overlayMode = game.inHistoryMode && !capturing ? historyPreview.overlay.mode : "interactive";
  const effectiveLegalActions = Array.isArray(game.legalActions) && !game.inHistoryMode && !(capturing && scenarioCapture.mode === 'frozen') ? game.legalActions : [];
  const selectionHydrationGame = getSelectionHydrationGame(game);
  const scenarioSelectionHydration = resolvePendingScenarioHydration({
    game: selectionHydrationGame,
    snapshot,
    legalActions: effectiveLegalActions,
  });
  const initialSelectionHydration = resolveInitialSelectionHydration({
    gameId: game.id,
    initialSelectionAction: !game.inHistoryMode ? selectionHydrationGame.initialSelectionAction ?? null : null,
    legalActions: effectiveLegalActions,
    consumedActionKey: consumedInitialSelectionActionKeyByGameId.get(game.id) ?? null,
    toStableKey,
  });
  if (!snapshot) {
    return;
  }

  const snapshotKey = toStableKey(snapshot);
  const legalActionsKey = toStableKey(effectiveLegalActions);
  const historyDestroyedPieces = capturing ? [] : historyPreview?.overlay.destroyedPieces ?? getHistoryDestroyedPieceOverlays(game);
  const historyRecordedActionStartPiece = capturing ? null : historyPreview?.overlay.recordedActionStartPiece ?? getHistoryRecordedActionStartPiece(game);
  const forceClickTargetSelection = Boolean(capturing);
  const frozenCapture = capturing && scenarioCapture.mode === 'frozen';
  const captureSelection = frozenCapture ? scenarioCapture.selection : null;
  const capturePiece = captureSelection?.source ? snapshot.pieces.find(piece => piece.position?.row === captureSelection.source.row && piece.position?.col === captureSelection.source.col) : null;
  const hydratedSelectionState = frozenCapture ? (capturePiece ? { selectedPieceId: capturePiece.id, source: captureSelection.source, target: captureSelection.target } : null) : scenarioSelectionHydration.selectionState;
  const hydratedSelectionAction = frozenCapture ? null : scenarioSelectionHydration.selectionAction ?? initialSelectionHydration.selectionAction;
  const overlayKey = toStableKey({
    overlayMode,
    ...historyPreview?.overlay,
    recordedAction: historySelectionAction,
    recordedActionStartPiece: historyRecordedActionStartPiece,
    destroyedPieces: historyDestroyedPieces,
    selectionAction: hydratedSelectionAction,
    selectionState: hydratedSelectionState,
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
        getGameView: () => getBoardGame(transport.getGameViewModel(game.id)),
        getInspectionSnapshot: () => currentRoute.scenarios && scenarioCapture?.mode === 'frozen' && scenarioCapture.gameId === game.id ? capturePosition() : null,
        canSelect: () => Boolean(currentRoute.scenarios && scenarioCapture?.gameId === game.id) || (hostInvite?.gameId !== game.id && Boolean(getBoardGame(transport.getGameViewModel(game.id))?.currentSnapshot)),
        canPresentActions: () => {
          const view = getBoardGame(transport.getGameViewModel(game.id));
          return !(currentRoute.scenarios && scenarioCapture?.mode === 'frozen' && scenarioCapture.gameId === game.id) && hostInvite?.gameId !== game.id && ownsBoardActor(view, transport.getIdentityId());
        },
        canInteract: () => {
          const view = getBoardGame(transport.getGameViewModel(game.id));
          return !(currentRoute.scenarios && scenarioCapture?.mode === 'frozen' && scenarioCapture.gameId === game.id) && hostInvite?.gameId !== game.id && canControlLiveBoard(view);
        },
      }),
      controls: {
        onInteractionSound: event => gameSound.interaction(event),
        getTurnIndicator: state => {
          const view=getBoardGame(transport.getGameViewModel(game.id));
          return boardTurnCaption(view,state,{identityId:transport.getIdentityId()});
        },
        getBoardMessage: selection => {
          const replayFeedback = replayRequests.snapshot();
          const replay = replayController?.snapshot();
          const view = getBoardGame(transport.getGameViewModel(game.id));
          const status = computerSession?.snapshot();
          updateComputerBoardLoading(document.getElementById('shell-board-preview-label')?.parentElement.querySelector('.board-message-activity'), view, status, {
            replaying: Boolean(replay?.playing || replayFeedback?.gameId === game.id), inspecting: Boolean(selection.selectedPieceId || selection.inspection), scope: viewingScope(),
          });
          if (replayFeedback?.gameId === game.id) return replayFeedback.phase === "loading"
            ? {text:"Preparing replay",action:{id:"replay-cancel",label:"Cancel replay"}}
            : {text:"Replay unavailable",actions:[{id:"replay-computer",label:"Try again"},{id:"replay-dismiss",label:"Dismiss"}]};
          if (replay?.playing) return { text:`Replay · ${Math.max(1,replay.step)} of ${replay.total}`, actions:[...(replay.manual ? [{id:'replay-next',label:'Next'}] : []),{id:'replay-stop',label:'Stop replay'}] };
          return opponentBoardMessage(view,status,selection,{canInteract:!(currentRoute.scenarios && scenarioCapture?.mode === "frozen" && scenarioCapture.gameId === game.id) && hostInvite?.gameId !== game.id && canControlLiveBoard(view),identityId:transport.getIdentityId()});
        },
        onBoardMessageAction: id => {
          if (id === 'replay-computer') void startComputerReplay();
          if (id === 'replay-stop') replayController?.stop('stopped');
          if (id === 'replay-next') replayController?.next();
          if (id === 'replay-cancel' || id === 'replay-dismiss') replayRequests.cancel();
        },
        getAllowFreeSelection: () => Boolean(currentRoute.scenarios && scenarioCapture?.mode === 'frozen' && scenarioCapture.gameId === game.id),
        getSupportsHover: () => hoverCapability.getSupportsHover(),
        getForceClickTargetSelection: () => Boolean(currentRoute.scenarios && scenarioCapture?.gameId === game.id),
        onVisualsUpdated: visible => { updateLegendVisibility(document.querySelector('.overlay-key'), visible, prefersReducedMotion()); updateInspectionLegend(document.querySelector('.overlay-key'),boardRuntime?.getState(),{selectedPieceId:boardRuntime?.getSelection()?.selectedPieceId,...visible}); },
        onStateUpdated: ({ state, selectedPieceId, selectedSource, selectedTarget, overlay }) => {
          if (selectedPieceId && replayRequests.snapshot()) replayRequests.cancel();
          if (currentRoute.scenarios && scenarioCapture?.gameId === game.id && toStableKey(state) === toStableKey(capturePosition())) {
            scenarioCapture.selection = buildSavedSelectionFromRuntimeSelection({ source: selectedSource, target: selectedTarget }, state);
          }
          updateInspectionLegend(document.querySelector('.overlay-key'),state,{selectedPieceId,...overlay});
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
      selectionState: hydratedSelectionState,
      overlayMode,
      ...historyPreview?.overlay,
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
    (!frozenCapture && mountedHistoryMoveIndex !== historyMoveIndex) ||
    shouldResetBoardSelection({
      currentSnapshot: boardRuntime.getState?.() ?? null,
      nextSnapshot: snapshot,
      currentSelection: boardRuntime.getSelection?.() ?? null,
      nextLegalActions: effectiveLegalActions,
      freeSelection: frozenCapture,
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
    // Readiness and opponent activity can change without a board revision.
    // Refresh the message while preserving the current board and selection.
    boardRuntime.refreshStatus();
    return;
  }
  const shouldReloadSnapshot =
    mountedSnapshotKey !== snapshotKey ||
    mountedLegalActionsKey !== legalActionsKey ||
    mountedOverlayKey !== overlayKey ||
    resetSelection;
  if (!shouldReloadSnapshot) {
    boardRuntime.refreshStatus();
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
    selectionState: hydratedSelectionState,
    overlayMode,
    ...historyPreview?.overlay,
    recordedAction: historySelectionAction,
    recordedActionStartPiece: historyRecordedActionStartPiece,
    destroyedPieces: historyDestroyedPieces,
  });
};

const destroyMountedBoardRuntime = () => {
  replayRequests.cancel();
  replayController?.destroy();
  replayController = null;
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
  recoveryPresentationOptions(currentRoute.name === 'game' ? transport.getGameViewModel(currentRoute.gameId) : null);
  const previousJoinFocus = document.activeElement;
  utilityMemory.capture();
  const result = preserveBoardFocus({ document, getGameId: getCurrentViewedGameId }, () => renderContent({ animatePanels, includeBoard }));
  utilityMemory.restore();
  inlineProfiles.sync();
  syncMountedGameShellPanelUi();
  if (pendingResultReviewFocus === currentRoute.gameId && getGamePanel() === "history") {
    const heading = appEl.querySelector('[data-game-panel="history"] h2');
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); pendingResultReviewFocus = null; }
  }
  joinFeedback.restoreFocus({ document, root: appEl, previousActive: previousJoinFocus });
  return result;
};
const renderContent = ({ animatePanels, includeBoard }) => {
  const hadResultView = Boolean(appEl.querySelector('.game-result'));
  const resultFocus = document.activeElement?.closest('.game-result') ? {action:document.activeElement.getAttribute('data-action'),href:document.activeElement.getAttribute('href')} : null;
  if(currentRoute.name==='game' && routeHydrated){
    const game=transport.getGameViewModel(currentRoute.gameId), confirmed=transport.getAuthoritativeGame(currentRoute.gameId);
    if (activeResultGameId === currentRoute.gameId && confirmed?.board?.state?.outcome && !getGameResult(confirmed, transport.getIdentityId())) activeResultGameId = null;
    if(resultTransitions.observe(confirmed,{inHistory:game?.inHistoryMode,hidden:document.hidden,storyOpen:storyDialog.isOpen()})){activeResultGameId=currentRoute.gameId;resultPresentation.enter(confirmed.id,getGameResult(confirmed,transport.getIdentityId()));}
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
      animatePanels,
    });
    restoreScenarioDraftFocus?.();
    syncRenderedMarkupSnapshot();
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
    if (inviteLoadState && routeReadIsCurrent(inviteLoadState.read) && (inviteLoadState.status === "error" || inviteLoadState.retrying)) {
      body = renderInvitationSurface({
        content: renderInviteLoadRecovery({ pending: inviteLoadState.status === "loading", kind: inviteLoadState.kind, loadingKey: `invitation-load:${inviteLoadState.requestId}`, homeHref: buildHomeHash(getCurrentFlyoutState()) }),
        background: renderGameViewSkeleton(),
      });
    } else if (!routeHydrated) {
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
      if(currentMain && nextMain){if(!replaceMainPreservingHeader(currentMain,nextMain))currentMain.replaceWith(nextMain);updateMountedFlyouts();}
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
  if(currentRoute.name==='game' && activeResultGameId===currentRoute.gameId){destroyMountedBoardRuntime();resultPresentation.mount(appEl.querySelector('.game-result'),currentRoute.gameId);if(!hadResultView)appEl.querySelector('.game-result h1')?.focus({preventScroll:true});return;}
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
        animatePanels,
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

const routeReadKey = hash => {
  // Ignore only utility parameters; retain token, role, panel and unknown inputs.
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  for (const key of FLYOUT_KEYS) params.delete(key);
  const text = params.toString();
  return `${path}${text ? `?${text}` : ""}`;
};
const captureRouteRead = () => {
  // A queued authority refresh can run after the URL changes but before the
  // browser delivers hashchange. Keep the read and its deduplication key on
  // the same URL instead of sharing an old route's work under the new hash.
  const hash = window.location.hash;
  const read = {
    generation: account.snapshot().generation,
    hash,
    routeKey: routeReadKey(hash),
    owner: transport,
    route: parseRouteFromHash(hash),
    inputs: JSON.stringify(getVisibleHomeSectionKeys().map(key => [key, getHomeSection(key).page, getHomeSectionVisiblePageSize(key), getHomeSectionColumnCount(key)])),
  };
  read.epoch = hydrateRoute.observe(read);
  return read;
};
const routeReadIsCurrent = read => {
  const current = captureRouteRead();
  return read.generation === current.generation && read.routeKey === current.routeKey && read.owner === current.owner && read.epoch === current.epoch;
};
const assertCurrentRouteRead = (read, isActive = () => true) => {
  if (!routeReadIsCurrent(read) || !isActive()) throw Object.assign(new Error("session_changed"), { code: "session_changed" });
};
const syncRouteDataAndLiveChannels = (read = captureRouteRead()) => {
  return hydrateRoute(read, async isActive => {
    assertCurrentRouteRead(read, isActive);
    if (read.route.name === "home") await syncHomeSections();
    if (read.route.name === "game") {
      resolvedInvite = null;
      await read.owner.loadGame(read.route.gameId, { openAsViewer: false });
    }
    if (read.route.name === "invite") {
      const invite = await read.owner.resolveInvite(read.route.inviteToken);
      assertCurrentRouteRead(read, isActive);
      // Keep validated invitation routing metadata even if its board requires an
      // upgrade. It identifies the recovery fence without trusting a snapshot.
      resolvedInvite = invite;
      await read.owner.loadGame(invite.gameId, { openAsViewer: false });
      assertCurrentRouteRead(read, isActive);
    }
    assertCurrentRouteRead(read, isActive);
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
  } catch (error) {
    if (accountContinuation === pending && routeReadIsCurrent(pending)) {
      pending.running = false;
      accountContinuationError = true;
      accountContinuationIncidentId = issueDiagnostics.capture("account-continuation", { ...error?.diagnosticEvidence, operation: "account_continuation", stage: "route_read_failed", code: error?.code ?? "unavailable", status: error?.status ?? null, gameId: pending.route?.gameId });
      render({ animatePanels: false, includeBoard: false });
    }
    return;
  }
  if (accountContinuation !== pending || !routeReadIsCurrent(pending)) return;
  // Claim before invoking the original action. A failed write is never replayed.
  accountContinuation = null;
  accountContinuationError = false;
  issueDiagnostics.resolve("account-continuation");
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
  issueDiagnostics.resolve("account-continuation");
};

const canHydrateRouteFromLocalState = (route = currentRoute) => {
  if (route?.name !== "game" || !route?.gameId) {
    return false;
  }
  return Boolean(transport.getGameViewModel(route.gameId));
};

const startRouteSync = ({ renderStart = true } = {}) => {
  const requestId = ++routeSyncRequestId;
  const read = captureRouteRead();
  const retrying = read.route.name === "invite" && inviteLoadState?.status === "error" && routeReadIsCurrent(inviteLoadState.read);
  inviteLoadState = read.route.name === "invite" ? { read, requestId, status: "loading", retrying, kind: "retry" } : null;
  resolvedInvite = null;
  routeHydrated = false;
  syncLiveChannels();
  if (renderStart) {
    render({ animatePanels: false, includeBoard: false });
  }
  void (async () => {
    try {
      await syncRouteDataAndLiveChannels(read);
      if (requestId === routeSyncRequestId && routeReadIsCurrent(read)) {
        inviteLoadState = null;
        issueDiagnostics.resolve("invite-load");
      }
    } catch (error) {
      if (requestId !== routeSyncRequestId || !routeReadIsCurrent(read)) return;
      window.__righeltLastError = error instanceof Error ? error.message : String(error);
      if (read.route.name === "invite" && error?.code !== "upgrade_required") {
        resolvedInvite = null;
        inviteLoadState = { read, requestId, status: "error", retrying: false, kind: invitationLoadFailureKind(error) };
        issueDiagnostics.capture("invite-load", { ...error?.diagnosticEvidence, operation: "invitation_lookup", stage: "route_read_failed", code: error?.code ?? "unavailable", status: error?.status ?? null });
      } else inviteLoadState = null;
    } finally {
      if (requestId !== routeSyncRequestId || !routeReadIsCurrent(read)) return;
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
    gameSound.observe(payload,{silent:context.initial || currentRoute.name!=='game' || payload?.game?.id!==currentRoute.gameId || Boolean(transport.getGameViewModel(currentRoute.gameId)?.inHistoryMode) || Boolean(replayController?.snapshot()?.playing || replayRequests.snapshot())});
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
let activeStorageGeneration = account.snapshot().storageGeneration;
let syncStore = makeAccountSyncStore(account.snapshot());
let transport = syncStore;
mountLoadingFeedback(document,{
  getScope:loadingContextScope,
  onContextsChange:contexts=>{
    slowLoadingContexts=contexts;
    // Patch only an already-mounted header. The next ordinary render consumes
    // current descriptors when no header exists, without a full render loop.
    if(updateMountedHeader())syncRenderedMarkupSnapshot();
  },
});
const currentReplayContext = () => {
  const gameId=getCurrentViewedGameId(),game=transport.getAuthoritativeGame(gameId);
  return {owner:transport,scope:viewingScope(),gameId,revision:game?.gameplayRevision,lineageHead:game?.moves?.filter(move=>!move.undone).at(-1)?.moveId ?? null,visible:!document.hidden};
};
const startComputerReplay = async () => {
  const context=currentReplayContext(),{gameId,owner,revision,lineageHead}=context;
  const game=owner.getAuthoritativeGame(gameId),completed=latestOpponentTurn(game,{identityId:owner.getIdentityId()});
  if (!completed || replayController?.snapshot().playing) return;
  const token=replayRequests.begin(context);
  const stillCurrent=()=>replayRequests.current(token,currentReplayContext());
  let moves=game.moves;
  let payload=buildTurnReplay({moves,completedTurnIndex:completed.turn.index,gameId,revision,lineageHead});
  if (!payload) {
    let entries=[],cursor=null;
    try {
      do {
        const page=await owner.decisionHistory(gameId,cursor);
        if(!stillCurrent())return;
        entries.push(...page.items);cursor=page.nextCursor;
      } while(cursor);
      moves=activeDecisionLineage(entries);
      payload=buildTurnReplay({moves,completedTurnIndex:completed.turn.index,gameId,revision,lineageHead});
    } catch {replayRequests.fail(token,currentReplayContext());return;}
  }
  if (!stillCurrent()) {replayRequests.reconcile(currentReplayContext());return;}
  if (!payload) {replayRequests.fail(token,currentReplayContext());return;}
  if(!replayRequests.ready(token,currentReplayContext()))return;
  replayController?.destroy();
  const rootEl=appEl.querySelector('[data-testid="game-board-wrap"]');
  if(!rootEl)return;
  replayController=createComputerReplay({rootEl,createAdapter:()=>createEngineBoardAdapter(),reducedMotion:prefersReducedMotion,
    onChange:replay=>{boardRuntime?.setInteractionBlocked(replay.playing);boardRuntime?.refreshStatus();},
    onFinish:()=>{boardRuntime?.setInteractionBlocked(false);boardRuntime?.refreshStatus();appEl.querySelector('[data-board-message-action="replay-computer"]')?.focus({preventScroll:true});}
  });
  try {await replayController.play(payload);} catch {replayController.stop('error');replayRequests.fail(token,currentReplayContext());}
};
const updateComputerUi = () => {
  boardRuntime?.refreshStatus?.();
  const gameId = getCurrentViewedGameId(), game = gameId ? transport.getGameViewModel(gameId) : null;
  const mountedGameId = appEl.querySelector('[data-testid="game-shell"]')?.getAttribute('data-game-id');
  if (game && mountedGameId === game.id) {
    updateReconnectPresentation(game);
    updateRecoveryAnnouncement(game);
  }
  updateParticipantCards(game);
  const alerts=appEl.querySelector('#shell-game-alerts');
  if(alerts && game) {
    const html=renderGameAlertsHtml(game);
    patchNotificationHtml(alerts,html);
    alerts.closest('[data-shell-alert-zone]')?.setAttribute('data-shell-alert-zone',html?'active':'idle');
  }
  const debug = appEl.querySelector('[data-flyout="debug"] .shell-flyout-scroll');
  if (debug) patchToolHtml(debug, renderDebugContent());
};
const computerUiPresentation = createFramePresentation({ render: updateComputerUi, measurementName: COMPUTER_UI_FRAME_MEASURE });
computerSession = createComputerSession({ getContext: () => {
  const state = account.snapshot(), gameId = currentRoute.name === 'game' ? currentRoute.gameId : null;
  return { transport, game: gameId ? transport.getAuthoritativeGame(gameId) : null, accountGeneration: state.generation, authenticated: account.canPlay(), canAnalyze: state.session.authenticated, visible: !document.hidden && Boolean(gameId) };
}, onChange: ({ presentation } = {}) => {
  if (presentation === COMPUTER_PRESENTATION.progress) computerUiPresentation.schedule();
  else { computerUiPresentation.cancel(); updateComputerUi(); }
} });
document.addEventListener('visibilitychange', () => {
  if(document.hidden) { replayRequests.cancel(); computerUiPresentation.cancel(); }
  else computerUiPresentation.schedule();
  void computerSession.tick();
});
window.addEventListener('pagehide', () => { computerSession.suspend(); computerUiPresentation.cancel(); });
window.addEventListener('hashchange', () => { queueMicrotask(() => { void computerSession.tick(); }); });

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
    if(!option){setInviteFeedback('That seat is taken. You can still invite someone to watch.');return;}
    issueDiagnostics.resolve(`invite:${gameId}`);
    if(role !== "viewer") preparedPlayerInvitations.set(gameId, role);
    const hash=buildInviteHash(option.token,getCurrentFlyoutState());
    const link=`${window.location.origin}${window.location.pathname}${hash}${hash.includes('?')?'&':'?'}as=${role}`;
    window.__righeltLastInvite=link;
    try { await navigator.clipboard.writeText(link);if(!active())return;inviteFallback=null;setInviteFeedback('Link copied! Ready to share.'); }
    catch { if(!active())return;inviteFallback={gameId,link};setInviteFeedback('Copy the link below to share it.'); }
  }catch(error){if(active()){ issueDiagnostics.capture(`invite:${gameId}`, { gameId, operation: 'create_invite', stage: 'failed', code: error.code ?? 'unavailable' }); setInviteFeedback('We couldn’t create your invite link. Please try again.'); }}
};
const renderHostInvite = game => renderInvitationSurface({host:true,background:renderGameContent(game.id),content:`
  <button class="ui-icon-button invite-close" data-action="close-invite" aria-label="Close invite">${icon('close')}</button>
  <p class="small invite-gate-kicker">Your game is ready</p><h2 id="invite-surface-title">Invite a friend</h2>
  <p>Copy a link and send it their way.</p>
  <div class="invite-choice-list">${invitationOptions(game).filter(option=>option.role!=="viewer").map(option=>`<button data-action="share-invite" data-invite-role="${option.role}" data-game-id="${escapeHtml(game.id)}"${renderButtonStateAttributes({className:`invite-action invite-${option.role}${option.role==='viewer'?' secondary':''}`,pendingKey:getCopyInviteButtonKey(game.id)})}>${icon('copy')}${option.label}</button>`).join('')}</div>
  ${renderInviteFeedback("invite-modal")}
  ${inviteFallback?.gameId===game.id?`<input class="invite-link-field" aria-label="Invitation link" value="${escapeHtml(inviteFallback.link)}" readonly>`:''}
`});
const openFriendInvite = gameId => {
  hostInvite={...createHostInvitation(transport.getGameViewModel(gameId),account.snapshot().generation),gameId};inviteVisit++;inviteFeedback='';inviteFallback=null;
  // A render while hash navigation is pending still sees Home and cancels
  // the game-entry transition. Let the destination render own its invitation.
  if(currentRoute.name === 'game' && currentRoute.gameId === gameId) render({animatePanels:false});
  window.requestAnimationFrame(() => {
    if(currentRoute.name !== 'game' || currentRoute.gameId !== gameId || hostInvite?.gameId !== gameId) return;
    window.scrollTo({top:0,behavior:'instant'});
    document.querySelector('[data-host-invite] [data-action="share-invite"]')?.focus({preventScroll:true});
  });
};
const preparation = createComputerPreparation({ onChange: () => { storyDialog.refresh(); rematchDialog.refresh(); branchDialog.refresh(); } });
const getComputerReadiness = (owner = 'intro') => typeof Worker !== 'function' || typeof WebAssembly !== 'object'
    ? { state: 'unavailable', message: 'Computer play isn’t available in this browser' }
    : preparation.snapshot(owner);
const prepareOpponent = (owner, opponent) => {
  if (!COMPUTER_PROFILES[opponent]) { preparation.cancel(owner); return; }
  if (getComputerReadiness(owner).state !== 'unavailable' && !document.hidden) return preparation.start(owner);
};
const readinessForChoice = (owner, opponent) => COMPUTER_PROFILES[opponent] ? getComputerReadiness(owner) : { state: 'ready', message: '' };
const rematchDialog = createRematchDialog({createModal,getReadiness:opponent=>readinessForChoice('rematch',opponent),onOpponentChange:opponent=>prepareOpponent('rematch',opponent),onRetry:opponent=>prepareOpponent('rematch',opponent),onClose:()=>preparation.cancel('rematch'),onStart:async({opponent,side},{isCurrent})=>{
  if(!await waitForAccountGate() || !isCurrent())return;
  if(!account.canPlay())throw new Error('Sign in to start another game.');
  if(readinessForChoice('rematch',opponent).state!=='ready')throw new Error('Prepare your opponent first.');
  const computer = COMPUTER_PROFILES[opponent] ? { p1: side === 'p2' ? opponent : null, p2: side === 'p1' ? opponent : null } : undefined;
  const handle=transport.createGame({selfPlayMode:opponent==='self',creatorSide:side,computer,computerModelId:computer?readinessForChoice('rematch',opponent).modelId:undefined});
  rematchDialog.close();activeResultGameId=null;
  startGameEntryRouteTransition(handle.result.id,'game');navigateTo(buildGameHash(handle.result.id,null,getCurrentFlyoutState()));
  if(opponent==='friend')openFriendInvite(handle.result.id);
}});
let pendingBranch = null;
const getBranchReadiness = opponent => {
  const readiness = readinessForChoice('branch',opponent);
  if (readiness.state !== 'ready') return readiness;
  const source = pendingBranch && transport.getGameViewModel(pendingBranch.sourceGameId);
  return source?.sharedMutationsBlocked
    ? { state: 'preparing', message: 'Updating this game' }
    : readiness;
};
const branchDialog = createRematchDialog({ createModal, getReadiness:getBranchReadiness, onOpponentChange:opponent=>prepareOpponent('branch',opponent), onRetry:opponent=>prepareOpponent('branch',opponent), onClose:()=>preparation.cancel('branch'), title: 'Create a new game here', labelId: 'branch-title', onStart: async ({ opponent, side }, { isCurrent }) => {
  if (!account.canPlay() || !pendingBranch || !isCurrent()) throw new Error('Sign in to create a game.');
  const readiness = getBranchReadiness(opponent);
  if (readiness.state !== 'ready') throw new Error(readiness.message || 'Prepare your opponent first.');
  const computer = COMPUTER_PROFILES[opponent] ? { p1: side === 'p2' ? opponent : null, p2: side === 'p1' ? opponent : null } : undefined;
  const handle = transport.launchHistoryBranch({ ...pendingBranch, creatorSide: side, selfPlayMode: opponent === 'self', computer, computerModelId: computer ? readinessForChoice('branch',opponent).modelId : undefined });
  const nextHash = buildGameHash(handle.result.game.id, null, { debug: false, scenarios: false });
  window.open(`${window.location.pathname}${window.location.search}${nextHash}`, '_blank', 'noopener');
  await handle.committed;
  pendingBranch = null;
} });
const opponentSession = createOpponentSession({ preferences:createIntroductionPreferences(storage), getReadiness:()=>getComputerReadiness('intro'), createGame:async(intent,isCurrent)=>{
  if(!await waitForAccountGate() || !isCurrent())throw new Error('Game start cancelled.');
  if(!account.canPlay())throw new Error('Sign in to start your game.');
  if(getComputerReadiness('intro').state!=='ready')throw new Error('Prepare your opponent first.');
  const side = intent.side === 'p2' ? 'p2' : 'p1';
  const handle=transport.createGame({creatorSide:side,computer:{p1:side==='p2'?intent.opponent:null,p2:side==='p1'?intent.opponent:null},computerModelId:getComputerReadiness('intro').modelId});
  await handle.committed;
  if(!isCurrent())return;
  startGameEntryRouteTransition(handle.result.id,currentRoute.name);
  navigateTo(buildGameHash(handle.result.id,null,getCurrentFlyoutState()));
  return handle.result;
} });
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
  }, onRetry:opponent=>prepareOpponent('intro',opponent), onClose:reason=>{preparation.cancel('intro');opponentSession.cancel();if(reason === 'dismiss')gameSound.play('intro-back');},
  onPresentation: () => { const root=document.createElement('div');root.className='story-presentation-board';root.setAttribute('aria-hidden','true');document.body.append(root);const preview=createMiniBoardPreview({rootEl:root,preview:{snapshot:createInitialBoardSnapshot(),previewKey:'intro'},createAdapter:createEngineBoardAdapter});return ()=>{preview.destroy();root.remove();}; },
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {preparation.cancel();resultPresentation.clear();}
  else if (storyDialog.isOpen()) void prepareOpponent('intro',storyDialog.opponent());
  else if (rematchDialog.isOpen()) void prepareOpponent('rematch',rematchDialog.opponent());
  else if (branchDialog.isOpen()) void prepareOpponent('branch',branchDialog.opponent());
});
window.addEventListener('pagehide', () => {preparation.cancel();resultPresentation.clear();});

document.addEventListener('toggle', event => {
  const key = event.target?.dataset?.debugSection;
  if (!key) return;
  const state = getDecisionDebugState(getCurrentViewedGameId());
  const changed = state.open.has(key) !== event.target.open;
  if (event.target.open) state.open.add(key); else state.open.delete(key);
  if (changed && event.target.open && key === 'position') updateComputerUi();
}, true);
document.addEventListener('input', event => {
  const field = event.target?.dataset?.debugNote;
  if (!field) return;
  const state = getDecisionDebugState(getCurrentViewedGameId()), id = event.target.dataset.decisionId;
  const note = { ...(state.drafts.get(id) ?? state.notes.find(note => note.decisionId === id) ?? { text: '', flagged: false }) };
  note[field] = field === 'flagged' ? event.target.checked : event.target.value;
  state.drafts.set(id, note);
});
document.addEventListener('change', event => {
  if (!event.target?.matches?.('[data-debug-filter]')) return;
  getDecisionDebugState(getCurrentViewedGameId()).flaggedOnly = event.target.checked; updateComputerUi();
});
const loadDebugHistory = async (gameId, more = false) => {
  const owner = transport, generation = account.snapshot().generation, state = getDecisionDebugState(gameId);
  const [page, personal] = await Promise.all([owner.decisionHistory(gameId, more ? state.cursor : null), account.snapshot().session.authenticated ? owner.decisionNotes(gameId) : { notes: [] }]);
  if (owner !== transport || generation !== account.snapshot().generation) return;
  state.items = more ? [...state.items, ...page.items] : page.items;
  state.loaded = true; state.cursor = page.nextCursor; state.partial = page.partial; applyDecisionNotes(state, personal.notes); updateComputerUi();
};

const destructionTransitions = createDestructionTransitions();
const maybeReturnAfterUndo = gameId => {
  if (currentRoute.name !== 'game' || currentRoute.gameId !== gameId) return;
  if (!viewingIntent.observeUndo(gameId, transport.getAuthoritativeGame(gameId), viewingScope())) return;
  boardRuntime?.clearSelection();
  mountedOverlayKey=null;
  transport.returnToLive({gameId});
  if (getShellLayoutMode() === 'narrow') navigateTo(buildGameHash(gameId,null,getCurrentGameHashState('board')));
};
const subscribeToTransport = () => transport.subscribe((change) => {
  branchDialog.refresh();
  const liveReplayGame = transport.getAuthoritativeGame(getCurrentViewedGameId());
  replayRequests.reconcile(currentReplayContext());
  replayController?.reconcile({gameId:liveReplayGame?.id,revision:liveReplayGame?.gameplayRevision,lineageHead:liveReplayGame?.moves?.filter(move=>!move.undone).at(-1)?.moveId ?? null});
  if (change?.gameId) maybeReturnAfterUndo(change.gameId);
  if (currentRoute.debug && currentRoute.gameId && !getDecisionDebugState(currentRoute.gameId).loaded && !getDecisionDebugState(currentRoute.gameId).loading) {
    const state = getDecisionDebugState(currentRoute.gameId); state.loading = true;
    void loadDebugHistory(currentRoute.gameId).catch(error => { state.error = error.message; state.loaded = true; }).finally(() => { state.loading = false; });
  }
  queueMicrotask(() => { void computerSession?.tick(); });
  gameSound.local(change, transport.getGameViewModel(change?.gameId), {silent:currentRoute.name!=='game' || currentRoute.gameId!==change?.gameId || Boolean(transport.getGameViewModel(change?.gameId)?.inHistoryMode)});
  const visibleGameId = getCurrentViewedGameId();
  const game = transport.getGameViewModel(visibleGameId);
  let releaseInvitationFocus = false;
  if (hostInvitationSettled(hostInvite,transport.getAuthoritativeGame(visibleGameId),account.snapshot().generation)) {
    releaseInvitationFocus = Boolean(document.activeElement?.closest('[data-host-invite]') || document.activeElement === document.body);
    hostInvite=null;inviteVisit++;inviteFeedback="";inviteFallback=null;
  }
  const frozenCapture = Boolean(currentRoute.scenarios && scenarioCapture?.mode === 'frozen' && scenarioCapture.gameId === visibleGameId);
  const transition = destructionTransitions.update(game, { frozen: frozenCapture, reset: change?.baseline === true || change?.type === "optimistic_rollback" || change?.type === "history_mode_changed" });
  if (transition.clear) boardRuntime?.clearRemovalEffects();
  render({
    animatePanels: false,
    includeBoard: change?.type !== "optimistic_enqueue",
  });
  if (mountedBoardGameId === visibleGameId && !game?.inHistoryMode && !frozenCapture) boardRuntime?.showRemovalEffects(transition.effects, null);
  if (releaseInvitationFocus) {
    const generation=account.snapshot().generation;
    window.requestAnimationFrame(()=>{
      if(generation===account.snapshot().generation && getCurrentViewedGameId()===visibleGameId && !hostInvite)
        document.querySelector('#shell-board .cell')?.focus({preventScroll:true});
    });
  }
});

subscribeToTransport();
accountInitialized = true;
function resetAccountTransport(next) {
  inviteLoadState = null;
  if (currentRoute.name === "invite") resolvedInvite = null;
  joinFeedback.clear();
  additionalHistory.clear();
  utilityMemory.clear(); expandedViewerGames.clear(); expandedComputerCards.clear();
  viewingIntent.clear();
  replayController?.stop("account-changed");
  preparation.cancel();
  computerSession?.suspend(); scenarioCapture = null; scenarioMetadataDrafts.clear(); decisionDebugStates.clear();
  const storageChanged=Boolean(activeStorageGeneration && next.storageGeneration!==activeStorageGeneration);
  activeStorageGeneration=next.storageGeneration;
  if(storageChanged){storageResetPending=true;storageResetNotice=true;resolvedInvite=null;}
  clearAccountContinuation();
  resultTransitions.clear();resultPresentation.clear();activeResultGameId=null;pendingResultReviewFocus=null;rematchDialog.close();branchDialog.close();pendingBranch=null;
  hostInvite=null;inviteVisit++;inviteFeedback="";inviteFallback=null;preparedPlayerInvitations.clear();
  gameSound.leaveGame();storyDialog.close();inlineProfiles.close();
  const gameId = getCurrentViewedGameId();
  const visible = gameId && !storageChanged ? transport.getAuthoritativeGame?.(gameId) : null;
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
  preparePanelTransition(currentRoute, nextRoute);
  const nextHash = buildHashForRoute(nextRoute);
  const previousRoute = currentRoute;
  closeHeaderMenu();
  if (window.location.hash === nextHash) {
    if (previousRoute.name === "tutorial" && (nextRoute.name !== "tutorial" || nextRoute.gameId !== previousRoute.gameId)) retireTutorialSave();
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
  joinFeedback.clear();
  clearAccountContinuation();
  const previousRoute = currentRoute;
  closeHeaderMenu();
  const parsedRoute = parseRouteFromHash(window.location.hash);
  if(parsedRoute.name!=='game' || parsedRoute.gameId!==currentRoute.gameId)gameSound.leaveGame();
  if(hostInvite && (parsedRoute.name!=='game' || parsedRoute.gameId!==hostInvite.gameId)){hostInvite=null;inviteVisit++;}
  inlineProfiles.close();
  if(parsedRoute.gameId!==previousRoute.gameId){resultPresentation.clear();activeResultGameId=null;pendingResultReviewFocus=null;rematchDialog.close();}
  if (previousRoute.name === "tutorial" && (parsedRoute.name !== "tutorial" || parsedRoute.gameId !== previousRoute.gameId)) retireTutorialSave();
  const enteringRoute = normalizeRouteFlyoutState(parsedRoute);
  preparePanelTransition(previousRoute, enteringRoute);
  currentRoute = enteringRoute;
  if(previousRoute.name !== 'game' && currentRoute.name === 'game' && !routeTransition)gameSound.play('enter');
  else if(previousRoute.name === 'game' && currentRoute.name !== 'game' && (currentRoute.name !== 'home' || prefersReducedMotion()))gameSound.play('leave');
  if(previousRoute.name === 'game' && currentRoute.name === 'home') {
    gameSound.cancelPreview();restoreHomePending=true;
    startGameEntryRouteTransition(previousRoute.gameId,'game','home');
  } else if(previousRoute.name === 'home' && currentRoute.name === 'game') {
    window.scrollTo({top:0,behavior:'instant'});
  }
  syncRouteTransitionForCurrentRoute();
  // Observe before normalization or cached fast paths can skip hydration.
  const previousRouteEpoch = hydrateRoute.currentEpoch();
  const routeReadChanged = captureRouteRead().epoch !== previousRouteEpoch;
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
  if (!routeReadChanged && isFlyoutOnlyRouteChange(previousRoute, currentRoute)) {
    if (currentRoute.name === "home" && previousRoute.debug !== currentRoute.debug) {
      startRouteSync({ renderStart: false });
      return;
    }
    render();
    return;
  }
  startRouteSync();
});

let previousLayoutMode = getShellLayoutMode();
window.addEventListener("resize", () => {
  const layout = getShellLayoutMode();
  if (layout !== previousLayoutMode) {
    previousLayoutMode = layout;
    if (layout === 'narrow' && currentRoute.name === 'game' && transport.getGameViewModel(currentRoute.gameId)?.inHistoryMode) {
      currentRoute = {...currentRoute,panel:'history'};
      window.history.replaceState(null,'',buildHashForRoute(currentRoute));
    }
    render({animatePanels:false});
  }
  const normalized = normalizeRouteFlyoutState(currentRoute, { preferredFlyoutKey: flyoutRenderOrder.at(-1) });
  if (FLYOUT_KEYS.some(key => Boolean(normalized[key]) !== Boolean(currentRoute[key]))) {
    currentRoute = normalized;
    saveDebugFlyoutOpen(storage, Boolean(currentRoute.debug));
    window.history.replaceState(null, "", buildHashForRoute(currentRoute));
    render({ animatePanels: false, includeBoard: false });
  }
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
let utilityCloseFlight = null;
const closeUtilityFlyouts = () => utilityCloseFlight ||= (async () => {
  const surfaces = [...appEl.querySelectorAll('.shell-flyout.is-open')];
  if (!surfaces.length) return;
  gameSound.play('flyout-back');
  surfaces.forEach(el => el.classList.add('is-closing'));
  if (!prefersReducedMotion()) await delay(FLYOUT_MOTION_MS);
  saveDebugFlyoutOpen(storage, false);
  currentRoute = {...currentRoute, debug:false, scenarios:false};
  flyoutRenderOrder = [];
  window.history.replaceState(null, '', buildHashForRoute(currentRoute));
  render({animatePanels:false,includeBoard:false});
})().finally(() => { utilityCloseFlight = null; });
// Passive page space dismisses utilities. Links, buttons, form fields, board
// cells and other actionable content keep their own click and current state.
appEl.addEventListener('click', event => {
  if (!isPassivePageClick(event)) return;
  if (accountDialog.isOpen() && accountDialog.element.dataset.presentation === 'flyout') void accountDialog.close();
  else void closeUtilityFlyouts();
});
appEl.addEventListener("click", async (event) => {
  const inspectionControl = event.target.closest('[data-board-inspection]');
  if (inspectionControl) { event.preventDefault(); if(replayController?.snapshot().playing)return; boardRuntime?.toggleNetworkInspection(inspectionControl.dataset.boardInspection); return; }
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
  if (action === "retry-invite-load") {
    if (currentRoute.name === "invite" && inviteLoadState?.status === "error" && inviteLoadState.kind === "retry" && routeReadIsCurrent(inviteLoadState.read)) startRouteSync();
    return;
  }
  if (action === "toggle-diagnostic" || action === "copy-diagnostic" || action === "dismiss-diagnostic") {
    event.stopPropagation();
    await handleDiagnosticAction(actionEl);
    const id = actionEl.dataset.incidentId;
    const diagnostic = actionEl.closest(".issue-diagnostic");
    if (action === "dismiss-diagnostic") { diagnostic?.remove(); render({ animatePanels: false, includeBoard: false }); return; }
    if (diagnostic) { const scope = diagnostic.dataset.diagnosticScope; diagnostic.outerHTML = renderDiagnosticDisclosure(id, scope); appEl.querySelector(`[data-incident-id="${id}"][data-diagnostic-scope="${scope}"] [data-action="${action}"]`)?.focus({ preventScroll: true }); }
    return;
  }
  if (action === "clear-diagnostics") { issueDiagnostics.clear(); render({ animatePanels: false }); return; }
  const actionGameId = actionEl.getAttribute("data-game-id") || currentRoute.gameId;
  if (action === "refresh-game") { window.location.reload(); return; }
  if (action === "reconnect-safely") { void transport.reconnectSafely(actionGameId).catch(() => {}); return; }
  if (action === "toggle-viewers") {
    const gameId=actionEl.dataset.gameId;
    if(expandedViewerGames.has(gameId))expandedViewerGames.delete(gameId);else expandedViewerGames.add(gameId);
    render({animatePanels:false,includeBoard:false});return;
  }
  if (action === "public-profile") { void inlineProfiles.open(actionEl.getAttribute("data-username"), actionEl); return; }
  if (action === "retry-account-continuation") { void retryAccountContinuation(); return; }
  if (action === "retry-account-startup") { if (accountStartupError.includes("refresh")) window.location.reload(); else void initialRender(); return; }
  if (action === "account-open") {
    if (accountDialog.isOpen()) { void accountDialog.close(); return; }
    await closeUtilityFlyouts();
    accountDialog.open(account.snapshot().session.authenticated ? "account" : "login", null, appEl.querySelector('[data-action="account-open"]')); return;
  }
  if (action === "open-debug" || action === "open-scenarios") {
    if (utilityCloseFlight) await utilityCloseFlight;
    if (accountDialog.isOpen() && !await accountDialog.close()) return;
    const otherKey = action === "open-debug" ? "scenarios" : "debug";
    if (currentRoute[otherKey]) await closeUtilityFlyouts();
  }
  const accountGatedActions = new Set(["create-game","create-self-play","rematch","join-player","accept-invite-player","play-as-both-players","load-scenario","launch-history-branch","computer-watch","computer-control","debug-analyze","debug-save-note","computer-branch","debug-branch","debug-delete-note"]);
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
  if (action === "view-result") { if (!getGameResult(transport.getAuthoritativeGame(actionGameId), transport.getIdentityId())) return; resultPresentation.clear();activeResultGameId = actionGameId; render({ animatePanels: false }); return; }
  if (action === "analysis") { resultPresentation.clear();pendingResultReviewFocus = actionGameId; activeResultGameId = null; render({ animatePanels: false }); navigateTo(buildGameHash(actionGameId, null, getCurrentGameHashState("history"))); return; }
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

  if(['load-history-archive','retry-history-archive','inspect-history-archive'].includes(action)) {
    const gameId=actionEl.dataset.gameId;
    if(action==='inspect-history-archive'){
      const entry=additionalHistory.snapshot(gameId)?.items.find(item=>item.id===actionEl.dataset.decisionId);
      if(entry){viewingIntent.navigate(gameId);transport.inspectDecision({gameId,entry});}
    } else {
      const work=action==='retry-history-archive'?additionalHistory.retry(gameId):additionalHistory.more(gameId);
      render({animatePanels:false,includeBoard:false});await work;
    }
    return;
  }
  if (action === 'toggle-computer-card') {
    const gameId=actionEl.dataset.gameId, side=actionEl.dataset.computerSide;
    const open=expandedComputerCards.get(gameId) ?? new Set();
    if(open.has(side))open.delete(side);else open.add(side);
    expandedComputerCards.set(gameId,open); updateParticipantCards(transport.getGameViewModel(gameId));return;
  }
  if (action === 'toggle-viewers') {
    const gameId=actionEl.dataset.gameId;
    if(expandedViewerGames.has(gameId))expandedViewerGames.delete(gameId);else expandedViewerGames.add(gameId);
    updateParticipantCards(transport.getGameViewModel(gameId));return;
  }
  if (action === 'computer-control') { await withPendingButton(`computer:${actionEl.dataset.control}`, () => computerSession.action(actionEl.dataset.control)); return; }
  if (action === 'computer-watch') {
    const handle = transport.createGame({ selfPlayMode: true, computer: { p1: 'babs', p2: 'horus' } });
    await handle.committed; navigateTo(buildGameHash(handle.result.id, null, getCurrentFlyoutState())); return;
  }
  if (action.startsWith('debug-') && action !== 'debug-branch') {
    const gameId = getCurrentViewedGameId(), game = gameId ? transport.getGameViewModel(gameId) : null;
    const state = getDecisionDebugState(gameId), selected = game?.inspectedDecision ?? (game?.inHistoryMode ? game.moves.find(move => move.index === game.historyIndex) : game?.moves.at(-1));
    try {
      if (action === 'debug-load-attempts') {
        const kind = actionEl.dataset.kind, page = state.attemptPages[kind];
        if (!page) return;
        const result = await transport.decisionAttempts(gameId, kind, page.cursor);
        page.items = page.cursor ? [...page.items, ...result.items] : result.items; page.cursor = result.nextCursor;
      }
      if (action === 'debug-analyze' && game) await computerSession.analyze(game.currentSnapshot, selected?.moveId ?? 'initial');
      if (action === 'debug-cancel-analysis') computerSession.cancelAnalysis();
      if (action === 'debug-load-history' && game) { await loadDebugHistory(gameId, Boolean(state.cursor)); render({ animatePanels: false, includeBoard: false }); }
      if (action === 'debug-inspect-decision') {
        const entry = state.items.find(entry => entry.id === actionEl.dataset.decisionId);
        if (entry) { viewingIntent.navigate(gameId); transport.inspectDecision({ gameId, entry }); }
      }
      if (action === 'debug-save-note' || action === 'debug-delete-note') {
        const id = actionEl.dataset.decisionId, note = state.drafts.get(id) ?? state.notes.find(note => note.decisionId === id) ?? { text: '', flagged: false };
        const result = await transport.decisionNotes(gameId, { operation: 'write', decisionId: id, note: action === 'debug-delete-note' ? null : note });
        if (state.drafts.get(id) === note) state.drafts.delete(id);
        applyDecisionNotes(state, result.notes);
      }
      if (action === 'debug-load-attempt' && selected?.computerProof) {
        const result = await transport.decisionAttempt(gameId, { attemptId: selected.computerProof.attemptId, kind: 'computer' });
        state.attempts.set(selected.computerProof.attemptId, result.attempt ?? { evidence: 'unavailable' });
      }
      if (action === 'debug-copy') await navigator.clipboard.writeText(JSON.stringify(game?.currentSnapshot, null, 2));
      if (action === 'debug-export' && game) {
        const owner = transport, generation = account.snapshot().generation;
        const currentAnalysis = computerSession.snapshot().analysis;
        const analysis = currentAnalysis?.gameId === gameId ? structuredClone(currentAnalysis) : null;
        let cursor = null, entries = [];
        do { const page = await owner.decisionHistory(gameId, cursor); entries.push(...page.items); cursor = page.nextCursor; } while (cursor);
        const personal = account.snapshot().session.authenticated ? await owner.decisionNotes(gameId) : { notes: [] };
        if (owner !== transport || generation !== account.snapshot().generation) return;
        const attempts = [], analyses = [];
        if (account.canPlay()) for (const kind of (account.snapshot().session.authenticated ? ['computer', 'analysis'] : ['computer'])) {
          let after = null;
          do {
            const page = await owner.decisionAttempts(gameId, kind, after);
            (kind === 'computer' ? attempts : analyses).push(...page.items); after = page.nextCursor;
            if (owner !== transport || generation !== account.snapshot().generation) return;
          } while (after);
        }
        if (owner !== transport || generation !== account.snapshot().generation) return;
        const data = { attempts, analyses, gameId, exportedAt: new Date().toISOString(), selectedDecisionId: selected?.moveId, entries, notes: personal.notes, analysis };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `${gameId}-evidence.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      state.error = null;
    } catch (error) { state.error = error.message || 'Could not complete this action. Try again.'; }
    updateComputerUi(); return;
  }

  if(action==='close-invite'){closeFriendInvite();return;}
  if(action==='share-invite'){await withPendingButton(getCopyInviteButtonKey(actionEl.dataset.gameId),()=>copyGameInvitation(actionEl.dataset.gameId,actionEl.dataset.inviteRole,true));return;}
  if (action === 'guest-profile') { void inlineProfiles.open(null,actionEl);return; }
  if (action === 'toggle-sound') { const enabled=gameSound.toggle();actionEl.innerHTML=icon(enabled?'sound':'muted');actionEl.setAttribute('aria-label',enabled?'Mute sound':'Enable sound');actionEl.setAttribute('aria-pressed',String(enabled));actionEl.title=`Sound ${enabled?'on':'off'}`;return; }
  if (action === 'opponent-story') {
    // Initial session adoption retires dialogs. Open only after it settles.
    if (!await waitForAccountGate()) return;
    gameSound.play('intro'); storyDialog.open(actionEl.dataset.opponent,{trigger:actionEl}); void prepareOpponent('intro',actionEl.dataset.opponent); return;
  }
  if (action === "create-game" || action === 'create-self-play') {
    if(action === 'create-game'){gameSound.play('intro');storyDialog.open('friend',{trigger:actionEl});return;}
    const handle = transport.createGame({ selfPlayMode: action === 'create-self-play' });
    startGameEntryRouteTransition(handle.result.id, "home");
    navigateTo(buildGameHash(handle.result.id, null, getCurrentFlyoutState()));
    if(action==='create-game') openFriendInvite(handle.result.id,actionEl);
    return;
  }

  if (action === "launch-history-branch" || action === 'computer-branch' || action === 'debug-branch') {
    const gameId = actionEl.dataset.gameId || currentRoute.gameId;
    const game = transport.getGameViewModel(gameId);
    if (!game) return;
    const moveIndex = Number.parseInt(actionEl.dataset.moveIndex ?? '-1', 10);
    const decisionId = actionEl.dataset.decisionId;
    const entry = decisionId ? getDecisionDebugState(gameId).items.find(entry => entry.id === decisionId) : null;
    const selected = decisionId ? entry?.move ?? game.moves.find(move => move.moveId === decisionId) ?? (game.inspectedDecision?.moveId === decisionId ? game.inspectedDecision : null) : (game.inspectedDecision ?? game.moves[moveIndex]);
    const authoritative = transport.getAuthoritativeGame(gameId) ?? game;
    const state = selected?.selectionSnapshot ?? entry?.state ?? authoritative.board.state;
    pendingBranch = {
      sourceGameId: gameId, sourceDecisionId: decisionId ?? selected?.moveId ?? null,
      sourceGameplayRevision: authoritative.gameplayRevision,
      scenario: { resultingState: structuredClone(state) }, initialSelectionAction: selected?.action ?? null,
    };
    branchDialog.open({ opponent: 'self', rematchSide: String(state.sideToMove).toLowerCase() === 'p2' ? 'p2' : 'p1' }, actionEl);
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
    const undoTransport = transport, undoAccountGeneration = account.snapshot().generation;
    const undoScopeIsCurrent = () => transport === undoTransport && account.snapshot().generation === undoAccountGeneration && getCurrentViewedGameId() === gameId;
    const game = transport.getGameViewModel(gameId);
    const undoToken = viewingIntent.beginUndo(gameId, {targetMoveId:moveId,revision:game.gameplayRevision,scope:viewingScope()});
    const computerUndo = Boolean(game?.computer && game.canControlComputer);
    const revert = async () => {
      if (!undoScopeIsCurrent()) return false;
      let targetMoveId = moveId;
      if (computerUndo) {
        await computerSession.action('pause');
        if (!undoScopeIsCurrent()) return false;
        if (action === 'undo-last-move' && !game.computer.manual) {
          const entries = [];
          let cursor = null;
          do { const page = await undoTransport.decisionHistory(gameId, cursor); entries.push(...page.items); cursor = page.nextCursor; } while (cursor);
          const human = activeDecisionLineage(entries).filter(move => !move.computerProof).at(-1);
          if (!human) return false;
          targetMoveId = human.moveId;
        }
      }
      if (!undoScopeIsCurrent()) return false;
      undoToken.targetMoveId = targetMoveId;
      const handle = undoTransport.requestRevertToMove({ gameId, targetMoveId });
      void handle.committed.then(() => { viewingIntent.commitUndo(gameId, undoToken); maybeReturnAfterUndo(gameId); }, () => viewingIntent.cancelUndo(gameId, undoToken));
      if (computerUndo) await handle.committed;
      return true;
    };
    // Keep automatic control work fenced until the undo response is applied;
    // the server drops its lease before that acknowledgement reaches us.
    let reverted;
    try { reverted = computerUndo ? await computerSession.withMutation(revert) : await revert(); }
    catch {
      viewingIntent.cancelUndo(gameId, undoToken);
      if (undoScopeIsCurrent()) setUndoRequestFeedback(gameId, "Undo could not finish");
      return;
    }
    if (computerUndo && reverted) {
      if (!undoScopeIsCurrent()) return;
      try {
        await computerSession.tick();
        if (!undoScopeIsCurrent()) return;
        await computerSession.action('resume');
      } catch { /* The undo is accepted. Computer recovery explains an uncertain resume. */ }
    }
    return;
  }

  if (action === "join-viewer" || action === "accept-invite-viewer") {
    if (account.snapshot().enabled && (!account.snapshot().session.authenticated || transport.getGameViewModel(actionGameId)?.ownershipMode === "legacy_guest")) {
      markInviteChoiceCommitted(actionGameId);navigateTo(buildGameHash(actionGameId, null, getCurrentFlyoutState()));return;
    }
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    const joinAttempt=joinFeedback.begin(gameId,{focusAction:document.activeElement===actionEl?action:null});
    void withPendingButton(getJoinButtonKey("viewer", gameId), async () => {
      try {
      await joinAttempt.scope.owner.joinGame({
        gameId,
        mode: "viewer",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      if(!joinFeedback.complete(joinAttempt))return;
      markInviteChoiceCommitted(gameId);
      if (currentRoute.name === "invite" || currentRoute.name === "game") {
        navigateTo(buildGameHash(gameId, null, getCurrentGameHashState(currentRoute.name === "game" ? getGamePanel() : DEFAULT_GAME_PANEL)));
        return;
      }
      await syncRouteDataAndLiveChannels();
      } catch(error) { joinFeedback.fail(joinAttempt);throw error; }
    });
    return;
  }

  if (action === "join-player" || action === "accept-invite-player") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    const joinAttempt=joinFeedback.begin(gameId,{focusAction:document.activeElement===actionEl?action:null});
    void withPendingButton(getJoinButtonKey("player", gameId), async () => {
      try {
      const result = await joinAttempt.scope.owner.joinGame({
        gameId,
        mode: "player",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      if(!joinFeedback.complete(joinAttempt))return;
      markInviteChoiceCommitted(gameId);
      if (result.pendingApproval) {
        setInviteFeedback("");
      }
      if (currentRoute.name === "invite" || currentRoute.name === "game") {
        navigateTo(buildGameHash(gameId, null, getCurrentGameHashState(currentRoute.name === "game" ? getGamePanel() : DEFAULT_GAME_PANEL)));
        return;
      }
      await syncRouteDataAndLiveChannels();
      } catch(error) { joinFeedback.fail(joinAttempt);throw error; }
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
    dismissedRecoveryNotices.set(gameId, presentedRecoveryMessage(transport.getGameViewModel(gameId)));
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

  if (action === "jump-history-turn") {
    const gameId = actionEl.getAttribute('data-game-id');
    const turnIndex = Number(actionEl.getAttribute('data-turn-index'));
    viewingIntent.navigate(gameId);
    await transport.selectHistoryTurn({gameId,turnIndex});
    if (transport.getGameViewModel(gameId)?.historyTurnIndex === turnIndex) gameSound.play("history");
    revealSelectedHistory();
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
    if (transport.getGameViewModel(gameId)?.historyIndex !== moveIndex || !transport.getGameViewModel(gameId)?.inHistoryMode) viewingIntent.navigate(gameId);
    transport.selectHistoryMove({ gameId, moveIndex, moveId:actionEl.getAttribute("data-move-id") || null });
    revealSelectedHistory();
    if(transport.getGameViewModel(gameId)?.inHistoryMode)gameSound.play("history");
    return;
  }

  if (action === "return-live") {
    const gameId = actionEl.getAttribute("data-game-id");
    if (!gameId) return;
    clearHistoryPress();
    playHistoryReleaseBounce(actionEl);
    await animateHistoryDeselection(actionEl);
    viewingIntent.navigate(gameId);
    transport.returnToLive({ gameId });
    if (getShellLayoutMode() === "narrow") navigateTo(buildGameHash(gameId, null, getCurrentGameHashState("board")));
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
    const debugGameId = getCurrentViewedGameId();
    if (debugGameId) void loadDebugHistory(debugGameId).catch(error => { getDecisionDebugState(debugGameId).error = error.message; updateComputerUi(); });
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
    if (currentRoute.name !== "tutorial" || tutorialSaveOwner) return;
    const owner = { visit: tutorialVisit, epoch: account.snapshot().generation };
    tutorialSaveOwner = owner;
    const active = () => tutorialSaveOwner === owner && owner.visit === tutorialVisit && currentRoute.name === "tutorial" && account.snapshot().generation === owner.epoch;
    const gameId = currentRoute.gameId;
    render({ animatePanels: false, includeBoard: false });
    try {
      if (account.snapshot().enabled && account.snapshot().session.authenticated) {
        await account.updateAccount({ preferences: { tutorial: action === "tutorial-complete" ? "completed" : "skipped" } });
      } else if (!account.snapshot().enabled) saveTutorialCompleted(storage, true);
      if (!active()) return;
      tutorialSavingError = null;
      issueDiagnostics.resolve("tutorial-saving");
      tutorial.reset();
      navigateTo(gameId ? buildGameHash(gameId, null, getCurrentFlyoutState()) : buildHomeHash(getCurrentFlyoutState()));
    } catch (error) {
      if (!active()) return;
      const message = "We couldn’t save your lesson progress. Please try again.";
      tutorialSavingError = { message, incidentId: issueDiagnostics.capture("tutorial-saving", { ...latestRequestEvidence("account"), operation: "lesson_progress", stage: "failed", code: error?.code ?? "unavailable" }) };
      window.__righeltLastError = message;
    } finally {
      if (tutorialSaveOwner === owner) { tutorialSaveOwner = null; if (currentRoute.name === "tutorial" && owner.visit === tutorialVisit) render({ animatePanels: false, includeBoard: false }); }
    }
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
    const shouldApplyInPlace = canLoadScenarioInPlace(activeGame, transport.getIdentityId());
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

  if (action === 'begin-scenario-capture' || action === 'end-scenario-capture') {
    if (!canAuthorScenariosLocally()) return;
    const game = getActiveScenarioGame();
    if (action === 'begin-scenario-capture' && game?.historyLoading) return;
    const historyContext = resolveHistoryScenarioExportContext(game);
    boardRuntime?.clearRemovalEffects();
    destructionTransitions.update(game, { reset: true });
    scenarioCapture = action === 'begin-scenario-capture' ? beginScenarioCapture(game, transport.getIdentityId(), historyContext) : null;
    if (scenarioCapture && !historyContext) {
      boardRuntime?.syncInteractionCapabilities?.();
      scenarioCapture.selection = buildSavedSelectionFromRuntimeSelection(boardRuntime?.getSelection?.(), scenarioCapture.snapshot);
    }
    render({ animatePanels: false });
    return;
  }
  if (action === 'edit-scenario-details' || action === 'save-scenario-details') {
    if (!canAuthorScenariosLocally()) return;
    const selected = getSelectedScenario(); if (!selected) return;
    if (action === 'edit-scenario-details') scenarioEditingId = selected.id;
    else {
      const result = await updateSelectedScenarioRecord({ activeGame: getActiveScenarioGame(), title: getScenarioEditableFieldText('title'), description: getScenarioEditableFieldText('description'), includeCurrentBoard: false, feedbackMessage: () => 'Details saved.' });
      if (result.ok) { scenarioEditingId = null; scenarioMetadataDrafts.delete(selected.id); }
    }
    render({ animatePanels: false, includeBoard: false }); return;
  }
  if (action === "update-scenario" || action === "save-scenario") {
    if (!scenarioCapture) return;
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
        { renderEnd: true },
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
      { renderEnd: true },
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
    if (getSelectedScenario()) scenarioMetadataDrafts.set(getSelectedScenario().id, { title: getScenarioEditableFieldText('title'), description: getScenarioEditableFieldText('description') });
    syncScenarioAuthoringControls();
  }
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
  if (target instanceof HTMLElement && target.matches('[role="button"][data-action="jump-history"], [role="button"][data-action="jump-history-turn"]') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); target.click(); return;
  }
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

mobileNavigation = mountMobileNavigation({window,document,isNarrow:()=>currentRoute.name==='game' && getShellLayoutMode()==='narrow',isBlocked:()=>Boolean(document.querySelector('dialog[open]'))});
mobileNavigation.reveal();

let startupFlight = false, startupComplete = false, startupRetryTimer = null, startupRetryDelay = 1000;
const initialRender = async () => {
  if (startupFlight || startupComplete) return;
  clearTimeout(startupRetryTimer);
  startupFlight = true;
  try {
  routeHydrated = false;
  render({ animatePanels: false, includeBoard: false });
  try {
    if (!account.snapshot().ready) await account.start();
    void account.activity(true);
  } catch (error) {
    window.__righeltLastError = error.code || error.message;
    if (error.code === "upgrade_required") {
      try { const key="righelt.auth-refresh"; if(!window.sessionStorage.getItem(key)){window.sessionStorage.setItem(key,"1");window.location.reload();return;} } catch {}
      accountStartupError="Righelt has an update. Refresh to keep playing. Play is unavailable until the update completes.";render({animatePanels:false,includeBoard:false});
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
