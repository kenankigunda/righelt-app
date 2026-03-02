import { assertGameBoardAdapter } from "./board-adapter-contract.js";
import { createEnginePlaygroundBoardAdapter } from "./board-adapters/engine-playground-adapter.js";
import { getBootstrapPayload } from "./shell/bootstrap.js";
import { createLiveTransportStore } from "./shell/live-transport.js";
import { createLiveSyncClient } from "./shell/live-sync.js";
import { loadTutorialCompleted, saveTutorialCompleted } from "./shell/persistence.js";
import { buildGameHash, buildHomeHash, buildInviteHash, buildTutorialHash, parseRouteFromHash } from "./shell/routes.js";
import { createTutorialController } from "./shell/tutorial.js";

const appEl = document.getElementById("app");
const bootstrap = getBootstrapPayload();

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

let currentRoute = parseRouteFromHash(window.location.hash);
let mountedBoardGameId = null;
let busy = false;
let liveSyncConnectedRoute = "";
const openedViewerGames = new Set();
let wsStatus = { state: "disconnected", scope: null, gameId: null, reconnectAttempts: 0 };
let wsLastEvent = "none";
const WS_RECONCILE_MS = 2000;
let inviteFeedback = "";
let inviteFeedbackTimer = null;
let routeHydrated = false;
let resolvedInvite = null;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatStatus = (connected) =>
  connected ? '<span class="status-chip live">Connected</span>' : '<span class="status-chip offline">Disconnected</span>';

const renderBoardPlaceholder = (game) => {
  const lastMove = game.moves.length > 0 ? game.moves[game.moves.length - 1] : null;
  const turnIndex = game.currentSnapshot?.turnIndex;
  const sideToMove = game.currentSnapshot?.sideToMove;
  const mode = game.inHistoryMode ? `history #${(game.historyIndex ?? 0) + 1}` : "live";

  if (!lastMove) {
    return `<div class="alert">Board placeholder: no moves recorded yet. Mode: ${mode}. Turn ${escapeHtml(
      String(turnIndex ?? 0),
    )}, side ${escapeHtml(String(sideToMove ?? "-"))}.</div>`;
  }

  return `<div class="alert">Board placeholder: ${escapeHtml(
    String(game.moves.length),
  )} move(s). Last move #${escapeHtml(String(lastMove.index + 1))} ${escapeHtml(
    lastMove.notation,
  )} at ${escapeHtml(lastMove.at)}. Mode: ${mode}. Turn ${escapeHtml(
    String(turnIndex ?? 0),
  )}, side ${escapeHtml(String(sideToMove ?? "-"))}.</div>`;
};

const renderHeader = () => `
  <header class="shell-header">
    <div>
      <h1>Righelt Web Shell</h1>
      <p class="small">Identity <span class="mono">${escapeHtml(transport.getIdentityId())}</span></p>
      <p class="small">Live sync: <span class="mono">${escapeHtml(
        `${wsStatus.state}${wsStatus.scope ? `:${wsStatus.scope}` : ""}${wsStatus.gameId ? `:${wsStatus.gameId}` : ""}`,
      )}</span> | Last event: <span class="mono">${escapeHtml(wsLastEvent)}</span></p>
    </div>
    <div class="nav-row">
      <a class="button-link secondary" href="${buildHomeHash()}">Home</a>
      <a class="button-link secondary" href="${buildTutorialHash()}">Tutorial</a>
      <button data-action="toggle-offline" class="secondary">Toggle Offline</button>
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

const renderHome = () => {
  const games = transport.listGames();
  const listHtml =
    games.length === 0
      ? "<p class=\"small\">No games yet.</p>"
      : `<ol class="game-list">${games
          .map(
            (game) => `<li>
            <a href="${buildGameHash(game.id)}">${escapeHtml(game.id)}</a>
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
            <button data-action="create-game" ${busy ? "disabled" : ""}>Play Game</button>
            <button data-action="create-playground" class="secondary" ${busy ? "disabled" : ""}>Playground Mode</button>
            <button data-action="create-offline-playground" class="warn" ${busy ? "disabled" : ""}>Offline Playground</button>
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
          <h2>Preview Board</h2>
          <p class="small">Non-authoritative preview sequence.</p>
          <div class="preview">Preview replay surface</div>
        </section>
      </div>
    </section>
  `;
};

const renderGame = (gameId, inviteFromRole = null, inviteToken = null) => {
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
        return `<li>${entry.label}: <span class="small">Open seat</span></li>`;
      }
      return `<li>${entry.label}: <span class="mono">${escapeHtml(entry.value.identityId)}</span> ${formatStatus(entry.value.connected)}</li>`;
    })
    .join("");

  const viewersRow = `<li>Viewers: ${game.viewers.length}</li>`;
  const historyRows =
    game.moves.length === 0
      ? "<li class=\"small\">No moves yet.</li>"
      : game.moves
          .map(
            (move) => `<li class="history-item" data-action="jump-history" data-game-id="${escapeHtml(
              game.id,
            )}" data-move-index="${move.index}">#${move.index + 1} ${escapeHtml(move.notation)} <span class="small">${escapeHtml(
              move.at,
            )}</span></li>`,
          )
          .join("");

  const pendingRows =
    game.pendingJoinRequests.length === 0
      ? "<li class=\"small\">No pending requests</li>"
      : game.pendingJoinRequests
          .map(
            (request) => `<li>
              <span class="mono">${escapeHtml(request.identityId)}</span> requests ${escapeHtml(request.requestedSeat)}
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

  const historyBanner = game.inHistoryMode
    ? '<div class="alert">Viewing history snapshot (not live). New moves keep appending.</div>'
    : "";

  return `
    <section class="layout-grid">
      <div class="stack">
        <section class="panel">
          <h2>Game <span class="mono">${escapeHtml(game.id)}</span></h2>
          <p class="small">Role: <strong>${escapeHtml(game.myRole)}</strong></p>
          ${offlineBanner}
          ${historyBanner}
          <div class="row">
            <button data-action="record-move" data-game-id="${escapeHtml(game.id)}" ${
              game.canRecordMove && !busy ? "" : "disabled"
            }>Record Live Move</button>
            <button class="secondary" data-action="toggle-p1" data-game-id="${escapeHtml(game.id)}" ${busy ? "disabled" : ""}>Toggle P1 Connection</button>
            <button class="secondary" data-action="toggle-p2" data-game-id="${escapeHtml(game.id)}" ${busy ? "disabled" : ""}>Toggle P2 Connection</button>
            <button class="warn" data-action="go-online" data-game-id="${escapeHtml(game.id)}" ${
              game.offlineLocal && !busy ? "" : "disabled"
            }>Go online</button>
          </div>
          <p class="small">Latest: ${escapeHtml(latestNote)}</p>
        </section>

        <section class="panel">
          <h2>Join / Invite</h2>
          <div class="row">
            <button data-action="join-viewer" data-game-id="${escapeHtml(game.id)}" class="secondary" ${
              game.canJoinAsViewer && !busy ? "" : "disabled"
            }>Join as viewer</button>
            <button data-action="join-player" data-game-id="${escapeHtml(game.id)}" ${
              game.canJoinAsPlayer && game.showJoinActions && !busy ? "" : "disabled"
            }>Join as player</button>
            <button data-action="copy-invite" data-link="${escapeHtml(inviteLink)}" ${
              game.canInvite && !busy ? "" : "disabled"
            }>Invite</button>
          </div>
          ${inviteFeedback ? `<p class="small">${escapeHtml(inviteFeedback)}</p>` : ""}
          <p class="small">Invite link: <span class="mono">${escapeHtml(inviteLink)}</span></p>
          <ul class="participant-list">${pendingRows}</ul>
        </section>

        <section class="panel">
          <h2>History</h2>
          <div class="row">
            <button class="secondary" data-action="return-live" data-game-id="${escapeHtml(game.id)}" ${
              game.inHistoryMode && !busy ? "" : "disabled"
            }>Return to live</button>
          </div>
          <ol class="history-list">${historyRows}</ol>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2>Board</h2>
          <div class="board-wrap">
            <div id="board" class="board"></div>
            <svg id="overlay-lines" class="overlay-lines" aria-hidden="true"></svg>
          </div>
          ${renderBoardPlaceholder(game)}
        </section>

        <section class="panel">
          <h2>Participants</h2>
          <ul class="participant-list">${participantRows}${viewersRow}</ul>
        </section>

        <section class="panel">
          <h2>Tutorial</h2>
          <div class="row">
            <a class="button-link secondary" href="${buildTutorialHash(game.id)}">Restart tutorial</a>
          </div>
        </section>
      </div>
    </section>
  `;
};

const renderTutorial = (gameId) => {
  const state = tutorial.current();
  return `
    <section class="panel">
      <h2>Tutorial</h2>
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
  const boardEl = document.getElementById("board");
  const overlayLinesEl = document.getElementById("overlay-lines");
  if (!boardEl || !overlayLinesEl || !game) {
    mountedBoardGameId = null;
    return;
  }

  if (mountedBoardGameId !== game.id) {
    boardAdapter.mount({ boardEl, overlayLinesEl, onCellClick: () => {} });
    mountedBoardGameId = game.id;
  }

  boardAdapter.render({
    snapshot: game.currentSnapshot,
    selection: { selectedPieceId: null, source: null, target: null },
    selectedPieceMoves: [],
  });
};

const render = () => {
  let body = "";
  if (currentRoute.name === "home") {
    body = renderHome();
  } else if (currentRoute.name === "game") {
    body = renderGame(currentRoute.gameId, currentRoute.inviteFromRole);
  } else if (currentRoute.name === "invite") {
    body = renderGame(resolvedInvite?.gameId || null, resolvedInvite?.inviteFromRole || null, resolvedInvite?.inviteToken || null);
  } else if (currentRoute.name === "tutorial") {
    body = renderTutorial(currentRoute.gameId);
  } else {
    body = renderNotFound();
  }

  appEl.innerHTML = `${renderHeader()}${body}`;
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
    if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
      syncLiveChannel();
    }
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
    const firstOpen = !openedViewerGames.has(currentRoute.gameId);
    await transport.loadGame(currentRoute.gameId, { openAsViewer: firstOpen });
    openedViewerGames.add(currentRoute.gameId);
    routeHydrated = true;
    return;
  }
  if (currentRoute.name === "invite") {
    resolvedInvite = await transport.resolveInvite(currentRoute.inviteToken);
    const firstOpen = !openedViewerGames.has(resolvedInvite.gameId);
    await transport.loadGame(resolvedInvite.gameId, { openAsViewer: firstOpen });
    openedViewerGames.add(resolvedInvite.gameId);
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
    }
    render();
  },
  onError: (error) => {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  },
  onStatus: (status) => {
    wsStatus = status;
    render();
  },
});

const syncLiveChannel = () => {
  const routeKey =
    currentRoute.name === "game"
      ? `game:${currentRoute.gameId}`
      : currentRoute.name === "invite" && resolvedInvite?.gameId
        ? `game:${resolvedInvite.gameId}`
      : currentRoute.name === "home"
        ? "home"
        : "none";

  if (routeKey === liveSyncConnectedRoute && wsStatus.state === "connected") {
    return;
  }
  liveSyncConnectedRoute = routeKey;

  liveSync.disconnect();

  if (currentRoute.name === "home") {
    liveSync.resume();
    liveSync.connectHome();
    return;
  }
  if (currentRoute.name === "game") {
    liveSync.resume();
    liveSync.connectGame(currentRoute.gameId);
    return;
  }
  if (currentRoute.name === "invite" && resolvedInvite?.gameId) {
    liveSync.resume();
    liveSync.connectGame(resolvedInvite.gameId);
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
  transport.setOffline(false);
  liveSync.resume();
  syncLiveChannel();
  void withBusy(syncRouteData);
});

window.addEventListener("offline", () => {
  transport.setOffline(true);
  liveSync.disconnect();
  liveSyncConnectedRoute = "";
  void withBusy(syncRouteData);
});

setInterval(() => {
  if (document.visibilityState === "hidden") {
    return;
  }
  if (currentRoute.name !== "game" && currentRoute.name !== "home") {
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

    if (action === "create-playground") {
      const game = await transport.createGame({ playgroundMode: true, offlineLocal: false });
      navigateTo(buildGameHash(game.id));
      return;
    }

    if (action === "create-offline-playground") {
      transport.setOffline(true);
      const game = await transport.createGame({ playgroundMode: true, offlineLocal: true });
      navigateTo(buildGameHash(game.id, "offline"));
      return;
    }

    if (action === "toggle-offline") {
      const next = !(window.__righeltOffline || false);
      window.__righeltOffline = next;
      transport.setOffline(next);
      await syncRouteData();
      return;
    }

    if (action === "go-online") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      const confirmed = window.confirm("Go online with this local game?");
      await transport.goOnlineGame({ gameId, confirmed });
      await syncRouteData();
      return;
    }

    if (action === "join-viewer") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.joinGame({
        gameId,
        mode: "viewer",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      await syncRouteData();
      return;
    }

    if (action === "join-player") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.joinGame({
        gameId,
        mode: "player",
        inviteFromRole: currentRoute.inviteFromRole || resolvedInvite?.inviteFromRole || null,
        inviteToken: resolvedInvite?.inviteToken || null,
      });
      await syncRouteData();
      return;
    }

    if (action === "approve-request") {
      const gameId = actionEl.getAttribute("data-game-id");
      const requester = actionEl.getAttribute("data-requester-id");
      if (!gameId || !requester) return;
      await transport.approvePendingRequest({ gameId, requesterIdentityId: requester });
      await syncRouteData();
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
      setInviteFeedback(copied ? "Copied to clipboard" : "Clipboard unavailable");
      return;
    }

    if (action === "record-move") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      await transport.addMove({ gameId });
      await syncRouteData();
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

    if (action === "toggle-p1" || action === "toggle-p2") {
      const gameId = actionEl.getAttribute("data-game-id");
      if (!gameId) return;
      const game = transport.getGameViewModel(gameId);
      if (!game) return;
      const role = action === "toggle-p1" ? "Player 1" : "Player 2";
      const current = role === "Player 1" ? game.player1 : game.player2;
      if (!current) return;
      await transport.setParticipantConnected({ gameId, role, connected: !current.connected });
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
    transport.setOffline(true);
  }

  if (currentRoute.name === "home" && !loadTutorialCompleted(storage)) {
    navigateTo(buildTutorialHash());
    return;
  }

  routeHydrated = false;
  syncLiveChannel();
  await withBusy(syncRouteData);
};

void initialRender();
