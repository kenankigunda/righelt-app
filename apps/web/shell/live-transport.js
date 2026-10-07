import { listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { loadIdentity, saveIdentity } from "./persistence.js";
import { defaultNotationForAction, projectOptimisticGame } from "./optimistic-live.js";
import { buildStaticGameCardFromGame, normalizeStaticGameCard } from "./static-game-cards.js";
import { createCommandJournal } from "./command-journal.js";
import { SYNC_PROTOCOL_VERSION, SYNC_TIMING, commandFingerprint, isReconcileResponse, isCommandOutcome, isSyncRevision, isSyncCommand, canonicalCommandJson } from "../generated/packages/shared-types/src/sync-protocol.js";

import { applyHistoryIntent, historyMoveKey } from "./recovery-view.js";

const clone = (value) => structuredClone(value);
export const validSyncSnapshot = (game, gameId) => {
  const state = game?.board?.state;
  return typeof gameId === "string" && gameId.length > 0 && game?.id === gameId
    && typeof game.createdAt === "string" && Number.isFinite(Date.parse(game.createdAt))
    && typeof game.updatedAt === "string" && Number.isFinite(Date.parse(game.updatedAt))
    && isSyncRevision(game.gameplayRevision) && state !== null && typeof state === "object" && !Array.isArray(state)
    && ["P1", "P2"].includes(state.sideToMove) && isSyncRevision(state.turnIndex) && Array.isArray(state.pieces)
    && Array.isArray(game.moves) && Array.isArray(game.turns);
};
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
    return `v2:${crypto.randomUUID()}`;
  }
  const rand = Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `v2:${now}:${rand}`;
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
    error.status = response.status;
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

export const createLiveTransportStore = ({
  storage,
  fetcher = fetch,
  random = Math.random,
  shouldDeferCommandSend = () => false,
  commandJournal = null,
  auth = null,
  timing = SYNC_TIMING,
  beforeReconcile = async () => {},
} = {}) => {
  let active = true;
  const assertActive = () => { if (!active) throw Object.assign(new Error("session_changed"), { code: "session_changed" }); };
  commandJournal ??= createCommandJournal({
    ...(auth?.enabled ? { databaseName: `righelt.online-commands.account-v1.${auth.session.contextId || "anonymous"}` } : {}),
    isCurrent: () => active,
  });
  const rawFetcher = fetcher;
  fetcher = async (url, init = {}) => {
    assertActive();
    if (init.method === "POST" && typeof init.body === "string") init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), protocolVersion: SYNC_PROTOCOL_VERSION }) };
    const response = await rawFetcher(url, init);
    assertActive();
    const json = response.json.bind(response);
    response.json = async () => { const body = await json(); assertActive(); return body; };
    return response;
  };
  let identityId = auth?.enabled ? auth.session.account?.id || "" : loadIdentity(storage);
  if (!auth?.enabled && !identityId) {
    identityId = createIdentity(random);
    saveIdentity(storage, identityId);
  }

  let games = [];
  let gameById = new Map();
  let homeGameCardById = new Map();
  const lastEventSeqByGameId = new Map();
  const optimisticStateByGameId = new Map();
  const historyIntentByGameId = new Map();
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
    if (!active) return;
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
        derivedGame: null,
        commandResults: new Map(),
        retryTimer: null,
        confirmingCommandId: null,
        retryAttempt: 0,
        confirmDeadlineAt: 0,
        budgetTimer: null,
        attempt: null,
        storageBlocked: false,
        confirmationOverdue: false,
        hydrated: false,
        outcomes: new Map(),
        admission: Promise.resolve(),
      });
    }
    return optimisticStateByGameId.get(gameId);
  };

  const clearRetryState = (optimistic) => {
    if (optimistic.retryTimer) {
      clearTimeout(optimistic.retryTimer);
      optimistic.retryTimer = null;
    }
    if (optimistic.budgetTimer) clearTimeout(optimistic.budgetTimer);
    optimistic.budgetTimer = null;
    optimistic.budgetCommandId = null;
    optimistic.confirmationOverdue = false;
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
    next.syncStatus = optimistic.storageBlocked ? "storage-blocked" : optimistic.syncStatus;
    next.storageBlocked = optimistic.storageBlocked;
    next.unsavedCommand = Boolean(optimistic.unsavedCommand);
    next.confirmationOverdue = optimistic.confirmationOverdue;
    next.recovering = optimistic.connectionRecovering === true || optimistic.syncStatus === "confirming";
    next.upgradeRequired = optimistic.upgradeRequired === true;
    next.storageLimitReached = optimistic.storageError?.code === "command_limit_reached" || /limit/.test(optimistic.storageError?.message ?? "");
    next.sharedMutationsBlocked = optimistic.storageBlocked || next.recovering || next.upgradeRequired;
    applyHistoryIntent(next, historyIntentByGameId.get(gameId), identityId);
    if (next.sharedMutationsBlocked) {
      next.canRecordMove = false;
      next.canEndTurn = false;
    }
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
      homeGameCardById.set(gameId, buildStaticGameCardFromGame(optimistic.derivedGame));
      return { ok: true, game: optimistic.derivedGame };
    }

    const projection = projectOptimisticGame({
      authoritativeGame,
      identityId,
      queue: optimistic.pendingCommands,
    });
    if (!projection.ok) {
      // Unknown commands retain the last tentative board until receipt reconciliation.
      optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? authoritativeGame, gameId);
      homeGameCardById.set(gameId, buildStaticGameCardFromGame(optimistic.derivedGame));
      return projection;
    }

    optimistic.commandResults = projection.commandResults;
    optimistic.derivedGame = decorateGameWithSync(projection.game, gameId);
    homeGameCardById.set(gameId, buildStaticGameCardFromGame(optimistic.derivedGame));
    return { ok: true, game: optimistic.derivedGame };
  };

  const clearOptimisticQueue = (
    gameId,
    { notice = "", syncStatus = "ready", changeType = "optimistic_queue_cleared", clientCommandId = null } = {},
  ) => {
    const optimistic = getOptimisticState(gameId);
    // Only commands still deferred behind a failed local creation are safe to cancel.
    // Submitted/unknown commands retain their journal and handles until receipts resolve them.
    const removed = optimistic.pendingCommands.filter((command) => shouldDeferCommandSend(gameId, command));
    optimistic.pendingCommands = optimistic.pendingCommands.filter((command) => !removed.includes(command));
    for (const command of removed) {
      void commandJournal.remove(command.envelope).catch((error) => blockStorage(gameId, error));
      emitChange({ type: "optimistic_rollback", gameId, clientCommandId: command.clientCommandId, failureNotice: notice });
    }
    if (!optimistic.pendingCommands.length) { clearRetryState(optimistic); optimistic.inflightCommandId = null; }
    optimistic.commandResults = new Map();
    optimistic.syncStatus = optimistic.pendingCommands.length ? "confirming" : syncStatus;
    recalculateOptimisticGame(gameId);
    emitChange({ type: changeType, gameId, clientCommandId, failureNotice: notice });
  };

  const upsertGame = (game) => {
    const next = clone(game);
    gameById.set(next.id, next);
    homeGameCardById.set(next.id, buildStaticGameCardFromGame(next));
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

  const upsertGameSnapshot = ({ game, eventSeq = null, clientCommandId = null, changeType = "authoritative_update", publish = true }) => {
    if (!active) return null;
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
    // A snapshot/command ID alone cannot establish a command outcome.
    recalculateOptimisticGame(game.id);
    if (changeType === "history_mode_changed") {
      logDiagnostic("info", "live_transport_history_mode_changed", { gameId: game.id }, { verboseOnly: true });
    }

    if (publish) { emitChange({ type: changeType, gameId: game.id }); void sendNextPendingCommand(game.id); }
    return authoritative;
  };


  const blockStorage = (gameId, error) => {
    const optimistic = getOptimisticState(gameId);
    optimistic.storageBlocked = true;
    optimistic.storageError = error;
    recalculateOptimisticGame(gameId);
    emitChange({ type: "journal_blocked", gameId, error });
  };
  const settleOutcome = (gameId, outcome, notifications = null) => {
    const optimistic = getOptimisticState(gameId);
    const command = optimistic.pendingCommands.find((entry) => entry.clientCommandId === outcome?.clientCommandId);
    if (!command || !isCommandOutcome(outcome, command.envelope) || outcome.outcome === "unknown") return false;
    if (optimistic.outcomes.get(command.clientCommandId)?.outcome === "accepted") return true;
    optimistic.outcomes.set(command.clientCommandId, outcome);
    optimistic.pendingCommands = optimistic.pendingCommands.filter((entry) => entry !== command);
    if (optimistic.attempt?.commandId === command.clientCommandId) {
      optimistic.attempt.controller.abort();
      optimistic.attempt = null;
      optimistic.inflightCommandId = null;
    }
    if (optimistic.budgetCommandId === command.clientCommandId || !optimistic.pendingCommands.length) clearRetryState(optimistic);
    optimistic.syncStatus = optimistic.pendingCommands.length ? optimistic.syncStatus : "ready";
    void commandJournal.remove(command.envelope).catch((error) => blockStorage(gameId, error));
    recalculateOptimisticGame(gameId);
    const notification = { type: outcome.outcome === "accepted" ? "authoritative_update" : "optimistic_rollback", gameId, clientCommandId: command.clientCommandId,
      failureNotice: outcome.outcome === "rejected" ? "The game changed before your move could be completed. Check the board and try again." : "" };
    if (notifications) notifications.push(notification); else emitChange(notification);
    return true;
  };
  const applyLiveGameUpdate = ({ game, eventSeq = null, commandOutcome = null }) => {
    if (eventSeq !== null || commandOutcome) {
      if (!validSyncSnapshot(game, game?.id) || !isSyncRevision(eventSeq)
        || (commandOutcome && (!isSyncRevision(commandOutcome.eventSeq) || !isSyncRevision(commandOutcome.gameplayRevision)
          || commandOutcome.eventSeq > eventSeq || commandOutcome.gameplayRevision > game.gameplayRevision))) {
        if (game?.id && gameById.has(game.id)) {
          const optimistic = getOptimisticState(game.id);
          optimistic.syncStatus = "confirming";
          recalculateOptimisticGame(game.id);
          emitChange({ type: "invalid_snapshot", gameId: game.id });
          void reconcileGame(game.id).catch(() => {});
        }
        return null;
      }
    }
    const notifications = [];
    if (commandOutcome && game) {
      const confirming = getOptimisticState(game.id).syncStatus === "confirming";
      if (settleOutcome(game.id, commandOutcome, notifications) && confirming) incrementSyncMetric("wsConfirmedAfterHttpFail", game.id);
    }
    const result = upsertGameSnapshot({ game, eventSeq, changeType: "authoritative_update", publish: false });
    for (const notification of notifications) emitChange(notification);
    if (game) { emitChange({ type: "authoritative_update", gameId: game.id }); void sendNextPendingCommand(game.id); }
    return result;
  };

  const boundedRequest = async (url, init, controller = new AbortController()) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fetcher(url, { ...init, signal: controller.signal })).then(mustOk),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("request_timeout"), { code: "request_timeout" })); }, timing.requestTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };

  const scheduleRetry = (gameId, retryAttempt) => {
    if (!active) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.retryTimer) clearTimeout(optimistic.retryTimer);
    const delays = timing.retryDelaysMs;
    const delay = delays[Math.min(retryAttempt, delays.length - 1)] * (1 - timing.retryJitter + random() * timing.retryJitter * 2);
    optimistic.retryTimer = setTimeout(() => {
      optimistic.retryTimer = null;
      void sendNextPendingCommand(gameId, { retryAttempt: retryAttempt + 1, reconcileFirst: true });
    }, delay);
    optimistic.retryTimer.unref?.();
  };
  const processResponse = (gameId, body, envelopes) => {
    if (body?.protocolVersion === 1) { markUpgradeRequired(gameId); throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" }); }
    if (!isReconcileResponse(body, gameId, envelopes) || (body.game !== undefined && (!validSyncSnapshot(body.game, gameId) || body.game.gameplayRevision !== body.gameplayRevision))) throw new Error("invalid_confirmation");
    const notifications = [];
    for (const outcome of body.commandOutcomes) settleOutcome(gameId, outcome, notifications);
    if (body.game) upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, publish: false });
    for (const notification of notifications) emitChange(notification);
    emitChange({ type: "authoritative_update", gameId });
    void sendNextPendingCommand(gameId);
    return body;
  };
  const reconcileRequest = async (gameId, controller, isCurrent = () => true) => {
    if (auth?.enabled && (!auth.session.authenticated || gameById.get(gameId)?.ownershipMode === "legacy_guest")) return null;
    await beforeReconcile(gameId);
    if (!isCurrent()) return null;
    const recoveryEpoch = getOptimisticState(gameId).mutationRecoveryEpoch;
    const envelopes = getOptimisticState(gameId).pendingCommands.map((entry) => entry.envelope);
    const body = await boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}/reconcile`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: 2, identityId, knownSnapshotEventSeq: getOptimisticState(gameId).forceSnapshot ? 0 : lastEventSeqByGameId.get(gameId) ?? 0, commands: envelopes }),
    }, controller);
    if (!isCurrent()) return null;
    const result = processResponse(gameId, body, envelopes);
    if (body.game && recoveryEpoch === getOptimisticState(gameId).mutationRecoveryEpoch) getOptimisticState(gameId).forceSnapshot = false;
    return result;
  };

  const sendNextPendingCommand = async (gameId, { retryAttempt = 0, reconcileFirst = false } = {}) => {
    if (!active) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.attempt || optimistic.retryTimer) return;
    const command = optimistic.pendingCommands[0];
    if (!command) {
      optimistic.syncStatus = "ready";
      recalculateOptimisticGame(gameId);
      return;
    }
    if (shouldDeferCommandSend(gameId, command)) return;
    const attempt = { commandId: command.clientCommandId, controller: new AbortController() };
    attempt.done = new Promise((resolve) => { attempt.finish = resolve; });
    optimistic.attempt = attempt;
    optimistic.inflightCommandId = command.clientCommandId;
    optimistic.syncStatus = reconcileFirst ? "confirming" : "applying-update";
    if (!optimistic.budgetTimer) {
      optimistic.budgetCommandId = command.clientCommandId;
      optimistic.confirmDeadlineAt = Date.now() + timing.confirmationBudgetMs;
      optimistic.budgetTimer = setTimeout(() => {
        if (!optimistic.pendingCommands.some((entry) => entry === command)) return;
        optimistic.confirmationOverdue = true;
        recalculateOptimisticGame(gameId);
        emitChange({ type: "confirmation_budget_expired", gameId, clientCommandId: command.clientCommandId });
      }, timing.confirmationBudgetMs);
      optimistic.budgetTimer.unref?.();
    }
    recalculateOptimisticGame(gameId);
    try {
      if (reconcileFirst) {
        const response = await reconcileRequest(gameId, attempt.controller, () => optimistic.attempt === attempt);
        if (optimistic.attempt !== attempt) return;
        const own = response.commandOutcomes.find((entry) => entry.clientCommandId === command.clientCommandId);
        const current = gameById.get(gameId);
        if (!own || own.outcome !== "unknown" || own.reason === "dependency_pending" || own.reason === "legacy_evidence" || current?.gameplayRevision !== command.envelope.expectedGameplayRevision || canonicalCommandJson(current?.board?.state ?? null) !== canonicalCommandJson(command.envelope.expectedState)) throw new Error("outcome_unknown");
      }
      const body = await boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}/${command.kind === "apply" ? "apply" : "end-turn"}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command.envelope),
      }, attempt.controller);
      if (optimistic.attempt !== attempt) return;
      processResponse(gameId, body, [command.envelope]);
      if (optimistic.pendingCommands.includes(command)) throw new Error("outcome_unknown");
    } catch (error) {
      if (optimistic.attempt !== attempt) return;
      if (error.code === "upgrade_required") markUpgradeRequired(gameId);
      optimistic.syncStatus = "confirming";
      incrementSyncMetric("httpConfirmFailed", gameId);
      recalculateOptimisticGame(gameId);
      emitChange({ type: "optimistic_confirming", gameId, clientCommandId: command.clientCommandId });
      scheduleRetry(gameId, retryAttempt);
    } finally {
      attempt.finish();
      if (optimistic.attempt === attempt) { optimistic.attempt = null; optimistic.inflightCommandId = null; }
      if (!optimistic.pendingCommands.includes(command)) void sendNextPendingCommand(gameId);
    }
  };

  const internalCommand = (envelope) => ({ envelope, kind: envelope.kind === "action" ? "apply" : "end-turn", clientCommandId: envelope.clientCommandId, state: clone(envelope.expectedState), action: envelope.payload.action, notation: envelope.payload.notation, queuedAt: new Date().toISOString() });
  const hydrateJournal = async (gameId) => {
    assertActive();
    if (auth?.enabled && (!auth.session.authenticated || gameById.get(gameId)?.ownershipMode !== "account_v1")) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.hydrated) return;
    try {
      const saved = await commandJournal.list(identityId, gameId);
      assertActive();
      for (const envelope of saved) if (!isSyncCommand(envelope) || envelope.fingerprint !== await commandFingerprint(envelope)) throw new Error("invalid_saved_command");
      assertActive();
      for (const envelope of saved) {
        if (auth?.enabled && envelope.authContextId !== auth.session.contextId) continue;
        if (optimistic.outcomes.has(envelope.clientCommandId)) { await commandJournal.remove(envelope); continue; }
        if (!optimistic.pendingCommands.some((entry) => entry.clientCommandId === envelope.clientCommandId)) optimistic.pendingCommands.push(internalCommand(envelope));
      }
      // Topological order; cycles/invalid chains are rejected by the server, never sent out of order.
      const ordered = [], remaining = [...optimistic.pendingCommands];
      while (remaining.length) {
        const next = remaining.findIndex((entry) => !entry.envelope.predecessor || !remaining.some((parent) => parent.clientCommandId === entry.envelope.predecessor.clientCommandId));
        if (next < 0) throw new Error("invalid_dependency_chain");
        ordered.push(...remaining.splice(next, 1));
      }
      optimistic.pendingCommands = ordered;
      optimistic.hydrated = true;
      if (saved.length) { optimistic.syncStatus = "confirming"; recalculateOptimisticGame(gameId); emitChange({ type: "journal_restored", gameId, clientCommandIds: ordered.map((entry) => entry.clientCommandId) }); void sendNextPendingCommand(gameId, { reconcileFirst: true }); }
    } catch (error) { blockStorage(gameId, error); throw error; }
  };

  const enqueueOptimisticCommand = async ({ gameId, command }) => {
    const optimistic = getOptimisticState(gameId);
    const admission = optimistic.admission.catch(() => {}).then(async () => {
      assertActive();
      if (auth?.enabled && (!auth.session.authenticated)) throw Object.assign(new Error("invalid_credentials"), { code: "invalid_credentials" });
      if (optimistic.storageBlocked || optimistic.connectionRecovering || optimistic.syncStatus === "confirming") throw Object.assign(new Error("sync_recovering"), { code: "sync_recovering" });
      const current = getGameViewModel(gameId);
      const predecessor = optimistic.pendingCommands.at(-1)?.envelope;
      const envelope = { protocolVersion: 2, gameId, identityId, clientCommandId: command.clientCommandId,
        ...(auth?.enabled ? { authContextId: auth.session.contextId } : {}),
        kind: command.kind === "apply" ? "action" : "end_turn", payload: command.kind === "apply" ? { action: command.action, notation: command.notation } : {},
        expectedState: clone(command.state ?? current.board.state), expectedGameplayRevision: predecessor ? predecessor.expectedGameplayRevision + 1 : (gameById.get(gameId)?.gameplayRevision ?? 0),
        ...(command.kind === "end-turn" ? { expectedTurnIndex: current.board.state.turnIndex } : {}),
        ...(predecessor ? { predecessor: { clientCommandId: predecessor.clientCommandId, fingerprint: predecessor.fingerprint } } : {}),
      };
      envelope.fingerprint = await commandFingerprint(envelope);
      assertActive();
      command.envelope = envelope;
      const projection = projectOptimisticGame({ authoritativeGame: gameById.get(gameId), identityId, queue: [...optimistic.pendingCommands, command] });
      if (!projection.ok) return projection;
      try { await commandJournal.admit(envelope); }
      catch (error) { optimistic.unsavedCommand = command; blockStorage(gameId, error); throw error; }
      assertActive();
      optimistic.pendingCommands.push(command);
      optimistic.syncStatus = "applying-update";
      recalculateOptimisticGame(gameId);
      emitChange({ type: "optimistic_enqueue", gameId, clientCommandId: command.clientCommandId });
      // Let the operation owner receive its handle before an immediate response can settle it.
      void sendNextPendingCommand(gameId);
      return { ok: true, result: optimistic.commandResults.get(command.clientCommandId), game: optimistic.derivedGame };
    });
    optimistic.admission = admission;
    return admission;
  };

  const setConnectionRecovering = (gameId, recovering) => {
    const optimistic = getOptimisticState(gameId);
    optimistic.connectionRecovering = recovering || optimistic.forceSnapshot === true;
    recalculateOptimisticGame(gameId);
    emitChange({ type: "connection_recovery_changed", gameId, recovering });
  };
  const reconcileGame = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.recoveryPromise) return optimistic.recoveryPromise;
    optimistic.recoveryPromise = Promise.resolve().then(async () => {
      await beforeReconcile(gameId);
      await hydrateJournal(gameId);
      if (optimistic.attempt) await optimistic.attempt.done;
      if (optimistic.retryTimer) { clearTimeout(optimistic.retryTimer); optimistic.retryTimer = null; }
      if (optimistic.pendingCommands.length) return sendNextPendingCommand(gameId, { reconcileFirst: true });
      const attempt = { commandId: null, controller: new AbortController() };
      attempt.done = new Promise((resolve) => { attempt.finish = resolve; });
      optimistic.attempt = attempt;
      try { await reconcileRequest(gameId, attempt.controller, () => optimistic.attempt === attempt); }
      finally { if (optimistic.attempt === attempt) optimistic.attempt = null; attempt.finish(); }
    }).finally(() => { optimistic.recoveryPromise = null; });
    return optimistic.recoveryPromise;
  };
  const retrySaving = async (gameId) => {
    const optimistic = getOptimisticState(gameId);
    try {
      // Admission failures must not block recovery of already durable commands.
      // Reconcile other games too: their receipts may release the identity-wide cap.
      const outstanding = await commandJournal.list(identityId);
      await Promise.allSettled([...new Set(outstanding.map((entry) => entry.gameId))].map((pendingGameId) => reconcileGame(pendingGameId)));
      // Retry cleanup by exact receipt identity, retaining unresolved records.
      const saved = await commandJournal.list(identityId, gameId);
      assertActive();
      for (const envelope of saved) if (!isSyncCommand(envelope) || envelope.fingerprint !== await commandFingerprint(envelope)) throw new Error("invalid_saved_command");
      for (const envelope of saved) if (optimistic.outcomes.has(envelope.clientCommandId)) await commandJournal.remove(envelope);
      if (optimistic.unsavedCommand) {
        const command = optimistic.unsavedCommand;
        await commandJournal.admit(command.envelope);
        assertActive();
      optimistic.pendingCommands.push(command);
        optimistic.unsavedCommand = null;
        optimistic.syncStatus = "confirming";
      }
      optimistic.storageBlocked = false;
      optimistic.hydrated = false;
      await hydrateJournal(gameId);
      return reconcileGame(gameId);
    } catch (error) { blockStorage(gameId, error); throw error; }
  };

  const loadGamesPage = async ({ section, page = 0, pageSize = 6, debug = false } = {}) => {
    const params = new URLSearchParams({
      identityId,
      section: String(section || ""),
      page: String(page),
      pageSize: String(pageSize),
      debug: debug ? "1" : "0",
    });
    const body = await boundedRequest(`/api/shell/games?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const gamesPage = Array.isArray(body.games) ? body.games.map((game) => normalizeStaticGameCard(game)) : [];
    for (const game of gamesPage) {
      homeGameCardById.set(game.id, game);
    }
    // Home reloads must resume durable commands even when their game is not opened.
    // Hydration starts bounded reconciliation; listing a page never waits on the network recovery.
    try {
      const saved = await commandJournal.list(identityId);
      await Promise.all([...new Set(saved.map(command => command.gameId))].map(gameId => hydrateJournal(gameId).catch(() => {})));
    } catch (error) {
      for (const game of gamesPage) blockStorage(game.id, error);
    }
    return {
      ...body,
      games: gamesPage.map(game => getHomeGameCard(game.id)),
    };
  };

  const markUpgradeRequired = (gameId) => {
    getOptimisticState(gameId).upgradeRequired = true;
    recalculateOptimisticGame(gameId);
    emitChange({ type: "upgrade_required", gameId });
  };
  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
    // A fresh route already opened its socket. Its bounded initial snapshot owns recovery;
    // only fall back to HTTP after that generation has been retired by the connection owner.
    if (!openAsViewer && !lastEventSeqByGameId.get(gameId)) {
      const socketOwned = await Promise.resolve(beforeReconcile(gameId, { initialLoad: true })).catch(() => false);
      if (lastEventSeqByGameId.get(gameId) && gameById.has(gameId)) {
        await hydrateJournal(gameId).catch(() => {});
        return getGameViewModel(gameId);
      }
      if (socketOwned) {
        try {
          await reconcileGame(gameId);
          const recovered = getGameViewModel(gameId);
          if (!recovered) throw new Error("invalid_snapshot");
          return recovered;
        } catch (error) {
          // The legacy server has no reconciliation route. A bounded read can establish
          // its protocol version without submitting or inventing any command outcome.
          if (error.status !== 404 && error.status !== 405) throw error;
        }
      }
    }
    const body = await boundedRequest(
      `/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}${
        openAsViewer ? "&openAsViewer=1" : ""
      }`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    if (body.protocolVersion !== 2) { markUpgradeRequired(gameId); throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" }); }
    if (!validSyncSnapshot(body.game, gameId) || !isSyncRevision(body.eventSeq)) throw new Error("invalid_snapshot");
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    // Storage failure blocks shared changes, not access to the authoritative board/history.
    await hydrateJournal(gameId).catch(() => {});
    return getGameViewModel(gameId);
  };

  const createGame = async ({ selfPlayMode = false, gameId = null, creatorSide = "p1" } = {}) => {
    const response = await fetcher("/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, selfPlayMode, gameId, creatorSide }),
    });
    const body = await mustOk(response);
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
    gameId = null,
    sourceGameId,
    sourceMoveIndex,
    scenario,
    initialSelectionAction,
    participantCopyMode,
    selfPlayMode = false,
  } = {}) => {
    const response = await fetcher("/api/shell/history/branch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId,
        sourceGameId,
        sourceMoveIndex,
        scenario,
        initialSelectionAction,
        participantCopyMode,
        selfPlayMode,
      }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    }
    return body;
  };

  const resolveInvite = async (inviteToken) => {
    return boundedRequest(`/api/shell/invites/${encodeURIComponent(inviteToken)}`, {
      method: "GET",
      cache: "no-store",
    });
  };

  const joinGame = async ({ gameId, mode, inviteFromRole = null, inviteToken = null }) => {
    if (mode !== "viewer") assertSharedMutationAllowed(gameId);
    const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, mode, inviteFromRole, inviteToken }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const playAsBothPlayers = async ({ gameId }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/play-as-both`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  const approvePendingRequest = async ({ gameId, requesterIdentityId }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requesterIdentityId }),
    });
    return { ...body, game: upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq }) };
  };

  // Compatibility convenience for callers that ask for the first legal move.
  // It uses exactly the same durable action path, never an unjournaled /moves write.
  const addMove = async ({ gameId, notation }) => {
    const current = await loadGame(gameId);
    const action = listLegalActions(resolveToStability(current.board.state, { artifactMode: "full" }))[0];
    if (!action) throw new Error("no_legal_actions");
    const submitted = await applyGameAction({ gameId, state: current.board.state, action, notation });
    if (!submitted.accepted) throw new Error(submitted.validation?.code ?? "invalid_action");
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const check = () => {
        const outcome = getOptimisticState(gameId).outcomes.get(submitted.clientCommandId);
        if (!outcome) return;
        unsubscribe();
        if (outcome.outcome === "rejected") { reject(Object.assign(new Error(outcome.reason), { code: outcome.reason })); return; }
        // Receipts settle before their snapshot is applied in the same response turn.
        queueMicrotask(() => { const game = getGameViewModel(gameId); resolve({ ok: true, accepted: true, game, clientCommandId: submitted.clientCommandId, move: game.moves.find((entry) => entry.clientCommandId === submitted.clientCommandId) }); });
      };
      unsubscribe = subscribe(check);
      check();
    });
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

  const applyGameAction = async ({ gameId, state, action, notation }) => {
    const command = {
      kind: "apply",
      clientCommandId: createClientCommandId({ gameId, identityId, random }),
      action: clone(action),
      state: clone(state),
      notation: notation ?? defaultNotationForAction(action),
      queuedAt: new Date().toISOString(),
    };
    const optimistic = await enqueueOptimisticCommand({ gameId, command });
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
    const optimistic = await enqueueOptimisticCommand({ gameId, command });
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

  const selectHistoryMove = ({ gameId, moveIndex }) => {
    const game = getGameViewModel(gameId);
    const moves = [...(game?.moves ?? []), ...(game?.pendingMoves ?? [])];
    const selected = moves.find((move) => move.index === moveIndex);
    if (!selected) throw new Error("move_not_found");
    historyIntentByGameId.set(gameId, { moveId: historyMoveKey(selected), clientCommandId: selected.clientCommandId, order: moves.map(historyMoveKey), position: moves.indexOf(selected) });
    recalculateOptimisticGame(gameId);
    emitChange({ type: "history_mode_changed", gameId });
    return getGameViewModel(gameId);
  };

  const returnToLive = ({ gameId }) => {
    historyIntentByGameId.set(gameId, { moveId: null });
    recalculateOptimisticGame(gameId);
    emitChange({ type: "history_mode_changed", gameId });
    return getGameViewModel(gameId);
  };
  const assertSharedMutationAllowed = (gameId) => {
    if (getGameViewModel(gameId)?.sharedMutationsBlocked) throw Object.assign(new Error("sync_recovering"), { code: "sync_recovering" });
  };

  const recoverUncertainMutation = async (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.mutationRecovery) return;
    optimistic.mutationRecovery = true;
    try {
      await reconcileGame(gameId);
      if (optimistic.forceSnapshot) throw new Error("snapshot_required");
      setConnectionRecovering(gameId, false);
    } catch {
      optimistic.mutationRecoveryTimer = setTimeout(() => { optimistic.mutationRecoveryTimer = null; void recoverUncertainMutation(gameId); }, timing.retryDelaysMs.at(-1));
      optimistic.mutationRecoveryTimer.unref?.();
    } finally { optimistic.mutationRecovery = false; }
  };

  const boundedSharedRequest = async (gameId, url, init) => {
    try {
      const body = await boundedRequest(url, init);
      if (!validSyncSnapshot(body.game, gameId) || !isSyncRevision(body.eventSeq)) throw new Error("invalid_confirmation");
      return body;
    }
    catch (error) {
      if (!error.body) {
        getOptimisticState(gameId).mutationRecoveryEpoch = (getOptimisticState(gameId).mutationRecoveryEpoch ?? 0) + 1;
        getOptimisticState(gameId).forceSnapshot = true;
        setConnectionRecovering(gameId, true);
        void recoverUncertainMutation(gameId);
        throw Object.assign(new Error("The response was lost. Checking the current game before you continue."), { code: "delivery_unknown", cause: error });
      }
      throw error;
    }
  };

  const requestRevertToMove = async ({ gameId, targetMoveId, requestId = null }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/revert-request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, targetMoveId, requestId }),
    });
    logDiagnostic("info", "live_transport_revert_requested", { gameId, targetMoveId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const approveRevertRequest = async ({ gameId, requestId }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/revert-approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
    logDiagnostic("info", "live_transport_revert_approved", { gameId, requestId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const rejectRevertRequest = async ({ gameId, requestId }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/revert-reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
    logDiagnostic("info", "live_transport_revert_rejected", { gameId, requestId }, { verboseOnly: true });
    upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, changeType: "history_mode_changed" });
    return getGameViewModel(gameId);
  };

  const rescindRevertRequest = async ({ gameId, requestId }) => {
    assertSharedMutationAllowed(gameId);
    const body = await boundedSharedRequest(gameId, `/api/shell/games/${encodeURIComponent(gameId)}/revert-rescind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requestId }),
    });
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
  const getHomeGameCard = (gameId) => {
    const card = homeGameCardById.get(gameId);
    if (!card) return null;
    const optimistic = getOptimisticState(gameId);
    const next = clone(card);
    if (optimistic.pendingCommands.length) next.syncStatus = optimistic.syncStatus;
    if (optimistic.storageBlocked || optimistic.connectionRecovering) next.syncStatus = "confirming";
    return next;
  };

  const getGameViewModel = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (!optimistic.derivedGame) {
      recalculateOptimisticGame(gameId);
    }
    const game = optimistic.derivedGame;
    if (!game) {
      return null;
    }
    if (auth?.enabled && (!auth.session.authenticated || game.ownershipMode === "legacy_guest")) {
      return { ...game, canRecordMove:false,canEndTurn:false,canPlayAsBothPlayers:false,canUndoLastMove:false,canInvite:false,inviteToken:null,
        ...(!auth.session.authenticated ? {legalActions:[]} : {}) };
    }
    return game;
  };

  const getIdentityId = () => identityId;
  const getLastEventSeq = (gameId) => lastEventSeqByGameId.get(gameId) ?? 0;
  const getSyncMetrics = () => clone(syncMetrics);
  const flushPendingCommands = (gameId) => {
    void sendNextPendingCommand(gameId);
  };
  const discardPendingCommands = (gameId, { notice = "" } = {}) => {
    clearOptimisticQueue(gameId, {
      notice,
      syncStatus: "ready",
      changeType: "optimistic_queue_cleared",
    });
  };

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
    reconcileGame,
    setConnectionRecovering,
    retrySaving,
    getCommandOutcome: (gameId, commandId) => getOptimisticState(gameId).outcomes.get(commandId) ?? null,
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
    flushPendingCommands,
    discardPendingCommands,
    listGames,
    getHomeGameCard,
    getGameViewModel,
    getAuthoritativeGame: (gameId) => clone(gameById.get(gameId) ?? null),
    getIdentityId,
    subscribe,
    unsubscribe,
    retire() {
      active = false;
      listeners.clear();
      for (const optimistic of optimisticStateByGameId.values()) {
        clearTimeout(optimistic.retryTimer);
        optimistic.attempt?.controller?.abort();
        optimistic.attempt = null;
        optimistic.pendingCommands = [];
        optimistic.unsavedCommand = null;
      }
      void Promise.resolve(commandJournal.close?.()).catch(() => {});
    },
  };
};
