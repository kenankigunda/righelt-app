import { createLiveSyncClient } from "./live-sync.js";
import { createLiveTransportStore } from "./live-transport.js";
import { createOperationManager } from "./operation-manager.js";

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

const buildCommittedActionResult = ({ transport, gameId, fallback }) => {
  const game = transport.getGameViewModel(gameId);
  return {
    ...(fallback ?? {}),
    ok: true,
    accepted: true,
    game,
    state: game?.currentSnapshot ?? fallback?.state ?? null,
    legalActions: Array.isArray(game?.legalActions) ? game.legalActions : fallback?.legalActions ?? [],
  };
};

const buildCommittedEndTurnResult = ({ transport, gameId, fallback }) => {
  const game = transport.getGameViewModel(gameId);
  return {
    ...(fallback ?? {}),
    ok: true,
    accepted: true,
    game,
    state: game?.currentSnapshot ?? fallback?.state ?? null,
    legalActions: Array.isArray(game?.legalActions) ? game.legalActions : fallback?.legalActions ?? [],
    turn: game?.currentTurn ?? fallback?.turn ?? null,
    outcome: game?.currentSnapshot?.outcome ?? fallback?.outcome ?? null,
  };
};

export const createSyncStore = ({
  storage,
  fetcher = fetch,
  random = Math.random,
  onEvent = () => {},
  onError = () => {},
  onStatus = () => {},
  onMetric = () => {},
  createTransportStore = createLiveTransportStore,
  createSyncClient = createLiveSyncClient,
} = {}) => {
  const transport = createTransportStore({ storage, fetcher, random });
  const operationManager = createOperationManager();
  let activeGameId = null;

  const confirmOperation = (clientCommandId) => {
    const handle = operationManager.getHandle(clientCommandId);
    if (!handle) {
      return;
    }
    const finalResult =
      handle.result?.turn !== undefined
        ? buildCommittedEndTurnResult({ transport, gameId: handle.gameId, fallback: handle.result })
        : buildCommittedActionResult({ transport, gameId: handle.gameId, fallback: handle.result });
    operationManager.confirm(clientCommandId, finalResult);
  };

  const failOperation = (clientCommandId, error) => {
    if (!clientCommandId) {
      return;
    }
    operationManager.fail(clientCommandId, error);
  };

  transport.subscribe((change) => {
    const clientCommandId = typeof change?.clientCommandId === "string" ? change.clientCommandId : null;
    if (change?.type === "authoritative_update" && clientCommandId) {
      confirmOperation(clientCommandId);
    }
    if (change?.type === "optimistic_rollback" && clientCommandId) {
      failOperation(
        clientCommandId,
        createOperationError("Predicted move was rejected by the authoritative game state.", "optimistic_rollback"),
      );
    }
    if (change?.type === "optimistic_desynced" && clientCommandId) {
      failOperation(
        clientCommandId,
        createOperationError("Sync failed before the optimistic command could be confirmed.", "optimistic_desynced"),
      );
    }
  });

  const liveSync = createSyncClient({
    identityId: transport.getIdentityId(),
    getLastEventSeq: (gameId) => (gameId ? transport.getLastEventSeq(gameId) : 0),
    onEvent: (payload, context = {}) => {
      if (isAuthoritativeSyncEvent(payload)) {
        transport.applyLiveGameUpdate({
          game: payload.game,
          eventSeq: payload.eventSeq,
          clientCommandId: payload.clientCommandId ?? null,
        });
      }
      onEvent(payload, context);
    },
    onError,
    onStatus,
    onMetric,
  });

  const syncActiveGame = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      liveSync.disconnectAll();
      return;
    }
    if (!activeGameId) {
      liveSync.disconnectAll();
      return;
    }
    const desiredGameIds = new Set([activeGameId]);
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
    window.addEventListener("online", () => {
      syncActiveGame();
    });
    window.addEventListener("offline", () => {
      liveSync.disconnectAll();
    });
  }

  return {
    ...transport,
    applyGameAction: async ({ gameId, state, action }) => {
      const response = await transport.applyGameAction({ gameId, state, action });
      if (!response?.accepted || typeof response?.clientCommandId !== "string") {
        return response;
      }
      return operationManager.enqueue({
        id: response.clientCommandId,
        gameId,
        result: response,
      });
    },
    endTurn: async ({ gameId }) => {
      const response = await transport.endTurn({ gameId });
      if (typeof response?.clientCommandId !== "string") {
        return response;
      }
      return operationManager.enqueue({
        id: response.clientCommandId,
        gameId,
        result: response,
      });
    },
    setActiveGameId: (gameId) => {
      activeGameId = gameId || null;
      syncActiveGame();
    },
    getActiveGameId: () => activeGameId,
    getPendingOperations: (gameId) => operationManager.getPendingOperations(gameId),
    getFailedOperations: (gameId) => operationManager.getFailedOperations(gameId),
    dismissOperation: (operationId) => operationManager.dismiss(operationId),
  };
};
