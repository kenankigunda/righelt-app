const WS_RECONNECT_BASE_MS = 500;
const WS_RECONNECT_MAX_MS = 6000;
const HEARTBEAT_MS = 15_000;
const LOCAL_API_WS_HOST = "127.0.0.1:8787";

const isLocalDevHost = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const createWsUrl = ({ identityId, gameId, lastEventSeq }) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    identityId,
    lastEventSeq: String(lastEventSeq ?? 0),
  });
  const host = isLocalDevHost(window.location.hostname) ? LOCAL_API_WS_HOST : window.location.host;
  return `${protocol}://${host}/api/shell/games/${encodeURIComponent(gameId)}/ws?${params.toString()}`;
};

export const createLiveSyncClient = ({
  identityId,
  getLastEventSeq = () => 0,
  onEvent,
  onError = () => {},
  onStatus = () => {},
}) => {
  let socket = null;
  let stopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let mode = null;
  let lastEventSeq = 0;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const cleanupSocket = () => {
    clearHeartbeat();
    if (!socket) {
      return;
    }
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  };

  const sendHeartbeat = () => {
    if (!socket || socket.readyState !== 1) {
      return;
    }
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

  const scheduleReconnect = () => {
    if (stopped || !mode) {
      return;
    }
    clearReconnect();
    const delay = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      if (!mode || stopped) {
        return;
      }
      connect(mode);
    }, delay);
  };

  const connect = ({ gameId }) => {
    if (typeof WebSocket === "undefined") {
      onError(new Error("websocket_unavailable"));
      return;
    }

    cleanupSocket();
    clearReconnect();
    mode = { gameId };
    lastEventSeq = Math.max(lastEventSeq, Number(getLastEventSeq() || 0));
    onStatus({ state: "connecting", gameId, reconnectAttempts });

    const ws = new WebSocket(createWsUrl({ identityId, gameId, lastEventSeq }));
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      onStatus({ state: "connected", gameId, reconnectAttempts });
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}");
        if (typeof payload?.eventSeq === "number") {
          lastEventSeq = Math.max(lastEventSeq, payload.eventSeq);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "ack", lastEventSeq }));
          }
        }
        onEvent(payload);
      } catch {
        // ignore malformed events
      }
    });

    ws.addEventListener("error", () => {
      onError(new Error("websocket_error"));
      onStatus({ state: "error", gameId, reconnectAttempts });
    });

    ws.addEventListener("close", () => {
      clearHeartbeat();
      onStatus({ state: "closed", gameId, reconnectAttempts });
      if (!stopped) {
        scheduleReconnect();
      }
    });
  };

  return {
    connectGame: (gameId) => connect({ gameId }),
    disconnect: () => {
      stopped = true;
      clearReconnect();
      cleanupSocket();
      mode = null;
      onStatus({ state: "disconnected", gameId: null, reconnectAttempts });
    },
    resume: () => {
      stopped = false;
      if (mode) {
        connect(mode);
      }
    },
  };
};
