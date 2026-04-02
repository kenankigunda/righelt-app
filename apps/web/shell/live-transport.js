import { listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { loadIdentity, saveIdentity } from "./persistence.js";
import { defaultNotationForAction, projectOptimisticGame } from "./optimistic-live.js";

const clone = (value) => structuredClone(value);
const CONFIRM_WINDOW_MS = 15_000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5_000;
const MAX_CONFIRM_RETRIES = 5;
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

const createIdentity = (random = Math.random) => `id-${random().toString(36).slice(2, 10)}`;
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

  let games = [];
  let gameById = new Map();
  const lastEventSeqByGameId = new Map();
  const optimisticStateByGameId = new Map();
  const listeners = new Set();
  const syncMetrics = {
    httpConfirmFailed: 0,
    wsConfirmedAfterHttpFail: 0,
    confirmTimeoutRefresh: 0,
    trueDesync: 0,
  };
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

  const upsertGame = (game) => {
    const next = clone(game);
    gameById.set(next.id, next);
    const current = games.filter((entry) => entry.id !== next.id);
    current.push(next);
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

  const sendCommandRequest = async ({ gameId, command }) =>
    command.kind === "apply"
      ? fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            identityId,
            state: command.state,
            action: command.action,
            clientCommandId: command.clientCommandId,
          }),
        })
      : fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            identityId,
            clientCommandId: command.clientCommandId,
          }),
        });

  const refreshAuthoritativeGameSnapshot = async (gameId) => {
    const response = await fetcher(
      `/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`,
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

  const loadGamesPage = async ({ section, page = 0, pageSize = 6, debug = false } = {}) => {
    const params = new URLSearchParams({
      identityId,
      section: String(section || ""),
      page: String(page),
      pageSize: String(pageSize),
      debug: debug ? "1" : "0",
    });
    const response = await fetcher(`/api/shell/games?${params.toString()}`, {
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
    const response = await fetcher(
      `/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}${
        openAsViewer ? "&openAsViewer=1" : ""
      }`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const createGame = async ({ selfPlayMode = false } = {}) => {
    const response = await fetcher("/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, selfPlayMode }),
    });
    const body = await mustOk(response);
    clearRollbackNotice(body.game.id);
    return upsertGame(body.game);
  };

  const importScenario = async ({ scenario, targetGameId = null, sourceGameId = null } = {}) => {
    const response = await fetcher("/api/shell/scenarios/import", {
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
    const response = await fetcher("/api/shell/history/branch", {
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
    const response = await fetcher(`/api/shell/invites/${encodeURIComponent(inviteToken)}`, {
      method: "GET",
      cache: "no-store",
    });
    return mustOk(response);
  };

  const joinGame = async ({ gameId, mode, inviteFromRole = null, inviteToken = null }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, mode, inviteFromRole, inviteToken }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const playAsBothPlayers = async ({ gameId }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/play-as-both`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const approvePendingRequest = async ({ gameId, requesterIdentityId }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requesterIdentityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const addMove = async ({ gameId, notation }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, notation }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const loadGameLegalActions = async ({ gameId, state }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/legal`, {
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
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/piece-moves`, {
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
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, moveIndex }),
    });
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const returnToLive = async ({ gameId }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const requestRevertToMove = async ({ gameId, targetMoveId }) => {
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/revert-request`, {
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
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/revert-approve`, {
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
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/revert-reject`, {
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
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/revert-rescind`, {
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
    return game;
  };

  const getIdentityId = () => identityId;
  const getLastEventSeq = (gameId) => lastEventSeqByGameId.get(gameId) ?? 0;
  const getSyncMetrics = () => clone(syncMetrics);

  return {
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
    listGames,
    getGameViewModel,
    getIdentityId,
    subscribe,
    unsubscribe,
  };
};
