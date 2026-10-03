import { AUTH_PROTOCOL_VERSION, AUTH_PROTOCOL_HEADER, AUTH_REQUEST_HEADER, SESSION_CONTEXT_HEADER } from '../generated/packages/shared-types/src/auth-policy.js';
import { createInitialState, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { buildLocalApiWsHost, isLocalDevHost } from "../local-dev-ports.js";
import { createLiveTransportStore, validSyncSnapshot } from "./live-transport.js";
import { createOperationManager } from "./operation-manager.js";

import { SYNC_TIMING, isSyncRevision } from "../generated/packages/shared-types/src/sync-protocol.js";

const PENDING_LOCAL_GAMES_KEY = "righelt.pendingLocalGames";
const WS_RECONNECT_BASE_MS = SYNC_TIMING.retryDelaysMs[0];
const WS_RECONNECT_MAX_MS = SYNC_TIMING.retryDelaysMs.at(-1);
const HEARTBEAT_MS = SYNC_TIMING.heartbeatIntervalMs;
const VISIBILITY_SUSPEND_GRACE_MS = 5_000;

const isAuthoritativeSyncEvent = (payload) =>
  payload?.game &&
  (payload?.type === "state_sync" ||
    payload?.type === "event_appended" ||
    payload?.type === "presence_changed" ||
    payload?.type === "join_request_created" ||
    payload?.type === "join_request_resolved");

const createOperationError = (message, code = "operation_failed") => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const createGameIdMismatchError = (operationLabel, expectedGameId, actualGameId) =>
  createOperationError(
    `${operationLabel} returned an unexpected game id. Expected ${expectedGameId} but received ${actualGameId}.`,
    "game_id_mismatch",
  );

const GAME_CREATION_FAILED_BANNER = "Game creation failed. The server could not create this game. Return home and try again.";
const ROLLBACK_FAILURE_PREFIX = "rollback:";

const clone = (value) => structuredClone(value);

const getLocalFailureMessage = (game) =>
  typeof game?.localFailureMessage === "string" ? game.localFailureMessage.trim() : "";

const isFailedLocalStub = (game) => Boolean(game && getLocalFailureMessage(game));

const getRollbackFailureId = (gameId) => `${ROLLBACK_FAILURE_PREFIX}${gameId}`;
const getRollbackFailureGameId = (operationId) =>
  typeof operationId === "string" && operationId.startsWith(ROLLBACK_FAILURE_PREFIX)
    ? operationId.slice(ROLLBACK_FAILURE_PREFIX.length) || null
    : null;

const createRollbackFailureHandle = (game, failureNotice = "") => {
  const error = createOperationError(failureNotice || "The operation could not be completed.", "authoritative_rollback");
  const committed = Promise.resolve(game);
  return {
    id: getRollbackFailureId(game.id),
    gameId: game.id,
    status: "failed",
    result: game,
    committed,
    error,
  };
};

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(16).slice(2)}-${Date.now()}`;
};

const createWsUrl = ({ identityId, gameId, sessionId, lastEventSeq, auth }) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    identityId,
    sessionId,
    lastEventSeq: String(lastEventSeq ?? 0),
    protocolVersion: "2",
  });
  if (auth?.enabled) { params.set("authProtocolVersion", String(AUTH_PROTOCOL_VERSION)); params.set("sessionContext", auth.session.contextId || ""); }
  const host = window.location.protocol !== "https:" && isLocalDevHost(window.location.hostname) ? buildLocalApiWsHost(window.location.port) : window.location.host;
  return `${protocol}://${host}/api/shell/games/${encodeURIComponent(gameId)}/ws?${params.toString()}`;
};

const createPresenceUrl = (gameId) => {
  const origin = window.location.origin ?? `${window.location.protocol}//${window.location.host}`;
  return `${origin}/api/shell/games/${encodeURIComponent(gameId)}/presence`;
};

export const createLiveSyncClient = ({
  identityId,
  auth = null,
  onAuthLost = () => {},
  presenceFetcher = globalThis.fetch,
  getLastEventSeq = () => 0,
  onEvent,
  onError = () => {},
  onStatus = () => {},
  onMetric = () => {},
  reconnectBaseMs = WS_RECONNECT_BASE_MS,
  reconnectMaxMs = WS_RECONNECT_MAX_MS,
  heartbeatMs = HEARTBEAT_MS,
  inboundTimeoutMs = SYNC_TIMING.inboundTimeoutMs,
  initialSnapshotTimeoutMs = SYNC_TIMING.requestTimeoutMs,
  onRecovery = () => {},
  onReconcile = async () => {},
  onReady = async () => {},
  visibilitySuspendGraceMs = VISIBILITY_SUSPEND_GRACE_MS,
}) => {
  let retired = false;
  const sockets = new Map();
  const reconnectTimers = new Map();
  const heartbeatTimers = new Map();
  const reconnectAttemptsByGameId = new Map();
  const lastEventSeqByGameId = new Map();
  const sessionIdByGameId = new Map();
  const desiredGameIds = new Set();
  const closeReasonBySocket = new Map();
  const generations = new Map();
  const connectionState = new Map();
  const repairOwners = new Map();
  const reconnectGates = new Map();
  const advertisedEventSeqByGameId = new Map();
  let visibilitySuspendTimer = null;
  let suspendedForInvisibility = false;

  const recordMetric = (type, extra = {}) => {
    onMetric({
      type,
      identityId,
      activeSocketCount: sockets.size,
      desiredSocketCount: desiredGameIds.size,
      ...extra,
    });
  };

  const isDocumentHidden = () =>
    typeof document !== "undefined" && (document.hidden === true || document.visibilityState === "hidden");

  const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

  const shouldKeepConnectionsActive = () => !retired && !isDocumentHidden() && isOnline();

  const clearReconnect = (gameId) => {
    const timer = reconnectTimers.get(gameId) ?? null;
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.delete(gameId);
    }
  };

  const clearHeartbeat = (gameId) => {
    const timer = heartbeatTimers.get(gameId) ?? null;
    if (timer) {
      clearInterval(timer);
      heartbeatTimers.delete(gameId);
    }
  };

  const sendPresenceHint = (gameId, type, { preferBeacon = false } = {}) => {
    if (!gameId || retired) {
      return;
    }
    const lastEventSeq = lastEventSeqByGameId.get(gameId) ?? 0;
    const payload = JSON.stringify({
      identityId,
      sessionId: sessionIdByGameId.get(gameId) ?? "",
      status: type,
      lastEventSeq,
    });
    const socket = sockets.get(gameId) ?? null;
    if (socket && socket.readyState === 1) {
      try {
        socket.send(JSON.stringify({ type, identityId, sessionId: sessionIdByGameId.get(gameId) ?? "", lastEventSeq }));
        recordMetric("presence_signal_sent", { gameId, signal: type, transport: "websocket" });
      } catch {
        // ignore
      }
    }
    if (!preferBeacon && socket?.readyState === 1) {
      return;
    }
    try {
      if (!auth?.enabled && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(createPresenceUrl(gameId), new Blob([payload], { type: "application/json" }));
        recordMetric("presence_signal_sent", { gameId, signal: type, transport: sent ? "beacon" : "beacon_failed" });
        if (sent) {
          return;
        }
      }
    } catch {
      // ignore
    }
    if (typeof presenceFetcher === "function") {
      void presenceFetcher(createPresenceUrl(gameId), {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth?.enabled ? {[AUTH_REQUEST_HEADER]:"1",[AUTH_PROTOCOL_HEADER]:String(AUTH_PROTOCOL_VERSION),[SESSION_CONTEXT_HEADER]:auth.session.contextId || ""} : {}) },
        body: payload,
        keepalive: true,
      }).catch(() => {});
      recordMetric("presence_signal_sent", { gameId, signal: type, transport: "fetch_keepalive" });
    }
  };

  const cleanupSocket = (gameId, { closeReason = "intentional_disconnect", emitDisconnected = false } = {}) => {
    clearHeartbeat(gameId);
    const socket = sockets.get(gameId) ?? null;
    if (!socket) {
      if (emitDisconnected) {
        onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
      }
      return;
    }
    if (closeReason.startsWith("intentional_suspend:") || closeReason === "network_offline" || closeReason === "pagehide") onRecovery({ gameId, reason: closeReason });
    if (closeReason.startsWith("intentional_suspend:")) {
      sendPresenceHint(gameId, "inactive");
    } else if (closeReason === "intentional_disconnect") {
      sendPresenceHint(gameId, "disconnecting");
    } else if (closeReason === "network_offline" || closeReason === "pagehide") {
      sendPresenceHint(gameId, "disconnecting", { preferBeacon: true });
    }
    sockets.delete(gameId);
    generations.set(gameId, (generations.get(gameId) ?? 0) + 1);
    const connection = connectionState.get(gameId);
    if (connection) { clearTimeout(connection.initialTimer); clearTimeout(connection.watchdog); connection.resolveInitial(); connectionState.delete(gameId); }
    closeReasonBySocket.set(socket, closeReason);
    try {
      socket.close();
    } catch {
      // ignore
    }
    if (closeReason.startsWith("intentional_suspend:")) onStatus({ state: "suspended", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    if (emitDisconnected) {
      onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    }
  };

  const sendHeartbeat = (gameId) => {
    const socket = sockets.get(gameId) ?? null;
    if (!socket || socket.readyState !== 1 || !shouldKeepConnectionsActive()) {
      return;
    }
    const lastEventSeq = lastEventSeqByGameId.get(gameId) ?? 0;
    try {
      socket.send(
        JSON.stringify({
          type: "heartbeat",
          identityId,
          sessionId: sessionIdByGameId.get(gameId) ?? "",
          lastEventSeq,
        }),
      );
      recordMetric("heartbeat_sent", { gameId, lastEventSeq });
    } catch {
      // ignore
    }
  };

  const resumeDesiredConnections = () => {
    if (!shouldKeepConnectionsActive()) {
      return;
    }
    suspendedForInvisibility = false;
    for (const gameId of desiredGameIds) {
      connect(gameId);
    }
  };

  const suspendConnections = (reason = "hidden_tab") => {
    if (suspendedForInvisibility) {
      return;
    }
    suspendedForInvisibility = true;
    for (const gameId of [...sockets.keys()]) {
      cleanupSocket(gameId, { closeReason: `intentional_suspend:${reason}` });
    }
    recordMetric("connections_suspended", { reason });
  };

  const clearVisibilitySuspend = () => {
    if (visibilitySuspendTimer) {
      clearTimeout(visibilitySuspendTimer);
      visibilitySuspendTimer = null;
    }
  };

  const scheduleVisibilitySuspend = () => {
    if (retired) return;
    clearVisibilitySuspend();
    if (!isDocumentHidden()) {
      return;
    }
    visibilitySuspendTimer = setTimeout(() => {
      visibilitySuspendTimer = null;
      if (isDocumentHidden()) {
        suspendConnections("hidden_tab");
      }
    }, visibilitySuspendGraceMs);
  };

  const refreshHeartbeatLoop = (gameId) => {
    clearHeartbeat(gameId);
    const socket = sockets.get(gameId) ?? null;
    if (!socket || socket.readyState !== 1 || !shouldKeepConnectionsActive()) {
      return;
    }
    sendHeartbeat(gameId);
    heartbeatTimers.set(gameId, setInterval(() => sendHeartbeat(gameId), heartbeatMs));
  };

  const scheduleReconnect = (gameId) => {
    if (!desiredGameIds.has(gameId)) {
      recordMetric("reconnect_skipped", { gameId, reason: "game_not_desired" });
      return;
    }
    if (!shouldKeepConnectionsActive() || suspendedForInvisibility) {
      recordMetric("reconnect_skipped", { gameId, reason: "connections_suspended" });
      return;
    }
    clearReconnect(gameId);
    const reconnectAttempts = reconnectAttemptsByGameId.get(gameId) ?? 0;
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** reconnectAttempts) * jitter);
    reconnectAttemptsByGameId.set(gameId, reconnectAttempts + 1);
    recordMetric("reconnect_scheduled", { gameId, reconnectAttempts: reconnectAttempts + 1, delayMs: delay });
    reconnectTimers.set(
      gameId,
      setTimeout(() => {
        if (!desiredGameIds.has(gameId)) {
          return;
        }
        connect(gameId);
      }, delay),
    );
  };

  const repair = (gameId, reason) => {
    if (!desiredGameIds.has(gameId)) return Promise.resolve();
    if (repairOwners.has(gameId)) return repairOwners.get(gameId).promise;
    const owner = {};
    repairOwners.set(gameId, owner);
    onRecovery({ gameId, reason });
    recordMetric("recovery_started", { gameId, reason });
    clearReconnect(gameId);
    cleanupSocket(gameId, { closeReason: `recovery:${reason}` });
    reconnectGates.get(gameId)?.resolve(); reconnectGates.delete(gameId);
    owner.promise = Promise.resolve().then(() => onReconcile({ gameId, reason })).then(() => {
      if (repairOwners.get(gameId) !== owner || !desiredGameIds.has(gameId)) return;
      recordMetric("recovery_reconciled", { gameId, reason });
      if (shouldKeepConnectionsActive()) connect(gameId);
    }).catch((error) => {
      if (repairOwners.get(gameId) !== owner) return;
      onError(error);
      scheduleReconnect(gameId);
    }).finally(() => { if (repairOwners.get(gameId) === owner) repairOwners.delete(gameId); });
    return owner.promise;
  };

  const connect = (gameId) => {
    if (!gameId) {
      return;
    }
    desiredGameIds.add(gameId);
    clearVisibilitySuspend();
    if (!shouldKeepConnectionsActive()) {
      scheduleVisibilitySuspend();
      return;
    }
    const existing = sockets.get(gameId) ?? null;
    if (existing && (existing.readyState === 0 || existing.readyState === 1)) {
      return;
    }

    if (typeof WebSocket === "undefined") {
      onError(new Error("websocket_unavailable"));
      return;
    }

    cleanupSocket(gameId);
    clearReconnect(gameId);
    const reconnectAttempts = reconnectAttemptsByGameId.get(gameId) ?? 0;
    const lastEventSeq = Math.max(lastEventSeqByGameId.get(gameId) ?? 0, Number(getLastEventSeq(gameId) || 0));
    const sessionId = createSessionId();
    sessionIdByGameId.set(gameId, sessionId);
    lastEventSeqByGameId.set(gameId, lastEventSeq);
    onRecovery({ gameId, reason: "connecting" });
    onStatus({ state: "connecting", gameId, reconnectAttempts });

    const ws = new WebSocket(createWsUrl({ identityId, gameId, sessionId, lastEventSeq, auth }));
    sockets.set(gameId, ws);
    const generation = (generations.get(gameId) ?? 0) + 1;
    generations.set(gameId, generation);
    const current = () => sockets.get(gameId) === ws && generations.get(gameId) === generation;
    const connection = { generation, initialDone: false, lastInboundAt: Date.now() };
    connection.initial = new Promise((resolve) => { connection.resolveInitial = resolve; });
    connectionState.set(gameId, connection);
    const reconnectGate = reconnectGates.get(gameId);
    if (reconnectGate) void connection.initial.then(() => { reconnectGate.resolve(); if (reconnectGates.get(gameId) === reconnectGate) reconnectGates.delete(gameId); });
    connection.initialTimer = setTimeout(() => { if (current()) void repair(gameId, "initial_snapshot_timeout"); }, initialSnapshotTimeoutMs);
    connection.initialTimer.unref?.();
    const refreshWatchdog = () => {
      clearTimeout(connection.watchdog);
      connection.lastInboundAt = Date.now();
      connection.watchdog = setTimeout(() => { if (current() && shouldKeepConnectionsActive()) void repair(gameId, "inbound_timeout"); }, inboundTimeoutMs);
      connection.watchdog.unref?.();
    };
    const finishInitial = () => {
      if (connection.initialDone) return;
      connection.initialDone = true;
      clearTimeout(connection.initialTimer);
      connection.resolveInitial();
      void Promise.resolve(onReady({ gameId, generation, isCurrent: current })).catch(() => { if (current()) void repair(gameId, "reconciliation_failed"); });
    };
    recordMetric("socket_opened", { gameId, reconnectAttempts });

    ws.addEventListener("open", () => {
      if (!current()) return;
      refreshWatchdog();
      reconnectAttemptsByGameId.set(gameId, 0);
      onStatus({ state: "connected", gameId, reconnectAttempts: 0 });
      refreshHeartbeatLoop(gameId);
    });

    ws.addEventListener("message", (event) => {
      if (!current()) return;
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}");
        if (auth?.enabled && payload.authProtocolVersion !== AUTH_PROTOCOL_VERSION) throw new Error("upgrade_required");
        if (payload.protocolVersion !== 2 || payload.gameId !== gameId || !isSyncRevision(payload.eventSeq)) throw new Error("invalid_socket_event");
        if (payload.type === "heartbeat_ack") {
          advertisedEventSeqByGameId.set(gameId, Math.max(advertisedEventSeqByGameId.get(gameId) ?? 0, payload.eventSeq));
          refreshWatchdog();
          const applied = Math.max(lastEventSeqByGameId.get(gameId) ?? 0, Number(getLastEventSeq(gameId) || 0));
          if (payload.eventSeq > applied) { void repair(gameId, "behind_server"); return; }
          finishInitial();
          return;
        }
        if (!isAuthoritativeSyncEvent(payload) || !validSyncSnapshot(payload.game, gameId)
          || (payload.commandOutcome && (!isSyncRevision(payload.commandOutcome.eventSeq) || payload.commandOutcome.eventSeq > payload.eventSeq || !isSyncRevision(payload.commandOutcome.gameplayRevision) || payload.commandOutcome.gameplayRevision > payload.game.gameplayRevision))) throw new Error("invalid_socket_snapshot");
        const applied = onEvent(payload, { gameId, generation, initial: !connection.initialDone });
        if (!current()) return;
        if (applied === false) throw new Error("snapshot_not_applied");
        lastEventSeqByGameId.set(gameId, Math.max(lastEventSeqByGameId.get(gameId) ?? 0, payload.eventSeq));
        refreshWatchdog();
        finishInitial();
      } catch {
        void repair(gameId, "invalid_socket_event");
      }
    });

    ws.addEventListener("error", () => {
      if (!current()) return;
      void repair(gameId, "socket_error");
      recordMetric("socket_error", { gameId });
      onError(new Error("websocket_error"));
      onStatus({ state: "error", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    });

    ws.addEventListener("close", (event) => {
      if (!current()) { closeReasonBySocket.delete(ws); return; }
      if (auth?.enabled && event.code === 4001 && !retired) { retired = true; disconnectAll(); onAuthLost(); return; }
      const closeReason = closeReasonBySocket.get(ws) ?? "unexpected_close";
      closeReasonBySocket.delete(ws);
      clearHeartbeat(gameId);
      clearTimeout(connection.initialTimer); clearTimeout(connection.watchdog); connection.resolveInitial(); connectionState.delete(gameId);
      onRecovery({ gameId, reason: closeReason });
      const reconnectGate = {};
      reconnectGate.promise = new Promise((resolve) => { reconnectGate.resolve = resolve; });
      reconnectGates.set(gameId, reconnectGate);
      if (sockets.get(gameId) === ws) {
        sockets.delete(gameId);
      }
      if (closeReason.startsWith("intentional_suspend:")) {
        onStatus({ state: "suspended", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
        recordMetric("socket_closed_by_client", { gameId, reason: closeReason });
        return;
      }
      if (closeReason === "intentional_disconnect" || closeReason === "pagehide") {
        onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
        recordMetric("socket_closed_by_client", { gameId, reason: closeReason });
        return;
      }
      onStatus({ state: "closed", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
      recordMetric("socket_closed", { gameId, reason: closeReason });
      if (desiredGameIds.has(gameId)) {
        scheduleReconnect(gameId);
      }
    });
  };

  const disconnectGame = (gameId) => {
    if (!gameId) {
      return;
    }
    desiredGameIds.delete(gameId);
    repairOwners.delete(gameId);
    reconnectGates.get(gameId)?.resolve(); reconnectGates.delete(gameId);
    clearReconnect(gameId);
    cleanupSocket(gameId, { closeReason: "intentional_disconnect", emitDisconnected: true });
  };

  const disconnectAll = () => {
    clearVisibilitySuspend();
    suspendedForInvisibility = false;
    const gameIds = new Set([...desiredGameIds, ...sockets.keys()]);
    desiredGameIds.clear();
    repairOwners.clear();
    for (const gate of reconnectGates.values()) gate.resolve();
    reconnectGates.clear();
    for (const gameId of gameIds) {
      clearReconnect(gameId);
      cleanupSocket(gameId, { closeReason: "intentional_disconnect", emitDisconnected: true });
    }
  };

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (isDocumentHidden()) {
        scheduleVisibilitySuspend();
        return;
      }
      clearVisibilitySuspend();
      for (const gameId of sockets.keys()) {
        refreshHeartbeatLoop(gameId);
      }
      resumeDesiredConnections();
      for (const gameId of desiredGameIds) {
        if (connectionState.get(gameId)?.initialDone) void repair(gameId, "visibility_resumed");
      }
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => {
      for (const gameId of sockets.keys()) {
        refreshHeartbeatLoop(gameId);
      }
      resumeDesiredConnections();
    });

    window.addEventListener("offline", () => {
      for (const gameId of [...sockets.keys()]) {
        cleanupSocket(gameId, { closeReason: "network_offline" });
      }
    });

    window.addEventListener("pagehide", () => {
      for (const gameId of [...sockets.keys()]) {
        cleanupSocket(gameId, { closeReason: "pagehide" });
      }
    });

    window.addEventListener("beforeunload", () => {
      for (const gameId of [...sockets.keys()]) {
        sendPresenceHint(gameId, "disconnecting", { preferBeacon: true });
      }
    });
  }

  const waitForInitialSnapshot = (gameId) => {
    const pending = connectionState.get(gameId)?.initial ?? reconnectGates.get(gameId)?.promise;
    if (!pending) return Promise.resolve();
    let timer;
    return Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("initial_snapshot_wait_timeout")), initialSnapshotTimeoutMs);
    })]).finally(() => clearTimeout(timer));
  };
  return {
    connectGame: (gameId) => connect(gameId),
    waitForInitialSnapshot,
    prepareInitialLoad: async (gameId) => {
      if (!desiredGameIds.has(gameId)) return false;
      try { await waitForInitialSnapshot(gameId); }
      catch { await repair(gameId, "initial_load_fallback"); }
      return true;
    },
    getAdvertisedEventSeq: (gameId) => advertisedEventSeqByGameId.get(gameId) ?? 0,
    disconnectGame,
    disconnectAll,
    disconnect: () => disconnectAll(),
    retire: () => { retired = true; clearVisibilitySuspend(); disconnectAll(); },
    getDesiredGameIds: () => [...desiredGameIds],
  };
};

const createGameId = () => {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `game-${hex}`;
};

const getSeatForSide = (sideToMove) => (sideToMove === "P1" ? "Player 1" : "Player 2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const isPlayerRole = (role) => role === "Player 1" || role === "Player 2";
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

const createLocalRequestId = (prefix = "req") => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
};

const getSeatIdentity = (game, seat) => (seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null);

const createParticipant = (identityId, at) => ({
  identityId,
  connected: true,
  joinedAt: at,
  lastHeartbeatAt: at,
  sessionCount: 1,
});

const buildLocalGameView = ({
  gameId,
  identityId,
  createdAt,
  state,
  selfPlayMode = false,
  selfPlayStartSide = "p1",
  player1 = null,
  player2 = null,
  viewers = [],
  myRole = "Player 1",
  notifications = ["Game creation pending sync"],
  initialSelectionAction = null,
}) => {
  const stableState = resolveToStability(clone(state), { artifactMode: "full" });
  const currentTurn = {
    index: stableState.turnIndex ?? 0,
    startedAt: createdAt,
    endedAt: null,
    playerSeat: getSeatForSide(stableState.sideToMove),
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  const legalActions = listLegalActions(stableState);
  const turnOwnerSeat = currentTurn.playerSeat;
  const controlSeat = turnOwnerSeat;
  const roleAllowsPlay =
    myRole === "Player 1" || myRole === "Player 2" || (selfPlayMode && player1?.identityId === identityId && player2?.identityId === identityId);

  return {
    id: gameId,
    createdAt,
    lastMoveAt: null,
    updatedAt: createdAt,
    selfPlayMode,
    ...(selfPlayMode ? { selfPlayStartSide } : {}),
    player1,
    player2,
    viewers,
    pendingJoinRequests: [],
    pendingRevertRequest: null,
    turns: [clone(currentTurn)],
    moves: [],
    notifications,
    myRole,
    inHistoryMode: false,
    historyIndex: null,
    currentSnapshot: clone(stableState),
    board: { state: clone(stableState) },
    currentTurn: clone(currentTurn),
    turnOwnerSeat,
    controlSeat,
    control: "turn-owner",
    legalActions,
    canRecordMove: roleAllowsPlay && legalActions.length > 0,
    canEndTurn: false,
    canJoinAsPlayer: false,
    canJoinAsViewer: false,
    showJoinActions: true,
    canInvite: true,
    inviteToken: gameId,
    initialSelectionAction: initialSelectionAction ? clone(initialSelectionAction) : null,
  };
};

const createCurrentTurnFromState = (game, stableState, createdAt, activeMoves) => {
  const turnIndex = stableState.turnIndex ?? 0;
  const existingTurns = Array.isArray(game.turns) ? game.turns : [];
  const existingTurn = existingTurns.find((turn) => turn?.index === turnIndex) ?? null;
  const currentTurnMoves = activeMoves.filter((move) => move?.turnIndex === turnIndex);
  return {
    index: turnIndex,
    startedAt: existingTurn?.startedAt ?? currentTurnMoves[0]?.at ?? game.createdAt ?? createdAt,
    endedAt: null,
    playerSeat: existingTurn?.playerSeat ?? getSeatForSide(stableState.sideToMove),
    status: "active",
    moveIndexes: currentTurnMoves.map((move) => move.index),
    lastMoveAt: currentTurnMoves.at(-1)?.at ?? null,
  };
};

const buildTurnsAfterRevert = (game, stableState, activeMoves, revertedAt) => {
  const currentTurn = createCurrentTurnFromState(game, stableState, revertedAt, activeMoves);
  const existingTurns = Array.isArray(game.turns) ? game.turns : [];
  const priorTurns = existingTurns
    .filter((turn) => turn && typeof turn.index === "number" && turn.index < currentTurn.index)
    .map((turn) => {
      const turnMoves = activeMoves.filter((move) => move?.turnIndex === turn.index);
      return {
        ...clone(turn),
        moveIndexes: turnMoves.map((move) => move.index),
        lastMoveAt: turnMoves.at(-1)?.at ?? turn.lastMoveAt ?? null,
      };
    })
    .filter((turn) => turn.moveIndexes.length > 0);
  return [...priorTurns, currentTurn];
};

const buildOptimisticRevertRequestGame = ({ game, requestId, requesterIdentityId, targetMoveId }) => {
  const targetMoveIndex = Array.isArray(game.moves) ? game.moves.findIndex((move) => move?.moveId === targetMoveId) : -1;
  if (targetMoveIndex < 0) {
    throw createOperationError("The target move could not be found for the undo request.", "move_not_found");
  }
  const requestedAt = new Date().toISOString();
  const pendingRevertRequest = {
    requestId,
    requesterIdentityId,
    targetMoveId,
    targetMoveIndex,
    requestedAt,
    status: "pending",
  };
  const nextGame = clone(game);
  nextGame.pendingRevertRequest = pendingRevertRequest;
  nextGame.myPendingRevertRequest = pendingRevertRequest;
  nextGame.approvableRevertRequest = null;
  nextGame.notifications = ["Undo request pending approval", ...(Array.isArray(game.notifications) ? game.notifications : [])];
  nextGame.updatedAt = requestedAt;
  return nextGame;
};

const clearOptimisticRevertRequest = ({ game, notification }) => {
  const nextGame = clone(game);
  nextGame.pendingRevertRequest = null;
  nextGame.myPendingRevertRequest = null;
  nextGame.approvableRevertRequest = null;
  nextGame.notifications = [notification, ...(Array.isArray(game.notifications) ? game.notifications : [])];
  nextGame.updatedAt = new Date().toISOString();
  return nextGame;
};

const buildOptimisticApprovedRevertGame = ({
  game,
  requesterIdentityId,
  currentIdentityId,
  targetMoveId: explicitTargetMoveId = null,
}) => {
  const pendingRevertRequest = game.pendingRevertRequest ?? game.myPendingRevertRequest ?? game.approvableRevertRequest ?? null;
  const targetMoveId = explicitTargetMoveId ?? pendingRevertRequest?.targetMoveId ?? null;
  const targetMoveIndex =
    typeof pendingRevertRequest?.targetMoveIndex === "number"
      ? pendingRevertRequest.targetMoveIndex
      : Array.isArray(game.moves)
        ? game.moves.findIndex((move) => move?.moveId === targetMoveId)
        : -1;
  const targetMove = targetMoveIndex >= 0 ? game.moves[targetMoveIndex] ?? null : null;
  if (!targetMoveId || !targetMove?.selectionSnapshot) {
    throw createOperationError("The undo target could not be resolved for local prediction.", "move_not_found");
  }
  const revertedAt = new Date().toISOString();
  const moves = Array.isArray(game.moves)
    ? game.moves.map((move, index) =>
        index >= targetMoveIndex
          ? {
              ...clone(move),
              undone: true,
              undoneAt: revertedAt,
              undoneByIdentityId: requesterIdentityId,
            }
          : clone(move),
      )
    : [];
  const activeMoves = moves.filter((move) => move?.undone !== true);
  const stableState = resolveToStability(clone(targetMove.selectionSnapshot), { artifactMode: "full" });
  const currentTurn = createCurrentTurnFromState(game, stableState, revertedAt, activeMoves);
  const turns = buildTurnsAfterRevert(game, stableState, activeMoves, revertedAt);
  const turnOwnerSeat = currentTurn.playerSeat;
  const controlSeat = getControlSeatForTurn(stableState, turnOwnerSeat);
  const roleAllowsPlay = isPlayerRole(game.myRole);
  const latestActiveMove = activeMoves.at(-1) ?? null;
  const latestActiveMoveSeat = latestActiveMove ? getSeatForSide(latestActiveMove.actorSide) : null;
  const latestActiveMoveIdentity = latestActiveMoveSeat ? getSeatIdentity(game, latestActiveMoveSeat) : null;
  const legalActions = listLegalActions(stableState);

  return {
    ...clone(game),
    moves,
    pendingRevertRequest: null,
    myPendingRevertRequest: null,
    approvableRevertRequest: null,
    historyIndex: null,
    inHistoryMode: false,
    currentSnapshot: clone(stableState),
    board: {
      ...(game.board ? clone(game.board) : {}),
      state: clone(stableState),
    },
    currentTurn,
    turns,
    historySelectionAction: null,
    initialSelectionAction: targetMove.action ? clone(targetMove.action) : null,
    turnOwnerSeat,
    controlSeat,
    control: controlSeat === turnOwnerSeat ? "turn-owner" : "opponent",
    legalActions,
    canRecordMove: roleAllowsPlay && legalActions.length > 0,
    canEndTurn:
      roleAllowsPlay && controlSeat === turnOwnerSeat && game.myRole === turnOwnerSeat && currentTurn.moveIndexes.length > 0,
    latestActiveMoveId: latestActiveMove?.moveId ?? null,
    canUndoLastMove: latestActiveMoveIdentity === currentIdentityId,
    pendingScenarioSelection: null,
    lastMoveAt: latestActiveMove?.at ?? null,
    updatedAt: revertedAt,
    notifications: ["Undo applied", ...(Array.isArray(game.notifications) ? game.notifications : [])],
  };
};

const readPendingLocalGames = (storage) => {
  const raw = storage?.getItem?.(PENDING_LOCAL_GAMES_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writePendingLocalGames = (storage, entries) => {
  if (!storage?.setItem) {
    return;
  }
  if (!entries || Object.keys(entries).length === 0) {
    storage.removeItem?.(PENDING_LOCAL_GAMES_KEY);
    return;
  }
  storage.setItem(PENDING_LOCAL_GAMES_KEY, JSON.stringify(entries));
};

const buildCommittedActionResult = ({ transport, gameId, fallback }) => {
  const game = transport.getAuthoritativeGame?.(gameId) ?? transport.getGameViewModel(gameId);
  return {
    ...(fallback ?? {}),
    ok: true,
    accepted: true,
    game,
    state: game?.board?.state ?? game?.currentSnapshot ?? fallback?.state ?? null,
    legalActions: Array.isArray(game?.legalActions) ? game.legalActions : fallback?.legalActions ?? [],
  };
};

const buildCommittedEndTurnResult = ({ transport, gameId, fallback }) => {
  const game = transport.getAuthoritativeGame?.(gameId) ?? transport.getGameViewModel(gameId);
  return {
    ...(fallback ?? {}),
    ok: true,
    accepted: true,
    game,
    state: game?.board?.state ?? game?.currentSnapshot ?? fallback?.state ?? null,
    legalActions: Array.isArray(game?.legalActions) ? game.legalActions : fallback?.legalActions ?? [],
    turn: game?.currentTurn ?? fallback?.turn ?? null,
    outcome: game?.board?.state?.outcome ?? game?.currentSnapshot?.outcome ?? fallback?.outcome ?? null,
  };
};

export const createSyncStore = ({
  storage,
  auth = null,
  onAuthLost = () => {},
  fetcher = fetch,
  random = Math.random,
  onEvent = () => {},
  onError = () => {},
  onStatus = () => {},
  onMetric = () => {},
  commandJournal,
  timing,
  createTransportStore = createLiveTransportStore,
  createSyncClient = createLiveSyncClient,
} = {}) => {
  let active = true;
  if (auth?.enabled) {
    const base = storage, prefix = `righelt.account.${auth.session.contextId || "anonymous"}.`;
    storage = { getItem: key => active ? base?.getItem(prefix + key) : null,
      setItem: (key,value) => { if (active) base?.setItem(prefix + key,value); },
      removeItem: key => { if (active) base?.removeItem(prefix + key); } };
  }
  const operationManager = createOperationManager();
  let pendingLocalGames = readPendingLocalGames(storage);
  let activeGameId = null;
  const getRollbackFailureHandle = (gameId) => {
    if (!gameId) {
      return null;
    }
    const handle = operationManager.getHandle(getRollbackFailureId(gameId));
    return handle?.status === "failed" ? handle : null;
  };
  const dismissRollbackFailure = (gameId) => {
    const rollbackHandle = getRollbackFailureHandle(gameId);
    if (rollbackHandle) {
      operationManager.dismiss(rollbackHandle.id);
    }
  };
  const upsertRollbackFailure = (gameId, message) => {
    if (!gameId || typeof message !== "string" || message.trim().length === 0) {
      return null;
    }
    const game = transport.getGameViewModel(gameId);
    if (!game) {
      return null;
    }
    dismissRollbackFailure(gameId);
    return operationManager.createFailed({
      id: getRollbackFailureId(gameId),
      gameId,
      result: game,
      error: createOperationError(message, "authoritative_rollback"),
    });
  };
  const isPendingOptimisticGameCreation = (gameId) => {
    const createHandle = operationManager.getHandle(`create:${gameId}`);
    if (createHandle?.status === "pending") {
      return true;
    }
    const branchHandle = operationManager.getHandle(`branch:${gameId}`);
    const stored = readPendingLocalGames(storage)[gameId];
    return branchHandle?.status === "pending" || Boolean(stored && !isFailedLocalStub(stored));
  };
  const transport = createTransportStore({
    storage,
    auth,
    fetcher,
    random,
    commandJournal,
    timing,
    beforeReconcile: (gameId, options) => options?.initialLoad && liveSync.prepareInitialLoad
      ? liveSync.prepareInitialLoad(gameId) : liveSync.waitForInitialSnapshot?.(gameId),
    shouldDeferCommandSend: (gameId, command) => {
      void command;
      return isPendingOptimisticGameCreation(gameId);
    },
  });

  const getStoredPendingLocalGame = (gameId) => {
    pendingLocalGames = readPendingLocalGames(storage);
    return gameId ? pendingLocalGames[gameId] ?? null : null;
  };

  const savePendingLocalGame = (game) => {
    pendingLocalGames = {
      ...readPendingLocalGames(storage),
      [game.id]: clone(game),
    };
    writePendingLocalGames(storage, pendingLocalGames);
  };

  const clearPendingLocalGame = (gameId) => {
    if (!gameId) {
      return;
    }
    pendingLocalGames = readPendingLocalGames(storage);
    if (!pendingLocalGames[gameId]) {
      return;
    }
    delete pendingLocalGames[gameId];
    writePendingLocalGames(storage, pendingLocalGames);
  };

  const confirmOperation = (clientCommandId) => {
    const handle = operationManager.getHandle(clientCommandId);
    if (!handle) {
      return;
    }
    clearPendingLocalGame(handle.gameId);
    const finalResult =
      handle.result?.turn !== undefined
        ? buildCommittedEndTurnResult({ transport, gameId: handle.gameId, fallback: handle.result })
        : buildCommittedActionResult({ transport, gameId: handle.gameId, fallback: handle.result });
    operationManager.confirm(clientCommandId, finalResult);
  };

  const failOperation = (clientCommandId, error, { preserveLocalGame = false } = {}) => {
    if (!clientCommandId) {
      return;
    }
    const handle = operationManager.getHandle(clientCommandId);
    if (!preserveLocalGame) {
      clearPendingLocalGame(handle?.gameId ?? null);
    }
    operationManager.fail(clientCommandId, error);
  };

  const getUnifiedFailedOperations = (gameId) => {
    const game = transport.getGameViewModel(gameId);
    const localFailureMessage = getLocalFailureMessage(game);
    if (game && localFailureMessage) {
      return [createRollbackFailureHandle(game, localFailureMessage)];
    }
    const rollbackHandle = getRollbackFailureHandle(gameId);
    return rollbackHandle ? [rollbackHandle] : operationManager.getFailedOperations(gameId);
  };

  const markGameCreationFailed = (gameId) => {
    const game = transport.getGameViewModel(gameId);
    if (!game) {
      return;
    }
    markLocalStubFailed(gameId, {
      notification: "Game creation failed",
      message: GAME_CREATION_FAILED_BANNER,
    });
  };

  const markLocalStubFailed = (gameId, { notification, message }) => {
    const game = transport.getGameViewModel(gameId);
    if (!game) {
      return null;
    }
    const failedGame = {
      ...clone(game),
      syncStatus: "ready",
      notifications: [
        notification,
        ...(Array.isArray(game.notifications) ? game.notifications.filter((entry) => entry !== notification) : []),
      ],
      pendingMoves: [],
      pendingCommandCount: 0,
      localFailureMessage:
        typeof message === "string" && message.trim().length > 0 ? message.trim() : "The operation could not be completed.",
    };
    transport.applyLiveGameUpdate({ game: failedGame });
    savePendingLocalGame(failedGame);
    syncActiveGame();
    return failedGame;
  };

  const failDependentOperationsForGame = (gameId, error, excludedOperationIds = [], options = {}) => {
    const excluded = new Set(excludedOperationIds.filter(Boolean));
    const pendingOperations = operationManager.getPendingOperations(gameId);
    for (const handle of pendingOperations) {
      if (excluded.has(handle.id)) {
        continue;
      }
      failOperation(handle.id, error, options);
    }
  };

  const optimisticOperationOwner = new Map();
  const runOptimisticGameOperation = ({ id, gameId, buildOptimisticGame, commit }) => {
    const currentGame = transport.getGameViewModel(gameId);
    if (!currentGame) {
      throw createOperationError(`Game ${gameId} is not loaded.`, "game_not_loaded");
    }
    if (currentGame.sharedMutationsBlocked) throw createOperationError("Recovery is in progress.", "sync_recovering");
    const previousGame = clone(currentGame);
    const operationSequence = transport.getLastEventSeq(gameId);
    optimisticOperationOwner.set(gameId, id);
    const optimisticGame = buildOptimisticGame(previousGame);
    transport.applyLiveGameUpdate({ game: optimisticGame });

    const handle = operationManager.enqueue({
      id,
      gameId,
      result: optimisticGame,
    });

    void Promise.resolve()
      .then(() => commit())
      .then((game) => {
        // The transport already applied the response with its authoritative sequence.
        operationManager.confirm(id, transport.getGameViewModel(gameId) ?? game ?? optimisticGame);
      })
      .catch((error) => {
        if (error.code !== "delivery_unknown" && optimisticOperationOwner.get(gameId) === id && transport.getLastEventSeq(gameId) === operationSequence) transport.applyLiveGameUpdate({ game: previousGame });
        operationManager.fail(id, error);
      });

    return handle;
  };

  transport.subscribe((change) => {
    const clientCommandId = typeof change?.clientCommandId === "string" ? change.clientCommandId : null;
    const gameId = typeof change?.gameId === "string" ? change.gameId : null;
    const failureNotice = typeof change?.failureNotice === "string" ? change.failureNotice.trim() : "";
    if (change?.type === "journal_restored") for (const id of change.clientCommandIds) operationManager.enqueue({ id, gameId, result: transport.getGameViewModel(gameId) });
    if (change?.type === "authoritative_update" && clientCommandId) {
      confirmOperation(clientCommandId);
    }
    if (change?.type === "optimistic_enqueue" && gameId) {
      dismissRollbackFailure(gameId);
    }
    if (change?.type === "optimistic_rollback" && clientCommandId) {
      failOperation(
        clientCommandId,
        createOperationError(failureNotice || "The game changed before your move could be completed. Check the board and try again.", "optimistic_rollback"),
      );
      const rejectedMoves = operationManager.getFailedOperations(gameId).filter((handle) => handle.error?.code === "optimistic_rollback").length;
      const notice = failureNotice || "The game changed before your move could be completed. Check the board and try again.";
      upsertRollbackFailure(gameId, rejectedMoves > 1 ? notice.replace("your move could", "your moves could") : notice);
    }
    if (change?.type === "optimistic_desynced" && clientCommandId) {
      failOperation(
        clientCommandId,
        createOperationError("Sync failed before the optimistic command could be confirmed.", "optimistic_desynced"),
      );
      upsertRollbackFailure(gameId, failureNotice || "Sync failed before the optimistic command could be confirmed.");
    }

  });

  const liveSync = createSyncClient({
    presenceFetcher: fetcher,
    auth,
    onAuthLost,
    identityId: transport.getIdentityId(),
    initialSnapshotTimeoutMs: timing?.requestTimeoutMs,
    inboundTimeoutMs: timing?.inboundTimeoutMs,
    heartbeatMs: timing?.heartbeatIntervalMs,
    onRecovery: ({ gameId }) => transport.setConnectionRecovering?.(gameId, true),
    onReconcile: ({ gameId }) => transport.reconcileGame?.(gameId),
    onReady: async ({ gameId, isCurrent = () => true }) => {
      if (transport.getGameViewModel(gameId)?.pendingCommandCount > 0) await transport.reconcileGame?.(gameId);
      if (isCurrent()) transport.setConnectionRecovering?.(gameId, false);
    },
    getLastEventSeq: (gameId) => (gameId ? transport.getLastEventSeq(gameId) : 0),
    onEvent: (payload, context = {}) => {
      if (!active) return false;
      if (isAuthoritativeSyncEvent(payload)) {
        const applied = transport.applyLiveGameUpdate({
          game: payload.game,
          eventSeq: payload.eventSeq,
          clientCommandId: payload.clientCommandId ?? null,
          commandOutcome: payload.commandOutcome ?? null,
        });
        if (applied === null) return false;
      }
      onEvent(payload, context);
      return true;
    },
    onError,
    onStatus,
    onMetric,
  });

  const syncActiveGame = () => {
    if (!active) return;
    if (auth?.enabled && auth.pendingLogout) {
      liveSync.disconnectAll();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      liveSync.disconnectAll();
      return;
    }
    if (!activeGameId) {
      liveSync.disconnectAll();
      return;
    }
    const activeGame =
      activeGameId && typeof transport.getGameViewModel === "function" ? transport.getGameViewModel(activeGameId) : null;
    const desiredGameIds = isFailedLocalStub(activeGame) || isPendingOptimisticGameCreation(activeGameId) ? new Set() : new Set([activeGameId]);
    for (const gameId of liveSync.getDesiredGameIds()) {
      if (!desiredGameIds.has(gameId)) {
        liveSync.disconnectGame(gameId);
      }
    }
    for (const gameId of desiredGameIds) {
      if (!liveSync.getDesiredGameIds().includes(gameId)) {
        liveSync.connectGame(gameId);
      }
    }
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (!active) return;
      if (event.key !== PENDING_LOCAL_GAMES_KEY || !activeGameId) return;
      const gameId = activeGameId;
      try {
        const before = JSON.parse(event.oldValue || "{}")[gameId];
        const after = JSON.parse(event.newValue || "{}")[gameId];
        if (JSON.stringify(before) === JSON.stringify(after)) return;
      } catch { return; }
      const stored = getStoredPendingLocalGame(gameId);
      if (stored) {
        transport.applyLiveGameUpdate({ game: stored });
        if (isFailedLocalStub(stored)) {
          transport.discardPendingCommands?.(gameId, { notice: stored.localFailureMessage });
          failDependentOperationsForGame(gameId, createOperationError(stored.localFailureMessage), [], { preserveLocalGame: true });
        }
        syncActiveGame();
      } else {
        void transport.loadGame(gameId).then(() => {
          if (activeGameId !== gameId) return;
          syncActiveGame();
          transport.flushPendingCommands?.(gameId);
        }).catch(onError);
      }
    });
    window.addEventListener("online", () => {
      syncActiveGame();
    });
    window.addEventListener("offline", () => {
      liveSync.disconnectAll();
    });
  }

  return {
    ...transport,
    retire() { active = false; activeGameId = null; liveSync.retire?.(); liveSync.disconnectAll(); transport.retire?.(); },
    loadGame: async (gameId, options = {}) => {
      const localPendingGame = transport.getGameViewModel(gameId) ?? getStoredPendingLocalGame(gameId);
      const hasPendingOperation = operationManager.getPendingOperations(gameId).length > 0;
      const shouldHydrateLocalGame = Boolean(localPendingGame) && (hasPendingOperation || isFailedLocalStub(localPendingGame));
      if (shouldHydrateLocalGame) {
        if (!transport.getGameViewModel(gameId)) {
          transport.applyLiveGameUpdate({ game: localPendingGame });
        }
        return transport.getGameViewModel(gameId) ?? localPendingGame;
      }
      try {
        const loadedGame = await transport.loadGame(gameId, options);
        clearPendingLocalGame(gameId);
        return loadedGame;
      } catch (error) {
        const fallbackPendingGame = getStoredPendingLocalGame(gameId);
        const fallbackGame = transport.getGameViewModel(gameId) ?? fallbackPendingGame;
        if (fallbackGame && (fallbackPendingGame || hasPendingOperation || isFailedLocalStub(fallbackGame))) {
          if (fallbackPendingGame) {
            transport.applyLiveGameUpdate({ game: fallbackPendingGame });
          }
          return transport.getGameViewModel(gameId) ?? fallbackPendingGame ?? fallbackGame;
        }
        throw error;
      }
    },
    createGame: ({ selfPlayMode = false, creatorSide = "p1" } = {}) => {
      const gameId = createGameId();
      const createdAt = new Date().toISOString();
      const identityId = transport.getIdentityId();
      const player1 = selfPlayMode || creatorSide === "p1" ? createParticipant(identityId, createdAt) : null;
      const player2 = selfPlayMode || creatorSide === "p2" ? createParticipant(identityId, createdAt) : null;
      const stubGame = buildLocalGameView({
        gameId,
        identityId,
        createdAt,
        state: createInitialState(),
        selfPlayMode,
        selfPlayStartSide: creatorSide,
        player1,
        player2,
        myRole: creatorSide === "p2" && !selfPlayMode ? "Player 2" : "Player 1",
        notifications: ["Game creation pending sync"],
      });
      transport.applyLiveGameUpdate({ game: stubGame });
      savePendingLocalGame(stubGame);

      const handle = operationManager.enqueue({
        id: `create:${gameId}`,
        gameId,
        result: stubGame,
      });

      void transport
        .createGame({ selfPlayMode, gameId, creatorSide })
        .then((game) => {
          if (game?.id !== gameId) {
            const mismatchError = createGameIdMismatchError("Game creation", gameId, game?.id ?? "unknown");
            transport.discardPendingCommands?.(gameId, {
              notice: GAME_CREATION_FAILED_BANNER,
            });
            markGameCreationFailed(gameId);
            failOperation(`create:${gameId}`, mismatchError, { preserveLocalGame: true });
            failDependentOperationsForGame(gameId, mismatchError, [`create:${gameId}`], { preserveLocalGame: true });
            return;
          }
          transport.applyLiveGameUpdate({ game });
          operationManager.confirm(`create:${gameId}`, transport.getGameViewModel(gameId) ?? game);
          clearPendingLocalGame(gameId);
          syncActiveGame();
          transport.flushPendingCommands?.(gameId);
        })
        .catch((error) => {
          transport.discardPendingCommands?.(gameId, {
            notice: GAME_CREATION_FAILED_BANNER,
          });
          markGameCreationFailed(gameId);
          failOperation(`create:${gameId}`, error, { preserveLocalGame: true });
          failDependentOperationsForGame(gameId, error, [`create:${gameId}`], { preserveLocalGame: true });
        });

      return handle;
    },
    applyGameAction: async ({ gameId, state, action }) => {
      const response = await transport.applyGameAction({ gameId, state, action });
      if (!response?.accepted || typeof response?.clientCommandId !== "string") {
        return response;
      }
      const handle = operationManager.enqueue({ id: response.clientCommandId, gameId, result: response });
      const outcome = transport.getCommandOutcome?.(gameId, response.clientCommandId);
      if (outcome?.outcome === "accepted") operationManager.confirm(handle.id);
      if (outcome?.outcome === "rejected") operationManager.fail(handle.id, createOperationError(outcome.reason));
      return handle;
    },
    endTurn: async ({ gameId }) => {
      const response = await transport.endTurn({ gameId });
      if (typeof response?.clientCommandId !== "string") {
        return response;
      }
      const handle = operationManager.enqueue({ id: response.clientCommandId, gameId, result: response });
      const outcome = transport.getCommandOutcome?.(gameId, response.clientCommandId);
      if (outcome?.outcome === "accepted") operationManager.confirm(handle.id);
      if (outcome?.outcome === "rejected") operationManager.fail(handle.id, createOperationError(outcome.reason));
      return handle;
    },
    selectHistoryMove: ({ gameId, moveIndex }) => operationManager.createCommitted({
      id: `history:${gameId}:${moveIndex}:${Date.now()}`, gameId,
      result: transport.selectHistoryMove({ gameId, moveIndex }),
    }),
    returnToLive: ({ gameId }) => operationManager.createCommitted({
      id: `live:${gameId}:${Date.now()}`, gameId,
      result: transport.returnToLive({ gameId }),
    }),
    launchHistoryBranch: ({
      sourceGameId,
      sourceMoveIndex,
      scenario,
      initialSelectionAction,
      participantCopyMode,
      selfPlayMode = false,
    } = {}) => {
      const gameId = createGameId();
      const createdAt = new Date().toISOString();
      const identityId = transport.getIdentityId();
      const sourceGame = transport.getGameViewModel(sourceGameId);
      if (sourceGame?.sharedMutationsBlocked) throw createOperationError("Recovery is in progress.", "sync_recovering");
      const sideToMoveSeat = getSeatForSide(scenario?.resultingState?.sideToMove ?? "P1");
      let player1 = null;
      let player2 = null;
      let viewers = [];
      let myRole = sideToMoveSeat;

      if (participantCopyMode === "copy_source_participants" && sourceGame) {
        player1 = clone(sourceGame.player1 ?? null);
        player2 = clone(sourceGame.player2 ?? null);
        viewers = clone(Array.isArray(sourceGame.viewers) ? sourceGame.viewers : []);
        myRole = sourceGame.myRole ?? myRole;
      } else if (sideToMoveSeat === "Player 1") {
        player1 = createParticipant(identityId, createdAt);
      } else {
        player2 = createParticipant(identityId, createdAt);
      }

      const stubGame = buildLocalGameView({
        gameId,
        identityId,
        createdAt,
        state: scenario?.resultingState ?? createInitialState(),
        selfPlayMode,
        player1,
        player2,
        viewers,
        myRole,
        notifications: ["History branch pending sync"],
        initialSelectionAction,
      });
      transport.applyLiveGameUpdate({ game: stubGame });
      savePendingLocalGame(stubGame);

      const handle = operationManager.enqueue({
        id: `branch:${gameId}`,
        gameId,
        result: { game: stubGame },
      });

      void transport
        .launchHistoryBranch({
          gameId,
          sourceGameId,
          sourceMoveIndex,
          scenario,
          initialSelectionAction,
          participantCopyMode,
          selfPlayMode,
        })
        .then((result) => {
          if (result?.game?.id !== gameId) {
            const mismatchError = createGameIdMismatchError("History branch creation", gameId, result?.game?.id ?? "unknown");
            transport.discardPendingCommands?.(gameId, {
              notice: "Queued local actions were cleared because history branch creation failed to bind to the expected game id.",
            });
            markLocalStubFailed(gameId, {
              notification: "History branch creation failed",
              message: mismatchError.message,
            });
            failOperation(`branch:${gameId}`, mismatchError, { preserveLocalGame: true });
            failDependentOperationsForGame(gameId, mismatchError, [`branch:${gameId}`], { preserveLocalGame: true });
            return;
          }
          if (result?.game) {
            transport.applyLiveGameUpdate({ game: result.game });
          }
          operationManager.confirm(`branch:${gameId}`, {
            ...(result ?? {}),
            game: transport.getGameViewModel(gameId) ?? result?.game ?? stubGame,
          });
          clearPendingLocalGame(gameId);
          syncActiveGame();
          transport.flushPendingCommands?.(gameId);
        })
        .catch((error) => {
          transport.discardPendingCommands?.(gameId, {
            notice: "Queued local actions were cleared because history branch creation failed.",
          });
          markLocalStubFailed(gameId, {
            notification: "History branch creation failed",
            message: error?.message || "History branch creation failed.",
          });
          failOperation(`branch:${gameId}`, error, { preserveLocalGame: true });
          failDependentOperationsForGame(gameId, error, [`branch:${gameId}`], { preserveLocalGame: true });
        });

      return handle;
    },
    requestRevertToMove: ({ gameId, targetMoveId }) => {
      const currentGame = transport.getGameViewModel(gameId);
      if (!currentGame) {
        throw createOperationError(`Game ${gameId} is not loaded.`, "game_not_loaded");
      }
      const requesterIdentityId = transport.getIdentityId();
      const targetMove = Array.isArray(currentGame.moves) ? currentGame.moves.find((move) => move?.moveId === targetMoveId) ?? null : null;
      if (!targetMove) {
        throw createOperationError("The target move could not be found for the undo request.", "move_not_found");
      }
      const requesterSeat = isPlayerRole(currentGame.myRole) ? currentGame.myRole : getSeatForSide(targetMove.actorSide);
      const approverIdentityId = getSeatIdentity(currentGame, getNextSeat(requesterSeat));
      const requestId = createLocalRequestId("revert");
      return runOptimisticGameOperation({
        id: `revert-request:${requestId}`,
        gameId,
        buildOptimisticGame: (game) =>
          approverIdentityId
            ? buildOptimisticRevertRequestGame({ game, requestId, requesterIdentityId, targetMoveId })
            : buildOptimisticApprovedRevertGame({
                game,
                requesterIdentityId,
                currentIdentityId: requesterIdentityId,
                targetMoveId,
              }),
        commit: async () => transport.requestRevertToMove({ gameId, targetMoveId, requestId }),
      });
    },
    approveRevertRequest: ({ gameId, requestId }) => {
      const currentGame = transport.getGameViewModel(gameId);
      const requesterIdentityId = currentGame?.pendingRevertRequest?.requesterIdentityId ?? currentGame?.myPendingRevertRequest?.requesterIdentityId;
      const currentIdentityId = transport.getIdentityId();
      if (!requesterIdentityId) {
        throw createOperationError("No pending undo request is available to approve.", "request_not_found");
      }
      return runOptimisticGameOperation({
        id: `revert-approve:${requestId}`,
        gameId,
        buildOptimisticGame: (game) => buildOptimisticApprovedRevertGame({ game, requesterIdentityId, currentIdentityId }),
        commit: async () => transport.approveRevertRequest({ gameId, requestId }),
      });
    },
    rejectRevertRequest: ({ gameId, requestId }) =>
      runOptimisticGameOperation({
        id: `revert-reject:${requestId}`,
        gameId,
        buildOptimisticGame: (game) => clearOptimisticRevertRequest({ game, notification: "Undo request rejected" }),
        commit: async () => transport.rejectRevertRequest({ gameId, requestId }),
      }),
    rescindRevertRequest: ({ gameId, requestId }) =>
      runOptimisticGameOperation({
        id: `revert-rescind:${requestId}`,
        gameId,
        buildOptimisticGame: (game) => clearOptimisticRevertRequest({ game, notification: "Undo request rescinded" }),
        commit: async () => transport.rescindRevertRequest({ gameId, requestId }),
      }),
    setActiveGameId: (gameId) => {
      activeGameId = gameId || null;
      syncActiveGame();
    },
    getActiveGameId: () => activeGameId,
    getGameHandle: (gameId) => {
      if (!gameId) {
        return null;
      }
      const pendingHandle =
        operationManager.getHandle(`create:${gameId}`) ??
        operationManager.getHandle(`branch:${gameId}`) ??
        null;
      if (pendingHandle) {
        return pendingHandle;
      }
      const game = transport.getGameViewModel(gameId);
      return game ? operationManager.createCommitted({ id: `game:${gameId}`, gameId, result: game }) : null;
    },
    getPendingOperations: (gameId) => operationManager.getPendingOperations(gameId),
    getFailedOperations: (gameId) => getUnifiedFailedOperations(gameId),
    dismissFailedOperation: (operationId) => {
      const handle = operationManager.getHandle(operationId);
      if (handle?.status === "failed") {
        if (handle.gameId) {
          const rollbackFailureId = getRollbackFailureId(handle.gameId);
          for (const failedHandle of operationManager.getFailedOperations(handle.gameId)) {
            if (failedHandle.id !== handle.id && (failedHandle.id === rollbackFailureId || operationId === rollbackFailureId)) {
              operationManager.dismiss(failedHandle.id);
            }
          }
        }
        operationManager.dismiss(operationId);
        return;
      }
      const rollbackGameId = getRollbackFailureGameId(operationId);
      if (rollbackGameId) {
        const game = transport.getGameViewModel(rollbackGameId);
        if (isFailedLocalStub(game)) {
          const nextGame = clone(game);
          delete nextGame.localFailureMessage;
          transport.applyLiveGameUpdate({ game: nextGame });
          clearPendingLocalGame(rollbackGameId);
        }
        for (const failedHandle of operationManager.getFailedOperations(rollbackGameId)) {
          operationManager.dismiss(failedHandle.id);
        }
      }
    },
    dismissOperation: (operationId) => operationManager.dismiss(operationId),
  };
};
