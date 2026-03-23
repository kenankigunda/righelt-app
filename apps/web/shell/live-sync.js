import { buildLocalApiWsHost, isLocalDevHost } from "../local-dev-ports.js";

const WS_RECONNECT_BASE_MS = 500;
const WS_RECONNECT_MAX_MS = 6000;
const HEARTBEAT_MS = 15_000;

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
}) => {
  const sockets = new Map();
  const reconnectTimers = new Map();
  const heartbeatTimers = new Map();
  const reconnectAttemptsByGameId = new Map();
  const lastEventSeqByGameId = new Map();
  const desiredGameIds = new Set();

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

  const cleanupSocket = (gameId, { emitDisconnected = false } = {}) => {
    clearHeartbeat(gameId);
    const socket = sockets.get(gameId) ?? null;
    if (!socket) {
      if (emitDisconnected) {
        onStatus({ state: "disconnected", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
      }
      return;
    }
    sockets.delete(gameId);
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
    } catch {
      // ignore
    }
  };

  const scheduleReconnect = (gameId) => {
    if (!desiredGameIds.has(gameId)) {
      return;
    }
    clearReconnect(gameId);
    const reconnectAttempts = reconnectAttemptsByGameId.get(gameId) ?? 0;
    const delay = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** reconnectAttempts);
    reconnectAttemptsByGameId.set(gameId, reconnectAttempts + 1);
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

    ws.addEventListener("open", () => {
      reconnectAttemptsByGameId.set(gameId, 0);
      onStatus({ state: "connected", gameId, reconnectAttempts: 0 });
      sendHeartbeat(gameId);
      heartbeatTimers.set(gameId, setInterval(() => sendHeartbeat(gameId), HEARTBEAT_MS));
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
      onError(new Error("websocket_error"));
      onStatus({ state: "error", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
    });

    ws.addEventListener("close", () => {
      clearHeartbeat(gameId);
      if (sockets.get(gameId) === ws) {
        sockets.delete(gameId);
      }
      onStatus({ state: "closed", gameId, reconnectAttempts: reconnectAttemptsByGameId.get(gameId) ?? 0 });
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
    cleanupSocket(gameId, { emitDisconnected: true });
  };

  const disconnectAll = () => {
    const gameIds = new Set([...desiredGameIds, ...sockets.keys()]);
    desiredGameIds.clear();
    for (const gameId of gameIds) {
      clearReconnect(gameId);
      cleanupSocket(gameId, { emitDisconnected: true });
    }
  };

  return {
    connectGame: (gameId) => connect(gameId),
    disconnectGame,
    disconnectAll,
    disconnect: () => disconnectAll(),
  };
};
