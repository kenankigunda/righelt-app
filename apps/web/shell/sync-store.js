import { createInitialState, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { createLiveSyncClient } from "./live-sync.js";
import { createLiveTransportStore } from "./live-transport.js";
import { createOperationManager } from "./operation-manager.js";

const PENDING_LOCAL_GAMES_KEY = "righelt.pendingLocalGames";

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

const clone = (value) => structuredClone(value);

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
  const operationManager = createOperationManager();
  const pendingLocalGames = readPendingLocalGames(storage);
  let activeGameId = null;
  const isCreatePendingForGame = (gameId) => {
    const handle = operationManager.getHandle(`create:${gameId}`);
    return handle?.status === "pending";
  };
  const transport = createTransportStore({
    storage,
    fetcher,
    random,
    shouldDeferCommandSend: (gameId, command) => {
      void command;
      return isCreatePendingForGame(gameId);
    },
  });

  const savePendingLocalGame = (game) => {
    pendingLocalGames[game.id] = clone(game);
    writePendingLocalGames(storage, pendingLocalGames);
  };

  const clearPendingLocalGame = (gameId) => {
    if (!gameId || !pendingLocalGames[gameId]) {
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

  const failOperation = (clientCommandId, error) => {
    if (!clientCommandId) {
      return;
    }
    const handle = operationManager.getHandle(clientCommandId);
    clearPendingLocalGame(handle?.gameId ?? null);
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
    loadGame: async (gameId, options = {}) => {
      const localPendingGame = transport.getGameViewModel(gameId) ?? pendingLocalGames[gameId] ?? null;
      const hasPendingOperation = operationManager.getPendingOperations(gameId).length > 0;
      if (localPendingGame && hasPendingOperation) {
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
        if (localPendingGame && hasPendingOperation) {
          return transport.getGameViewModel(gameId) ?? localPendingGame;
        }
        throw error;
      }
    },
    createGame: ({ selfPlayMode = false } = {}) => {
      const gameId = createGameId();
      const createdAt = new Date().toISOString();
      const identityId = transport.getIdentityId();
      const player1 = createParticipant(identityId, createdAt);
      const player2 = selfPlayMode ? createParticipant(identityId, createdAt) : null;
      const stubGame = buildLocalGameView({
        gameId,
        identityId,
        createdAt,
        state: createInitialState(),
        selfPlayMode,
        player1,
        player2,
        myRole: "Player 1",
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
        .createGame({ selfPlayMode, gameId })
        .then((game) => {
          transport.applyLiveGameUpdate({ game });
          operationManager.confirm(`create:${gameId}`, transport.getGameViewModel(gameId) ?? game);
          clearPendingLocalGame(gameId);
          transport.flushPendingCommands?.(gameId);
        })
        .catch((error) => {
          failOperation(`create:${gameId}`, error);
        });

      return handle;
    },
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
          if (result?.game) {
            transport.applyLiveGameUpdate({ game: result.game });
          }
          operationManager.confirm(`branch:${gameId}`, {
            ...(result ?? {}),
            game: transport.getGameViewModel(gameId) ?? result?.game ?? stubGame,
          });
          clearPendingLocalGame(gameId);
        })
        .catch((error) => {
          failOperation(`branch:${gameId}`, error);
        });

      return handle;
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
