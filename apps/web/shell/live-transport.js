import { activeDecisionLineage } from './decision-history.js';
import { createRulesExecutor } from '../board/rules-runtime.js';
import { CURRENT_COMPUTER_MODEL } from '../generated/packages/shared-types/src/computer-play.js';
import { STORAGE_GENERATION_HEADER } from "../generated/packages/shared-types/src/storage-policy.js";
import { issueDiagnostics } from "./issue-diagnostics.js";
import { serializeState, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { loadIdentity, saveIdentity } from "./persistence.js";
import { defaultNotationForAction, rebaseProjectedMetadata } from "./optimistic-live.js";
import { buildStaticGameCardFromGame, normalizeStaticGameCard } from "./static-game-cards.js";
import { createCommandJournal } from "./command-journal.js";
import { ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION, SYNC_PROTOCOL_VERSION, SYNC_TIMING, SYNC_LIMITS, LIVE_HISTORY, SHARED_OPERATIONS, commandFingerprint, isReconcileResponse, isCommandOutcome, isSyncRevision, isSyncCommand, canonicalCommandJson } from "../generated/packages/shared-types/src/sync-protocol.js";

import { applyHistoryIntent, historyMoveKey } from "./recovery-view.js";
import { activityStateActorSide } from "./activity-affiliation.js";

const clone = (value) => structuredClone(value);
const projectionControlKey = game => JSON.stringify({
  ownershipMode: game?.ownershipMode, selfPlayMode: game?.selfPlayMode,
  p1: game?.player1?.identityId, p2: game?.player2?.identityId,
  myRole: game?.myRole, myRoles: game?.myRoles,
  inHistoryMode: game?.inHistoryMode, historyIndex: game?.historyIndex, historyTurnIndex: game?.historyTurnIndex,
  // A renewal changes expiry, not authority. Generation/device/owner changes
  // must still fence work, even if the board and gameplay revision stay put.
  computer: game?.computer ? { ...game.computer,
    lease: game.computer.lease ? { ...game.computer.lease, expiresAt: undefined } : null,
  } : null,
});
const sameProjectionAuthority = (left, right) => Boolean(left && right
  && left.gameplayRevision === right.gameplayRevision
  && serializeState(left.board.state) === serializeState(right.board.state)
  && projectionControlKey(left) === projectionControlKey(right));
// A validated, unresolved receipt is pending durable intent, not a failed
// request. Private identity prevents external error messages impersonating it.
const unresolvedCommandOutcome = Symbol('unresolved-command-outcome');
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
    const retryAfter = response.headers?.get?.("Retry-After");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const until = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(until) && until > 0) error.retryAfterMs = Math.min(until, SYNC_TIMING.maximumRetryAfterMs);
    }
    error.diagnosticEvidence = response.righeltDiagnosticEvidence;
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
  rulesExecutor = createRulesExecutor(),
} = {}) => {
  let active = true;
  let rulesGameId = null;
  let rulesVisible = !globalThis.document?.hidden;
  let rulesEpoch = 0;
  const assertRulesContext = (epoch, gameId) => {
    if (rulesExecutor.asynchronous && (rulesEpoch !== epoch || rulesGameId !== gameId || !rulesVisible)) {
      throw Object.assign(new Error("rules_cancelled"), { code: "rules_cancelled" });
    }
  };
  const assertActive = () => { if (!active) throw Object.assign(new Error("session_changed"), { code: "session_changed" }); };
  commandJournal ??= createCommandJournal({
    ...(auth?.storageGeneration ? { databaseName: `righelt.online-commands.storage.${auth.storageGeneration}.${auth?.enabled ? auth.session.contextId || "anonymous" : "guest"}` } : auth?.enabled ? { databaseName: `righelt.online-commands.account-v1.${auth.session.contextId || "anonymous"}` } : {}),
    isCurrent: () => active,
  });
  let serverActionContract = null;
  const rawFetcher = fetcher;
  fetcher = async (url, init = {}, evidence = {}) => {
    assertActive();
    if (init.method === "POST" && typeof init.body === "string") init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), protocolVersion: SYNC_PROTOCOL_VERSION }) };
    const requestId = crypto.randomUUID(), started = Date.now();
    const routeKind = /\/games\/[^/?]+\/([^/?]+)/.exec(url)?.[1];
    Object.assign(evidence, { requestId, status: null, durationMs: 0, serverBuild: "unavailable", requestPhase: "headers",
      requestKind: ["apply", "end-turn", "reconcile"].includes(routeKind) ? routeKind : "read" });
    init = { ...init, headers: { ...init.headers, "X-Righelt-Request-Id": requestId, [ACTION_CONTRACT_HEADER]: String(ACTION_CONTRACT_VERSION), [LIVE_HISTORY.requestHeader]: LIVE_HISTORY.requestValue, ...(auth?.storageGeneration ? { [STORAGE_GENERATION_HEADER]: auth.storageGeneration } : {}) } };
    let response;
    try { response = await rawFetcher(url, init); }
    catch(error) {
      const data = { ...evidence, durationMs: Date.now() - started, status: null, stage: "request_failed", serverBuild: "unavailable" };
      if (error && typeof error === "object") error.diagnosticEvidence = data;
      const gameId = /\/games\/([^/?]+)/.exec(url)?.[1];
      if (gameId && !init.signal?.aborted) getOptimisticState(gameId).requestEvidence = data;
      throw error;
    }
    Object.assign(evidence, { status: response.status, durationMs: Date.now() - started, serverBuild: response.headers?.get?.("X-Righelt-Server-Build") ?? "unavailable", requestPhase: "body" });
    const data = { ...evidence, stage: "response_received" };
    response.righeltDiagnosticEvidence = data;
    const gameId = /\/games\/([^/?]+)/.exec(url)?.[1];
    if (gameId && !init.signal?.aborted) {
      const optimistic = getOptimisticState(gameId);
      data.gameId = gameId;
      optimistic.requestEvidence = data;
      if (optimistic.incidentId) issueDiagnostics.capture(`recovery:${gameId}`, data);
    }
    assertActive();
    const responseGeneration = response.headers?.get?.(STORAGE_GENERATION_HEADER);
    if (auth?.storageGeneration && responseGeneration && responseGeneration !== auth.storageGeneration) throw Object.assign(new Error("storage_reset"), { code: "storage_reset", diagnosticEvidence: data });
    if (auth?.storageGeneration && !responseGeneration && response.ok) throw Object.assign(new Error("storage_generation_unverified"), { code: "storage_generation_unverified", diagnosticEvidence: data });
    const advertisedContract = response.headers?.get?.(ACTION_CONTRACT_HEADER);
    serverActionContract = advertisedContract == null ? null : Number(advertisedContract);
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
  let homeListRevision = 0;
  const homeMembershipSignature = card => JSON.stringify([card?.gameplayRevision,card?.confirmedOutcomeStatus,card?.moveCount,card?.lastMoveAt,
    card?.selfPlayMode,card?.myRole,card?.myRoles,card?.player1?.identityId,card?.player2?.identityId,
    card?.player1?.profile,card?.player2?.profile,card?.player1?.computerProfile,card?.player2?.computerProfile]);
  const installAuthoritativeHomeCard = (game, eventSeq) => {
    const next = buildStaticGameCardFromGame(game, {eventSeq, confirmed:true});
    if (homeMembershipSignature(homeGameCardById.get(game.id)) !== homeMembershipSignature(next)) homeListRevision++;
    homeGameCardById.set(game.id,next);
  };
  const lastEventSeqByGameId = new Map();
  const optimisticStateByGameId = new Map();
  // Storage recovery owns asynchronous work separately from game projections.
  const journalRecoveryByOwner = new WeakMap();
  const historyIntentByGameId = new Map();
  const historyCache = new Map();
  const historyRequests = new Map();
  const historyLoads = new Map();
  const sharedWaiters = new Map();
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
    next.pendingComputerControl = optimistic.pendingCommands.length > 0 && optimistic.pendingCommands.every(command => command.kind === 'shared' && command.envelope?.payload?.operation === 'computer-control');
    const pendingControl = next.pendingComputerControl && optimistic.pendingCommands.length === 1 ? optimistic.pendingCommands[0].envelope : null;
    const controlValues = pendingControl?.payload?.values;
    // Read-only presentation metadata. The durable envelope and all sync gates stay authoritative.
    next.pendingComputerControlRequest = pendingControl ? { action: controlValues?.action, deviceId: controlValues?.deviceId, generation: controlValues?.generation, submittedAt: pendingControl.submittedAt } : null;
    const historyLoad = historyLoads.get(gameId);
    next.historyLoading = Boolean(historyLoad?.loading);
    next.historyLoadError = historyLoad?.error ?? null;
    next.historyLoadIndex = historyLoad?.index ?? null;
    next.historyLoadTurnIndex = historyLoad?.turnIndex ?? null;
    const pendingState = (optimistic.pendingCommands[0] ?? optimistic.unsavedCommand)?.envelope?.expectedState;
    // During a forced retreat the defender acts within the attacker’s turn.
    // Resolve the captured command actor before an optimistic turn change.
    next.pendingActorSide = activityStateActorSide(pendingState);
    next.pendingComputerSaveStartedAt = optimistic.pendingCommands.length && optimistic.pendingCommands.every(command => command.computer)
      ? Math.min(...optimistic.pendingCommands.map(command => Date.parse(command.queuedAt))) : null;
    next.pendingComputerProfile = next.pendingComputerSaveStartedAt != null ? optimistic.pendingCommands[0]?.computer?.profile : null;
    next.liveCurrentSnapshot = clone(next.liveCurrentSnapshot ?? next.board?.state ?? next.currentSnapshot ?? null);
    next.syncStatus = optimistic.storageBlocked ? "storage-blocked" : optimistic.syncStatus;
    next.storageBlocked = optimistic.storageBlocked;
    next.unsavedCommand = Boolean(optimistic.unsavedCommand);
    next.confirmationOverdue = optimistic.confirmationOverdue || Boolean(optimistic.pendingCommands.length && optimistic.confirmDeadlineAt && Date.now() >= optimistic.confirmDeadlineAt);
    next.recoveryStartedAt = optimistic.recoveryStartedAt ?? null;
    next.recoveryEpisodeId = optimistic.recoveryEpisodeId ?? null;
    next.recoveryGeneration = optimistic.recoveryGeneration ?? 0;
    next.recoveryIssue = optimistic.recoveryIssue ?? null;
    next.incidentId = optimistic.incidentId ?? null;
    next.recovering = optimistic.connectionRecovering === true || optimistic.syncStatus === "confirming" || next.confirmationOverdue;
    next.upgradeRequired = optimistic.upgradeRequired === true;
    next.storageLimitReached = optimistic.storageError?.code === "command_limit_reached" || /limit/.test(optimistic.storageError?.message ?? "");
    next.rulesChecking = Boolean(optimistic.admissionProjection || optimistic.projectionJob?.pending);
    next.sharedMutationsBlocked = next.rulesChecking || optimistic.storageBlocked || next.recovering || next.upgradeRequired || optimistic.pendingCommands.some(command=>command.kind === "shared");
    applyHistoryIntent(next, historyIntentByGameId.get(gameId), identityId);
    if (next.sharedMutationsBlocked) {
      next.canRecordMove = false;
      next.canEndTurn = false;
    }
    return next;
  };

  const recalculateOptimisticGame = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    const authoritativeGame = optimistic.externalPreview ?? gameById.get(gameId);
    optimistic.commandResults = new Map();

    if (!authoritativeGame) {
      optimistic.derivedGame = null;
      return { ok: true, game: null };
    }

    if (optimistic.pendingCommands.length === 0) {
      rulesExecutor.cancel(`project:${gameId}`);
      optimistic.projectionJob = null;
      optimistic.derivedGame = decorateGameWithSync(authoritativeGame, gameId);
      return { ok: true, game: optimistic.derivedGame };
    }

    // Recovery owns saved intent. A fresh load starts with authority, while an
    // already-published tentative board must survive unknown receipts. Neither
    // case needs speculative recomputation while hidden or confirming.
    if (rulesExecutor.asynchronous && (optimistic.syncStatus === "confirming" || !rulesVisible || gameId !== rulesGameId)) {
      rulesExecutor.cancel(`project:${gameId}`);
      optimistic.projectionJob = null;
      optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? authoritativeGame, gameId);
      return { ok: true, game: optimistic.derivedGame };
    }
    if (optimistic.admissionProjection) return { ok: true, game: optimistic.derivedGame };
    const queue = optimistic.pendingCommands.filter(command => command.kind !== "shared");
    const signature = queue.map(command => command.clientCommandId).join("|");
    const previous = optimistic.projectionJob;
    if (previous?.base === authoritativeGame && previous.signature === signature) {
      if (previous.result) return installProjection(gameId, previous.result);
      optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? authoritativeGame, gameId);
      return { ok: true, game: optimistic.derivedGame };
    }
    const job = optimistic.projectionJob = { base: authoritativeGame, signature, pending: true };
    const projection = rulesExecutor.project(`project:${gameId}`, { authoritativeGame, identityId, queue });
    if (!projection?.then) { job.pending = false; job.result = projection; return installProjection(gameId, projection); }
    job.promise = projection.then(result => {
      if (!active || optimistic.projectionJob !== job) return;
      job.pending = false; job.result = result;
      installProjection(gameId, result);
      emitChange({ type: "rules_projected", gameId });
    }).catch(error => {
      if (!active || optimistic.projectionJob !== job) return;
      job.pending = false;
      if (error.code !== "rules_cancelled") logDiagnostic("error", "rules_projection_failed", { gameId, message: error.message });
      optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? authoritativeGame, gameId);
      emitChange({ type: "rules_projection_stopped", gameId });
    });
    optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? authoritativeGame, gameId);
    return { ok: true, game: optimistic.derivedGame };
  };

  const installProjection = (gameId, projection) => {
    const optimistic = getOptimisticState(gameId);
    if (!projection.ok) {
      optimistic.derivedGame = decorateGameWithSync(optimistic.derivedGame ?? gameById.get(gameId), gameId);
      return projection;
    }
    optimistic.commandResults = projection.commandResults;
    optimistic.derivedGame = decorateGameWithSync(projection.game, gameId);
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
      void commandJournal.remove(command.envelope).catch((error) => blockStorage(gameId, error, command));
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
    getOptimisticState(next.id).externalPreview = null;
    gameById.set(next.id, next);
    installAuthoritativeHomeCard(next,lastEventSeqByGameId.get(next.id) ?? null);
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
      if (!staleSnapshotIgnored) installAuthoritativeHomeCard(authoritative,nextEventSeq);
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


  const captureRecoveryIssue = (gameId, stage, error = null, commandHint = null) => {
    const optimistic = getOptimisticState(gameId);
    const authoritative = gameById.get(gameId);
    const command = commandHint ?? optimistic.pendingCommands[0] ?? optimistic.unsavedCommand;
    optimistic.incidentId = issueDiagnostics.capture(`recovery:${gameId}`, {
      ...(error ? error.diagnosticEvidence : optimistic.requestEvidence), gameId, gameLink: `${globalThis.location?.origin ?? ""}/#/game/${gameId}`,
      operation: "move_recovery", stage, code: error?.code ?? (error ? "unavailable" : "overdue"),
      commandId: command?.clientCommandId, fingerprint: command?.envelope?.fingerprint,
      receipt: command ? optimistic.outcomes.get(command.clientCommandId) ?? "unavailable" : "unavailable",
      pendingCount: optimistic.pendingCommands.length, gameplayRevision: authoritative?.gameplayRevision,
      appliedEventSeq: lastEventSeqByGameId.get(gameId), authoritativeState: authoritative?.board?.state,
      tentativeState: optimistic.derivedGame?.board?.state, action: command?.action,
      browser: globalThis.navigator?.userAgent, visibility: globalThis.document?.visibilityState, online: globalThis.navigator?.onLine,
      clientBuild: globalThis.__righeltClientBuild ?? "unavailable", retry: Math.max(optimistic.retryAttempt ?? 0, optimistic.recoveryRetryAttempt ?? 0), generation: optimistic.recoveryGeneration ?? 0, recoveryEpisodeId: optimistic.recoveryEpisodeId ?? "unavailable",
      elapsedMs: Math.max(0, Date.now() - (optimistic.recoveryStartedAt ?? (Date.parse(optimistic.pendingCommands[0]?.queuedAt) || Date.now()))),
      ...optimistic.connectionEvidence,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, mode: authoritative?.computer ? "computer" : authoritative?.selfPlayMode ? "play_both" : "multiplayer",
      deadlineMs: error?.code === "request_timeout" ? timing.requestTimeoutMs : stage.startsWith("journal") ? SYNC_TIMING.requestTimeoutMs : timing.confirmationBudgetMs,
    });
  };
  const journalRecoveryState = (optimistic) => {
    if (!journalRecoveryByOwner.has(optimistic)) journalRecoveryByOwner.set(optimistic, {
      reasons: new Map(), jobs: new Map(),
      automaticRecovery: null, repairPromise: null,
      identityId, authEnabled: Boolean(auth?.enabled),
      contextId: auth?.enabled ? auth.session.contextId : null,
      storageGeneration: auth?.storageGeneration ?? null,
    });
    return journalRecoveryByOwner.get(optimistic);
  };
  const currentJournalOwner = (gameId, optimistic, owner) => active
    && optimisticStateByGameId.get(gameId) === optimistic
    && journalRecoveryByOwner.get(optimistic) === owner
    && owner.identityId === identityId && owner.authEnabled === Boolean(auth?.enabled)
    && owner.contextId === (auth?.enabled ? auth.session.contextId : null)
    && owner.storageGeneration === (auth?.storageGeneration ?? null)
    && (!auth?.enabled || (auth.session.authenticated && auth.session.account?.id === identityId));
  const journalRetryDelays = () => (timing.retryDelaysMs ?? SYNC_TIMING.retryDelaysMs).slice(0, 2);
  const retireJournalRecovery = owner => {
    const job = owner.automaticRecovery;
    if (!job) return;
    clearTimeout(job.timer); job.retired = true; owner.automaticRecovery = null;
  };
  const automaticJournalRecoveryAllowed = owner => [...owner.reasons.values()].every(reason => reason.error?.code === 'journal_timeout' && reason.automaticRecoveryAllowed !== false);
  const scheduleJournalRecovery = (gameId, optimistic, owner) => {
    if (!currentJournalOwner(gameId, optimistic, owner)) return;
    const failures = [...owner.reasons.values()].filter(reason => !reason.job);
    if (!automaticJournalRecoveryAllowed(owner)) { retireJournalRecovery(owner); return; }
    if (!failures.length) return;
    const job = owner.automaticRecovery ??= { attempts: 0, timer: null, promise: null, retired: false };
    const delays = journalRetryDelays();
    if (job.retired || job.timer || job.promise || job.attempts >= delays.length) return;
    const current = () => !job.retired && owner.automaticRecovery === job && currentJournalOwner(gameId, optimistic, owner);
    job.timer = setTimeout(() => {
      job.timer = null;
      if (!current()) return;
      if (!optimistic.storageBlocked) { retireJournalRecovery(owner); return; }
      if (!automaticJournalRecoveryAllowed(owner) || ![...owner.reasons.values()].some(reason => !reason.job)) { retireJournalRecovery(owner); return; }
      job.attempts++;
      // A timeout does not prove absence. Reuse the manual recovery path:
      // validate stored intent, reconcile exact receipts and prove readback.
      // Never construct a replacement shared command when no row exists.
      const recovery = retrySaving(gameId, () => current() && automaticJournalRecoveryAllowed(owner)); job.promise = recovery;
      const settled = () => {
        if (job.promise === recovery) job.promise = null;
        if (current() && optimistic.storageBlocked) scheduleJournalRecovery(gameId, optimistic, owner);
      };
      void recovery.then(settled, settled);
    }, delays[job.attempts]);
    job.timer.unref?.();
  };
  const refreshStorageReasons = (optimistic, owner) => {
    const reasons = [...owner.reasons.values()];
    // A cleanup retry must not replace an admission/cap/hydration explanation.
    const reason = reasons.filter(entry => !entry.job).at(-1) ?? reasons.at(-1);
    optimistic.storageBlocked = reasons.length > 0 || Boolean(optimistic.unsavedCommand);
    optimistic.storageError = reason?.error ?? null;
    if (!optimistic.storageBlocked && !owner.repairPromise) retireJournalRecovery(owner);
  };
  const resolveRecoveryIfClear = (gameId, optimistic) => {
    if (optimistic.storageBlocked || optimistic.unsavedCommand || optimistic.connectionRecovering
      || optimistic.forceSnapshot || optimistic.pendingCommands.length) return;
    issueDiagnostics.resolve(`recovery:${gameId}`);
    optimistic.incidentId = null;
  };
  const cleanupKey = envelope => canonicalCommandJson([envelope.identityId, envelope.gameId, envelope.clientCommandId, envelope.fingerprint]);
  const terminalReceipt = (envelope, outcome) => isSyncCommand(envelope)
    && isCommandOutcome(outcome, envelope) && ["accepted", "rejected"].includes(outcome.outcome);
  const currentCleanupJob = job => !job.retired && currentJournalOwner(job.gameId, job.optimistic, job.owner)
    && job.owner.jobs.get(job.key) === job;
  const retireCleanupJob = (job, { verified = false } = {}) => {
    if (job.owner.jobs.get(job.key) !== job) return;
    clearTimeout(job.timer); job.retired = true;
    job.owner.jobs.delete(job.key);
    if (verified) job.owner.reasons.delete(job.token);
  };
  const blockStorage = (gameId, error, settledCommand = null, cleanupJob = null, automaticRecoveryAllowed = true) => {
    if (!active || cleanupJob && !currentCleanupJob(cleanupJob)) return;
    const optimistic = getOptimisticState(gameId);
    const owner = journalRecoveryState(optimistic);
    if (!currentJournalOwner(gameId, optimistic, owner)) return;
    const token = cleanupJob?.token ?? Symbol('storage-failure');
    owner.reasons.set(token, { error, job: cleanupJob, automaticRecoveryAllowed });
    captureRecoveryIssue(gameId, settledCommand ? "journal_cleanup" : "journal", error, settledCommand);
    refreshStorageReasons(optimistic, owner);
    recalculateOptimisticGame(gameId);
    emitChange({ type: "journal_blocked", gameId, error });
    if (error?.code !== 'journal_timeout' || !automaticRecoveryAllowed) retireJournalRecovery(owner);
    else if (!cleanupJob) scheduleJournalRecovery(gameId, optimistic, owner);
  };
  const sameTerminalOwner = (gameId, optimistic, owner, envelope, outcome) => {
    if (!currentJournalOwner(gameId, optimistic, owner) || envelope.identityId !== identityId || envelope.gameId !== gameId
      || (auth?.enabled ? envelope.authContextId !== owner.contextId : envelope.authContextId !== undefined)
      || !terminalReceipt(envelope, outcome)) return false;
    const current = optimistic.outcomes.get(envelope.clientCommandId);
    return terminalReceipt(envelope, current) && canonicalCommandJson(current) === canonicalCommandJson(outcome);
  };
  const validTerminalCleanup = async (gameId, optimistic, owner, envelope, outcome) => {
    if (!sameTerminalOwner(gameId, optimistic, owner, envelope, outcome)) return false;
    if (envelope.fingerprint !== await commandFingerprint(envelope)) return false;
    return sameTerminalOwner(gameId, optimistic, owner, envelope, outcome);
  };
  const verifyCleanupAbsence = async (job, saved) => {
    for (const envelope of saved) {
      if (!currentCleanupJob(job)) return false;
      if (!isSyncCommand(envelope) || envelope.identityId !== identityId || envelope.gameId !== job.gameId
        || (auth?.enabled ? envelope.authContextId !== job.owner.contextId : envelope.authContextId !== undefined)
        || envelope.fingerprint !== await commandFingerprint(envelope)) throw Object.assign(new Error("invalid_saved_command"), { code: "invalid_saved_command" });
      if (envelope.clientCommandId === job.envelope.clientCommandId) throw Object.assign(new Error("cleanup_unverified"), { code: "cleanup_unverified" });
      const tracked = job.optimistic.pendingCommands.some(command => canonicalCommandJson(command.envelope) === canonicalCommandJson(envelope));
      const known = job.optimistic.outcomes.get(envelope.clientCommandId);
      if (!tracked && !await validTerminalCleanup(job.gameId, job.optimistic, job.owner, envelope, known)) {
        throw Object.assign(new Error("untracked_saved_command"), { code: "untracked_saved_command" });
      }
    }
    return currentCleanupJob(job);
  };
  const startTerminalCleanup = (gameId, command, outcome) => {
    const optimistic = getOptimisticState(gameId), owner = journalRecoveryState(optimistic);
    const envelope = clone(command.envelope), receipt = clone(outcome), key = cleanupKey(envelope);
    if (owner.jobs.has(key)) return;
    // Register before the first removal: a manual repair may finish while that
    // original transaction is still pending, making its late failure obsolete.
    const job = { gameId, optimistic, owner, envelope, receipt, command, key, token: Symbol('terminal-cleanup'), retries: 0, retired: false, timer: null };
    owner.jobs.set(key, job);
    const attempt = async (initial = false) => {
      try {
        if (!currentCleanupJob(job)) return;
        // Initial envelopes were fingerprinted during admission/hydration. Keep
        // that existing immediate removal ordering; retries rehash the capture.
        const valid = initial ? sameTerminalOwner(gameId, optimistic, owner, envelope, receipt)
          && canonicalCommandJson(command.envelope) === canonicalCommandJson(envelope)
          : await validTerminalCleanup(gameId, optimistic, owner, envelope, receipt);
        if (!valid) throw Object.assign(new Error("invalid_cleanup_receipt"), { code: "invalid_cleanup_receipt" });
        if (!currentCleanupJob(job)) return;
        await commandJournal.remove(envelope);
        if (!currentCleanupJob(job)) return;
        // A successful first transaction is already a proven committed delete.
        // Only recovery from a failed cleanup needs a separate readback; normal
        // commits must not manufacture blockers from unrelated bulk hydration.
        if (initial) { retireCleanupJob(job); return; }
        const saved = await commandJournal.list(identityId, gameId);
        if (!await verifyCleanupAbsence(job, saved)) return;
        const hadReason = owner.reasons.has(job.token);
        retireCleanupJob(job, { verified: true });
        if (hadReason) {
          refreshStorageReasons(optimistic, owner);
          resolveRecoveryIfClear(gameId, optimistic);
          recalculateOptimisticGame(gameId);
          emitChange({ type: "journal_cleanup_recovered", gameId });
        }
      } catch (error) {
        if (!currentCleanupJob(job)) return;
        if (["invalid_saved_command", "untracked_saved_command"].includes(error.code)) {
          // Uncertain stored intent is a separate manual/hydration blocker.
          blockStorage(gameId, error);
          retireCleanupJob(job, { verified: true });
          refreshStorageReasons(optimistic, owner);
          return;
        }
        blockStorage(gameId, error, command, job);
        const delays = journalRetryDelays();
        if (error.code === "journal_timeout" && job.retries < delays.length) {
          const delay = delays[job.retries++];
          job.timer = setTimeout(() => { job.timer = null; job.promise = attempt(); }, delay);
          job.timer.unref?.();
        }
      }
    };
    job.promise = attempt(true);
  };
  const settleOutcome = (gameId, outcome, notifications = null) => {
    const optimistic = getOptimisticState(gameId);
    const command = optimistic.pendingCommands.find((entry) => entry.clientCommandId === outcome?.clientCommandId);
    if (!command || !isCommandOutcome(outcome, command.envelope) || outcome.outcome === "unknown") return false;
    if (optimistic.outcomes.get(command.clientCommandId)?.outcome === "accepted") return true;
    optimistic.outcomes.set(command.clientCommandId, outcome);
    const waiter=sharedWaiters.get(command.clientCommandId);
    if(waiter){sharedWaiters.delete(command.clientCommandId);if(outcome.outcome === "accepted")waiter.resolve();else waiter.reject(Object.assign(new Error(outcome.reason),{code:outcome.reason}));}
    optimistic.pendingCommands = optimistic.pendingCommands.filter((entry) => entry !== command);
    if (optimistic.attempt?.commandId === command.clientCommandId) {
      optimistic.attempt.controller.abort();
      optimistic.attempt = null;
      optimistic.inflightCommandId = null;
    }
    if (optimistic.budgetCommandId === command.clientCommandId || !optimistic.pendingCommands.length) clearRetryState(optimistic);
    optimistic.syncStatus = optimistic.pendingCommands.length ? optimistic.syncStatus : "ready";
    startTerminalCleanup(gameId, command, outcome);
    recalculateOptimisticGame(gameId);
    const notification = { type: outcome.outcome === "accepted" ? "authoritative_update" : command.kind === "shared" ? "shared_request_rejected" : "optimistic_rollback", gameId, clientCommandId: command.clientCommandId, reason:outcome.reason,
      failureNotice: outcome.outcome === "rejected" && command.kind !== "shared" ? outcome.reason === "state_capacity_exceeded" ? "This game couldn’t save another move. Your earlier moves are safe. Please view details." : "Board changed before your move was recorded. Check it and try again." : "" };
    if (notifications) notifications.push(notification); else emitChange(notification);
    return true;
  };
  const applyLiveGameUpdate = ({ game, eventSeq = null, commandOutcome = null, baseline = false, actionContractVersion }) => {
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
    if (actionContractVersion !== undefined) serverActionContract = actionContractVersion;
    const notifications = [];
    const receiptOwner = game && commandOutcome ? getOptimisticState(game.id).pendingCommands.find(command => command.clientCommandId === commandOutcome.clientCommandId)?.sharedRecoveryEpoch : undefined;
    if (commandOutcome && game) {
      const confirming = getOptimisticState(game.id).syncStatus === "confirming";
      if (settleOutcome(game.id, commandOutcome, notifications) && confirming) incrementSyncMetric("wsConfirmedAfterHttpFail", game.id);
    }
    const result = upsertGameSnapshot({ game, eventSeq, changeType: "authoritative_update", publish: false });
    if (game && notifications.length) {
      const optimistic = getOptimisticState(game.id);
      // A socket receipt may beat (and cancel) HTTP. Finish only the recovery
      // started by this shared write, never a newer connection/snapshot repair.
      if (receiptOwner !== undefined && receiptOwner === optimistic.connectionRecoveryEpoch && !optimistic.pendingCommands.length && !optimistic.forceSnapshot) setConnectionRecovering(game.id, false);
    }
    for (const notification of notifications) emitChange(notification);
    if (game) { emitChange({ type: "authoritative_update", gameId: game.id, baseline }); void sendNextPendingCommand(game.id); }
    return result;
  };

  const boundedRequest = async (url, init, controller = new AbortController()) => {
    let timer;
    const evidence = {}, started = Date.now();
    try {
      return await Promise.race([
        Promise.resolve().then(() => fetcher(url, { ...init, signal: controller.signal }, evidence)).then(mustOk),
        new Promise((_, reject) => { timer = setTimeout(() => {
          const diagnosticEvidence = { ...evidence, durationMs: Date.now() - started };
          controller.abort();
          reject(Object.assign(new Error("request_timeout"), { code: "request_timeout", diagnosticEvidence }));
        }, timing.requestTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };

  const scheduleRetry = (gameId, retryAttempt, reconcileFirst = true, retryAfterMs = 0) => {
    if (!active) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.upgradeRequired) return;
    if (optimistic.retryTimer) clearTimeout(optimistic.retryTimer);
    const delays = timing.retryDelaysMs;
    const delay = Math.min(5000, delays[Math.min(retryAttempt, delays.length - 1)] * (1 - timing.retryJitter + random() * timing.retryJitter * 2));
    optimistic.retryTimer = setTimeout(() => {
      optimistic.retryTimer = null;
      void sendNextPendingCommand(gameId, { retryAttempt: retryAttempt + 1, reconcileFirst });
    }, Math.max(delay, retryAfterMs));
    optimistic.retryTimer.unref?.();
  };
  const processResponse = (gameId, body, envelopes) => {
    if (body?.protocolVersion === 1) { markUpgradeRequired(gameId); throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" }); }
    if (!isReconcileResponse(body, gameId, envelopes) || (body.game !== undefined && (!validSyncSnapshot(body.game, gameId) || body.game.gameplayRevision !== body.gameplayRevision))) throw Object.assign(new Error("invalid_confirmation"), { code: "invalid_response" });
    const optimistic = getOptimisticState(gameId);
    const sharedRecoveryOwners = optimistic.pendingCommands.filter(command => command.kind === "shared" && body.commandOutcomes.some(outcome => outcome.clientCommandId === command.clientCommandId && outcome.outcome !== "unknown")).map(command => command.sharedRecoveryEpoch);
    const notifications = [];
    for (const outcome of body.commandOutcomes) settleOutcome(gameId, outcome, notifications);
    if (body.game) upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq, publish: false });
    for (const notification of notifications) emitChange(notification);
    if (body.commandOutcomes.some(outcome => outcome.reason === "upgrade_required")) {
      markUpgradeRequired(gameId);
      throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" });
    }
    if (!optimistic.pendingCommands.length && !optimistic.forceSnapshot && (!sharedRecoveryOwners.length || sharedRecoveryOwners.some(epoch => epoch !== undefined && epoch === optimistic.connectionRecoveryEpoch))) setConnectionRecovering(gameId, false);

    emitChange({ type: "authoritative_update", gameId });
    void sendNextPendingCommand(gameId);
    return body;
  };
  const reconcileRequest = async (gameId, controller, isCurrent = () => true) => {
    if (auth?.enabled && (!auth.session.authenticated || gameById.get(gameId)?.ownershipMode === "legacy_guest")) return null;
    if (!isCurrent()) return null;
    // Starting another request and consuming a valid in-flight receipt have
    // different permissions. Compatibility blocks only the former.
    if (getOptimisticState(gameId).upgradeRequired) return null;
    const recoveryEpoch = getOptimisticState(gameId).mutationRecoveryEpoch;
    const envelopes = getOptimisticState(gameId).pendingCommands.map((entry) => entry.envelope);
    const body = await boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}/reconcile`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: 2, identityId, knownSnapshotEventSeq: getOptimisticState(gameId).forceSnapshot ? 0 : lastEventSeqByGameId.get(gameId) ?? 0, commands: envelopes }),
    }, controller);
    if (!isCurrent()) return null;
    const result = processResponse(gameId, body, envelopes);
    if (getOptimisticState(gameId).forceSnapshot && !body.game) throw Object.assign(new Error("snapshot_required"), { code: "invalid_response" });
    if (body.game && recoveryEpoch === getOptimisticState(gameId).mutationRecoveryEpoch) {
      getOptimisticState(gameId).forceSnapshot = false;
      if (!getOptimisticState(gameId).pendingCommands.length) setConnectionRecovering(gameId, false);
    }
    return result;
  };

  const sendNextPendingCommand = async (gameId, { retryAttempt = 0, reconcileFirst = false } = {}) => {
    if (!active) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.upgradeRequired) return;
    if (optimistic.attempt || optimistic.retryTimer) return;
    if ((optimistic.retryNotBefore ?? 0) > Date.now()) {scheduleRetry(gameId,retryAttempt,reconcileFirst,optimistic.retryNotBefore-Date.now());return;}
    const command = optimistic.pendingCommands[0];
    if (!command) {
      optimistic.syncStatus = "ready";
      recalculateOptimisticGame(gameId);
      return;
    }
    if (command.kind === "shared" && gameById.has(gameId) && !gameById.get(gameId).sharedReceipts) { markUpgradeRequired(gameId); return; }
    if (shouldDeferCommandSend(gameId, command)) return;
    const attempt = { commandId: command.clientCommandId, controller: new AbortController() };
    attempt.done = new Promise((resolve) => { attempt.finish = resolve; });
    optimistic.attempt = attempt;
    optimistic.inflightCommandId = command.clientCommandId;
    optimistic.retryAttempt = retryAttempt;
    // An idempotent replay is still confirmation of an unknown command. Keep
    // shared changes locked until its receipt and queued descendants settle.
    optimistic.syncStatus = reconcileFirst || retryAttempt > 0 || optimistic.syncStatus === "confirming" ? "confirming" : "applying-update";
    if (!optimistic.budgetTimer) {
      optimistic.budgetCommandId = command.clientCommandId;
      optimistic.confirmDeadlineAt = (Date.parse(command.queuedAt) || Date.now()) + timing.confirmationBudgetMs;
      optimistic.budgetTimer = setTimeout(() => {
        if (!optimistic.pendingCommands.some((entry) => entry === command)) return;
        optimistic.confirmationOverdue = true;
        captureRecoveryIssue(gameId, "confirmation_overdue");
        recalculateOptimisticGame(gameId);
        emitChange({ type: "confirmation_budget_expired", gameId, clientCommandId: command.clientCommandId });
      }, Math.max(0, optimistic.confirmDeadlineAt - Date.now()));
      optimistic.budgetTimer.unref?.();
    }
    recalculateOptimisticGame(gameId);
    try {
      if (command.kind === "shared" && !gameById.has(gameId)) {
        // Initial HTTP fallback can hydrate the journal before a socket or page
        // has supplied a snapshot. Discover support without sending saved intent.
        const snapshot = await boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`, {
          method: "GET", cache: "no-store",
        }, attempt.controller);
        if (optimistic.attempt !== attempt || optimistic.upgradeRequired) return;
        if (snapshot.protocolVersion !== 2) { markUpgradeRequired(gameId); return; }
        if (!validSyncSnapshot(snapshot.game, gameId) || !isSyncRevision(snapshot.eventSeq)) throw Object.assign(new Error("invalid_snapshot"), { code: "invalid_response" });
        upsertGameSnapshot({ game: snapshot.game, eventSeq: snapshot.eventSeq, publish: false });
        if (!gameById.get(gameId)?.sharedReceipts) { markUpgradeRequired(gameId); return; }
      }
      if (reconcileFirst) {
        const response = await reconcileRequest(gameId, attempt.controller, () => optimistic.attempt === attempt);
        if (optimistic.attempt !== attempt || optimistic.upgradeRequired) return;
        const own = response.commandOutcomes.find((entry) => entry.clientCommandId === command.clientCommandId);
        const current = gameById.get(gameId);
        if (!own || own.outcome !== "unknown" || own.reason === "dependency_pending" || own.reason === "legacy_evidence") throw unresolvedCommandOutcome;
        if (command.kind !== "shared") {
          if (current?.gameplayRevision !== command.envelope.expectedGameplayRevision) throw unresolvedCommandOutcome;
          // Most saved envelopes match exactly. Older snapshots may need semantic
          // resolution, which must remain off the browser thread during recovery.
          if (serializeState(current.board.state) !== serializeState(command.envelope.expectedState)) {
            const epoch = rulesEpoch;
            assertRulesContext(epoch, gameId);
            const equivalent = await rulesExecutor.equivalent(`reconcile:${gameId}`, { left: current.board.state, right: command.envelope.expectedState });
            if (!active || optimistic.attempt !== attempt || optimistic.upgradeRequired) return;
            assertRulesContext(epoch, gameId);
            if (gameById.get(gameId) !== current || !equivalent) throw unresolvedCommandOutcome;
          }
        }
      }
      if (optimistic.upgradeRequired) return;
      const body = await boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}/${command.kind === "shared" ? "shared" : command.kind === "apply" ? "apply" : "end-turn"}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command.envelope),
      }, attempt.controller);
      if (optimistic.attempt !== attempt) return;
      processResponse(gameId, body, [command.envelope]);
      if (optimistic.pendingCommands.includes(command)) throw unresolvedCommandOutcome;
    } catch (error) {
      if (optimistic.attempt !== attempt) return;
      if(error.retryAfterMs)optimistic.retryNotBefore=Date.now()+error.retryAfterMs;
      const unresolved = error === unresolvedCommandOutcome;
      if (!unresolved) captureRecoveryIssue(gameId, "command_confirmation", error);
      if (!optimistic.recoveryStartedAt) { optimistic.recoveryStartedAt = Date.parse(command.queuedAt) || Date.now(); optimistic.recoveryEpisodeId = crypto.randomUUID(); }
      optimistic.recoveryIssue = unresolved ? null : error.code ?? (error.message === "invalid_confirmation" ? "invalid_response" : "unavailable");
      if (error.code === "upgrade_required") markUpgradeRequired(gameId);
      optimistic.syncStatus = "confirming";
      if (!unresolved) incrementSyncMetric("httpConfirmFailed", gameId);
      recalculateOptimisticGame(gameId);
      emitChange({ type: "optimistic_confirming", gameId, clientCommandId: command.clientCommandId });
      // A stalled receipt read must not permanently gate an idempotent submission.
      // Replay only the unchanged durable envelope. The server resolves an existing
      // receipt first, then enforces authority, dependencies and expected state.
      const replayAfterReadTimeout = reconcileFirst && error.code === "request_timeout" && error.diagnosticEvidence?.requestKind === "reconcile";
      if (!optimistic.upgradeRequired && error.code !== "session_changed" && error.code !== "invalid_credentials") scheduleRetry(gameId, retryAttempt, !replayAfterReadTimeout, error.retryAfterMs);
    } finally {
      attempt.finish();
      if (optimistic.attempt === attempt) { optimistic.attempt = null; optimistic.inflightCommandId = null; }
      if (!optimistic.pendingCommands.includes(command)) void sendNextPendingCommand(gameId);
    }
  };

  const internalCommand = (envelope) => ({ envelope, kind: envelope.kind === "shared" ? "shared" : envelope.kind === "action" ? "apply" : "end-turn", clientCommandId: envelope.clientCommandId, state: clone(envelope.expectedState), action: envelope.payload.action, notation: envelope.payload.notation, computer: envelope.payload.computer, queuedAt: Number.isFinite(envelope.submittedAt) ? new Date(envelope.submittedAt).toISOString() : new Date().toISOString() });
  const hydrateJournal = async (gameId, isCurrent = () => true) => {
    assertActive();
    if (auth?.enabled && (!auth.session.authenticated || gameById.get(gameId)?.ownershipMode !== "account_v1")) return;
    const optimistic = getOptimisticState(gameId);
    if (optimistic.hydrated) return;
    try {
      const saved = await commandJournal.list(identityId, gameId);
      if (!isCurrent()) return;
      assertActive();
      for (const envelope of saved) {
        if (!isSyncCommand(envelope) || envelope.fingerprint !== await commandFingerprint(envelope)) throw new Error("invalid_saved_command");
        if (!isCurrent()) return;
      }
      assertActive();
      for (const envelope of saved) {
        if (auth?.enabled && envelope.authContextId !== auth.session.contextId) continue;
        if (!isCurrent()) return;
        const outcome = optimistic.outcomes.get(envelope.clientCommandId);
        if (outcome) {
          const owner = journalRecoveryState(optimistic);
          const valid = await validTerminalCleanup(gameId, optimistic, owner, envelope, outcome);
          if (!isCurrent() || !currentJournalOwner(gameId, optimistic, owner)) return;
          if (!valid) throw Object.assign(new Error("invalid_cleanup_receipt"), { code: "invalid_cleanup_receipt" });
          await commandJournal.remove(envelope);
          if (!isCurrent() || !currentJournalOwner(gameId, optimistic, owner)) return;
          continue;
        }
        if (!optimistic.pendingCommands.some((entry) => entry.clientCommandId === envelope.clientCommandId)) optimistic.pendingCommands.push(internalCommand(envelope));
      }
      // Topological order; cycles/invalid chains are rejected by the server, never sent out of order.
      const ordered = [], remaining = [...optimistic.pendingCommands];
      while (remaining.length) {
        const next = remaining.findIndex((entry) => !entry.envelope.predecessor || !remaining.some((parent) => parent.clientCommandId === entry.envelope.predecessor.clientCommandId));
        if (next < 0) throw new Error("invalid_dependency_chain");
        ordered.push(...remaining.splice(next, 1));
      }
      if (!isCurrent()) return;
      optimistic.pendingCommands = ordered;
      optimistic.hydrated = true;
      if (saved.length) { optimistic.syncStatus = "confirming"; recalculateOptimisticGame(gameId); emitChange({ type: "journal_restored", gameId, clientCommandIds: ordered.map((entry) => entry.clientCommandId) }); void sendNextPendingCommand(gameId, { reconcileFirst: true }); }
    } catch (error) { if (isCurrent() && active) blockStorage(gameId, error); throw error; }
  };

  const enqueueOptimisticCommand = async ({ gameId, command }) => {
    const contextEpoch = rulesEpoch;
    const optimistic = getOptimisticState(gameId);
    const admission = optimistic.admission.catch(() => {}).then(async () => {
      assertActive();
      assertRulesContext(contextEpoch, gameId);
      if (auth?.enabled && (!auth.session.authenticated)) throw Object.assign(new Error("invalid_credentials"), { code: "invalid_credentials" });
      const current = getGameViewModel(gameId);
      if (current?.sharedMutationsBlocked) throw Object.assign(new Error("sync_recovering"), { code: "sync_recovering" });
      const isClosure = command.kind === "end-turn" || command.action?.type === "end_turn";
      if (isClosure && serverActionContract !== ACTION_CONTRACT_VERSION) {
        markUpgradeRequired(gameId);
        throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" });
      }
      const predecessor = optimistic.pendingCommands.at(-1)?.envelope;
      const envelope = { protocolVersion: 2, actionContractVersion: ACTION_CONTRACT_VERSION, gameId, identityId, clientCommandId: command.clientCommandId, submittedAt: Date.parse(command.queuedAt) || Date.now(),
        ...(auth?.enabled ? { authContextId: auth.session.contextId } : {}),
        kind: command.kind === "apply" ? "action" : "end_turn", payload: command.kind === "apply" ? { action: command.action, notation: command.notation, ...(command.computer ? { computer: command.computer } : {}) } : {},
        expectedState: clone(command.state ?? current.board.state), expectedGameplayRevision: predecessor ? predecessor.expectedGameplayRevision + 1 : (gameById.get(gameId)?.gameplayRevision ?? 0),
        ...(command.kind === "end-turn" ? { expectedTurnIndex: current.board.state.turnIndex } : {}),
        ...(predecessor ? { predecessor: { clientCommandId: predecessor.clientCommandId, fingerprint: predecessor.fingerprint } } : {}),
      };
      envelope.fingerprint = await commandFingerprint(envelope);
      assertActive();
      assertRulesContext(contextEpoch, gameId);
      command.envelope = envelope;
      const base = gameById.get(gameId);
      const pendingIds = optimistic.pendingCommands.map(entry => entry.clientCommandId).join("|");
      rulesExecutor.cancel(`project:${gameId}`);
      optimistic.projectionJob = null;
      optimistic.admissionProjection = true;
      try {
        let projection = await rulesExecutor.project(`admit:${gameId}`, { authoritativeGame: base, identityId, queue: [...optimistic.pendingCommands.filter(entry => entry.kind !== "shared"), command] });
        assertActive();
        assertRulesContext(contextEpoch, gameId);
        const latest = gameById.get(gameId);
        if (!sameProjectionAuthority(base, latest) || optimistic.pendingCommands.map(entry => entry.clientCommandId).join("|") !== pendingIds) {
          throw Object.assign(new Error("stale_state"), { code: "stale_state" });
        }
        if (!projection.ok) return projection;
        if (latest !== base) projection = rebaseProjectedMetadata(projection, latest);
        try { await commandJournal.admit(envelope); }
        catch (error) { optimistic.unsavedCommand = command; blockStorage(gameId, error); throw error; }
        assertActive();
        optimistic.pendingCommands.push(command);
        optimistic.syncStatus = "applying-update";
        optimistic.admissionProjection = false;
        if (gameById.get(gameId) === latest) {
          optimistic.projectionJob = { base: latest, signature: optimistic.pendingCommands.filter(entry => entry.kind !== "shared").map(entry => entry.clientCommandId).join("|"), result: projection, pending: false };
          installProjection(gameId, projection);
        } else recalculateOptimisticGame(gameId);
        emitChange({ type: "optimistic_enqueue", gameId, clientCommandId: command.clientCommandId });
        // An admitted command belongs to durable recovery, including after navigation.
        void sendNextPendingCommand(gameId);
        return { ok: true, result: projection.commandResults.get(command.clientCommandId), game: optimistic.derivedGame };
      } finally { optimistic.admissionProjection = false; }
    });
    optimistic.admission = admission;
    return admission;
  };

  const setConnectionRecovering = (gameId, recovering, evidence = {}) => {
    const optimistic = getOptimisticState(gameId);
    if (recovering && !optimistic.recoveryStartedAt) {
      optimistic.recoveryStartedAt = Date.now();
      optimistic.recoveryEpisodeId = crypto.randomUUID();
    }
    optimistic.connectionEvidence = { ...optimistic.connectionEvidence, ...evidence };
    if (recovering) optimistic.connectionRecoveryEpoch = (optimistic.connectionRecoveryEpoch ?? 0) + 1;
    optimistic.connectionRecovering = recovering || optimistic.forceSnapshot === true;
    if (!optimistic.connectionRecovering && !optimistic.pendingCommands.length) {
      optimistic.syncStatus = "ready";
      optimistic.recoveryStartedAt = null; optimistic.recoveryIssue = null;
      clearTimeout(optimistic.recoveryRetryTimer); optimistic.recoveryRetryTimer = null; optimistic.recoveryRetryAttempt = 0;
      resolveRecoveryIfClear(gameId, optimistic);
    }
    recalculateOptimisticGame(gameId);
    emitChange({ type: "connection_recovery_changed", gameId, recovering });
  };
  const reconcileGame = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.upgradeRequired) return Promise.reject(Object.assign(new Error("upgrade_required"), { code: "upgrade_required" }));
    if (optimistic.recoveryPromise) return optimistic.recoveryPromise;
    const owner = {}; optimistic.recoveryOwner = owner;
    optimistic.recoveryGeneration = (optimistic.recoveryGeneration ?? 0) + 1;
    clearTimeout(optimistic.recoveryRetryTimer); optimistic.recoveryRetryTimer = null;
    const current = () => active && optimistic.recoveryOwner === owner;
    let timer;
    const work = Promise.resolve().then(async () => {
      if((optimistic.retryNotBefore??0)>Date.now())throw Object.assign(new Error("retry_delayed"),{code:"retry_delayed",retryAfterMs:optimistic.retryNotBefore-Date.now()});
      await hydrateJournal(gameId, current);
      if (!current() || optimistic.upgradeRequired) return;
      if (optimistic.attempt) await optimistic.attempt.done;
      if (!current() || optimistic.upgradeRequired) return;
      if (optimistic.retryTimer) { clearTimeout(optimistic.retryTimer); optimistic.retryTimer = null; }
      if (optimistic.pendingCommands.length) await sendNextPendingCommand(gameId, { reconcileFirst: true });
      else {
        const attempt = { commandId: null, controller: new AbortController() };
        attempt.done = new Promise(resolve => { attempt.finish = resolve; });
        optimistic.attempt = attempt;
        let reconciled = false;
        try { reconciled = Boolean(await reconcileRequest(gameId, attempt.controller, () => current() && optimistic.attempt === attempt)); }
        finally {
          const owned = optimistic.attempt === attempt;
          if (owned) optimistic.attempt = null;
          attempt.finish();
          // Admission may commit while this read occupies the send slot. Its
          // first send and processResponse's send both defer to that slot.
          // Wake only after a validated, still-current read releases it.
          if (owned && reconciled && current()) void sendNextPendingCommand(gameId);
        }
      }
      if (optimistic.upgradeRequired) return;
      if (current() && optimistic.forceSnapshot) throw Object.assign(new Error("snapshot_required"), { code: "invalid_response" });
      if (current() && !optimistic.pendingCommands.length) setConnectionRecovering(gameId, false);
    });
    const promise = Promise.race([work, new Promise((_, reject) => {
      owner.reject = reject;
      timer = setTimeout(() => {
        if (!current()) return;
        optimistic.recoveryOwner = null;
        if (optimistic.attempt) { optimistic.attempt.controller.abort(); optimistic.attempt.finish(); optimistic.attempt = null; optimistic.inflightCommandId = null; }
        reject(Object.assign(new Error("recovery_timeout"), { code: "recovery_timeout" }));
      }, timing.recoveryPassMs ?? SYNC_TIMING.recoveryPassMs);
    })]).catch(error => {
      if (!active || owner.superseded) throw error;
      if(error.retryAfterMs)optimistic.retryNotBefore=Date.now()+error.retryAfterMs;
      if (optimistic.pendingCommands.length && !optimistic.retryTimer && !optimistic.upgradeRequired) scheduleRetry(gameId,optimistic.retryAttempt??0,true,error.retryAfterMs);
      if (!optimistic.pendingCommands.length && !optimistic.upgradeRequired && error.code !== "session_changed" && error.code !== "invalid_credentials") {
        const retry = optimistic.recoveryRetryAttempt ?? 0;
        optimistic.recoveryRetryAttempt = retry + 1;
        const delay = timing.retryDelaysMs[Math.min(retry, timing.retryDelaysMs.length - 1)] * (1 - timing.retryJitter + random() * timing.retryJitter * 2);
        optimistic.recoveryRetryTimer = setTimeout(() => { optimistic.recoveryRetryTimer = null; void reconcileGame(gameId).catch(() => {}); }, Math.max(error.retryAfterMs ?? 0, Math.min(5000, delay)));
        optimistic.recoveryRetryTimer.unref?.();
      }
      captureRecoveryIssue(gameId, "reconciliation", error);
      optimistic.recoveryIssue = error.code ?? "unavailable";
      recalculateOptimisticGame(gameId); emitChange({ type: "recovery_failed", gameId, error });
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      if (optimistic.recoveryPromise === promise) optimistic.recoveryPromise = null;
      if (optimistic.recoveryOwner === owner) optimistic.recoveryOwner = null;
    });
    optimistic.recoveryPromise = promise; return promise;
  };
  const retrySavingOnce = async (gameId, optimistic, owner, mayRecover) => {
    const reasons = [...owner.reasons.keys()], jobs = [...owner.jobs.values()];
    const current = () => currentJournalOwner(gameId, optimistic, owner) && mayRecover();
    const assertCurrent = () => { if (!current()) throw Object.assign(new Error("session_changed"), { code: "session_changed" }); };
    try {
      assertCurrent();
      // Admission failures must not block recovery of already durable commands.
      // Reconcile other games too: their receipts may release the identity-wide cap.
      const outstanding = await commandJournal.list(identityId);
      assertCurrent();
      for (const envelope of outstanding) {
        if (!isSyncCommand(envelope) || envelope.identityId !== owner.identityId
          || (owner.authEnabled ? envelope.authContextId !== owner.contextId : envelope.authContextId !== undefined)
          || envelope.fingerprint !== await commandFingerprint(envelope)) throw new Error('invalid_saved_command');
        assertCurrent();
      }
      await Promise.allSettled([...new Set(outstanding.map((entry) => entry.gameId))].map(async pendingGameId => {
        assertCurrent(); await reconcileGame(pendingGameId); assertCurrent();
      }));
      assertCurrent();
      // Retry cleanup by exact receipt identity, retaining unresolved records.
      const saved = await commandJournal.list(identityId, gameId);
      assertCurrent();
      for (const envelope of saved) {
        if (!isSyncCommand(envelope) || envelope.identityId !== identityId || envelope.gameId !== gameId
          || (auth?.enabled ? envelope.authContextId !== owner.contextId : envelope.authContextId !== undefined)
          || envelope.fingerprint !== await commandFingerprint(envelope)) throw new Error("invalid_saved_command");
        assertCurrent();
      }
      for (const envelope of saved) {
        assertCurrent();
        const outcome = optimistic.outcomes.get(envelope.clientCommandId);
        if (!outcome) continue;
        if (!await validTerminalCleanup(gameId, optimistic, owner, envelope, outcome)) throw new Error("invalid_cleanup_receipt");
        assertCurrent();
        await commandJournal.remove(envelope);
        assertCurrent();
      }
      // A previous removal may have committed but still be waiting on its
      // callback/readback. Prove each captured job's exact key absent, then
      // retire only that job object so late failures cannot recreate its fence.
      const remaining = await commandJournal.list(identityId, gameId);
      assertCurrent();
      for (const job of jobs) {
        assertCurrent();
        if (owner.jobs.get(job.key) !== job) continue;
        if (!await validTerminalCleanup(gameId, optimistic, owner, job.envelope, job.receipt)
          || remaining.some(envelope => envelope.identityId === job.envelope.identityId && envelope.gameId === job.gameId && envelope.clientCommandId === job.envelope.clientCommandId)) throw new Error("cleanup_unverified");
        assertCurrent();
        retireCleanupJob(job, { verified: true });
      }
      if (optimistic.unsavedCommand) {
        assertCurrent();
        const command = optimistic.unsavedCommand;
        const outcome = optimistic.outcomes.get(command.clientCommandId);
        if (!outcome) {
          await commandJournal.admit(command.envelope);
          assertCurrent();
          if (!optimistic.pendingCommands.some(entry => entry.clientCommandId === command.clientCommandId)) optimistic.pendingCommands.push(command);
          optimistic.syncStatus = "confirming";
        } else if (!await validTerminalCleanup(gameId, optimistic, owner, command.envelope, outcome)) throw new Error("invalid_cleanup_receipt");
        assertCurrent();
        if (optimistic.unsavedCommand === command) optimistic.unsavedCommand = null;
      }
      optimistic.hydrated = false;
      await hydrateJournal(gameId, current);
      assertCurrent();
      for (const token of reasons) {
        const reason = owner.reasons.get(token);
        if (!reason?.job || reason.job.retired) owner.reasons.delete(token);
      }
      refreshStorageReasons(optimistic, owner);
      resolveRecoveryIfClear(gameId, optimistic);
      recalculateOptimisticGame(gameId);
      if (reasons.length && !optimistic.storageBlocked) emitChange({ type: 'journal_recovered', gameId });
      assertCurrent();
      const result = await reconcileGame(gameId);
      assertCurrent(); return result;
    } catch (error) { if (current()) blockStorage(gameId, error); throw error; }
  };
  const retrySaving = (gameId, mayRecover = () => true) => {
    const optimistic = getOptimisticState(gameId), owner = journalRecoveryState(optimistic);
    if (owner.repairPromise) return owner.repairPromise;
    const work = Promise.resolve().then(() => retrySavingOnce(gameId, optimistic, owner, mayRecover));
    owner.repairPromise = work;
    const settled = () => {
      if (owner.repairPromise !== work) return;
      owner.repairPromise = null;
      if (!optimistic.storageBlocked) retireJournalRecovery(owner);
    };
    void work.then(settled, settled);
    return work;
  };

  const loadGamesPage = async ({ section, page = 0, pageSize = 6, debug = false } = {}) => {
    const startedRevision = homeListRevision;
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
    assertActive();
    let homeListChanged = startedRevision !== homeListRevision;
    const gamesPage = Array.isArray(body.games) ? body.games.map((game) => normalizeStaticGameCard(game)) : [];
    for (const game of gamesPage) {
      const current = homeGameCardById.get(game.id);
      const hasCurrentAuthority = Number.isSafeInteger(current?.eventSeq);
      const stale = hasCurrentAuthority && (!Number.isSafeInteger(game.eventSeq) || game.eventSeq < current.eventSeq ||
        (game.eventSeq === current.eventSeq && (game.gameplayRevision ?? -1) < (current.gameplayRevision ?? -1)));
      if (stale) {
        if (homeMembershipSignature(current) !== homeMembershipSignature(game)) homeListChanged = true;
      } else {
        if (homeMembershipSignature(current) !== homeMembershipSignature(game)) homeListRevision++;
        homeGameCardById.set(game.id, game);
      }
    }
    const installedRevision = homeListRevision;
    // Home reloads must resume durable commands even when their game is not opened.
    // Hydration starts bounded reconciliation; listing a page never waits on the network recovery.
    try {
      const saved = await commandJournal.list(identityId);
      await Promise.all([...new Set(saved.map(command => command.gameId))].map(gameId => hydrateJournal(gameId).catch(() => {})));
    } catch (error) {
      for (const game of gamesPage) blockStorage(game.id, error);
    }
    assertActive();
    return {
      ...body,
      homeListRevision,
      homeListChanged: homeListChanged || installedRevision !== homeListRevision,
      games: gamesPage.map(game => getHomeGameCard(game.id)),
    };
  };

  const markUpgradeRequired = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (optimistic.upgradeRequired) return;
    optimistic.upgradeRequired = true;
    clearTimeout(optimistic.retryTimer); optimistic.retryTimer = null;
    clearTimeout(optimistic.recoveryRetryTimer); optimistic.recoveryRetryTimer = null;
    recalculateOptimisticGame(gameId);
    emitChange({ type: "upgrade_required", gameId });
  };
  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
    if (getOptimisticState(gameId).upgradeRequired) throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" });
    // A fresh route already opened its socket. Its bounded initial snapshot owns recovery;
    // only fall back to HTTP after that generation has been retired by the connection owner.
    if (!openAsViewer && !lastEventSeqByGameId.get(gameId)) {
      const socketOwned = await Promise.resolve(beforeReconcile(gameId, { initialLoad: true })).catch(() => false);
      if (socketOwned?.upgradeRequired === true || getOptimisticState(gameId).upgradeRequired) {
        markUpgradeRequired(gameId);
        throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" });
      }
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
          // Retain bounded protocol discovery until terminal-protocol recovery
          // supplies its replacement. A read never decides a command outcome.
          if (error.status !== 404 && error.status !== 405) throw error;
        }
      }
    }
    // A current socket can discover incompatibility while legacy discovery is awaiting reconciliation.
    if (getOptimisticState(gameId).upgradeRequired) throw Object.assign(new Error("upgrade_required"), { code: "upgrade_required" });
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

  const decisionRequest = async (gameId, endpoint, values = {}) => {
    const requester=endpoint === "computer-control" ? boundedSharedRequest.bind(null,gameId) : boundedRequest;
    const body = await requester(`/api/shell/games/${encodeURIComponent(gameId)}/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identityId, ...values }),
    });
    if (body.game) upsertGameSnapshot({ game: body.game, eventSeq: body.eventSeq });
    return body;
  };

  const createGame = async ({ selfPlayMode = false, gameId = null, creatorSide = "p1", computer, computerModelId = CURRENT_COMPUTER_MODEL.id } = {}) => {
    const response = await fetcher("/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, selfPlayMode, gameId, creatorSide, computer, ...(computer ? {computerModelId} : {}) }),
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
    sourceDecisionId = null,
    sourceGameplayRevision = null,
    creatorSide = "p1",
    computer,
    computerModelId = CURRENT_COMPUTER_MODEL.id,
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
        sourceDecisionId, sourceGameplayRevision, creatorSide, computer, ...(computer ? {computerModelId} : {}),
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

  const applyGameAction = async ({ gameId, state, action, notation, computer }) => {
    const command = {
      kind: "apply",
      clientCommandId: createClientCommandId({ gameId, identityId, random }),
      action: clone(action),
      ...(computer ? { computer: clone(computer) } : {}),
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

  const historyKey = (gameId, revision, moveId) => `${gameId}:${revision}:${moveId}`;
  const loadHistoricalMove = (gameId, revision, moveId) => {
    const key = historyKey(gameId, revision, moveId);
    if (historyCache.has(key)) return Promise.resolve(clone(historyCache.get(key)));
    if (historyRequests.has(key)) return historyRequests.get(key);
    const request = boundedRequest(`/api/shell/games/${encodeURIComponent(gameId)}/decision-snapshot`, {
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identityId,decisionId:moveId,gameplayRevision:revision}),
    }).then(body => {
      const move = body.move;
      if (body.gameId !== gameId || body.gameplayRevision !== revision || move?.moveId !== moveId || !move.snapshot || !Array.isArray(move.snapshot.pieces) || !["P1","P2"].includes(move.snapshot.sideToMove)) throw new Error("invalid_history_snapshot");
      historyCache.set(key,clone(move));
      while(historyCache.size > SYNC_LIMITS.historyCacheEntries) historyCache.delete(historyCache.keys().next().value);
      return move;
    }).finally(() => historyRequests.delete(key));
    historyRequests.set(key,request);return request;
  };
  const applyHistorySelection = (gameId, game, moves, selected) => {
    historyIntentByGameId.set(gameId, { moveId: historyMoveKey(selected), clientCommandId: selected.clientCommandId, order: moves.map(historyMoveKey), position: moves.findIndex(move => historyMoveKey(move) === historyMoveKey(selected)), frozen: clone(selected), contextMoves: (game.historyTurnMoves ?? game.historyContextMoves)?.some(move=>move.moveId===selected.moveId) ? game.historyTurnMoves ?? game.historyContextMoves : null, revision: game.gameplayRevision });
    historyLoads.delete(gameId);
    recalculateOptimisticGame(gameId);
    emitChange({ type:"history_mode_changed",gameId });
  };
  const selectHistoryMove = ({ gameId, moveIndex, moveId = null }) => {
    const game = getGameViewModel(gameId);
    const moves = [...(game?.moves ?? []), ...(game?.pendingMoves ?? [])];
    const frozen = moveId ? (game.historyTurnMoves ?? game.historyContextMoves)?.find(move=>move.moveId===moveId) : null;
    const summary = frozen ?? moves.find(move => moveId ? move.moveId === moveId : move.index === moveIndex);
    if (!summary) throw new Error("move_not_found");
    const selected = summary.snapshot ? summary : historyCache.get(historyKey(gameId,game.gameplayRevision,summary.moveId));
    if (selected) applyHistorySelection(gameId,frozen ? {...game,gameplayRevision:game.inspectedAtRevision} : game,moves,selected);
    else {
      const owner = {loading:true,index:moveIndex,error:null};historyLoads.set(gameId,owner);
      recalculateOptimisticGame(gameId);emitChange({type:"history_loading",gameId});
      void loadHistoricalMove(gameId,game.gameplayRevision,summary.moveId).then(move => {
        if (!active || historyLoads.get(gameId) !== owner) return;
        const current = getGameViewModel(gameId);
        if (current.gameplayRevision !== game.gameplayRevision) throw new Error("history_changed");
        applyHistorySelection(gameId,current,[...current.moves,...(current.pendingMoves??[])],move);
        // Prefetch only adjacent snapshots, with the same immutable revision key.
        for(const adjacent of moves.filter(move=>Math.abs(move.index-moveIndex)===1 && !move.snapshot)) void loadHistoricalMove(gameId,game.gameplayRevision,adjacent.moveId).catch(()=>{});
      }).catch(error => {
        if (!active || historyLoads.get(gameId) !== owner) return;
        owner.loading=false;owner.error=error.code??error.message;
        recalculateOptimisticGame(gameId);emitChange({type:"history_load_failed",gameId});
      });
    }
    return getGameViewModel(gameId);
  };

  const selectHistoryTurn = async ({gameId, turnIndex}) => {
    const game = getGameViewModel(gameId);
    const revision = game.gameplayRevision;
    // Explicit turn selection reads current acknowledged records, not a move's
    // previously frozen inspection snapshot.
    let summaries = (gameById.get(gameId)?.moves ?? game.moves ?? []).filter(move => move.turnIndex === turnIndex && !move.undone);
    const owner = {loading:true,index:summaries[0]?.index ?? 0,error:null,turnIndex};
    historyLoads.set(gameId,owner);
    recalculateOptimisticGame(gameId); emitChange({type:'history_loading',gameId});
    let archived = false;
    try {
      if (!summaries.length || summaries[0].turnMoveIndex > 0) {
        archived = true;
        let entries = [], cursor = null;
        do {
          const page = await decisionRequest(gameId,'decision-history',{cursor});
          if (!active || historyLoads.get(gameId) !== owner) return;
          entries.push(...page.items); cursor = page.nextCursor;
        } while(cursor);
        summaries = activeDecisionLineage(entries).filter(move=>move.turnIndex===turnIndex);
      }
      if (!summaries.length) throw new Error('turn_not_found');
      const moves = await Promise.all(summaries.map(move => !archived && move.snapshot ? clone(move) : loadHistoricalMove(gameId,revision,move.moveId)));
      if (!active || historyLoads.get(gameId) !== owner) return;
      if (getGameViewModel(gameId).gameplayRevision !== revision) throw new Error('history_changed');
      historyIntentByGameId.set(gameId,{turn:{index:turnIndex,moves},revision});
      historyLoads.delete(gameId); recalculateOptimisticGame(gameId); emitChange({type:'history_mode_changed',gameId});
    } catch(error) {
      if (!active || historyLoads.get(gameId) !== owner) return;
      owner.loading=false;owner.error=error.message;
      recalculateOptimisticGame(gameId); emitChange({type:'history_load_failed',gameId});
    }
    return getGameViewModel(gameId);
  };

  const returnToLive = ({ gameId }) => {
    historyLoads.delete(gameId);
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
    } catch { /* reconcileGame owns the next attempt, including uncertain shared writes. */
    } finally { optimistic.mutationRecovery = false; }
  };

  const journalSharedRequest = async (gameId, url, init) => {
    const optimistic=getOptimisticState(gameId);
    const admitted=optimistic.admission.catch(()=>{}).then(async()=>{
      assertSharedMutationAllowed(gameId);
      if(optimistic.pendingCommands.length)throw Object.assign(new Error("sync_recovering"),{code:"sync_recovering"});
      const current=gameById.get(gameId);
      const envelope={protocolVersion:2,gameId,identityId,clientCommandId:createClientCommandId({gameId,identityId,random}),submittedAt:Date.now(),kind:"shared",
        ...(auth?.enabled?{authContextId:auth.session.contextId}:{}),payload:{operation:url.split("/").at(-1),values:JSON.parse(init.body)},expectedState:clone(current.board.state),expectedGameplayRevision:current.gameplayRevision};
      envelope.fingerprint=await commandFingerprint(envelope);
      try{await commandJournal.admit(envelope);}catch(error){
        // Readable storage cannot prove a missing user stop/switch intent was
        // fulfilled. Only maintenance lease acquisition/renewal may self-recover.
        const automaticRecoveryAllowed=envelope.payload.operation==='computer-control'&&['acquire','renew'].includes(envelope.payload.values?.action);
        blockStorage(gameId,error,null,null,automaticRecoveryAllowed);throw error;
      }
      assertActive();
      const completion=new Promise((resolve,reject)=>sharedWaiters.set(envelope.clientCommandId,{resolve,reject}));
      const pending = internalCommand(envelope);
      optimistic.pendingCommands.push(pending);
      setConnectionRecovering(gameId,true);
      pending.sharedRecoveryEpoch = optimistic.connectionRecoveryEpoch;
      void sendNextPendingCommand(gameId);
      return {completion};
    });
    optimistic.admission=admitted;
    const {completion}=await admitted;await completion;
    return {ok:true,game:clone(gameById.get(gameId)),eventSeq:lastEventSeqByGameId.get(gameId)};
  };
  const boundedSharedRequest = async (gameId, url, init) => {
    if(gameById.get(gameId)?.sharedReceipts && SHARED_OPERATIONS.includes(url.split("/").at(-1)))return journalSharedRequest(gameId,url,init);

    try {
      const body = await boundedRequest(url, init);
      if (!validSyncSnapshot(body.game, gameId) || !isSyncRevision(body.eventSeq)) throw Object.assign(new Error("invalid_confirmation"), { code: "invalid_response" });
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
    if (optimistic.pendingCommands.length) {
      next.syncStatus = optimistic.syncStatus;
      next.pendingPreviewSnapshot = clone(optimistic.derivedGame?.liveCurrentSnapshot ?? optimistic.derivedGame?.board?.state ?? null);
    }
    if (optimistic.storageBlocked || optimistic.connectionRecovering) next.syncStatus = "confirming";
    return next;
  };

  const getGameViewModel = (gameId) => {
    const optimistic = getOptimisticState(gameId);
    if (!optimistic.derivedGame) {
      recalculateOptimisticGame(gameId);
    }
    if (!optimistic.derivedGame) {
      return null;
    }
    // Browser suspension can advance deadlines before scheduled callbacks run.
    // Refresh time-dependent safety flags even when the board projection is cached.
    const game = decorateGameWithSync(optimistic.derivedGame, gameId);
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

  const setRulesActiveGame = (gameId, visible = rulesVisible) => {
    if (rulesGameId === gameId && rulesVisible === visible) return;
    rulesGameId = gameId; rulesVisible = visible; rulesEpoch++;
    rulesExecutor.cancelAll();
    for (const optimistic of optimisticStateByGameId.values()) optimistic.projectionJob = null;
    if (gameId) recalculateOptimisticGame(gameId);
  };
  const onRulesVisibility = () => setRulesActiveGame(rulesGameId, !document.hidden);
  const onRulesPageHide = () => setRulesActiveGame(rulesGameId, false);
  const onRulesPageShow = () => setRulesActiveGame(rulesGameId, !globalThis.document?.hidden);
  globalThis.document?.addEventListener?.("visibilitychange", onRulesVisibility);
  globalThis.window?.addEventListener?.("pagehide", onRulesPageHide);
  globalThis.window?.addEventListener?.("pageshow", onRulesPageShow);

  return {
    setRulesActiveGame,
    loadGamesPage,
    loadGame,
    resolveInvite,
    createGame,
    computerControl: (gameId, values) => decisionRequest(gameId, 'computer-control', values),
    decisionHistory: (gameId, cursor) => decisionRequest(gameId, 'decision-history', { cursor }),
    additionalHistory: (gameId, values) => decisionRequest(gameId, 'decision-history', { ...values, mode:'additional' }),
    decisionNotes: (gameId, values) => decisionRequest(gameId, 'decision-notes', values),
    decisionAttempt: (gameId, values) => decisionRequest(gameId, 'decision-attempt', values),
    decisionAttempts: (gameId, kind, cursor) => decisionRequest(gameId, 'decision-attempts', { kind, cursor }),
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
    prepareSafeReconnect(gameId) {
      const optimistic = getOptimisticState(gameId);
      optimistic.forceSnapshot = true;
      optimistic.mutationRecoveryEpoch = (optimistic.mutationRecoveryEpoch ?? 0) + 1;
      if (optimistic.recoveryOwner) {
        optimistic.recoveryOwner.superseded = true;
        optimistic.recoveryOwner.reject?.(Object.assign(new Error("recovery_superseded"), { code: "recovery_superseded" }));
        optimistic.recoveryOwner = null; optimistic.recoveryPromise = null;
      }
      clearTimeout(optimistic.recoveryRetryTimer); optimistic.recoveryRetryTimer = null;
      clearTimeout(optimistic.retryTimer); optimistic.retryTimer = null;
      if (optimistic.attempt) {
        optimistic.attempt.controller.abort(); optimistic.attempt.finish(); optimistic.attempt = null; optimistic.inflightCommandId = null;
      }
      setConnectionRecovering(gameId, true);
    },
    retrySaving,
    getCommandOutcome: (gameId, commandId) => getOptimisticState(gameId).outcomes.get(commandId) ?? null,
    applyGameAction,
    endTurn,
    inspectDecision: ({ gameId, entry }) => {
      const game = getGameViewModel(gameId);
      const frozen = clone(entry.move ?? { moveId: entry.id, snapshot: entry.state, selectionSnapshot: entry.state });
      historyIntentByGameId.set(gameId, { moveId: frozen.moveId, frozen, revision: game.gameplayRevision });
      recalculateOptimisticGame(gameId); emitChange({ type: 'history_mode_changed', gameId });
      return getGameViewModel(gameId);
    },
    selectHistoryMove,
    selectHistoryTurn,
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
    getHomeListRevision: () => homeListRevision,
    getGameViewModel,
    isUpgradeRequired: (gameId) => getOptimisticState(gameId).upgradeRequired === true,
    markUpgradeRequired,
    getAuthoritativeGame: (gameId) => clone(gameById.get(gameId) ?? null),
    applyGamePreview: (gameId,game) => {getOptimisticState(gameId).externalPreview=game?clone(game):null;recalculateOptimisticGame(gameId);emitChange({type:"local_preview",gameId});},
    getIdentityId,
    subscribe,
    unsubscribe,
    retire() {
      active = false;
      rulesExecutor.cancelAll();
      globalThis.document?.removeEventListener?.("visibilitychange", onRulesVisibility);
      globalThis.window?.removeEventListener?.("pagehide", onRulesPageHide);
      globalThis.window?.removeEventListener?.("pageshow", onRulesPageShow);
      historyLoads.clear();historyCache.clear();
      for(const waiter of sharedWaiters.values())waiter.reject(Object.assign(new Error("session_changed"),{code:"session_changed"}));
      sharedWaiters.clear();
      listeners.clear();
      for (const optimistic of optimisticStateByGameId.values()) {
        const journalOwner = journalRecoveryByOwner.get(optimistic);
        if (journalOwner) {
          retireJournalRecovery(journalOwner);
          for (const job of [...journalOwner.jobs.values()]) retireCleanupJob(job);
        }
        clearTimeout(optimistic.retryTimer); clearTimeout(optimistic.recoveryRetryTimer); clearTimeout(optimistic.mutationRecoveryTimer); clearTimeout(optimistic.budgetTimer);
        optimistic.recoveryOwner?.reject?.(Object.assign(new Error("session_changed"), { code: "session_changed" }));
        optimistic.recoveryOwner = null;
        optimistic.attempt?.finish?.();
        optimistic.attempt?.controller?.abort();
        optimistic.attempt = null;
        optimistic.pendingCommands = [];
        optimistic.unsavedCommand = null;
      }
      void Promise.resolve(commandJournal.close?.()).catch(() => {});
    },
  };
};
