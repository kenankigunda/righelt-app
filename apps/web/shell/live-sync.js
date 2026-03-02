const WS_RECONNECT_BASE_MS = 500;
const WS_RECONNECT_MAX_MS = 6000;
const WS_HEARTBEAT_MS = 10_000;

const createWsUrl = ({ scope, identityId, gameId = null }) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({ scope, identityId });
  if (scope === "game" && gameId) {
    params.set("gameId", gameId);
  }
  return `${protocol}://${window.location.host}/api/shell/ws?${params.toString()}`;
};

export const createLiveSyncClient = ({ identityId, onEvent, onError = () => {}, onStatus = () => {} }) => {
  let socket = null;
  let stopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let mode = null;
  let heartbeatTimer = null;

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

  const connect = ({ scope, gameId = null }) => {
    if (typeof WebSocket === "undefined") {
      onError(new Error("websocket_unavailable"));
      return;
    }

    cleanupSocket();
    clearReconnect();
    mode = { scope, gameId };
    onStatus({ state: "connecting", scope, gameId, reconnectAttempts });

    const ws = new WebSocket(createWsUrl({ scope, identityId, gameId }));
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        try {
          ws.send("ping");
        } catch {
          clearHeartbeat();
        }
      }, WS_HEARTBEAT_MS);
      onStatus({ state: "connected", scope, gameId, reconnectAttempts });
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}");
        onEvent(payload);
      } catch {
        // ignore malformed events
      }
    });

    ws.addEventListener("error", () => {
      onError(new Error("websocket_error"));
      onStatus({ state: "error", scope, gameId, reconnectAttempts });
    });

    ws.addEventListener("close", () => {
      onStatus({ state: "closed", scope, gameId, reconnectAttempts });
      if (!stopped) {
        scheduleReconnect();
      }
    });
  };

  return {
    connectHome: () => connect({ scope: "home" }),
    connectGame: (gameId) => connect({ scope: "game", gameId }),
    disconnect: () => {
      stopped = true;
      clearReconnect();
      clearHeartbeat();
      cleanupSocket();
      mode = null;
      onStatus({ state: "disconnected", scope: null, gameId: null, reconnectAttempts });
    },
    resume: () => {
      stopped = false;
      if (mode) {
        connect(mode);
      }
    },
  };
};
