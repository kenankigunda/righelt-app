import { assertGameBoardAdapter } from "../board-adapter-contract.js";
import { createEnginePlaygroundBoardAdapter } from "../board-adapters/engine-playground-adapter.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createShellBoardHost } from "../board/hosts/shell-host.js";
import { getBootstrapPayload } from "./bootstrap.js";
import { createLiveTransportStore } from "./live-transport.js";
import { createLiveSyncClient } from "./live-sync.js";
import { saveTutorialCompleted } from "./persistence.js";
import { shouldSkipBoardRuntimeReload } from "./runtime-sync.js";
import {
  buildGameHash,
  buildHomeHash,
  buildInviteHash,
  buildPlaygroundHash,
  buildTutorialHash,
  isShellRootHash,
  parseRouteFromHash,
  shouldLiveSyncRoute,
  shouldPassiveRefreshRoute,
} from "./routes.js";
import { createTutorialController } from "./tutorial.js";

const appEl = document.getElementById("app");
const playgroundAppEl = document.getElementById("playground-app");
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
if (playgroundAppEl) {
  playgroundAppEl.hidden = true;
}
if (appEl) {
  appEl.hidden = false;
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
let mountedSelectionActionKey = null;
let boardRuntime = null;
let busy = false;
let liveSyncConnectedRoute = "";
let wsStatus = { state: "disconnected", scope: null, gameId: null, reconnectAttempts: 0 };
let lastWsStatusKey = toStableKey(wsStatus);
let wsLastEvent = "none";
const WS_RECONCILE_MS = 2000;
let inviteFeedback = "";
let inviteFeedbackTimer = null;
let routeHydrated = false;
let resolvedInvite = null;
const inviteChoiceCommittedByGameId = new Set();
const ignoredApprovalRequests = new Set();
let lastRenderedMarkup = "";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatStatus = (connected) =>
  connected ? '<span class="status-chip live">Connected</span>' : '<span class="status-chip offline">Disconnected</span>';
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

const renderPlaceholderBadge = () => '<span class="status-chip offline">Not yet implemented</span>';

const getCurrentViewedGameId = () => {
  if (currentRoute.name === "game") {
    return currentRoute.gameId;
  }
  if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
    return resolvedInvite.gameId;
  }
  return null;
};

const syncCurrentIdentityPresence = async (connected) => {
  const gameId = getCurrentViewedGameId();
  if (!gameId) {
    return;
  }
  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return;
  }
  const role = game.myRole;
  if (role !== "Player 1" && role !== "Player 2" && role !== "Viewer") {
    return;
  }
  await transport.setParticipantConnected({ gameId, role, connected });
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
  const liveSelectedEmptyTurnIndex =
    !game.inHistoryMode && activeTurnIndex !== null && game.currentTurn?.moveIndexes?.length === 0 ? activeTurnIndex : null;
  const selectedMoveIndex =
    typeof game.historyIndex === "number"
      ? game.historyIndex
      : liveSelectedEmptyTurnIndex !== null
        ? null
        : game.moves.length > 0
          ? game.moves.length - 1
          : null;
  const emptyTurnText = "Waiting on next move...";

  const moveRows = game.turns.flatMap((turn) =>
    turn.moveIndexes
      .map((moveIndex) => game.moves[moveIndex])
      .filter(Boolean)
      .map((move) => {
        const isSelected = game.inHistoryMode ? game.historyIndex === move.index : selectedMoveIndex === move.index;
        const selectedClass = isSelected ? (game.inHistoryMode ? " is-selected" : " is-live-selected") : "";
        return `<li class="history-item${selectedClass}" data-action="jump-history" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}">
          <span class="history-move-line ${playerToneClassForSide(move.actorSide || (turn.playerSeat === "Player 1" ? "P1" : "P2"))}">Move ${escapeHtml(
            String(move.index + 1),
          )}: ${escapeHtml(move.notation)}</span>
          <span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span>
        </li>`;
      }),
  );

  const activeTurn = activeTurnIndex !== null ? game.turns.find((turn) => turn.index === activeTurnIndex) : null;
  if (!activeTurn || activeTurn.moveIndexes.length > 0) {
    return moveRows.join("");
  }

  const showLiveSelectedEmpty = liveSelectedEmptyTurnIndex === activeTurn.index;
  const emptyTurnItem = game.inHistoryMode
    ? `<li class="history-item history-return-live" data-action="return-live" data-game-id="${escapeHtml(
        game.id,
      )}"><span class="history-move-line">${escapeHtml(emptyTurnText)}</span></li>`
    : `<li class="history-empty-line${showLiveSelectedEmpty ? " is-live-selected" : ""}"><span class="history-move-line">${escapeHtml(
        emptyTurnText,
      )}</span></li>`;

  return `${moveRows.join("")}${emptyTurnItem}`;
};

const renderHeader = () => `
  <header class="shell-header">
    <div class="shell-header-main">
      <h1>Righelt Web Shell</h1>
      <p class="small">Identity <span class="mono">${escapeHtml(transport.getIdentityId())}</span></p>
      <p class="small shell-header-status">Live sync: <span class="mono">${escapeHtml(
        `${wsStatus.state}${wsStatus.scope ? `:${wsStatus.scope}` : ""}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`,
      )}</span></p>
      <p class="small shell-header-status">Last event: <span class="mono">${escapeHtml(wsLastEvent)}</span></p>
    </div>
    <div class="shell-header-actions">
      <div class="nav-row">
        ${
          currentRoute.name !== "home"
            ? `<a class="button-link secondary" href="${buildHomeHash()}">Home</a>`
            : ""
        }
        <a class="button-link secondary" href="${buildPlaygroundHash()}">Playground</a>
        <a class="button-link secondary" href="${buildTutorialHash()}">Tutorial</a>
      </div>
    </div>
  </header>
`;

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
      : `<ol class="game-list">${games
          .map(
            (game) => `<li>
            <a href="${buildGameHash(game.id)}">${escapeHtml(formatDisplayGameId(game.id))}</a>
            <span class="small">latest ${escapeHtml(game.lastMoveAt || game.createdAt)}</span>
          </li>`,
          )
          .join("")}</ol>`;

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

const renderGameContent = (gameId, inviteFromRole = null, inviteToken = null) => {
  if (!routeHydrated) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Synchronizing current game state.</p></section>`;
  }

  const game = transport.getGameViewModel(gameId);
  if (!game) {
    return `<section class="panel"><h2>Loading game...</h2><p class="small">Fetching latest server state.</p></section>`;
  }

  const inviteLink = `${window.location.origin}${window.location.pathname}${buildInviteHash(game.inviteToken || inviteToken || game.id)}`;
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
  const historyRows = renderTurnHistory(game);
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

  const latestNote = game.notifications[0] || "Ready";
  const offlineBanner =
    game.showOfflineState || inviteFromRole === "offline"
      ? `<div class="alert warn">Offline mode: invite and remote join actions are disabled.</div>`
      : "";

  const historyMoveNumber =
    typeof game.historyIndex === "number" ? String(game.historyIndex + 1) : "?";
  const historyBanner = game.inHistoryMode
    ? `<p class="small">Viewing history snapshot for move ${escapeHtml(historyMoveNumber)}.</p>
       <p class="small">Incoming live moves will appear at bottom.</p>`
    : '<p class="small">You are on the live view.</p><p class="small">Click moves below to see historical state.</p>';

  return `
    ${offlineBanner ? `<section class="panel">${offlineBanner}</section>` : ""}
    <section class="layout-grid">
      <div class="stack">
        <section class="panel">
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
        </section>

        <section class="panel">
          <h2>Join / Invite</h2>
          ${pendingSeatNotice}
          <div class="row section-actions">
            ${
              game.canJoinAsViewer
                ? `<button data-action="join-viewer" data-game-id="${escapeHtml(game.id)}" class="secondary" ${
                    !busy ? "" : "disabled"
                  }>Join as viewer</button>`
                : ""
            }
            ${
              game.canJoinAsPlayer && game.showJoinActions
                ? `<button data-action="join-player" data-game-id="${escapeHtml(game.id)}" ${
                    !busy ? "" : "disabled"
                  }>Join as player</button>`
                : ""
            }
            ${
              game.canPlayAsBothPlayers
                ? `<button data-action="play-as-both-players" data-game-id="${escapeHtml(game.id)}" class="secondary" ${
                    !game.showOfflineState && !busy ? "" : "disabled"
                  }>Play as both players</button>`
                : ""
            }
            <button data-action="copy-invite" data-link="${escapeHtml(inviteLink)}" ${
              game.canInvite && !busy ? "" : "disabled"
            }>Invite someone else</button>
          </div>
          <div class="section-followup">
            ${inviteFeedback ? `<p class="small">${escapeHtml(inviteFeedback)}</p>` : ""}
            <ul class="participant-list">${pendingRows}</ul>
          </div>
        </section>

        <section class="panel">
          <h2>Participants</h2>
          <ul class="participant-list">${participantRows}${viewerRows}</ul>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2 class="board-heading">Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span></h2>
          <p class="board-preview-label" id="shell-board-preview-label">Select a piece to see it supply and command lines + what it can do:</p>
          <div class="board-wrap">
            <div id="shell-board" class="board"></div>
            <svg id="shell-overlay-lines" class="overlay-lines" aria-hidden="true"></svg>
          </div>
          <div class="overlay-key" aria-label="Overlay color key">
            <span><i class="swatch supply"></i>Supply line</span>
            <span><i class="swatch command"></i>Command line</span>
            <span><i class="swatch move"></i>Move preview</span>
            <span><i class="swatch group"></i>Group strength</span>
            <span><i class="swatch supply-point"></i>Supply point</span>
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2>History</h2>
          ${historyBanner}
          <div class="row section-actions">
            ${
              game.inHistoryMode && !busy
                ? `<button class="secondary" data-action="return-live" data-game-id="${escapeHtml(game.id)}">Return to live view</button>`
                : ""
            }
          </div>
          <div class="section-followup">
            <ol class="history-list">${historyRows}</ol>
          </div>
        </section>
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
            <a class="button-link secondary" href="${buildHomeHash()}">Back home</a>
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
    <a class="button-link" href="${buildHomeHash()}">Return home</a>
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
    mountedSelectionActionKey = null;
    if (boardRuntime) {
      boardRuntime.destroy();
      boardRuntime = null;
    }
    return;
  }

  const snapshot = game.currentSnapshot ?? null;
  const historyMoveIndex = game.inHistoryMode ? game.historyIndex : null;
  const historySelectionAction = game.inHistoryMode ? game.historySelectionAction ?? null : null;
  const effectiveLegalActions = game.inHistoryMode
    ? historySelectionAction
      ? [historySelectionAction]
      : []
    : Array.isArray(game.legalActions)
      ? game.legalActions
      : [];
  if (!snapshot) {
    return;
  }

  const snapshotKey = toStableKey(snapshot);
  const legalActionsKey = toStableKey(effectiveLegalActions);
  const selectionActionKey = toStableKey(historySelectionAction);

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
        onMoveRecorded: () => {
          render();
        },
      },
    });
    mountedBoardGameId = game.id;
    mountedHistoryMoveIndex = historyMoveIndex;
    mountedSnapshotKey = snapshotKey;
    mountedLegalActionsKey = legalActionsKey;
    mountedSelectionActionKey = selectionActionKey;
    boardRuntime.bindElements({ boardEl, overlayLinesEl, boardPreviewLabelEl, boardTurnIndicatorEl });
    void boardRuntime.loadSnapshot(snapshot, {
      legalActions: effectiveLegalActions,
      resetSelection: true,
      selectionAction: historySelectionAction,
    });
    return;
  }

  const resetSelection = mountedHistoryMoveIndex !== historyMoveIndex;
  mountedHistoryMoveIndex = historyMoveIndex;
  boardRuntime.bindElements({ boardEl, overlayLinesEl, boardPreviewLabelEl, boardTurnIndicatorEl });
  const runtimeSnapshotKey = toStableKey(boardRuntime.getState());
  const runtimeLegalActionsKey = toStableKey(boardRuntime.getLegalActions());
  if (shouldSkipBoardRuntimeReload({
    runtimeSnapshotKey,
    runtimeLegalActionsKey,
    snapshotKey,
    legalActionsKey,
    mountedSelectionActionKey,
    selectionActionKey,
    resetSelection,
  })) {
    mountedSnapshotKey = snapshotKey;
    mountedLegalActionsKey = legalActionsKey;
    mountedSelectionActionKey = selectionActionKey;
    return;
  }
  const shouldReloadSnapshot =
    mountedSnapshotKey !== snapshotKey ||
    mountedLegalActionsKey !== legalActionsKey ||
    mountedSelectionActionKey !== selectionActionKey ||
    resetSelection;
  if (!shouldReloadSnapshot) {
    return;
  }
  mountedSnapshotKey = snapshotKey;
  mountedLegalActionsKey = legalActionsKey;
  mountedSelectionActionKey = selectionActionKey;
  void boardRuntime.loadSnapshot(snapshot, {
    legalActions: effectiveLegalActions,
    resetSelection,
    selectionAction: historySelectionAction,
  });
};

const render = () => {
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

  const nextMarkup = `${renderHeader()}${body}`;
  if (nextMarkup !== lastRenderedMarkup) {
    appEl.innerHTML = nextMarkup;
    lastRenderedMarkup = nextMarkup;
  }
  if (currentRoute.name !== "game" && currentRoute.name !== "invite") {
    mountedBoardGameId = null;
    mountedHistoryMoveIndex = null;
    mountedSnapshotKey = null;
    mountedLegalActionsKey = null;
    mountedSelectionActionKey = null;
    if (boardRuntime) {
      boardRuntime.destroy();
      boardRuntime = null;
    }
  }
  if (currentRoute.name === "game") {
    mountBoardForGame(transport.getGameViewModel(currentRoute.gameId));
  }
  if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
    mountBoardForGame(transport.getGameViewModel(resolvedInvite.gameId));
  }
};

const withBusy = async (fn) => {
  busy = true;
  render();
  try {
    await fn();
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    render();
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

const liveSync = createLiveSyncClient({
  identityId: transport.getIdentityId(),
  onEvent: (payload) => {
    wsLastEvent = payload?.type
      ? `${payload.type}${payload?.reason ? `:${payload.reason}` : ""}`
      : "unknown";
    if (payload?.type === "game.updated" || payload?.type === "socket.connected") {
      void syncRouteDataPassive();
      return;
    }
    render();
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
    render();
  },
});

const syncLiveChannel = () => {
  const routeKey =
    currentRoute.name === "game"
      ? `game:${currentRoute.gameId}`
      : currentRoute.name === "home"
        ? "home"
        : "none";

  if (routeKey === liveSyncConnectedRoute && (wsStatus.state === "connected" || wsStatus.state === "connecting")) {
    return;
  }
  liveSyncConnectedRoute = routeKey;

  liveSync.disconnect();

  if (!shouldLiveSyncRoute(currentRoute)) {
    return;
  }

  if (currentRoute.name === "home") {
    liveSync.resume();
    liveSync.connectHome();
    return;
  }
  if (currentRoute.name === "game") {
    liveSync.resume();
    liveSync.connectGame(currentRoute.gameId);
  }
};

const navigateTo = (hash) => {
  if (window.location.hash === hash) {
    currentRoute = parseRouteFromHash(hash);
    routeHydrated = false;
    syncLiveChannel();
    void withBusy(syncRouteData);
    return;
  }
  window.location.hash = hash;
};

window.addEventListener("hashchange", () => {
  currentRoute = parseRouteFromHash(window.location.hash);
  routeHydrated = false;
  syncLiveChannel();
  void withBusy(syncRouteData);
});

window.addEventListener("online", () => {
  void withBusy(async () => {
    await transport.setOffline(false);
    void syncCurrentIdentityPresence(true);
    liveSync.resume();
    syncLiveChannel();
    await syncRouteData();
  });
});

window.addEventListener("offline", () => {
  void withBusy(async () => {
    await transport.setOffline(true);
    void syncCurrentIdentityPresence(false);
    liveSync.disconnect();
    liveSyncConnectedRoute = "";
    await syncRouteData();
  });
});

setInterval(() => {
  if (document.visibilityState === "hidden") {
    return;
  }
  if (!shouldPassiveRefreshRoute(currentRoute)) {
    return;
  }
  void syncRouteDataPassive();
}, WS_RECONCILE_MS);

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

  await withBusy(async () => {
    if (action === "create-game") {
      const game = await transport.createGame({ playgroundMode: false, offlineLocal: false });
      navigateTo(buildGameHash(game.id));
      return;
    }

    if (action === "create-offline-playground") {
      await transport.setOffline(true);
      const game = await transport.createGame({ playgroundMode: true, offlineLocal: true });
      navigateTo(buildGameHash(game.id, "offline"));
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
      await syncCurrentIdentityPresence(!next);
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
        navigateTo(buildGameHash(gameId));
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
        navigateTo(buildGameHash(gameId));
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
      await transport.selectHistoryMove({ gameId, moveIndex });
      await syncRouteData();
      return;
    }

    if (action === "return-live") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
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
      navigateTo(gameId ? buildGameHash(gameId) : buildHomeHash());
    }
  });
});

const initialRender = async () => {
  if (navigator.onLine === false) {
    await transport.setOffline(true);
  }

  routeHydrated = false;
  syncLiveChannel();
  await withBusy(syncRouteData);
};

void initialRender();
