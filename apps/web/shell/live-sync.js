import { buildLocalApiWsHost, isLocalDevHost } from "../local-dev-ports.js";

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 45_000;
const VISIBILITY_SUSPEND_GRACE_MS = 5_000;

const createWsUrl = ({ identityId, gameId, lastEventSeq }) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    identityId,
    lastEventSeq: String(lastEventSeq ?? 0),
  });
  const host = isLocalDevHost(window.location.hostname) ? buildLocalApiWsHost(window.location.port) : window.location.host;
  return `${protocol}://${host}/api/shell/games/${encodeURIComponent(gameId)}/ws?${params.toString()}`;
};

export const createLiveSyncClient = ({
  identityId,
  getLastEventSeq = () => 0,
  onEvent,
  onError = () => {},
  onStatus = () => {},
  onMetric = () => {},
  reconnectBaseMs = WS_RECONNECT_BASE_MS,
  reconnectMaxMs = WS_RECONNECT_MAX_MS,
  heartbeatMs = HEARTBEAT_MS,
  visibilitySuspendGraceMs = VISIBILITY_SUSPEND_GRACE_MS,
}) => {
  const sockets = new Map();
  const reconnectTimers = new Map();
  const heartbeatTimers = new Map();
  const reconnectAttemptsByGameId = new Map();
  const lastEventSeqByGameId = new Map();
  const desiredGameIds = new Set();
  const closeReasonBySocket = new Map();
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

  const shouldKeepConnectionsActive = () => !isDocumentHidden();

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

  const cleanupSocket = (gameId, { closeReason = "intentional_disconnect", emitDisconnected = false } = {}) => {
    clearHeartbeat(gameId);
    const socket = sockets.get(gameId) ?? null;
    if (!socket) {
      if (emitDisconnected) {
        onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
      }
      return;
    }
    sockets.delete(gameId);
    closeReasonBySocket.set(socket, closeReason);
    try {
      socket.close();
    } catch {
      // ignore
    }
    if (emitDisconnected) {
      onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    }
  };

  const sendHeartbeat = (gameId) => {
    const socket = sockets.get(gameId) ?? null;
    if (!socket || socket.readyState !== 1) {
      return;
    }
    const lastEventSeq = lastEventSeqByGameId.get(gameId) ?? 0;
    try {
      socket.send(
        JSON.stringify({
          type: "heartbeat",
          identityId,
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
    const jitter = 0.85 + Math.random() * 0.3;
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
    lastEventSeqByGameId.set(gameId, lastEventSeq);
    onStatus({ state: "connecting", gameId, reconnectAttempts });

    const ws = new WebSocket(createWsUrl({ identityId, gameId, lastEventSeq }));
    sockets.set(gameId, ws);
    recordMetric("socket_opened", { gameId, reconnectAttempts });

    ws.addEventListener("open", () => {
      reconnectAttemptsByGameId.set(gameId, 0);
      onStatus({ state: "connected", gameId, reconnectAttempts: 0 });
      sendHeartbeat(gameId);
      heartbeatTimers.set(gameId, setInterval(() => sendHeartbeat(gameId), heartbeatMs));
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}");
        if (typeof payload?.eventSeq === "number") {
          const nextLastEventSeq = Math.max(lastEventSeqByGameId.get(gameId) ?? 0, payload.eventSeq);
          lastEventSeqByGameId.set(gameId, nextLastEventSeq);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "ack", lastEventSeq: nextLastEventSeq }));
          }
        }
        onEvent(payload, { gameId });
      } catch {
        // ignore malformed events
      }
    });

    ws.addEventListener("error", () => {
      recordMetric("socket_error", { gameId });
      onError(new Error("websocket_error"));
      onStatus({ state: "error", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    });

    ws.addEventListener("close", () => {
      const closeReason = closeReasonBySocket.get(ws) ?? "unexpected_close";
      closeReasonBySocket.delete(ws);
      clearHeartbeat(gameId);
      if (sockets.get(gameId) === ws) {
        sockets.delete(gameId);
      }
      if (closeReason.startsWith("intentional_suspend:")) {
        onStatus({ state: "suspended", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
        recordMetric("socket_closed_by_client", { gameId, reason: closeReason });
        return;
      }
      if (closeReason === "intentional_disconnect") {
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
    clearReconnect(gameId);
    cleanupSocket(gameId, { closeReason: "intentional_disconnect", emitDisconnected: true });
  };

  const disconnectAll = () => {
    clearVisibilitySuspend();
    suspendedForInvisibility = false;
    const gameIds = new Set([...desiredGameIds, ...sockets.keys()]);
    desiredGameIds.clear();
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
      resumeDesiredConnections();
    });
  }

  return {
    connectGame: (gameId) => connect(gameId),
    disconnectGame,
    disconnectAll,
    disconnect: () => disconnectAll(),
    getDesiredGameIds: () => [...desiredGameIds],
  };
};
