import { buildLocalApiOrigin, buildLocalApiWsHost, isLocalDevHost } from "../local-dev-ports.js";

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 45_000;
const VISIBILITY_SUSPEND_GRACE_MS = 5_000;

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(16).slice(2)}-${Date.now()}`;
};

const createWsUrl = ({ identityId, gameId, sessionId, lastEventSeq }) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    identityId,
    sessionId,
    lastEventSeq: String(lastEventSeq ?? 0),
  });
  const host = isLocalDevHost(window.location.hostname) ? buildLocalApiWsHost(window.location.port) : window.location.host;
  return `${protocol}://${host}/api/shell/games/${encodeURIComponent(gameId)}/ws?${params.toString()}`;
};

const createPresenceUrl = (gameId) => {
  const origin = isLocalDevHost(window.location.hostname)
    ? buildLocalApiOrigin(window.location.port)
    : window.location.origin ?? `${window.location.protocol}//${window.location.host}`;
  return `${origin}/api/shell/games/${encodeURIComponent(gameId)}/presence`;
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
  const sessionIdByGameId = new Map();
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

  const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

  const shouldKeepConnectionsActive = () => !isDocumentHidden() && isOnline();

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
    if (!gameId) {
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
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(createPresenceUrl(gameId), new Blob([payload], { type: "application/json" }));
        recordMetric("presence_signal_sent", { gameId, signal: type, transport: sent ? "beacon" : "beacon_failed" });
        if (sent) {
          return;
        }
      }
    } catch {
      // ignore
    }
    if (typeof fetch === "function") {
      void fetch(createPresenceUrl(gameId), {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    if (closeReason.startsWith("intentional_suspend:")) {
      sendPresenceHint(gameId, "inactive");
    } else if (closeReason === "intentional_disconnect") {
      sendPresenceHint(gameId, "disconnecting");
    } else if (closeReason === "network_offline" || closeReason === "pagehide") {
      sendPresenceHint(gameId, "disconnecting", { preferBeacon: true });
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
    const sessionId = createSessionId();
    sessionIdByGameId.set(gameId, sessionId);
    lastEventSeqByGameId.set(gameId, lastEventSeq);
    onStatus({ state: "connecting", gameId, reconnectAttempts });

    const ws = new WebSocket(createWsUrl({ identityId, gameId, sessionId, lastEventSeq }));
    sockets.set(gameId, ws);
    recordMetric("socket_opened", { gameId, reconnectAttempts });

    ws.addEventListener("open", () => {
      reconnectAttemptsByGameId.set(gameId, 0);
      onStatus({ state: "connected", gameId, reconnectAttempts: 0 });
      refreshHeartbeatLoop(gameId);
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}");
        if (typeof payload?.eventSeq === "number") {
          const nextLastEventSeq = Math.max(lastEventSeqByGameId.get(gameId) ?? 0, payload.eventSeq);
          lastEventSeqByGameId.set(gameId, nextLastEventSeq);
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
      if (closeReason === "pagehide") {
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
      for (const gameId of sockets.keys()) {
        refreshHeartbeatLoop(gameId);
      }
      resumeDesiredConnections();
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

  return {
    connectGame: (gameId) => connect(gameId),
    disconnectGame,
    disconnectAll,
    disconnect: () => disconnectAll(),
    getDesiredGameIds: () => [...desiredGameIds],
  };
};
