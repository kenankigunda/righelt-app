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

const createGameIdMismatchError = (operationLabel, expectedGameId, actualGameId) =>
  createOperationError(
    `${operationLabel} returned an unexpected game id. Expected ${expectedGameId} but received ${actualGameId}.`,
    "game_id_mismatch",
  );

const GAME_CREATION_FAILED_BANNER = "Game creation failed. The server could not create this game. Return home and try again.";

const clone = (value) => structuredClone(value);

const isFailedCreateStub = (game) =>
  Boolean(game && typeof game.rollbackNotice === "string" && game.rollbackNotice === GAME_CREATION_FAILED_BANNER);

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

const buildHistoryViewProjection = (game, moveIndex) => {
  const authoritativeMoves = Array.isArray(game?.moves) ? game.moves : [];
  const pendingMoves = Array.isArray(game?.pendingMoves) ? game.pendingMoves : [];
  const selectedMove =
    authoritativeMoves.find((move) => move?.index === moveIndex) ?? pendingMoves.find((move) => move?.index === moveIndex) ?? null;
  if (!selectedMove?.selectionSnapshot) {
    return null;
  }
  const selectedSnapshot = clone(selectedMove.selectionSnapshot);
  const selectedTurn =
    (Array.isArray(game.turns) ? game.turns.find((turn) => turn?.index === selectedSnapshot.turnIndex) : null) ??
    game.currentTurn ??
    null;
  const turnOwnerSeat = selectedTurn?.playerSeat ?? game.turnOwnerSeat ?? null;
  const controlSeat = turnOwnerSeat ? getControlSeatForTurn(selectedSnapshot, turnOwnerSeat) : game.controlSeat ?? null;
  return {
    ...clone(game),
    inHistoryMode: true,
    historyIndex: moveIndex,
    historySelectionAction: selectedMove.action ? clone(selectedMove.action) : null,
    currentSnapshot: selectedSnapshot,
    currentTurn: selectedTurn ? clone(selectedTurn) : game.currentTurn ? clone(game.currentTurn) : null,
    turnOwnerSeat,
    controlSeat,
    control: controlSeat === turnOwnerSeat ? "turn-owner" : controlSeat ? "opponent" : game.control ?? "turn-owner",
    canRecordMove: false,
    canEndTurn: false,
  };
};

const buildLiveViewProjection = (game) => {
  const liveSnapshot = game?.board?.state ? clone(game.board.state) : game?.currentSnapshot ? clone(game.currentSnapshot) : null;
  if (!liveSnapshot) {
    return null;
  }
  const currentTurn =
    (Array.isArray(game.turns) ? [...game.turns].reverse().find((turn) => turn?.status === "active") : null) ?? game.currentTurn ?? null;
  return {
    ...clone(game),
    inHistoryMode: false,
    historyIndex: null,
    historySelectionAction: null,
    currentSnapshot: liveSnapshot,
    currentTurn: currentTurn ? clone(currentTurn) : game.currentTurn ? clone(game.currentTurn) : null,
  };
};

const sameHistoryProjection = (currentGame, projectedGame) =>
  currentGame?.inHistoryMode === true &&
  currentGame?.historyIndex === projectedGame?.historyIndex &&
  JSON.stringify(currentGame?.currentSnapshot ?? null) === JSON.stringify(projectedGame?.currentSnapshot ?? null);

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
  let pendingLocalGames = readPendingLocalGames(storage);
  let activeGameId = null;
  const localHistorySelectionByGameId = new Map();
  const isPendingOptimisticGameCreation = (gameId) => {
    const createHandle = operationManager.getHandle(`create:${gameId}`);
    if (createHandle?.status === "pending") {
      return true;
    }
    const branchHandle = operationManager.getHandle(`branch:${gameId}`);
    return branchHandle?.status === "pending";
  };
  const transport = createTransportStore({
    storage,
    fetcher,
    random,
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

  const failOperation = (clientCommandId, error) => {
    if (!clientCommandId) {
      return;
    }
    const handle = operationManager.getHandle(clientCommandId);
    clearPendingLocalGame(handle?.gameId ?? null);
    operationManager.fail(clientCommandId, error);
  };

  const markGameCreationFailed = (gameId) => {
    const game = transport.getGameViewModel(gameId);
    if (!game) {
      return;
    }
    const failedGame = {
      ...clone(game),
      syncStatus: "ready",
      rollbackNotice: GAME_CREATION_FAILED_BANNER,
      notifications: ["Game creation failed", ...(Array.isArray(game.notifications) ? game.notifications : [])],
      pendingMoves: [],
      pendingCommandCount: 0,
    };
    transport.applyLiveGameUpdate({ game: failedGame });
    syncActiveGame();
    clearPendingLocalGame(gameId);
  };

  const failDependentOperationsForGame = (gameId, error, excludedOperationIds = []) => {
    const excluded = new Set(excludedOperationIds.filter(Boolean));
    const pendingOperations = operationManager.getPendingOperations(gameId);
    for (const handle of pendingOperations) {
      if (excluded.has(handle.id)) {
        continue;
      }
      failOperation(handle.id, error);
    }
  };

  const runOptimisticGameOperation = ({ id, gameId, buildOptimisticGame, commit }) => {
    const currentGame = transport.getGameViewModel(gameId);
    if (!currentGame) {
      throw createOperationError(`Game ${gameId} is not loaded.`, "game_not_loaded");
    }
    const previousGame = clone(currentGame);
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
        if (game) {
          transport.applyLiveGameUpdate({ game });
        }
        operationManager.confirm(id, transport.getGameViewModel(gameId) ?? game ?? optimisticGame);
      })
      .catch((error) => {
        transport.applyLiveGameUpdate({ game: previousGame });
        operationManager.fail(id, error);
      });

    return handle;
  };

  transport.subscribe((change) => {
    const clientCommandId = typeof change?.clientCommandId === "string" ? change.clientCommandId : null;
    const gameId = typeof change?.gameId === "string" ? change.gameId : null;
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
    if (gameId && localHistorySelectionByGameId.has(gameId)) {
      const projectedGame = buildHistoryViewProjection(transport.getGameViewModel(gameId), localHistorySelectionByGameId.get(gameId));
      if (projectedGame && !sameHistoryProjection(transport.getGameViewModel(gameId), projectedGame)) {
        transport.applyLiveGameUpdate({ game: projectedGame });
      }
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
    const activeGame =
      activeGameId && typeof transport.getGameViewModel === "function" ? transport.getGameViewModel(activeGameId) : null;
    const desiredGameIds = isFailedCreateStub(activeGame) ? new Set() : new Set([activeGameId]);
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
      const localPendingGame = transport.getGameViewModel(gameId) ?? getStoredPendingLocalGame(gameId);
      const hasPendingOperation = operationManager.getPendingOperations(gameId).length > 0;
      const shouldHydrateLocalGame = Boolean(localPendingGame) && (hasPendingOperation || isFailedCreateStub(localPendingGame));
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
        if (fallbackGame && (fallbackPendingGame || hasPendingOperation || isFailedCreateStub(fallbackGame))) {
          if (!transport.getGameViewModel(gameId) && fallbackPendingGame) {
            transport.applyLiveGameUpdate({ game: fallbackPendingGame });
          }
          return transport.getGameViewModel(gameId) ?? fallbackPendingGame ?? fallbackGame;
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
          if (game?.id !== gameId) {
            const mismatchError = createGameIdMismatchError("Game creation", gameId, game?.id ?? "unknown");
            transport.discardPendingCommands?.(gameId, {
              notice: GAME_CREATION_FAILED_BANNER,
            });
            markGameCreationFailed(gameId);
            failOperation(`create:${gameId}`, mismatchError);
            failDependentOperationsForGame(gameId, mismatchError, [`create:${gameId}`]);
            return;
          }
          transport.applyLiveGameUpdate({ game });
          operationManager.confirm(`create:${gameId}`, transport.getGameViewModel(gameId) ?? game);
          clearPendingLocalGame(gameId);
          transport.flushPendingCommands?.(gameId);
        })
        .catch((error) => {
          transport.discardPendingCommands?.(gameId, {
            notice: GAME_CREATION_FAILED_BANNER,
          });
          markGameCreationFailed(gameId);
          failOperation(`create:${gameId}`, error);
          failDependentOperationsForGame(gameId, error, [`create:${gameId}`]);
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
    selectHistoryMove: ({ gameId, moveIndex }) => {
      const currentGame = transport.getGameViewModel(gameId);
      const projectedGame = buildHistoryViewProjection(currentGame, moveIndex);
      if (!projectedGame) {
        throw createOperationError(`History move ${moveIndex} is not available for game ${gameId}.`, "move_not_found");
      }
      localHistorySelectionByGameId.set(gameId, moveIndex);
      transport.applyLiveGameUpdate({ game: projectedGame });
      void transport.selectHistoryMove({ gameId, moveIndex }).catch(onError);
      return operationManager.createCommitted({
        id: `history:${gameId}:${moveIndex}:${Date.now().toString(16)}`,
        gameId,
        result: projectedGame,
      });
    },
    returnToLive: ({ gameId }) => {
      const currentGame = transport.getGameViewModel(gameId);
      const projectedGame = buildLiveViewProjection(currentGame);
      if (!projectedGame) {
        throw createOperationError(`Game ${gameId} is not loaded.`, "game_not_loaded");
      }
      localHistorySelectionByGameId.delete(gameId);
      transport.applyLiveGameUpdate({ game: projectedGame });
      void transport.returnToLive({ gameId }).catch(onError);
      return operationManager.createCommitted({
        id: `live:${gameId}:${Date.now().toString(16)}`,
        gameId,
        result: projectedGame,
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
          if (result?.game?.id !== gameId) {
            const mismatchError = createGameIdMismatchError("History branch creation", gameId, result?.game?.id ?? "unknown");
            transport.discardPendingCommands?.(gameId, {
              notice: "Queued local actions were cleared because history branch creation failed to bind to the expected game id.",
            });
            failOperation(`branch:${gameId}`, mismatchError);
            failDependentOperationsForGame(gameId, mismatchError, [`branch:${gameId}`]);
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
          transport.flushPendingCommands?.(gameId);
        })
        .catch((error) => {
          transport.discardPendingCommands?.(gameId, {
            notice: "Queued local actions were cleared because history branch creation failed.",
          });
          failOperation(`branch:${gameId}`, error);
          failDependentOperationsForGame(gameId, error, [`branch:${gameId}`]);
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
    getFailedOperations: (gameId) => operationManager.getFailedOperations(gameId),
    dismissOperation: (operationId) => operationManager.dismiss(operationId),
  };
};
