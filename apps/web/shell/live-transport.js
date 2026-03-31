import {
  applyAction as applyEngineAction,
  createInitialState,
  deterministicStateHash,
  listLegalActions,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";
import { buildPieceMoveResponse } from "../board/client-move-generation.js";
import { loadIdentity, loadLiveTransportState, saveIdentity, saveLiveTransportState } from "./persistence.js";
import { defaultNotationForAction, projectOptimisticGame } from "./optimistic-live.js";

const clone = (value) => structuredClone(value);
const MAX_HISTORY = 200;
const CONFIRM_WINDOW_MS = 15_000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5_000;
const MAX_CONFIRM_RETRIES = 5;
const OFFLINE_PROGRESS_WARNING = "offline_progress_may_be_lost";
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
const canOperateOfflinePlayground = (game, identityId) =>
  Boolean(game?.playgroundMode) && game?.player1?.identityId === identityId && game?.player2?.identityId === identityId;
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

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "(?,?)");

const renumberHistory = (game) => {
  game.moves.forEach((move, index) => {
    move.index = index;
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = turn.moveIndexes
      .map((_, turnMoveIndex) => game.moves.find((move) => move.turnIndex === turn.index && move.turnMoveIndex === turnMoveIndex)?.index ?? -1)
      .filter((index) => index >= 0);
  });
};

const createIdentity = (random = Math.random) => `id-${random().toString(36).slice(2, 10)}`;
const createLocalGameId = (random = Math.random) => `local-${Date.now().toString(36)}-${Math.floor(random() * 1_000_000).toString(36)}`;
const createClientCommandId = ({ gameId, identityId, random = Math.random }) => {
  const now = Date.now().toString(36);
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${gameId}:${identityId}:${now}:${crypto.randomUUID()}`;
  }
  const rand = Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `${gameId}:${identityId}:${now}:${rand}`;
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const mustOk = async (response) => {
  const body = await readJson(response);
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error || `HTTP_${response.status}`);
    error.code = body.error || `HTTP_${response.status}`;
    error.body = body;
    throw error;
  }
  return body;
};

const isVerboseClientLoggingEnabled = (storage) => {
  const processEnvFlag =
    typeof process !== "undefined" && process?.env?.RIGHELT_VERBOSE_CLIENT_LOGS
      ? String(process.env.RIGHELT_VERBOSE_CLIENT_LOGS).toLowerCase()
      : "";
  const globalFlag =
    typeof globalThis !== "undefined" && (globalThis.__RIGHELT_VERBOSE_CLIENT_LOGS || globalThis.__RIGHELT_VERBOSE_LIVE_TRANSPORT_LOGS)
      ? String(globalThis.__RIGHELT_VERBOSE_CLIENT_LOGS || globalThis.__RIGHELT_VERBOSE_LIVE_TRANSPORT_LOGS).toLowerCase()
      : "";
  const storageFlag = storage?.getItem?.("righelt.verboseClientLogs");
  const value = processEnvFlag || globalFlag || (typeof storageFlag === "string" ? storageFlag.toLowerCase() : "");
  return value === "1" || value === "true" || value === "yes" || value === "on" || value === "verbose";
};

export const createLiveTransportStore = ({ storage, fetcher = fetch, random = Math.random }) => {
  let identityId = loadIdentity(storage);
  if (!identityId) {
    identityId = createIdentity(random);
    saveIdentity(storage, identityId);
  }

  const persistedState = loadLiveTransportState(storage);

  let offline = false;
  let games = [];
  let gameById = new Map();
  const lastEventSeqByGameId = new Map();
  const offlinePendingByGameId = new Map(
    Object.entries(persistedState?.pendingMutationsByGameId ?? {}).map(([gameId, mutations]) => [gameId, clone(mutations)]),
  );
  const optimisticStateByGameId = new Map();
  const listeners = new Set();
  const syncMetrics = {
    httpConfirmFailed: 0,
    wsConfirmedAfterHttpFail: 0,
    confirmTimeoutRefresh: 0,
    trueDesync: 0,
  };
  let persistenceWarningCode = persistedState?.warningCode === OFFLINE_PROGRESS_WARNING ? OFFLINE_PROGRESS_WARNING : null;
  const logDiagnostic = (level, event, payload = {}, { verboseOnly = false } = {}) => {
    if (verboseOnly && !isVerboseClientLoggingEnabled(storage)) {
      return;
    }
    const entry = {
      event,
      at: new Date().toISOString(),
      identityId,
      ...payload,
    };
    const logger = level === "warn" ? console.warn : level === "error" ? console.error : console.info;
    logger(JSON.stringify(entry));
  };

  const withOfflineQuery = (path) => `${path}${path.includes("?") ? "&" : "?"}offline=${offline ? "1" : "0"}`;
  const withForcedOfflineQuery = (path, forcedOffline) => `${path}${path.includes("?") ? "&" : "?"}offline=${forcedOffline ? "1" : "0"}`;

  const emitChange = (change) => {
    for (const listener of listeners) {
      listener(change);
    }
  };

  const incrementSyncMetric = (name, gameId = null) => {
    if (!Object.hasOwn(syncMetrics, name)) {
      return;
    }
    syncMetrics[name] += 1;
    emitChange({ type: "sync_metric_updated", metric: name, value: syncMetrics[name], gameId });
  };

  const subscribe = (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const unsubscribe = (listener) => {
    listeners.delete(listener);
  };

  const getOptimisticState = (gameId) => {
    if (!optimisticStateByGameId.has(gameId)) {
      optimisticStateByGameId.set(gameId, {
        pendingCommands: [],
        inflightCommandId: null,
        syncStatus: "ready",
        rollbackNotice: "",
        derivedGame: null,
        commandResults: new Map(),
        retryTimer: null,
        confirmingCommandId: null,
        retryAttempt: 0,
        confirmDeadlineAt: 0,
      });
    }
    return optimisticStateByGameId.get(gameId);
  };

  const clearRetryState = (optimistic) => {
    if (optimistic.retryTimer) {
      clearTimeout(optimistic.retryTimer);
      optimistic.retryTimer = null;
    }
    optimistic.confirmingCommandId = null;
    optimistic.retryAttempt = 0;
    optimistic.confirmDeadlineAt = 0;
  };

  const decorateGameWithSync = (game, gameId) => {
    const optimistic = getOptimisticState(gameId);
    const next = clone(game);
    next.pendingMoves = Array.isArray(next.pendingMoves) ? next.pendingMoves : [];
    next.pendingCommandCount = optimistic.pendingCommands.length;
    next.liveCurrentSnapshot = clone(next.liveCurrentSnapshot ?? next.board?.state ?? next.currentSnapshot ?? null);
    next.syncStatus = optimistic.syncStatus;
    next.rollbackNotice = optimistic.rollbackNotice;
    return next;
  };

  const recalculateOptimisticGame = (gameId) => {
    const authoritativeGame = gameById.get(gameId);
    const optimistic = getOptimisticState(gameId);
    optimistic.commandResults = new Map();

    if (!authoritativeGame) {
      optimistic.derivedGame = null;
      return { ok: true, game: null };
    }

    if (optimistic.pendingCommands.length === 0) {
      optimistic.derivedGame = decorateGameWithSync(authoritativeGame, gameId);
      return { ok: true, game: optimistic.derivedGame };
    }

    const projection = projectOptimisticGame({
      authoritativeGame,
      identityId,
      queue: optimistic.pendingCommands,
    });
    if (!projection.ok) {
      optimistic.derivedGame = decorateGameWithSync(authoritativeGame, gameId);
      return projection;
    }

    optimistic.commandResults = projection.commandResults;
    optimistic.derivedGame = decorateGameWithSync(projection.game, gameId);
    return { ok: true, game: optimistic.derivedGame };
  };

  const clearOptimisticQueue = (gameId, { notice = "", syncStatus = "ready", changeType = "optimistic_queue_cleared" } = {}) => {
    const optimistic = getOptimisticState(gameId);
    clearRetryState(optimistic);
    optimistic.pendingCommands = [];
    optimistic.inflightCommandId = null;
    optimistic.commandResults = new Map();
    optimistic.syncStatus = syncStatus;
    optimistic.rollbackNotice = notice;
    recalculateOptimisticGame(gameId);
    emitChange({ type: changeType, gameId });
  };

  const clearRollbackNotice = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    optimistic.rollbackNotice = "";
    if (optimistic.syncStatus !== "applying-update") {
      optimistic.syncStatus = "ready";
    }
    recalculateOptimisticGame(gameId);
    emitChange({ type: "rollback_notice_cleared", gameId });
  };

  const syncCacheFromList = (nextGames) => {
    games = clone(nextGames);
    const localGames = [...gameById.values()].filter((game) => game?.localOnly === true);
    gameById = new Map([
      ...games.map((game) => [game.id, clone(game)]),
      ...localGames.map((game) => [game.id, decorateLocalGame(game)]),
    ]);
    for (const game of games) {
      recalculateOptimisticGame(game.id);
    }
    for (const game of localGames) {
      recalculateOptimisticGame(game.id);
    }
    persistLocalState();
    emitChange({ type: "games_refreshed" });
  };

  const applyClientOfflineViewState = (game) => {
    const next = clone(game);
    if (!offline) {
      if (persistenceWarningCode) {
        next.persistenceWarningCode = persistenceWarningCode;
      }
      return next;
    }
    next.showOfflineState = true;
    next.canInvite = false;
    next.showJoinActions = false;
    const offlinePlayable = next.localOnly || next.offlineLocal || canOperateOfflinePlayground(next, identityId);
    next.canRecordMove = Boolean(offlinePlayable && next.canRecordMove);
    const activeTurn = getActiveTurn(next);
    const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
    const turnOwnerIdentity = turnOwnerSeat === "Player 1" ? next.player1?.identityId ?? null : next.player2?.identityId ?? null;
    const dualSeatOfflinePlayground = offlinePlayable && canOperateOfflinePlayground(next, identityId);
    next.canEndTurn =
      Boolean(dualSeatOfflinePlayground) &&
      next.myRole !== "Viewer" &&
      next.myRole !== "Guest" &&
      !next.inHistoryMode &&
      turnOwnerIdentity === identityId &&
      Boolean(getActiveTurn(next)?.moveIndexes?.length);
    if (persistenceWarningCode) {
      next.persistenceWarningCode = persistenceWarningCode;
    }
    return next;
  };

  const persistLocalState = () => {
    try {
      const persistedGames = [...gameById.values()]
        .filter((game) => game?.localOnly === true || (canOperateOfflinePlayground(game, identityId) && (offline || offlinePendingByGameId.has(game.id))))
        .map((game) => clone(game));
      const pendingMutationsByGameId = Object.fromEntries(
        [...offlinePendingByGameId.entries()]
          .filter(([gameId]) => persistedGames.some((game) => game.id === gameId))
          .map(([gameId, mutations]) => [gameId, clone(mutations)]),
      );
      saveLiveTransportState(storage, {
        games: persistedGames,
        warningCode: null,
        pendingMutationsByGameId,
      });
      if (persistenceWarningCode) {
        persistenceWarningCode = null;
      }
    } catch {
      persistenceWarningCode = OFFLINE_PROGRESS_WARNING;
    }
  };

  const decorateLocalGame = (game) => {
    const next = clone(game);
    const currentSnapshot = clone(next.board?.state ?? next.currentSnapshot ?? null);
    const currentTurn = getActiveTurn(next);
    const turnOwnerSeat = currentTurn?.playerSeat ?? getSideToMoveSeat(next);
    const controlSeat = getControlSeatForTurn(currentSnapshot, turnOwnerSeat);
    const turnOwnerIdentity = turnOwnerSeat === "Player 1" ? next.player1?.identityId ?? null : next.player2?.identityId ?? null;
    const controlIdentity = controlSeat === "Player 1" ? next.player1?.identityId ?? null : next.player2?.identityId ?? null;
    const legalActions = Array.isArray(next.legalActions) ? clone(next.legalActions) : listLegalActions(currentSnapshot);
    next.currentSnapshot = currentSnapshot;
    next.board = { state: currentSnapshot };
    next.currentTurn = currentTurn ? clone(currentTurn) : null;
    next.legalActions = legalActions;
    next.myRole = next.player1?.identityId === identityId ? "Player 1" : next.player2?.identityId === identityId ? "Player 2" : "Guest";
    next.myRoles =
      next.player1?.identityId === identityId && next.player2?.identityId === identityId
        ? ["Player 1", "Player 2"]
        : next.myRole === "Player 1" || next.myRole === "Player 2"
          ? [next.myRole]
          : [];
    next.inHistoryMode = false;
    next.historyIndex = null;
    next.canJoinAsPlayer = false;
    next.canJoinAsViewer = false;
    next.joinAsPlayerDisabledReason = "Remote joining is unavailable while offline.";
    next.joinAsViewerDisabledReason = "Remote joining is unavailable while offline.";
    next.canPlayAsBothPlayers = false;
    next.canInvite = false;
    next.showJoinActions = false;
    next.showOfflineState = true;
    next.controlSeat = controlSeat;
    next.control = controlSeat === turnOwnerSeat ? "turn-owner" : "opponent";
    next.turnOwnerSeat = turnOwnerSeat;
    next.canRecordMove =
      (next.myRole === "Player 1" || next.myRole === "Player 2") &&
      !next.inHistoryMode &&
      controlIdentity === identityId &&
      legalActions.length > 0;
    next.canEndTurn =
      (next.localOnly || next.offlineLocal || canOperateOfflinePlayground(next, identityId)) &&
      canOperateOfflinePlayground(next, identityId) &&
      !next.inHistoryMode &&
      controlSeat === turnOwnerSeat &&
      turnOwnerIdentity === identityId &&
      Boolean(currentTurn?.moveIndexes?.length);
    if (persistenceWarningCode) {
      next.persistenceWarningCode = persistenceWarningCode;
    }
    return next;
  };

  const createLocalGame = ({ playgroundMode = false, offlineLocal = false }) => {
    const createdAt = new Date().toISOString();
    const initial = resolveToStability(createInitialState(), { artifactMode: "full" });
    const currentTurn = {
      index: initial.turnIndex ?? 0,
      startedAt: createdAt,
      endedAt: null,
      playerSeat: getSideToMoveSeat({ board: { state: initial } }),
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    };
    return decorateLocalGame({
      id: createLocalGameId(random),
      localOnly: true,
      createdAt,
      lastMoveAt: null,
      updatedAt: createdAt,
      offlineLocal,
      playgroundMode,
      player1: { identityId, connected: true, joinedAt: createdAt, lastHeartbeatAt: createdAt, sessionCount: 0 },
      player2: playgroundMode
        ? { identityId, connected: true, joinedAt: createdAt, lastHeartbeatAt: createdAt, sessionCount: 0 }
        : null,
      viewers: [],
      pendingJoinRequests: [],
      pendingRevertRequest: null,
      turns: [currentTurn],
      moves: [],
      notifications: ["Game created", playgroundMode ? "Playground mode active" : "Invite a second player"],
      currentTurn,
      currentSnapshot: clone(initial),
      board: { state: clone(initial) },
      legalActions: listLegalActions(initial),
    });
  };

  const removeGame = (gameId) => {
    games = games.filter((entry) => entry.id !== gameId);
    gameById.delete(gameId);
    optimisticStateByGameId.delete(gameId);
    offlinePendingByGameId.delete(gameId);
    lastEventSeqByGameId.delete(gameId);
    persistLocalState();
  };

  const upsertGame = (game) => {
    const next = game?.localOnly ? decorateLocalGame(game) : clone(game);
    gameById.set(next.id, next);
    const current = games.filter((entry) => entry.id !== next.id);
    if (!next.offlineLocal) {
      current.push(next);
    }
    current.sort((left, right) => {
      const leftTs = left.lastMoveAt || left.createdAt;
      const rightTs = right.lastMoveAt || right.createdAt;
      return rightTs.localeCompare(leftTs);
    });
    games = current;
    recalculateOptimisticGame(next.id);
    persistLocalState();
    return next;
  };

  const upsertGameSnapshot = ({ game, eventSeq = null, clientCommandId = null, changeType = "authoritative_update" }) => {
    if (!game) {
      return null;
    }

    const nextEventSeq = typeof eventSeq === "number" && Number.isFinite(eventSeq) ? eventSeq : null;
    const currentEventSeq = nextEventSeq !== null ? lastEventSeqByGameId.get(game.id) ?? 0 : null;
    const staleSnapshotIgnored = nextEventSeq !== null && currentEventSeq !== null && nextEventSeq < currentEventSeq;
    const authoritative = staleSnapshotIgnored ? gameById.get(game.id) ?? null : upsertGame(game);
    if (staleSnapshotIgnored) {
      logDiagnostic(
        "info",
        "live_transport_stale_snapshot_ignored",
        { gameId: game.id, incomingEventSeq: nextEventSeq, currentEventSeq, changeType },
        { verboseOnly: true },
      );
    }

    if (nextEventSeq !== null) {
      lastEventSeqByGameId.set(game.id, Math.max(currentEventSeq ?? 0, nextEventSeq));
    }

    const optimistic = getOptimisticState(game.id);
    const pendingBefore = optimistic.pendingCommands.length;
    const moveClientCommandIds = new Set(
      (Array.isArray(game.moves) ? game.moves : [])
        .map((move) => (typeof move?.clientCommandId === "string" ? move.clientCommandId : null))
        .filter(Boolean),
    );
    if (moveClientCommandIds.size > 0) {
      optimistic.pendingCommands = optimistic.pendingCommands.filter(
        (command) => command.kind !== "apply" || !moveClientCommandIds.has(command.clientCommandId),
      );
      if (optimistic.inflightCommandId && moveClientCommandIds.has(optimistic.inflightCommandId)) {
        const inflight = optimistic.pendingCommands.find((command) => command.clientCommandId === optimistic.inflightCommandId);
        if (!inflight || inflight.kind === "apply") {
          optimistic.inflightCommandId = null;
        }
      }
    }
    if (clientCommandId) {
      optimistic.pendingCommands = optimistic.pendingCommands.filter((command) => command.clientCommandId !== clientCommandId);
      if (optimistic.inflightCommandId === clientCommandId) {
        optimistic.inflightCommandId = null;
      }
    }
    const pendingAfter = optimistic.pendingCommands.length;
    if (pendingAfter < pendingBefore && optimistic.syncStatus === "confirming") {
      incrementSyncMetric("wsConfirmedAfterHttpFail", game.id);
      if (!optimistic.confirmingCommandId || pendingAfter === 0 || !optimistic.pendingCommands.some((command) => command.clientCommandId === optimistic.confirmingCommandId)) {
        clearRetryState(optimistic);
      }
    } else if (optimistic.syncStatus === "desynced") {
      optimistic.syncStatus = "ready";
    }

    const recalculated = recalculateOptimisticGame(game.id);
    if (!recalculated.ok) {
      clearOptimisticQueue(game.id, {
        notice: "Predicted move no longer matched the authoritative game. The board was restored.",
        syncStatus: "ready",
        changeType: "optimistic_rollback",
      });
    } else if (optimistic.pendingCommands.length > 0 && optimistic.syncStatus !== "confirming") {
      optimistic.syncStatus = "applying-update";
    }
    if (changeType === "history_mode_changed") {
      logDiagnostic("info", "live_transport_history_mode_changed", { gameId: game.id }, { verboseOnly: true });
    }

    emitChange({ type: changeType, gameId: game.id, clientCommandId });
    void sendNextPendingCommand(game.id);
    return authoritative;
  };

  const applyLiveGameUpdate = ({ game, eventSeq = null, clientCommandId = null }) =>
    upsertGameSnapshot({ game, eventSeq, clientCommandId, changeType: "authoritative_update" });

  const queueOfflineMutation = (gameId, mutation) => {
    const current = offlinePendingByGameId.get(gameId) ?? [];
    current.push(mutation);
    offlinePendingByGameId.set(gameId, current);
    persistLocalState();
  };

  const computeLocalLegalActions = (state) => {
    const stable = resolveToStability(clone(state), { artifactMode: "full" });
    return {
      state: stable,
      legalActions: listLegalActions(stable),
    };
  };

  const applyLocalAction = ({ game, action, notation = defaultNotationForAction(action) }) => {
    const activeTurn = getActiveTurn(game);
    if (!activeTurn) {
      throw new Error("turn_not_initialized");
    }
    const stable = resolveToStability(clone(game.board.state), { artifactMode: "full" });
    const computed = applyEngineAction(stable, clone(action));
    if (!computed?.state) {
      return {
        ok: true,
        accepted: false,
        validation: computed?.validation ?? { ok: false, code: "invalid_action" },
        state: stable,
        legalActions: listLegalActions(stable),
      };
    }
    const selectionSnapshot = structuredClone(game.board.state);
    const next = resolveToStability(computed.state, { artifactMode: "full" });

    const at = new Date().toISOString();
    const move = {
      index: game.moves.length,
      turnIndex: activeTurn.index,
      turnMoveIndex: activeTurn.moveIndexes.length,
      actorSide: game.board.state.sideToMove,
      at,
      notation,
      action: structuredClone(action),
      selectionSnapshot,
      snapshot: next,
    };
    game.moves.push(move);
    activeTurn.moveIndexes.push(move.index);
    activeTurn.lastMoveAt = at;
    if (game.moves.length > MAX_HISTORY) {
      game.moves.shift();
      renumberHistory(game);
    }
    const advancedTurn = (next.turnIndex ?? activeTurn.index) > activeTurn.index;
    if (advancedTurn) {
      activeTurn.endedAt = at;
      activeTurn.status = "complete";
      game.turns.push({
        index: next.turnIndex,
        startedAt: at,
        endedAt: null,
        playerSeat: getSideToMoveSeat({ board: { state: next } }),
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      });
    }
    game.board.state = next;
    game.currentSnapshot = clone(next);
    game.lastMoveAt = at;
    game.updatedAt = at;
    game.legalActions = listLegalActions(next);
    game.notifications = [`Offline move recorded`, ...(game.notifications ?? [])].slice(0, 50);
    return {
      ok: true,
      accepted: true,
      action,
      move,
      previousState: stable,
      state: next,
      legalActions: game.legalActions,
      game: decorateLocalGame(game),
    };
  };

  const applyOfflineEndTurn = (game) => {
    const activeTurn = getActiveTurn(game);
    if (!activeTurn || activeTurn.moveIndexes.length === 0) {
      throw new Error("turn_has_no_moves");
    }
    const endedAt = new Date().toISOString();
    activeTurn.endedAt = endedAt;
    activeTurn.status = "complete";
    const nextSeat = getNextSeat(activeTurn.playerSeat);
    const nextTurn = {
      index: activeTurn.index + 1,
      startedAt: endedAt,
      endedAt: null,
      playerSeat: nextSeat,
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    };
    game.turns.push(nextTurn);
    game.board.state = {
      ...game.board.state,
      sideToMove: getSideForSeat(nextSeat),
      turnIndex: nextTurn.index,
    };
    game.currentSnapshot = clone(game.board.state);
    game.legalActions = listLegalActions(game.board.state);
    game.updatedAt = endedAt;
    game.notifications = [`Offline turn ended`, ...(game.notifications ?? [])].slice(0, 50);
    return nextTurn;
  };

  const buildPromotionScenario = async (game) => {
    const selectedMoves = game.moves.filter((move) => move?.undone !== true);
    const resultingState = clone(game.board?.state ?? game.currentSnapshot ?? null);
    return {
      formatVersion: 2,
      id:
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `00000000-0000-4000-8000-${Math.floor(random() * 1e12)
              .toString()
              .padStart(12, "0")}`,
      title: `Offline game ${game.id}`,
      description: "Promoted offline-local game",
      incorrect: false,
      initialState: clone(selectedMoves[0]?.selectionSnapshot ?? resultingState),
      moves: selectedMoves.map((move) => ({
        turnIndex: move.turnIndex,
        turnMoveIndex: move.turnMoveIndex,
        actorSide: move.actorSide,
        notation: move.notation,
        action: clone(move.action),
      })),
      resultingState,
      expectedFinalStateHash: deterministicStateHash(resultingState),
      expectedOutcome: resultingState?.outcome?.status ?? "ongoing",
      savedSelection: null,
    };
  };

  const flushOfflineQueue = async () => {
    const entries = [...offlinePendingByGameId.entries()];
    offlinePendingByGameId.clear();
    for (const [gameId, mutations] of entries) {
      for (const mutation of mutations) {
        if (mutation.type === "apply") {
          const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/apply`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              identityId,
              state: mutation.state,
              action: mutation.action,
            }),
          });
          const body = await mustOk(response);
          if (body.game) {
            upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
          }
          continue;
        }
        if (mutation.type === "move") {
          const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/moves`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identityId, notation: mutation.notation }),
          });
          const body = await mustOk(response);
          upsertGame(body.game);
          continue;
        }
        if (mutation.type === "end-turn") {
          const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identityId }),
          });
          const body = await mustOk(response);
          upsertGame(body.game);
        }
      }
      await loadGame(gameId);
    }
  };

  const sendCommandRequest = async ({ gameId, command }) =>
    command.kind === "apply"
      ? fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/apply`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            identityId,
            state: command.state,
            action: command.action,
            clientCommandId: command.clientCommandId,
          }),
        })
      : fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            identityId,
            clientCommandId: command.clientCommandId,
          }),
        });

  const refreshAuthoritativeGameSnapshot = async (gameId) => {
    const response = await fetcher(
      withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`),
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "authoritative_update" });
  };

  const scheduleRetry = ({ gameId, command, retryAttempt }) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.retryTimer) {
      clearTimeout(optimistic.retryTimer);
      optimistic.retryTimer = null;
    }
    const exponential = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
    const jitter = 0.75 + random() * 0.5;
    const delay = Math.max(100, Math.round(exponential * jitter));
    optimistic.retryTimer = setTimeout(() => {
      optimistic.retryTimer = null;
      void sendNextPendingCommand(gameId, { forcedCommandId: command.clientCommandId, retryAttempt: retryAttempt + 1 });
    }, delay);
  };

  const sendNextPendingCommand = async (gameId, { forcedCommandId = null, retryAttempt = 0 } = {}) => {
    if (offline) {
      return;
    }

    const optimistic = getOptimisticState(gameId);
    if (optimistic.inflightCommandId && optimistic.inflightCommandId !== forcedCommandId) {
      return;
    }

    const command = forcedCommandId
      ? optimistic.pendingCommands.find((entry) => entry.clientCommandId === forcedCommandId) ?? null
      : optimistic.pendingCommands[0] ?? null;
    if (!command) {
      if (optimistic.syncStatus !== "desynced") {
        clearRetryState(optimistic);
        optimistic.syncStatus = "ready";
        recalculateOptimisticGame(gameId);
      }
      return;
    }

    optimistic.inflightCommandId = command.clientCommandId;
    optimistic.syncStatus = retryAttempt > 0 || optimistic.syncStatus === "confirming" ? "confirming" : "applying-update";
    optimistic.confirmingCommandId = command.clientCommandId;
    optimistic.retryAttempt = retryAttempt;
    optimistic.confirmDeadlineAt = optimistic.confirmDeadlineAt || Date.now() + CONFIRM_WINDOW_MS;
    recalculateOptimisticGame(gameId);

    try {
      const response = await sendCommandRequest({ gameId, command });

      const body = await mustOk(response);
      clearRetryState(optimistic);

      if (command.kind === "apply" && body.accepted === false) {
        optimistic.inflightCommandId = null;
        clearOptimisticQueue(gameId, {
          notice: "A predicted move was rejected by the server. The board was restored.",
          syncStatus: "ready",
          changeType: "optimistic_rollback",
        });
        if (body.game) {
          upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
        }
        return;
      }

      if (body.game) {
        upsertGameSnapshot({
          game: body.game,
          eventSeq: body.eventSeq,
          clientCommandId: body.clientCommandId ?? command.clientCommandId,
        });
        return;
      }

      optimistic.pendingCommands = optimistic.pendingCommands.filter((entry) => entry.clientCommandId !== command.clientCommandId);
      optimistic.inflightCommandId = null;
      recalculateOptimisticGame(gameId);
      emitChange({ type: "authoritative_update", gameId, clientCommandId: command.clientCommandId });
      void sendNextPendingCommand(gameId);
    } catch {
      optimistic.inflightCommandId = null;
      optimistic.syncStatus = "confirming";
      optimistic.confirmingCommandId = command.clientCommandId;
      optimistic.retryAttempt = retryAttempt;
      optimistic.confirmDeadlineAt = optimistic.confirmDeadlineAt || Date.now() + CONFIRM_WINDOW_MS;
      recalculateOptimisticGame(gameId);
      emitChange({ type: "optimistic_confirming", gameId, clientCommandId: command.clientCommandId });
      incrementSyncMetric("httpConfirmFailed", gameId);
      logDiagnostic(
        "info",
        "live_transport_command_confirming",
        {
          gameId,
          commandKind: command.kind,
          clientCommandId: command.clientCommandId,
          retryAttempt,
        },
        { verboseOnly: true },
      );

      const hasTimeRemaining = optimistic.confirmDeadlineAt > Date.now();
      if (retryAttempt < MAX_CONFIRM_RETRIES && hasTimeRemaining) {
        scheduleRetry({ gameId, command, retryAttempt });
        return;
      }

      try {
        await refreshAuthoritativeGameSnapshot(gameId);
        incrementSyncMetric("confirmTimeoutRefresh", gameId);
        const pendingAfterRefresh = getOptimisticState(gameId).pendingCommands.some(
          (entry) => entry.clientCommandId === command.clientCommandId,
        );
        if (pendingAfterRefresh) {
          clearOptimisticQueue(gameId, {
            notice: "Move confirmation timed out. The board was restored to the latest authoritative state.",
            syncStatus: "ready",
            changeType: "optimistic_rollback",
          });
          logDiagnostic("warn", "live_transport_confirmation_timeout_rollback", {
            gameId,
            commandKind: command.kind,
            clientCommandId: command.clientCommandId,
          });
        }
      } catch {
        incrementSyncMetric("trueDesync", gameId);
        clearOptimisticQueue(gameId, {
          notice: "Move sync failed before confirmation. The board was restored to the last authoritative state.",
          syncStatus: "desynced",
          changeType: "optimistic_desynced",
        });
        logDiagnostic("error", "live_transport_desynced", {
          gameId,
          commandKind: command.kind,
          clientCommandId: command.clientCommandId,
        });
      }
    }
  };

  const enqueueOptimisticCommand = ({ gameId, command }) => {
    const optimistic = getOptimisticState(gameId);
    optimistic.rollbackNotice = "";
    optimistic.syncStatus = "applying-update";
    optimistic.pendingCommands.push(command);
    const recalculated = recalculateOptimisticGame(gameId);
    if (!recalculated.ok) {
      optimistic.pendingCommands = optimistic.pendingCommands.filter((entry) => entry.clientCommandId !== command.clientCommandId);
      optimistic.syncStatus = optimistic.pendingCommands.length > 0 ? "applying-update" : "ready";
      recalculateOptimisticGame(gameId);
      return recalculated;
    }
    emitChange({ type: "optimistic_enqueue", gameId, clientCommandId: command.clientCommandId });
    void sendNextPendingCommand(gameId);
    return {
      ok: true,
      result: optimistic.commandResults.get(command.clientCommandId),
      game: optimistic.derivedGame,
    };
  };

  const refreshGames = async () => {
    if (offline) {
      return listGames();
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games?identityId=${encodeURIComponent(identityId)}`), {
      method: "GET",
      cache: "no-store",
    });
    const body = await mustOk(response);
    syncCacheFromList(Array.isArray(body.games) ? body.games : []);
    return listGames();
  };

  const loadGamesPage = async ({ section, page = 0, pageSize = 6, debug = false } = {}) => {
    if (offline) {
      return {
        ok: true,
        section,
        page: 0,
        pageSize,
        totalGames: 0,
        totalPages: 0,
        games: [],
      };
    }
    const params = new URLSearchParams({
      identityId,
      section: String(section || ""),
      page: String(page),
      pageSize: String(pageSize),
      debug: debug ? "1" : "0",
    });
    const response = await fetcher(withOfflineQuery(`/api/shell/games?${params.toString()}`), {
      method: "GET",
      cache: "no-store",
    });
    const body = await mustOk(response);
    const gamesPage = Array.isArray(body.games) ? body.games : [];
    for (const game of gamesPage) {
      upsertGame(game);
    }
    return {
      ...body,
      games: gamesPage.map((game) => getGameViewModel(game.id) ?? game),
    };
  };

  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
    const cached = getGameViewModel(gameId);
    if (cached?.localOnly) {
      return cached;
    }
    if (offline) {
      return cached;
    }
    const response = await fetcher(
      withOfflineQuery(
        `/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}${
          openAsViewer ? "&openAsViewer=1" : ""
        }`,
      ),
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const createGame = async ({ playgroundMode = false, offlineLocal = false } = {}) => {
    if (offline && offlineLocal) {
      return upsertGame(createLocalGame({ playgroundMode, offlineLocal }));
    }
    const response = await fetcher(withOfflineQuery("/api/shell/games"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, playgroundMode, offlineLocal }),
    });
    const body = await mustOk(response);
    clearRollbackNotice(body.game.id);
    return upsertGame(body.game);
  };

  const importScenario = async ({ scenario, targetGameId = null, sourceGameId = null } = {}) => {
    const response = await fetcher(withOfflineQuery("/api/shell/scenarios/import"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, scenario, targetGameId, sourceGameId }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    }
    return body;
  };

  const launchHistoryBranch = async ({
    sourceGameId,
    sourceMoveIndex,
    scenario,
    initialSelectionAction,
    participantCopyMode,
  } = {}) => {
    const response = await fetcher(withOfflineQuery("/api/shell/history/branch"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        sourceGameId,
        sourceMoveIndex,
        scenario,
        initialSelectionAction,
        participantCopyMode,
      }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    }
    return body;
  };

  const resolveInvite = async (inviteToken) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/invites/${encodeURIComponent(inviteToken)}`), {
      method: "GET",
      cache: "no-store",
    });
    return mustOk(response);
  };

  const joinGame = async ({ gameId, mode, inviteFromRole = null, inviteToken = null }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/join`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, mode, inviteFromRole, inviteToken }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const playAsBothPlayers = async ({ gameId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/play-as-both`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const approvePendingRequest = async ({ gameId, requesterIdentityId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/approve`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requesterIdentityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const addMove = async ({ gameId, notation }) => {
    if (offline) {
      const game = getGameViewModel(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      const offlinePlayable = game.localOnly || game.offlineLocal || canOperateOfflinePlayground(game, identityId);
      if (!offlinePlayable) {
        const error = new Error("offline_move_local_only");
        error.code = "offline_move_local_only";
        throw error;
      }
      const next = clone(game);
      const legalBody = computeLocalLegalActions(next.board.state);
      const action = Array.isArray(legalBody.legalActions) && legalBody.legalActions.length > 0 ? legalBody.legalActions[0] : null;
      if (!action) {
        const error = new Error("no_legal_actions");
        error.code = "no_legal_actions";
        throw error;
      }
      const result = applyLocalAction({ game: next, action, notation: notation || defaultNotationForAction(action) });
      if (!result.accepted) {
        const error = new Error(result.validation?.code || "offline_apply_failed");
        error.code = result.validation?.code || "offline_apply_failed";
        throw error;
      }
      if (!game.localOnly) {
        queueOfflineMutation(gameId, { type: "apply", state: result.previousState, action });
      }
      return { ok: true, game: upsertGame(next), move: result.move };
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/moves`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, notation }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const loadGameLegalActions = async ({ gameId, state }) => {
    const game = getGameViewModel(gameId);
    if (game?.localOnly || (offline && canOperateOfflinePlayground(game, identityId))) {
      const body = computeLocalLegalActions(state ?? game.currentSnapshot ?? game.board?.state ?? null);
      const next = clone(game);
      next.board.state = clone(body.state);
      next.currentSnapshot = clone(body.state);
      next.legalActions = clone(body.legalActions);
      upsertGame(next);
      return { ok: true, state: body.state, legalActions: body.legalActions, game: getGameViewModel(gameId) };
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/legal`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, state }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    }
    return body;
  };

  const loadGamePieceMoves = async ({ gameId, state, pieceId }) => {
    const game = getGameViewModel(gameId);
    if (game?.localOnly || (offline && canOperateOfflinePlayground(game, identityId))) {
      return buildPieceMoveResponse({
        state: state ?? game.currentSnapshot ?? game.board?.state ?? null,
        legalActions: Array.isArray(game.legalActions) ? game.legalActions : [],
        pieceId,
      });
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/piece-moves`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, state, pieceId }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    }
    return body;
  };

  const applyGameAction = async ({ gameId, state, action }) => {
    const game = getGameViewModel(gameId);
    if (game?.localOnly || (offline && canOperateOfflinePlayground(game, identityId))) {
      const next = clone(game);
      const result = applyLocalAction({ game: next, action });
      if (result.accepted) {
        if (!game.localOnly) {
          queueOfflineMutation(gameId, { type: "apply", state: result.previousState, action });
        }
        upsertGame(next);
      }
      return {
        ...result,
        game: result.accepted ? getGameViewModel(gameId) : game,
      };
    }
    if (offline) {
      return {
        ok: true,
        accepted: false,
        validation: { ok: false, code: "offline_move_local_only", message: "Offline play is only available for offline-local games." },
        state,
        legalActions: game?.legalActions ?? [],
      };
    }

    const command = {
      kind: "apply",
      clientCommandId: createClientCommandId({ gameId, identityId, random }),
      action: clone(action),
      state: clone(state),
      notation: defaultNotationForAction(action),
      queuedAt: new Date().toISOString(),
    };
    const optimistic = enqueueOptimisticCommand({ gameId, command });
    if (!optimistic.ok) {
      return {
        ok: true,
        accepted: false,
        validation: optimistic.validation ?? { ok: false, code: optimistic.error || "invalid_action" },
        state,
        legalActions: getGameViewModel(gameId)?.legalActions ?? [],
      };
    }

    return {
      ok: true,
      accepted: true,
      clientCommandId: command.clientCommandId,
      ...(optimistic.result ?? {}),
      game: optimistic.game,
    };
  };

  const endTurn = async ({ gameId }) => {
    const game = getGameViewModel(gameId);
    if (game?.localOnly || (offline && canOperateOfflinePlayground(game, identityId))) {
      const next = clone(game);
      const turn = applyOfflineEndTurn(next);
      if (!game.localOnly) {
        queueOfflineMutation(gameId, { type: "end-turn" });
      }
      return { ok: true, turn, game: upsertGame(next) };
    }
    if (offline) {
      const error = new Error("offline_move_local_only");
      error.code = "offline_move_local_only";
      throw error;
    }

    const current = getGameViewModel(gameId);
    const command = {
      kind: "end-turn",
      clientCommandId: createClientCommandId({ gameId, identityId, random }),
      queuedAt: new Date().toISOString(),
    };
    const optimistic = enqueueOptimisticCommand({ gameId, command });
    if (!optimistic.ok) {
      const error = new Error(optimistic.error || "turn_has_no_moves");
      error.code = optimistic.error || "turn_has_no_moves";
      throw error;
    }

    return {
      ok: true,
      clientCommandId: command.clientCommandId,
      turn: optimistic.game?.currentTurn ?? current?.currentTurn ?? null,
      ...(optimistic.result ?? {}),
      game: optimistic.game,
    };
  };

  const selectHistoryMove = async ({ gameId, moveIndex }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/history`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, moveIndex }),
    });
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const returnToLive = async ({ gameId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/live`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const requestRevertToMove = async ({ gameId, targetMoveId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/revert-request`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, targetMoveId }),
    });
    const body = await mustOk(response);
    logDiagnostic("info", "live_transport_revert_requested", { gameId, targetMoveId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const approveRevertRequest = async ({ gameId, requestId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/revert-approve`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
    const body = await mustOk(response);
    logDiagnostic("info", "live_transport_revert_approved", { gameId, requestId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const rejectRevertRequest = async ({ gameId, requestId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/revert-reject`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
    const body = await mustOk(response);
    logDiagnostic("info", "live_transport_revert_rejected", { gameId, requestId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const rescindRevertRequest = async ({ gameId, requestId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/revert-rescind`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
    const body = await mustOk(response);
    logDiagnostic("info", "live_transport_revert_rescinded", { gameId, requestId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const setParticipantConnected = async ({ gameId, role, connected }) => {
    void gameId;
    void role;
    void connected;
    throw new Error("presence_http_removed");
  };

  const goOnlineGame = async ({ gameId, confirmed }) => {
    const game = getGameViewModel(gameId);
    if (game?.localOnly) {
      if (confirmed !== true) {
        const error = new Error("confirmation_required");
        error.code = "confirmation_required";
        throw error;
      }
      const created = await fetcher(withForcedOfflineQuery("/api/shell/games", false), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, playgroundMode: game.playgroundMode === true, offlineLocal: false }),
      });
      const createdBody = await mustOk(created);
      const scenario = await buildPromotionScenario(game);
      const imported = await fetcher(withForcedOfflineQuery("/api/shell/scenarios/import", false), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, scenario, targetGameId: createdBody.game.id, sourceGameId: null }),
      });
      const importedBody = await mustOk(imported);
      removeGame(gameId);
      upsertGameSnapshot({ game: importedBody.game ?? createdBody.game, eventSeq: importedBody.eventSeq ?? createdBody.eventSeq });
      return getGameViewModel(importedBody.game?.id ?? createdBody.game.id);
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/go-online`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, confirmed }),
    });
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    return getGameViewModel(gameId);
  };

  const listGames = () => games.map((game) => getGameViewModel(game.id)).filter(Boolean);

  const getGameViewModel = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (!optimistic.derivedGame) {
      recalculateOptimisticGame(gameId);
    }
    const game = optimistic.derivedGame;
    if (!game) {
      return null;
    }
    const base = game.localOnly ? decorateLocalGame(game) : game;
    return applyClientOfflineViewState(base);
  };

  const setOffline = (value) => {
    const previous = offline;
    offline = value;
    persistLocalState();
    emitChange({ type: "offline_changed", offline });
    if (previous && !offline) {
      return flushOfflineQueue();
    }
    return Promise.resolve();
  };

  const getIdentityId = () => identityId;
  const getLastEventSeq = (gameId) => lastEventSeqByGameId.get(gameId) ?? 0;
  const getSyncMetrics = () => clone(syncMetrics);

  for (const persistedGame of Array.isArray(persistedState?.games) ? persistedState.games : []) {
    if (persistedGame?.localOnly === true || canOperateOfflinePlayground(persistedGame, identityId)) {
      upsertGame(persistedGame);
    }
  }

  return {
    refreshGames,
    loadGamesPage,
    loadGame,
    resolveInvite,
    createGame,
    importScenario,
    launchHistoryBranch,
    joinGame,
    playAsBothPlayers,
    approvePendingRequest,
    addMove,
    loadGameLegalActions,
    loadGamePieceMoves,
    applyGameAction,
    endTurn,
    selectHistoryMove,
    returnToLive,
    requestRevertToMove,
    approveRevertRequest,
    rejectRevertRequest,
    rescindRevertRequest,
    setParticipantConnected,
    applyLiveGameUpdate,
    getLastEventSeq,
    getSyncMetrics,
    goOnlineGame,
    listGames,
    getGameViewModel,
    setOffline,
    getIdentityId,
    subscribe,
    unsubscribe,
  };
};
