import { createLiveTransportStore } from "./live-transport.js";
import { createLiveSyncClient } from "./live-sync.js";

export const createSyncStore = ({
  storage,
  fetcher = fetch,
  random = Math.random,
  onSyncEvent = () => {},
  onSyncStatus = () => {},
  onSyncMetric = () => {},
  onSyncError = () => {},
}) => {
  const transport = createLiveTransportStore({ storage, fetcher, random });

  let activeGameId = null;

  const liveSync = createLiveSyncClient({
    identityId: transport.getIdentityId(),
    getLastEventSeq: (gameId) => (gameId ? transport.getLastEventSeq(gameId) : 0),
    onEvent: (payload) => {
      if (
        (payload?.type === "state_sync" ||
          payload?.type === "event_appended" ||
          payload?.type === "presence_changed" ||
          payload?.type === "join_request_created" ||
          payload?.type === "join_request_resolved") &&
        payload?.game
      ) {
        transport.applyLiveGameUpdate({
          game: payload.game,
          eventSeq: payload.eventSeq,
          clientCommandId: payload.clientCommandId ?? null,
        });
      }
      onSyncEvent(payload);
    },
    onError: (error) => {
      onSyncError(error);
    },
    onMetric: (metric) => {
      onSyncMetric(metric);
    },
    onStatus: (status) => {
      onSyncStatus(status);
    },
  });

  const setActiveGameId = (gameId) => {
    const nextId = gameId || null;
    if (nextId === activeGameId) {
      return;
    }
    const isOnline = globalThis.navigator?.onLine !== false;
    if (!isOnline) {
      liveSync.disconnectAll();
      activeGameId = null;
      return;
    }
    if (activeGameId && activeGameId !== nextId) {
      liveSync.disconnectGame(activeGameId);
    }
    activeGameId = nextId;
    if (nextId) {
      liveSync.connectGame(nextId);
    }
  };

  const getActiveGameId = () => activeGameId;
  const getDesiredGameIds = () => liveSync.getDesiredGameIds();

  const win = typeof window !== "undefined" ? window : null;
  if (win && typeof win.addEventListener === "function") {
    win.addEventListener("online", () => {
      if (activeGameId) {
        liveSync.connectGame(activeGameId);
      }
    });
    win.addEventListener("offline", () => {
      liveSync.disconnectAll();
    });
  }

  const dispose = () => {
    liveSync.disconnectAll();
    activeGameId = null;
  };

  return {
    loadGamesPage: transport.loadGamesPage,
    loadGame: transport.loadGame,
    resolveInvite: transport.resolveInvite,
    createGame: transport.createGame,
    importScenario: transport.importScenario,
    launchHistoryBranch: transport.launchHistoryBranch,
    joinGame: transport.joinGame,
    playAsBothPlayers: transport.playAsBothPlayers,
    approvePendingRequest: transport.approvePendingRequest,
    addMove: transport.addMove,
    loadGameLegalActions: transport.loadGameLegalActions,
    loadGamePieceMoves: transport.loadGamePieceMoves,
    applyGameAction: transport.applyGameAction,
    endTurn: transport.endTurn,
    selectHistoryMove: transport.selectHistoryMove,
    returnToLive: transport.returnToLive,
    requestRevertToMove: transport.requestRevertToMove,
    approveRevertRequest: transport.approveRevertRequest,
    rejectRevertRequest: transport.rejectRevertRequest,
    rescindRevertRequest: transport.rescindRevertRequest,
    setParticipantConnected: transport.setParticipantConnected,
    applyLiveGameUpdate: transport.applyLiveGameUpdate,
    getLastEventSeq: transport.getLastEventSeq,
    getSyncMetrics: transport.getSyncMetrics,
    listGames: transport.listGames,
    getGameViewModel: transport.getGameViewModel,
    getHomeGameCard: transport.getHomeGameCard,
    getIdentityId: transport.getIdentityId,
    subscribe: transport.subscribe,
    unsubscribe: transport.unsubscribe,
    setActiveGameId,
    getActiveGameId,
    getDesiredGameIds,
    dispose,
  };
};
