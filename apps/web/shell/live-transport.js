import { loadIdentity, saveIdentity } from "./persistence.js";
import { defaultNotationForAction, projectOptimisticGame } from "./optimistic-live.js";

const clone = (value) => structuredClone(value);
const MAX_HISTORY = 200;
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000];
const MAX_CONFIRMATION_WINDOW_MS = 30_000;
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
    error.status = response.status;
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
        retryTimer: null,
      });
    }
    return optimisticStateByGameId.get(gameId);
  };

  const clearRetryTimer = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.retryTimer) {
      clearTimeout(optimistic.retryTimer);
      optimistic.retryTimer = null;
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
    clearRetryTimer(gameId);
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
    gameById = new Map(games.map((game) => [game.id, clone(game)]));
    for (const game of games) {
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
    recalculateOptimisticGame(next.id);
    return next;
  };

  const upsertGameSnapshot = ({ game, eventSeq = null, clientCommandId = null, changeType = "authoritative_update" }) => {
    if (!game) {
      return null;
    }

    const nextEventSeq = typeof eventSeq === "number" && Number.isFinite(eventSeq) ? eventSeq : null;
    const currentEventSeq = nextEventSeq !== null ? lastEventSeqByGameId.get(game.id) ?? 0 : null;
    const authoritative = nextEventSeq !== null && currentEventSeq !== null && nextEventSeq < currentEventSeq ? gameById.get(game.id) ?? null : upsertGame(game);

    if (nextEventSeq !== null) {
      lastEventSeqByGameId.set(game.id, Math.max(currentEventSeq ?? 0, nextEventSeq));
    }

    const optimistic = getOptimisticState(game.id);
    if (clientCommandId) {
      clearRetryTimer(game.id);
      optimistic.pendingCommands = optimistic.pendingCommands.filter((command) => command.clientCommandId !== clientCommandId);
      if (optimistic.inflightCommandId === clientCommandId) {
        optimistic.inflightCommandId = null;
      }
      optimistic.rollbackNotice = "";
      optimistic.syncStatus = optimistic.pendingCommands.length > 0 ? "applying-update" : "ready";
    } else if (optimistic.syncStatus === "desynced") {
      optimistic.syncStatus = "ready";
      optimistic.rollbackNotice = "";
    }

    const recalculated = recalculateOptimisticGame(game.id);
    if (!recalculated.ok) {
      clearOptimisticQueue(game.id, {
        notice: "Predicted move no longer matched the authoritative game. The board was restored.",
        syncStatus: "ready",
        changeType: "optimistic_rollback",
      });
    } else if (optimistic.pendingCommands.length > 0) {
      optimistic.syncStatus = "applying-update";
    } else {
      optimistic.rollbackNotice = "";
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

  const isRetryableCommandError = (error) => {
    const category = error?.body?.errorCategory ?? null;
    if (category === "authorization" || category === "conflict" || category === "validation") {
      return false;
    }
    if (typeof error?.status === "number" && error.status >= 500) {
      return true;
    }
    if (String(error?.code || "").startsWith("HTTP_4")) {
      return false;
    }
    return true;
  };

  const scheduleCommandRetry = (gameId, command, delayMs) => {
    const optimistic = getOptimisticState(gameId);
    clearRetryTimer(gameId);
    optimistic.retryTimer = setTimeout(() => {
      optimistic.retryTimer = null;
      void sendNextPendingCommand(gameId);
    }, delayMs);
    optimistic.retryTimer?.unref?.();
    optimistic.syncStatus = command.attemptCount === 1 ? "confirming" : "retrying";
    optimistic.rollbackNotice =
      command.attemptCount === 1
        ? "Waiting for server confirmation after a connection interruption."
        : `Retrying move sync after a connection interruption (attempt ${command.attemptCount + 1}).`;
    recalculateOptimisticGame(gameId);
    emitChange({ type: "optimistic_confirming", gameId, clientCommandId: command.clientCommandId });
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
      clearRetryTimer(gameId);
      if (optimistic.syncStatus !== "desynced") {
        optimistic.syncStatus = "ready";
        recalculateOptimisticGame(gameId);
      }
      return;
    }

    optimistic.inflightCommandId = command.clientCommandId;
    optimistic.syncStatus = "applying-update";
    optimistic.rollbackNotice = "";
    command.attemptCount = (command.attemptCount ?? 0) + 1;
    command.firstAttemptAt = command.firstAttemptAt ?? Date.now();
    command.lastAttemptAt = Date.now();
    recalculateOptimisticGame(gameId);

    try {
      const response =
        command.kind === "apply"
          ? await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/commands`), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                identityId,
                type: "apply",
                state: command.state,
                action: command.action,
                autoEndTurn: command.autoEndTurn === true,
                clientCommandId: command.clientCommandId,
              }),
            })
          : await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/commands`), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                identityId,
                type: "end-turn",
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
      clearRetryTimer(gameId);
      optimistic.rollbackNotice = "";
      recalculateOptimisticGame(gameId);
      emitChange({ type: "authoritative_update", gameId, clientCommandId: command.clientCommandId });
      void sendNextPendingCommand(gameId);
    } catch (error) {
      optimistic.inflightCommandId = null;
      if (!isRetryableCommandError(error)) {
        clearOptimisticQueue(gameId, {
          notice: "The server rejected the command. The board was restored to the last authoritative state.",
          syncStatus: "ready",
          changeType: "optimistic_rollback",
        });
        if (error?.body?.game) {
          upsertGameSnapshot({
            game: error.body.game,
            eventSeq: error.body.eventSeq,
            clientCommandId: error.body.clientCommandId ?? command.clientCommandId,
          });
        }
        return;
      }

      const elapsedMs = Date.now() - (command.firstAttemptAt ?? Date.now());
      if (elapsedMs >= MAX_CONFIRMATION_WINDOW_MS || (command.attemptCount ?? 0) > RETRY_DELAYS_MS.length + 1) {
        clearOptimisticQueue(gameId, {
          notice: "Move sync could not be confirmed after repeated retries. The board was restored to the last authoritative state.",
          syncStatus: "desynced",
          changeType: "optimistic_desynced",
        });
        return;
      }
      const delayMs = command.attemptCount === 1 ? 3000 : RETRY_DELAYS_MS[Math.min(command.attemptCount - 2, RETRY_DELAYS_MS.length - 1)];
      scheduleCommandRetry(gameId, command, delayMs);
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
      const next = clone(game);
      await applyOfflineMove(next, notation);
      queueOfflineMutation(gameId, { type: "move", notation });
      return { ok: true, game: upsertGame(next) };
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
      autoEndTurn: true,
      attemptCount: 0,
      firstAttemptAt: null,
      lastAttemptAt: null,
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
      const game = getGameViewModel(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      const next = clone(game);
      const turn = applyOfflineEndTurn(next);
      queueOfflineMutation(gameId, { type: "end-turn" });
      return { ok: true, turn, game: upsertGame(next) };
    }

    const current = getGameViewModel(gameId);
    const command = {
      kind: "end-turn",
      clientCommandId: createClientCommandId(gameId, nextClientCommandCounter++),
      queuedAt: new Date().toISOString(),
      attemptCount: 0,
      firstAttemptAt: null,
      lastAttemptAt: null,
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
    const optimistic = getOptimisticState(gameId);
    if (!optimistic.derivedGame) {
      recalculateOptimisticGame(gameId);
    }
    const game = optimistic.derivedGame;
    return game ? applyClientOfflineViewState(game) : null;
  };

  const getCommandDiagnostics = (gameId) => {
    const game = getGameViewModel(gameId);
    const optimistic = getOptimisticState(gameId);
    return {
      syncStatus: optimistic.syncStatus,
      rollbackNotice: optimistic.rollbackNotice,
      inflightCommandId: optimistic.inflightCommandId,
      pendingCommands: optimistic.pendingCommands.map((command) => ({
        clientCommandId: command.clientCommandId,
        kind: command.kind,
        queuedAt: command.queuedAt,
        attemptCount: command.attemptCount ?? 0,
        firstAttemptAt: command.firstAttemptAt ?? null,
        lastAttemptAt: command.lastAttemptAt ?? null,
        autoEndTurn: command.autoEndTurn === true,
      })),
      recentCommandOrder: Array.isArray(game?.recentCommandOrder) ? game.recentCommandOrder.slice(0, 10) : [],
      commandTimeline: Array.isArray(game?.commandTimeline) ? game.commandTimeline.slice(0, 10) : [],
      recentCommandReceipts: game?.recentCommandReceipts ?? {},
    };
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
    importScenario,
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
    setParticipantConnected,
    applyLiveGameUpdate,
    getLastEventSeq,
    goOnlineGame,
    listGames,
    getGameViewModel,
    getCommandDiagnostics,
    setOffline,
    getIdentityId,
    subscribe,
    unsubscribe,
  };
};
