import { loadIdentity, saveIdentity } from "./persistence.js";
import { defaultNotationForAction, projectOptimisticGame } from "./optimistic-live.js";

const clone = (value) => structuredClone(value);
const MAX_HISTORY = 200;
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
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
const createClientCommandId = (gameId, counter) => `${gameId}:cmd:${counter}`;

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

export const createLiveTransportStore = ({ storage, fetcher = fetch, random = Math.random }) => {
  let identityId = loadIdentity(storage);
  if (!identityId) {
    identityId = createIdentity(random);
    saveIdentity(storage, identityId);
  }

  let offline = false;
  let games = [];
  let gameById = new Map();
  let nextClientCommandCounter = 1;
  const lastEventSeqByGameId = new Map();
  const offlinePendingByGameId = new Map();
  const optimisticStateByGameId = new Map();
  const historyStateByGameId = new Map();
  const listeners = new Set();

  const withOfflineQuery = (path) => `${path}${path.includes("?") ? "&" : "?"}offline=${offline ? "1" : "0"}`;

  const emitChange = (change) => {
    for (const listener of listeners) {
      listener(change);
    }
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
      });
    }
    return optimisticStateByGameId.get(gameId);
  };

  const getHistoryState = (gameId) => {
    if (!historyStateByGameId.has(gameId)) {
      historyStateByGameId.set(gameId, {
        status: "idle",
        error: null,
        moves: [],
        turns: [],
        validatedMoveCount: 0,
        validatedTurnCount: 0,
        selection: { kind: "live" },
        inflightPromise: null,
        needsRefresh: false,
      });
    }
    return historyStateByGameId.get(gameId);
  };

  const normalizeCountsFromGame = (game) => ({
    validatedMoveCount: Number.isFinite(game?.validatedMoveCount)
      ? Number(game.validatedMoveCount)
      : Array.isArray(game?.moves)
        ? game.moves.length
        : 0,
    validatedTurnCount: Number.isFinite(game?.validatedTurnCount)
      ? Number(game.validatedTurnCount)
      : Array.isArray(game?.turns)
        ? game.turns.length
        : 0,
  });

  const syncHistorySeedFromGame = (game) => {
    if (!game?.id) {
      return null;
    }
    const history = getHistoryState(game.id);
    const counts = normalizeCountsFromGame(game);
    history.validatedMoveCount = counts.validatedMoveCount;
    history.validatedTurnCount = counts.validatedTurnCount;
    if (history.moves.length === 0 && Array.isArray(game.moves) && game.moves.length > 0) {
      history.moves = clone(game.moves);
    }
    if (Array.isArray(game.turns) && game.turns.length > 0) {
      history.turns = mergeTurnsWithCurrentTurn(game.turns, game.currentTurn);
    } else if (game.currentTurn) {
      history.turns = mergeTurnsWithCurrentTurn(history.turns, game.currentTurn);
    }
    if ((game.offlineLocal || history.moves.length > 0 || history.turns.length > 0) && history.status === "idle") {
      history.status = "ready";
    }
    return history;
  };

  const getPendingMoveByClientCommandId = (gameId, clientCommandId) => {
    const optimistic = getOptimisticState(gameId);
    const game = optimistic.derivedGame;
    return Array.isArray(game?.pendingMoves)
      ? game.pendingMoves.find((move) => move.clientCommandId === clientCommandId) ?? null
      : null;
  };

  const mergeTurnsWithCurrentTurn = (turns, currentTurn) => {
    const nextTurns = Array.isArray(turns) ? clone(turns) : [];
    if (!currentTurn || typeof currentTurn.index !== "number") {
      return nextTurns;
    }

    const current = clone(currentTurn);
    const existingIndex = nextTurns.findIndex((turn) => turn.index === current.index);
    if (existingIndex >= 0) {
      nextTurns[existingIndex] = {
        ...nextTurns[existingIndex],
        ...current,
      };
      return nextTurns;
    }

    nextTurns.push(current);
    nextTurns.sort((left, right) => (left?.index ?? 0) - (right?.index ?? 0));
    return nextTurns;
  };

  const bridgeAcknowledgedPendingMoveIntoHistory = ({ gameId, clientCommandId, pendingMove, authoritativeGame }) => {
    if (!clientCommandId || !pendingMove) {
      return;
    }

    const history = getHistoryState(gameId);
    if (history.status === "idle") {
      return;
    }

    const targetMoveCount = Number.isFinite(authoritativeGame?.validatedMoveCount)
      ? Number(authoritativeGame.validatedMoveCount)
      : history.validatedMoveCount;
    const moveIndex = Math.max(0, targetMoveCount - 1);

    if (history.moves.some((move) => move.clientCommandId === clientCommandId)) {
      return;
    }

    const bridgedMove = {
      ...clone(pendingMove),
      index: moveIndex,
      pending: false,
      provisionalValidated: true,
    };
    const nextMoves = clone(history.moves);
    if (moveIndex >= nextMoves.length) {
      nextMoves.push(bridgedMove);
    } else {
      nextMoves.splice(moveIndex, 0, bridgedMove);
    }
    nextMoves.forEach((move, index) => {
      move.index = index;
    });
    history.moves = nextMoves;

    const nextTurns = clone(history.turns);
    let targetTurn = nextTurns.find((turn) => turn.index === bridgedMove.turnIndex) ?? null;
    if (!targetTurn) {
      const authoritativeCurrentTurn =
        authoritativeGame?.currentTurn && authoritativeGame.currentTurn.index === bridgedMove.turnIndex
          ? clone(authoritativeGame.currentTurn)
          : null;
      targetTurn =
        authoritativeCurrentTurn ?? {
          index: bridgedMove.turnIndex,
          startedAt: bridgedMove.at,
          endedAt: null,
          playerSeat: bridgedMove.actorSide === "P2" ? "Player 2" : "Player 1",
          status: "active",
          moveIndexes: [],
          lastMoveAt: null,
        };
      nextTurns.push(targetTurn);
      nextTurns.sort((left, right) => left.index - right.index);
    }

    const turnMoveIndexes = Array.isArray(targetTurn.moveIndexes) ? [...targetTurn.moveIndexes] : [];
    if (!turnMoveIndexes.includes(moveIndex)) {
      turnMoveIndexes.push(moveIndex);
      turnMoveIndexes.sort((left, right) => left - right);
    }
    targetTurn.moveIndexes = turnMoveIndexes;
    targetTurn.lastMoveAt = bridgedMove.at;
    history.turns = nextTurns;

    if (history.selection?.kind === "pending" && history.selection.clientCommandId === clientCommandId) {
      history.selection = { kind: "validated", moveIndex };
    }
  };

  const reconcileHistorySelection = (gameId) => {
    const history = getHistoryState(gameId);
    const selection = history.selection ?? { kind: "live" };
    if (selection.kind === "validated") {
      if (selection.moveIndex < 0 || selection.moveIndex >= history.moves.length) {
        history.selection = { kind: "live" };
      }
      return;
    }
    if (selection.kind === "pending") {
      if (getPendingMoveByClientCommandId(gameId, selection.clientCommandId)) {
        return;
      }
      const validatedIndex = history.moves.findIndex((move) => move.clientCommandId === selection.clientCommandId);
      history.selection = validatedIndex >= 0 ? { kind: "validated", moveIndex: validatedIndex } : { kind: "live" };
    }
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
    const history = getHistoryState(gameId);
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
      validatedMoveCount: history.validatedMoveCount,
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
    optimistic.pendingCommands = [];
    optimistic.inflightCommandId = null;
    optimistic.commandResults = new Map();
    optimistic.syncStatus = syncStatus;
    optimistic.rollbackNotice = notice;
    recalculateOptimisticGame(gameId);
    reconcileHistorySelection(gameId);
    emitChange({ type: changeType, gameId });
  };

  const clearRollbackNotice = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    optimistic.rollbackNotice = "";
    if (optimistic.syncStatus !== "applying-update") {
      optimistic.syncStatus = "ready";
    }
    recalculateOptimisticGame(gameId);
    reconcileHistorySelection(gameId);
    emitChange({ type: "rollback_notice_cleared", gameId });
  };

  const syncCacheFromList = (nextGames) => {
    games = clone(nextGames);
    gameById = new Map(games.map((game) => [game.id, clone(game)]));
    for (const game of games) {
      syncHistorySeedFromGame(game);
      recalculateOptimisticGame(game.id);
    }
    emitChange({ type: "games_refreshed" });
  };

  const applyClientOfflineViewState = (game) => {
    const next = clone(game);
    if (!offline) {
      return next;
    }
    next.showOfflineState = true;
    next.canInvite = false;
    next.showJoinActions = false;
    const activeTurn = getActiveTurn(next);
    const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
    const turnOwnerIdentity = turnOwnerSeat === "Player 1" ? next.player1?.identityId ?? null : next.player2?.identityId ?? null;
    const dualSeatOfflinePlayground =
      next.offlineLocal &&
      next.playgroundMode &&
      next.player1?.identityId === identityId &&
      next.player2?.identityId === identityId;
    next.canEndTurn =
      Boolean(dualSeatOfflinePlayground) &&
      next.myRole !== "Viewer" &&
      next.myRole !== "Guest" &&
      !next.inHistoryMode &&
      turnOwnerIdentity === identityId &&
      Boolean(getActiveTurn(next)?.moveIndexes?.length);
    return next;
  };

  const upsertGame = (game) => {
    const next = clone(game);
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
    syncHistorySeedFromGame(next);
    recalculateOptimisticGame(next.id);
    return next;
  };

  const upsertGameSnapshot = ({ game, eventSeq = null, clientCommandId = null, changeType = "authoritative_update" }) => {
    if (!game) {
      return null;
    }

    const acknowledgedPendingMove = clientCommandId ? getPendingMoveByClientCommandId(game.id, clientCommandId) : null;
    const nextEventSeq = typeof eventSeq === "number" && Number.isFinite(eventSeq) ? eventSeq : null;
    const currentEventSeq = nextEventSeq !== null ? lastEventSeqByGameId.get(game.id) ?? 0 : null;
    const authoritative = nextEventSeq !== null && currentEventSeq !== null && nextEventSeq < currentEventSeq ? gameById.get(game.id) ?? null : upsertGame(game);

    if (nextEventSeq !== null) {
      lastEventSeqByGameId.set(game.id, Math.max(currentEventSeq ?? 0, nextEventSeq));
    }

    const optimistic = getOptimisticState(game.id);
    if (clientCommandId) {
      optimistic.pendingCommands = optimistic.pendingCommands.filter((command) => command.clientCommandId !== clientCommandId);
      if (optimistic.inflightCommandId === clientCommandId) {
        optimistic.inflightCommandId = null;
      }
    } else if (optimistic.syncStatus === "desynced") {
      optimistic.syncStatus = "ready";
    }

    bridgeAcknowledgedPendingMoveIntoHistory({
      gameId: game.id,
      clientCommandId,
      pendingMove: acknowledgedPendingMove,
      authoritativeGame: authoritative ?? gameById.get(game.id) ?? game,
    });

    const recalculated = recalculateOptimisticGame(game.id);
    if (!recalculated.ok) {
      clearOptimisticQueue(game.id, {
        notice: "Predicted move no longer matched the authoritative game. The board was restored.",
        syncStatus: "ready",
        changeType: "optimistic_rollback",
      });
    } else if (optimistic.pendingCommands.length > 0) {
      optimistic.syncStatus = "applying-update";
    }

    reconcileHistorySelection(game.id);
    maybeRefreshHistory(game.id);
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
  };

  const computeOfflineMoveState = async (state) => {
    const legalResponse = await fetcher("/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const legalBody = await mustOk(legalResponse);
    const action = Array.isArray(legalBody.legalActions) && legalBody.legalActions.length > 0 ? legalBody.legalActions[0] : null;
    if (!action) {
      throw new Error("no_legal_actions");
    }

    const applyResponse = await fetcher("/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: legalBody.state, action }),
    });
    const applyBody = await mustOk(applyResponse);
    if (applyBody.accepted !== true || !applyBody.state) {
      throw new Error(applyBody.validation?.code || "offline_apply_failed");
    }
    return {
      action,
      state: applyBody.state,
    };
  };

  const buildLocalAuthoritativeGame = (gameId) => {
    const liveGame = gameById.get(gameId);
    if (!liveGame) {
      return null;
    }
    const history = getHistoryState(gameId);
    return {
      ...clone(liveGame),
      moves: clone(history.moves),
      turns: mergeTurnsWithCurrentTurn(
        history.turns.length > 0
          ? history.turns
          : Array.isArray(liveGame.turns) && liveGame.turns.length > 0
            ? liveGame.turns
            : [],
        liveGame.currentTurn,
      ),
      board: { state: clone(liveGame.board?.state ?? liveGame.currentSnapshot ?? null) },
    };
  };

  const applyOfflineAuthoritativeGame = (gameId, authoritativeGame) => {
    const liveGame = gameById.get(gameId);
    if (!liveGame || !authoritativeGame) {
      return null;
    }
    const nextLive = {
      ...clone(liveGame),
      board: { state: clone(authoritativeGame.board.state) },
      currentSnapshot: clone(authoritativeGame.board.state),
      currentTurn: authoritativeGame.turns[authoritativeGame.turns.length - 1] ?? null,
      lastMoveAt: authoritativeGame.lastMoveAt,
      updatedAt: authoritativeGame.updatedAt,
      validatedMoveCount: authoritativeGame.moves.length,
      validatedTurnCount: authoritativeGame.turns.length,
      notifications: clone(authoritativeGame.notifications ?? liveGame.notifications ?? []),
    };
    upsertGame(nextLive);
    const history = getHistoryState(gameId);
    history.status = "ready";
    history.error = null;
    history.moves = clone(authoritativeGame.moves);
    history.turns = clone(authoritativeGame.turns);
    history.validatedMoveCount = authoritativeGame.moves.length;
    history.validatedTurnCount = authoritativeGame.turns.length;
    reconcileHistorySelection(gameId);
    return getGameViewModel(gameId);
  };

  const applyOfflineMove = async (game, notation) => {
    const activeTurn = getActiveTurn(game);
    if (!activeTurn) {
      throw new Error("turn_not_initialized");
    }
    const computed = await computeOfflineMoveState(game.board.state);
    const selectionSnapshot = structuredClone(game.board.state);
    const next = computed.state;
    next.sideToMove = getSideForSeat(getControlSeatForTurn(next, activeTurn.playerSeat));
    next.turnIndex = activeTurn.index;

    const at = new Date().toISOString();
    const move = {
      index: game.moves.length,
      turnIndex: activeTurn.index,
      turnMoveIndex: activeTurn.moveIndexes.length,
      actorSide: game.board.state.sideToMove,
      at,
      notation: notation || defaultNotationForAction(computed.action),
      action: structuredClone(computed.action),
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
    game.board.state = next;
    game.lastMoveAt = at;
    game.updatedAt = at;
    game.notifications = [`Offline move recorded`, ...(game.notifications ?? [])].slice(0, 50);
    return move;
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
    game.updatedAt = endedAt;
    game.notifications = [`Offline turn ended`, ...(game.notifications ?? [])].slice(0, 50);
    return nextTurn;
  };

  const flushOfflineQueue = async () => {
    const entries = [...offlinePendingByGameId.entries()];
    offlinePendingByGameId.clear();
    for (const [gameId, mutations] of entries) {
      for (const mutation of mutations) {
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

  const sendNextPendingCommand = async (gameId) => {
    if (offline) {
      return;
    }

    const optimistic = getOptimisticState(gameId);
    if (optimistic.inflightCommandId) {
      return;
    }

    const command = optimistic.pendingCommands[0];
    if (!command) {
      if (optimistic.syncStatus !== "desynced") {
        optimistic.syncStatus = "ready";
        recalculateOptimisticGame(gameId);
      }
      return;
    }

    optimistic.inflightCommandId = command.clientCommandId;
    optimistic.syncStatus = "applying-update";
    recalculateOptimisticGame(gameId);

    try {
      const response =
        command.kind === "apply"
          ? await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/apply`), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                identityId,
                state: command.state,
                action: command.action,
                clientCommandId: command.clientCommandId,
              }),
            })
          : await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                identityId,
                clientCommandId: command.clientCommandId,
              }),
            });

      const body = await mustOk(response);

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
      clearOptimisticQueue(gameId, {
        notice: "Move sync failed before confirmation. The board was restored to the last authoritative state.",
        syncStatus: "desynced",
        changeType: "optimistic_desynced",
      });
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

  const shouldReloadHistory = (gameId) => {
    const liveGame = gameById.get(gameId);
    if (!liveGame) {
      return false;
    }
    const history = getHistoryState(gameId);
    const counts = normalizeCountsFromGame(liveGame);
    return counts.validatedMoveCount > history.validatedMoveCount || counts.validatedTurnCount > history.validatedTurnCount;
  };

  const loadGameHistory = async (gameId, { force = false } = {}) => {
    const liveGame = gameById.get(gameId);
    if (!liveGame) {
      return null;
    }

    const history = getHistoryState(gameId);
    if (offline || liveGame.offlineLocal) {
      history.status = "ready";
      history.error = null;
      reconcileHistorySelection(gameId);
      emitChange({ type: "history_loaded", gameId });
      return history;
    }

    if (history.inflightPromise) {
      if (force) {
        history.needsRefresh = true;
      }
      return history.inflightPromise;
    }

    history.status = "loading";
    history.error = null;
    emitChange({ type: "history_loading", gameId });

    const run = (async () => {
      try {
        const response = await fetcher(
          withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/history?identityId=${encodeURIComponent(identityId)}`),
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const body = await mustOk(response);
        const latestLive = gameById.get(gameId);
        const latestCounts = normalizeCountsFromGame(latestLive ?? liveGame);
        const responseMoveCount = Number.isFinite(body?.validatedMoveCount) ? Number(body.validatedMoveCount) : 0;
        const responseTurnCount = Number.isFinite(body?.validatedTurnCount) ? Number(body.validatedTurnCount) : 0;
        if (responseMoveCount < latestCounts.validatedMoveCount || responseTurnCount < latestCounts.validatedTurnCount) {
          history.needsRefresh = true;
          return history;
        }

        history.moves = Array.isArray(body?.moves) ? clone(body.moves) : [];
        history.turns = mergeTurnsWithCurrentTurn(
          Array.isArray(body?.turns) ? body.turns : [],
          latestLive?.currentTurn ?? liveGame.currentTurn ?? null,
        );
        history.validatedMoveCount = responseMoveCount;
        history.validatedTurnCount = responseTurnCount;
        history.status = "ready";
        history.error = null;
        recalculateOptimisticGame(gameId);
        reconcileHistorySelection(gameId);
        emitChange({ type: "history_loaded", gameId });
        return history;
      } catch (error) {
        history.status = "error";
        history.error = error?.code || "history_load_failed";
        reconcileHistorySelection(gameId);
        emitChange({ type: "history_error", gameId });
        return history;
      } finally {
        history.inflightPromise = null;
        if (history.needsRefresh || shouldReloadHistory(gameId)) {
          history.needsRefresh = false;
          void loadGameHistory(gameId, { force: true });
        }
      }
    })();

    history.inflightPromise = run;
    return run;
  };

  const maybeRefreshHistory = (gameId) => {
    const history = getHistoryState(gameId);
    if (history.status === "idle") {
      return;
    }
    if (history.inflightPromise) {
      if (shouldReloadHistory(gameId)) {
        history.needsRefresh = true;
      }
      return;
    }
    if (shouldReloadHistory(gameId)) {
      void loadGameHistory(gameId, { force: true });
    }
  };

  const buildComposedGameViewModel = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (!optimistic.derivedGame) {
      recalculateOptimisticGame(gameId);
    }

    const game = optimistic.derivedGame;
    if (!game) {
      return null;
    }

    const history = getHistoryState(gameId);
    const selection = history.selection ?? { kind: "live" };
    const validatedMove =
      selection.kind === "validated" && selection.moveIndex >= 0 && selection.moveIndex < history.moves.length
        ? history.moves[selection.moveIndex]
        : null;
    const pendingMove =
      selection.kind === "pending"
        ? (Array.isArray(game.pendingMoves) ? game.pendingMoves.find((move) => move.clientCommandId === selection.clientCommandId) : null) ?? null
        : null;
    const selectedMove = validatedMove ?? pendingMove;
    const currentSnapshot =
      selectedMove?.selectionSnapshot ?? game.liveCurrentSnapshot ?? game.currentSnapshot ?? game.board?.state ?? null;
    const historySelectionAction = selectedMove?.action ?? null;

    return {
      ...clone(game),
      moves: clone(history.moves),
      turns: mergeTurnsWithCurrentTurn(history.turns, game.currentTurn),
      validatedMoveCount: history.validatedMoveCount,
      validatedTurnCount: history.validatedTurnCount,
      historyStatus: history.status,
      historyError: history.error,
      historySelection: clone(selection),
      inHistoryMode: selection.kind !== "live",
      historyIndex: selection.kind === "validated" ? selection.moveIndex : null,
      selectedPendingClientCommandId: selection.kind === "pending" ? selection.clientCommandId : null,
      historySelectionKey:
        selection.kind === "validated"
          ? `validated:${selection.moveIndex}`
          : selection.kind === "pending"
            ? `pending:${selection.clientCommandId}`
            : "live",
      canRetryHistoryLoad: history.status === "error" && !offline && !game.offlineLocal,
      currentSnapshot: clone(currentSnapshot),
      historySelectionAction: historySelectionAction ? clone(historySelectionAction) : null,
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

  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
    if (offline) {
      return getGameViewModel(gameId);
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
    void loadGameHistory(gameId);
    return getGameViewModel(gameId);
  };

  const createGame = async ({ playgroundMode = false, offlineLocal = false } = {}) => {
    const response = await fetcher(withOfflineQuery("/api/shell/games"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, playgroundMode, offlineLocal }),
    });
    const body = await mustOk(response);
    clearRollbackNotice(body.game.id);
    return upsertGame(body.game);
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
    const nextGame = upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    if (nextGame) {
      void loadGameHistory(nextGame.id);
    }
    return { ...body, game: getGameViewModel(gameId) };
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
      const game = buildLocalAuthoritativeGame(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      await applyOfflineMove(game, notation);
      queueOfflineMutation(gameId, { type: "move", notation });
      return { ok: true, game: applyOfflineAuthoritativeGame(gameId, game) };
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
    if (offline) {
      const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/apply`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, state, action }),
      });
      const body = await mustOk(response);
      if (body.game) {
        upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
      }
      return body;
    }

    const command = {
      kind: "apply",
      clientCommandId: createClientCommandId(gameId, nextClientCommandCounter++),
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
    if (offline) {
      const game = buildLocalAuthoritativeGame(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      const turn = applyOfflineEndTurn(game);
      queueOfflineMutation(gameId, { type: "end-turn" });
      return { ok: true, turn, game: applyOfflineAuthoritativeGame(gameId, game) };
    }

    const current = getGameViewModel(gameId);
    const command = {
      kind: "end-turn",
      clientCommandId: createClientCommandId(gameId, nextClientCommandCounter++),
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
    const history = getHistoryState(gameId);
    if (moveIndex < 0 || moveIndex >= history.moves.length) {
      return getGameViewModel(gameId);
    }
    history.selection = { kind: "validated", moveIndex };
    reconcileHistorySelection(gameId);
    emitChange({ type: "history_mode_changed", gameId });
    return getGameViewModel(gameId);
  };

  const selectPendingHistoryMove = async ({ gameId, clientCommandId }) => {
    if (!clientCommandId || !getPendingMoveByClientCommandId(gameId, clientCommandId)) {
      return getGameViewModel(gameId);
    }
    const history = getHistoryState(gameId);
    history.selection = { kind: "pending", clientCommandId };
    reconcileHistorySelection(gameId);
    emitChange({ type: "history_mode_changed", gameId });
    return getGameViewModel(gameId);
  };

  const returnToLive = async ({ gameId }) => {
    const history = getHistoryState(gameId);
    history.selection = { kind: "live" };
    emitChange({ type: "history_mode_changed", gameId });
    return getGameViewModel(gameId);
  };

  const retryHistoryLoad = async ({ gameId }) => {
    await loadGameHistory(gameId, { force: true });
    return getGameViewModel(gameId);
  };

  const setParticipantConnected = async ({ gameId, role, connected }) => {
    void gameId;
    void role;
    void connected;
    throw new Error("presence_http_removed");
  };

  const goOnlineGame = async ({ gameId, confirmed }) => {
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
    const game = buildComposedGameViewModel(gameId);
    return game ? applyClientOfflineViewState(game) : null;
  };

  const setOffline = (value) => {
    const previous = offline;
    offline = value;
    emitChange({ type: "offline_changed", offline });
    if (previous && !offline) {
      return flushOfflineQueue();
    }
    return Promise.resolve();
  };

  const getIdentityId = () => identityId;
  const getLastEventSeq = (gameId) => lastEventSeqByGameId.get(gameId) ?? 0;

  return {
    refreshGames,
    loadGame,
    resolveInvite,
    createGame,
    joinGame,
    playAsBothPlayers,
    approvePendingRequest,
    addMove,
    loadGameLegalActions,
    loadGamePieceMoves,
    applyGameAction,
    endTurn,
    loadGameHistory,
    selectHistoryMove,
    selectPendingHistoryMove,
    returnToLive,
    retryHistoryLoad,
    setParticipantConnected,
    applyLiveGameUpdate,
    getLastEventSeq,
    goOnlineGame,
    listGames,
    getGameViewModel,
    setOffline,
    getIdentityId,
    subscribe,
    unsubscribe,
  };
};
