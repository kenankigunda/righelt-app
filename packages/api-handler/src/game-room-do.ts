import { canonicalCommandJson } from '../../shared-types/src/sync-protocol';
import { archiveStatements, readDecision, readDecisionPage, readDecisionNotes, noteStatement, readAttempt, readAttemptPage, attemptStatement } from './decision-archive';
import { StorageWriteLimitError } from './storage-codec';
import { COMPUTER_LIMITS, changeComputerControl, computerCommandError, createComputerControl, parseComputerSeats, type ComputerProof } from '../../shared-types/src/computer-play';
import { STORAGE_POLICY, STORAGE_GENERATION_HEADER } from "../../shared-types/src/storage-policy";
import { storageRoomName } from "./storage-generation";
import { archiveRow, beginArchive, captureArchiveStep, pruneArchivedEvidence, restoreArchiveStep, saveArchivedView } from "./storage-archive";
import { withCutoverPolicy, maintenanceAllowed, cutoverWritePermit } from './account-cutover';
import { assertStorageGeneration } from './storage-generation';
import { enrichAccountNames } from './account-profiles';
import type { AuthDatabase } from './auth-db';
import { AUTH_PROTOCOL_VERSION } from '../../shared-types/src/auth-policy.js';
import { authorizeGameRequest, authActive, authErrorResponse, currentGameAuthority, gameGuardStatements, registerSessionRoom, sanitizeGameResponse, type GameAuthority } from './auth-game';
import { AuthProblem } from './auth-controls';
import { equivalentGameStates, deterministicStateHash } from "../../game-engine/src/hash";
import { resolveToStability } from "../../game-engine/src/resolve";
import { readSyncBody, SyncBodyError } from "./sync-body";
import { LIVE_HISTORY, SHARED_OPERATIONS, commandFingerprint, isReconcileRequest, isSyncCommand, type SyncCommand, type CommandOutcome, type CommandReceipt } from "../../shared-types/src/sync-protocol";
import { commandReceiptStatement, loadCommandReceipt, hasLegacyCommandEvidence } from "./sync-receipts";
import type {
  ClientSocketMessage,
  EventAppendedEvent,
  JoinRequestCreatedEvent,
  JoinRequestResolvedEvent,
  PresenceChangedEvent,
  ServerEvent,
  StateSyncEvent,
} from "../../shared-types/src/events";
import { listLegalActions } from "../../game-engine/src/legal";
import {
  addNotification,
  assignIdentityToScenarioSeat,
  applyScenarioToGame,
  applyServerActionWithExpectedState,
  applyServerMove,
  applyRevertToMove,
  asAction,
  asGameState,
  asIdentity,
  asScenarioRecord,
  applyLaunchParticipantCopyMode,
  clone,
  createInitialGame,
  dismissCompetingJoinRequests,
  endServerTurn,
  ensureViewer,
  enumeratePieceActionPreviews,
  enumeratePieceActions,
  findRoleForIdentity,
  getParticipantsForIdentity,
  getRolesForIdentity,
  getActiveTurn,
  getApproverIdentityForSeat,
  getClaimableDualSeat,
  resolveLaunchParticipantCopyMode,
  reconcileGameToScenarioResultingState,
  getSeatIdentity,
  getSeatForSide,
  nextMoveId,
  getSideToMoveSeat,
  now,
  promoteIdentityToSeat,
  removeViewer,
  type JoinRequest,
  type LaunchParticipantCopyMode,
  type LiveGame,
  withViewModel,
} from "./shell-live-core";
import { loadGameProjection, persistGameState, resolveInvite, type D1Statement, type LiveGameEnv } from "./shell-live-db";

const HEARTBEAT_TIMEOUT_MS = 95_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

type DurableObjectStateLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
  blockConcurrencyWhile?: <T>(callback: () => Promise<T>) => Promise<T>;
  acceptWebSocket?: (socket: WebSocket) => void;
  getWebSockets?: () => WebSocket[];
  setWebSocketAutoResponse?: (pair: unknown) => void;
  id?: { toString?: () => string; name?: string };
  storage?: {
    setAlarm?: (scheduledTime: number | Date) => Promise<void> | void;
    deleteAlarm?: () => Promise<void> | void;
  };
};

type SessionStatus = "active" | "inactive" | "disconnecting";

type SessionAttachment = {
  compactHistory?: boolean;
  authVersion?: number;
  authority?: GameAuthority | null;
  gameId: string;
  sessionId: string;
  identityId: string;
  lastEventSeq: number;
  lastSeenAt: number;
  status: SessionStatus;
};

type SessionRecord = {
  compactHistory?: boolean;
  authVersion?: number;
  authority?: GameAuthority | null;
  socket: WebSocket;
  gameId: string;
  sessionId: string;
  identityId: string;
  lastEventSeq: number;
  lastSeenAt: number;
  status: SessionStatus;
};

type HibernationWebSocket = WebSocket & {
  serializeAttachment?: (value: SessionAttachment) => void;
  deserializeAttachment?: () => unknown;
};

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const text = await request.text();
    if (!text) {
      return {};
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
};


const parseLaunchParticipantCopyMode = (value: unknown): LaunchParticipantCopyMode | null =>
  value === "copy_source_participants" || value === "viewer_as_side_to_move" ? value : null;

const shouldReconcileImportedScenarioResultingState = (
  preserveMode: unknown,
  currentTurnIndex: number,
  resultingTurnIndex: number,
) => {
  if (preserveMode === true || preserveMode === "always") {
    return true;
  }
  if (preserveMode === "if_not_behind") {
    return resultingTurnIndex >= currentTurnIndex;
  }
  return false;
};

const getProcessEnvFlag = (key: string) => {
  const processLike = (globalThis as { process?: { env?: Record<string, unknown> } }).process;
  const raw = processLike?.env?.[key];
  return raw == null ? "" : String(raw).toLowerCase();
};

const isVerboseServerLoggingEnabled = () => {
  const processEnvFlag = getProcessEnvFlag("RIGHELT_VERBOSE_SERVER_LOGS");
  const globalFlag =
    typeof globalThis !== "undefined" &&
      ((globalThis as { __RIGHELT_VERBOSE_SERVER_LOGS?: unknown }).__RIGHELT_VERBOSE_SERVER_LOGS ||
        (globalThis as { __RIGHELT_VERBOSE_GAME_ROOM_LOGS?: unknown }).__RIGHELT_VERBOSE_GAME_ROOM_LOGS)
      ? String(
          (globalThis as { __RIGHELT_VERBOSE_SERVER_LOGS?: unknown }).__RIGHELT_VERBOSE_SERVER_LOGS ||
            (globalThis as { __RIGHELT_VERBOSE_GAME_ROOM_LOGS?: unknown }).__RIGHELT_VERBOSE_GAME_ROOM_LOGS,
        ).toLowerCase()
      : "";
  const value = processEnvFlag || globalFlag;
  return value === "1" || value === "true" || value === "yes" || value === "on" || value === "verbose";
};

// Capability negotiated per request/socket; durable state and old clients keep full snapshots.
export const compactHistoryResponse = (body: Record<string, unknown>): Record<string, unknown> => {
  const game = body.game as Record<string, unknown> | undefined;
  if (!game || !Array.isArray(game.moves)) return body;
  const last = game.moves.length - 1;
  return { ...body, game: { ...game, historyProjection: LIVE_HISTORY.snapshotValue, sharedReceipts: true, moves: game.moves.map((move, index) => {
    if (index === last) return move;
    const { snapshot: _snapshot, selectionSnapshot: _selection, ...summary } = move;
    return index === 0 ? {...summary,selectionSnapshot:_selection} : summary;
  }) } };
};

const eventForSession = (event: ServerEvent, identityId: string) => {
  if (!("game" in event)) {
    return event;
  }
  return {
    ...event,
    game: { ...withViewModel(event.game as LiveGame, identityId), sharedReceipts: true },
  };
};

export class GameRoomDO {
  private readonly state: DurableObjectStateLike;
  private env: LiveGameEnv;
  private game: LiveGame | null = null;
  private sharedCommand: SyncCommand | null = null;
  private sharedReceipt: CommandReceipt | null = null;
  private requestId: string | null = null;
  private requestOperation = "";
  private requestIdentity = "";
  private requestAuthority: GameAuthority | null = null;
  private requestedGameId: string | null = null;
  private eventSeq = 0;
  private deliveryTail: Promise<unknown> = Promise.resolve();
  private mutationTail: Promise<unknown> = Promise.resolve();
  private needsDurableReload = false;
  private readonly sessions = new Map<WebSocket, SessionRecord>();

  private logDiagnostic(level: "info" | "warn" | "error", event: string, payload: Record<string, unknown>, verboseOnly = false) {
    if (verboseOnly && !isVerboseServerLoggingEnabled()) {
      return;
    }
    const logger = level === "warn" ? console.warn : level === "error" ? console.error : console.info;
    logger(
      JSON.stringify({
        event,
        at: new Date().toISOString(),
        gameId: this.getLoadedGameId(),
        eventSeq: this.eventSeq,
        requestId: this.requestId,
        serverBuild: this.env.CF_VERSION_METADATA?.id ?? "unavailable",
        ...payload,
      }),
    );
  }

  constructor(state: DurableObjectStateLike, env: LiveGameEnv) {
    this.state = state;
    this.env = env;
    this.restoreSessionsFromState();
    this.configureWebSocketAutoResponse();
    const initialize = () => this.enqueue(async () => {
      this.env = await withCutoverPolicy(this.env);
      await this.reconcileAllPresenceFromSessions();
      await this.syncSessionAlarm();
    });
    if (this.state.blockConcurrencyWhile) void this.state.blockConcurrencyWhile(initialize);
    else void initialize();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedAt = Date.now();
    const result = this.mutationTail.then(async () => {
      const started = Date.now();
      if (this.needsDurableReload) {
        this.game = null;
        this.eventSeq = 0;
        await this.ensureLoaded();
        this.needsDurableReload = false;
      }
      try { return await operation(); } finally { this.logDiagnostic("info", "live_server_queue_timing", { queueWaitMs: started - queuedAt, operationMs: Date.now() - started }); this.requestId = null; }
    });
    this.mutationTail = result.catch(() => undefined);
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.enqueue(async () => {
        this.env = await withCutoverPolicy(this.env);
        this.requestAuthority = null;
        this.requestId = request.headers.get("X-Righelt-Request-Id");
        try {
          if(new URL(request.url).pathname==="/_storage/tick") {
            assertStorageGeneration(request,this.env);
            this.requestedGameId=request.headers.get("x-game-id");
            if(!this.requestedGameId)return json({ok:false,error:"invalid_game"},400);
            this.game=null;
            let row=await archiveRow(this.env,this.requestedGameId);
            if(row?.status==="restoring"){const ready=await restoreArchiveStep(this.env,row);this.game=null;if(!ready)this.scheduleRestoreStep(row.game_id,Number(request.headers.get("x-storage-restore-steps")??0));return json({ok:true,ready});}
            if(this.env.STORAGE_ARCHIVE_MODE==="canary" && this.requestedGameId!==this.env.STORAGE_ARCHIVE_CANARY_GAME_ID)return json({ok:false,error:"archive_canary_only"},403);
            if(this.env.STORAGE_ARCHIVES_ENABLED!=="true")return json({ok:true,disabled:true});
            if(row?.status==="archived"){
              await pruneArchivedEvidence(this.env,row);
              const left=await this.env.DB.prepare("SELECT EXISTS(SELECT 1 FROM live_command_receipts WHERE game_id=?1) OR EXISTS(SELECT 1 FROM live_legacy_command_tombstones WHERE game_id=?1) OR EXISTS(SELECT 1 FROM live_events WHERE game_id=?1) AS remaining").bind(row.game_id).first<{remaining:number}>();
              if(left?.remaining)this.scheduleStorageStep(row.game_id,Number(request.headers.get("x-storage-archive-steps")??0),"archive");
              return json({ok:true,archived:true});
            }
            const game=await this.ensureLoaded();
            if(!game)return json({ok:true,missing:true});
            try {
              if(!row){if(!await beginArchive(this.env,game,this.eventSeq))return json({ok:true,eligible:false});row=await archiveRow(this.env,game.id);}
              await this.deliveryTail;
              const storageGame=clone(game);
              const changedIdentity=this.applyCurrentPresence(storageGame);
              const archived=row?await captureArchiveStep(this.env,row,game,storageGame):false;
              if(archived && row){
                // Publication atomically advances the cursor with the fresh card.
                // A lost response is still discoverable through reconciliation.
                this.eventSeq=row.event_seq+1;
                if(changedIdentity){
                  const roles=getRolesForIdentity(storageGame,changedIdentity);
                  const event:PresenceChangedEvent={type:"presence_changed",eventSeq:this.eventSeq,identityId:changedIdentity,role:roles[0]??"Viewer",roles,connected:this.getSessionCount(changedIdentity)>0,game:clone(storageGame)};
                  this.scheduleBroadcast(event);
                }
              }
              if(row)this.scheduleStorageStep(row.game_id,Number(request.headers.get("x-storage-archive-steps")??0),"archive");
              return json({ok:true,archived});
            } finally {
              // Publication may commit before its response is lost. Never let an
              // old room cache overwrite the corrected archived representation.
              this.game=null;
            }
          }
          if (authActive(this.env) && new URL(request.url).pathname === "/auth-recheck") {
            await this.recheckSockets();
            return json({ ok: true });
          }
          const authorized = await authorizeGameRequest(
            request,
            this.env,
            new URL(request.url).pathname === "/ws",
          );
          this.requestAuthority = authorized.authority;
          const response = await this.fetchQueued(authorized.request);
          if (response.status === 101 || !response.headers.get("content-type")?.includes("application/json")) {
            return response;
          }
          const original = await response.json() as Record<string, unknown>;
          const body = authActive(this.env) ? await enrichAccountNames(original, this.env.DB as unknown as AuthDatabase) : original;
          // Recheck after enrichment before personalized output, including existing receipts.
          if (this.requestAuthority && !await currentGameAuthority(this.env, this.requestAuthority)) {
            throw new AuthProblem("session_changed", 409);
          }
          this.env = await withCutoverPolicy(this.env);
          const safe = authActive(this.env) ? sanitizeGameResponse(body, this.requestAuthority, !maintenanceAllowed(this.env,this.requestAuthority?.accountId)) : body;
          return json(request.headers.get(LIVE_HISTORY.requestHeader) === LIVE_HISTORY.requestValue ? compactHistoryResponse(safe) : safe, response.status);
        } finally {
          this.requestAuthority = null;
        }
      });
    } catch (error) {
      if (error instanceof SyncBodyError) return json({ ok: false, error: error.message }, error.status);
      if (authActive(this.env) || error instanceof AuthProblem) return authErrorResponse(error);
      throw error;
    }
  }

  private async fetchQueued(request: Request): Promise<Response> {
    assertStorageGeneration(request, this.env);
    const url = new URL(request.url);
    const path = url.pathname;
    this.requestOperation = path;
    this.requestIdentity = asIdentity(url.searchParams.get("identityId")) ?? "";
    const headerGameId = asIdentity(request.headers.get("x-game-id"));
    if (headerGameId) {
      if (authActive(this.env) && this.getLoadedGameId() && this.getLoadedGameId() !== headerGameId) throw new AuthProblem("invalid_input", 400);
      this.requestedGameId = headerGameId;
    }

    if (request.method === "GET" && path === "/ws") {
      return this.handleWebSocket(url);
    }

    if (request.method === "POST" && (path === "/create" || path === "/create-from-scenario")) {
      if (await this.ensureLoaded()) return json({ ok: false, error: "game_already_exists" }, 409);
    }

    if (request.method === "POST" && path === "/create") {
      const body = await parseBody(request);
      const identityId = asIdentity(body.identityId);
      this.requestIdentity=identityId??"";
      const gameId = asIdentity(body.gameId);
      if (!identityId || !gameId) {
        return json({ ok: false, error: "invalid_identity" }, 400);
      }
      if (body.creatorSide !== undefined && body.creatorSide !== "p1" && body.creatorSide !== "p2") return json({ ok: false, error: "invalid_creator_side" }, 400);
      const candidate = createInitialGame({
        gameId,
        identityId,
        selfPlayMode: body.selfPlayMode === true || body.playgroundMode === true,
        creatorSide: body.creatorSide === "p2" ? "p2" : "p1",
      });
      if (body.computer !== undefined) {
        const seats = parseComputerSeats(body.computer);
        if (authActive(this.env) && !this.requestAuthority) throw new AuthProblem("invalid_credentials", 401);
        if (!seats) return json({ ok: false, error: "invalid_computer_seats" }, 400);
        candidate.computer = createComputerControl(identityId, seats);
        candidate.selfPlayMode = true;
        const owner = candidate.player1 ?? candidate.player2!;
        candidate.player1 = clone(owner);
        candidate.player2 = clone(owner);
        candidate.notifications = ["Game created"];
      }
      if (authActive(this.env)) candidate.ownershipMode = "account_v1";
      await this.persistCandidate(candidate, null);
      return json({ ok: true, game: withViewModel(candidate, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/create-from-scenario") {
      const body = await parseBody(request);
      const identityId = asIdentity(body.identityId);
      this.requestIdentity=identityId??"";
      const gameId = asIdentity(body.gameId);
      const scenario = asScenarioRecord(body.scenario);
      const hasInitialSelectionAction = typeof body.initialSelectionAction !== "undefined" && body.initialSelectionAction !== null;
      const initialSelectionAction = typeof body.initialSelectionAction === "undefined" ? null : asAction(body.initialSelectionAction);
      if (!identityId || !gameId || !scenario || (hasInitialSelectionAction && !initialSelectionAction)) {
        return json({ ok: false, error: "invalid_scenario_payload" }, 400);
      }
      const candidate = createInitialGame({
        gameId,
        identityId,
        selfPlayMode: body.selfPlayMode === true || body.playgroundMode === true,
      });
      applyScenarioToGame(candidate, scenario);
      if (
        shouldReconcileImportedScenarioResultingState(
          body.preserveResultingState,
          Number(candidate.board.state?.turnIndex ?? 0),
          Number(scenario.resultingState?.turnIndex ?? 0),
        )
      ) {
        reconcileGameToScenarioResultingState(candidate, scenario);
      }
      const creatorSeat = body.creatorSide === "p1" ? "Player 1" : body.creatorSide === "p2" ? "Player 2" : getSeatForSide(candidate.board.state.sideToMove);
      assignIdentityToScenarioSeat(candidate, identityId, creatorSeat);
      if (body.computer !== undefined) {
        const seats = parseComputerSeats(body.computer);
        if (authActive(this.env) && !this.requestAuthority) throw new AuthProblem("invalid_credentials", 401);
        if (!seats) return json({ ok: false, error: "invalid_computer_seats" }, 400);
        candidate.computer = createComputerControl(identityId, seats);
        candidate.selfPlayMode = true;
        const owner = candidate.player1 ?? candidate.player2!;
        candidate.player1 = clone(owner); candidate.player2 = clone(owner);
      } else if (candidate.selfPlayMode) {
        const owner = candidate.player1 ?? candidate.player2!;
        candidate.player1 = clone(owner); candidate.player2 = clone(owner);
      }
      candidate.initialSelectionAction = initialSelectionAction ? clone(initialSelectionAction) : null;
      if (authActive(this.env)) candidate.ownershipMode = "account_v1";
      await this.persistCandidate(candidate, null);
      return json({ ok: true, game: withViewModel(candidate, identityId), eventSeq: this.eventSeq });
    }

    const body = path === '/decision-attempt' ? await readSyncBody(request, COMPUTER_LIMITS.attemptBytes) : ["/moves", "/apply", "/end-turn", "/reconcile", '/decision-history', '/decision-snapshot', '/decision-attempts', '/decision-notes'].includes(path) ? await readSyncBody(request) : await parseBody(request);
    const identityId = asIdentity(body.identityId);
      this.requestIdentity=identityId??"";
    if (!identityId) {
      return json({ ok: false, error: "invalid_identity" }, 400);
    }

    const loaded = await this.ensureLoaded();
    if (!loaded) {
      return json({ ok: false, error: "game_not_found" }, 404);
    }
    const game = loaded;
    if (!authActive(this.env) && game.ownershipMode === "account_v1") throw new AuthProblem("temporarily_unavailable", 503);
    if (authActive(this.env) && game.ownershipMode !== "account_v1" && !["/legal", "/piece-moves", "/piece-actions", '/decision-history', '/decision-snapshot', '/decision-attempts', '/decision-attempt', '/decision-notes'].includes(path)) throw new AuthProblem("legacy_read_only", 403);
    if (["/moves", "/apply", "/end-turn", "/shared", "/reconcile"].includes(path)) {
      return this.handleSyncCommand(path, body, game);
    }
    if (!["/history", "/live", "/presence", "/legal", "/piece-actions", "/piece-moves"].includes(path) && body.protocolVersion !== 2) {
      return json({ ok: false, error: "upgrade_required", protocolVersion: 2 }, 426);
    }

    if (request.method === 'POST' && path === '/decision-snapshot') {
      if (typeof body.decisionId !== "string" || body.gameplayRevision !== game.gameplayRevision) return json({ok:false,error:"history_changed"},409);
      const move = game.moves.find(move => move.moveId === body.decisionId) ?? (await readDecision(this.env,game.id,body.decisionId))?.move;
      if (!move) return json({ok:false,error:"decision_not_found"},404);
      return json({ok:true,gameId:game.id,gameplayRevision:game.gameplayRevision,move});
    }

    if (request.method === 'POST' && path === '/decision-history') {
      if (game.archiveStartRevision === undefined) {
        const cursor = body.cursor as { eventSeq?: unknown; ordinal?: unknown } | null;
        const after = cursor?.ordinal ?? -1;
        if (!Number.isSafeInteger(after) || Number(after) < -1 || (cursor && cursor.eventSeq !== this.eventSeq)) return json({ ok: false, error: 'invalid_history_cursor' }, 400);
        const retained = [
          { id: 'initial', kind: 'initial', revision: game.gameplayRevision, eventSeq: this.eventSeq, ordinal: 0, at: game.createdAt, state: game.moves[0]?.selectionSnapshot ?? game.board.state, partial: true },
          ...game.moves.map((move, index) => ({ id: move.moveId, kind: 'decision', revision: game.gameplayRevision, eventSeq: this.eventSeq, ordinal: index + 1, at: move.at, move, partial: true })),
        ].filter(entry => entry.ordinal > Number(after));
        const items = retained.slice(0, COMPUTER_LIMITS.historyPage), last = items.at(-1);
        return json({ ok: true, items, nextCursor: retained.length > items.length && last ? { eventSeq: this.eventSeq, ordinal: last.ordinal } : null, partial: true });
      }
      try { return json({ ok: true, ...(await readDecisionPage(this.env, game.id, body.cursor)), partial: (game.archiveStartRevision ?? 1) > 0 }); }
      catch (error) { if ((error as Error).message === 'invalid_history_cursor') return json({ ok: false, error: 'invalid_history_cursor' }, 400); throw error; }
    }
    if (request.method === 'POST' && path === '/decision-attempts') {
      if (!this.requestAuthority && (authActive(this.env) || body.kind !== 'computer')) throw new AuthProblem('invalid_credentials', 401);
      if (!['computer', 'analysis'].includes(String(body.kind))) return json({ ok: false, error: 'invalid_attempt' }, 400);
      const owner = body.kind === 'computer' ? game.computer?.ownerId : identityId;
      if (!owner) return json({ ok: true, items: [], nextCursor: null });
      try { return json({ ok: true, ...(await readAttemptPage(this.env, game.id, owner, String(body.kind), body.cursor)) }); }
      catch (error) { if ((error as Error).message === 'invalid_attempt_cursor') return json({ ok: false, error: 'invalid_attempt_cursor' }, 400); throw error; }
    }
    if (request.method === 'POST' && path === '/decision-attempt') {
      if (!this.requestAuthority && (authActive(this.env) || body.kind !== 'computer')) throw new AuthProblem('invalid_credentials', 401);
      if (typeof body.attemptId !== 'string' || !['computer', 'analysis'].includes(String(body.kind))) return json({ ok: false, error: 'invalid_attempt' }, 400);
      const attemptOwner = body.kind === 'computer' ? game.computer?.ownerId : identityId;
      if (!attemptOwner) return json({ ok: false, error: 'invalid_attempt' }, 400);
      const saved = await readAttempt(this.env, game.id, attemptOwner, body.attemptId, String(body.kind));
      if (body.operation !== 'write') return json({ ok: true, attempt: saved });
      if (attemptOwner !== identityId) return json({ ok: false, error: 'computer_owner_required' }, 403);
      if (saved) return canonicalCommandJson(saved) === canonicalCommandJson(body.attempt) ? json({ ok: true, attempt: saved }) : json({ ok: false, error: "attempt_id_conflict" }, 409);
      let statement;
      try { statement = attemptStatement(this.env, game.id, identityId, body.attemptId, String(body.kind), body.attempt); }
      catch { return json({ ok: false, error: 'invalid_attempt' }, 400); }
      await this.persistCandidate(game, null, undefined, false, [statement]);
      return json({ ok: true });
    }
    if (request.method === 'POST' && path === '/decision-notes') {
      if (!this.requestAuthority) throw new AuthProblem('invalid_credentials', 401);
      if (body.operation === 'write') {
        const retainedDecision = game.archiveStartRevision === undefined && (body.decisionId === 'initial' || game.moves.some(move => move.moveId === body.decisionId));
        if (typeof body.decisionId !== 'string' || (!retainedDecision && !await readDecision(this.env, game.id, body.decisionId))) return json({ ok: false, error: 'decision_not_found' }, 404);
        let statement;
        try { statement = noteStatement(this.env, game.id, identityId, body.decisionId, body.note); }
        catch { return json({ ok: false, error: 'invalid_decision_note' }, 400); }
        await this.persistCandidate(game, null, undefined, false, [statement]);
      }
      return json({ ok: true, notes: await readDecisionNotes(this.env, game.id, identityId) });
    }

    if (request.method === "POST" && path === "/computer-control") {
      if (!game.computer) return json({ ok: false, error: "not_computer_game" }, 409);
      try {
        game.computer = changeComputerControl(game.computer, { ownerId: identityId, authContextId: this.requestAuthority?.contextId ?? '', deviceId: body.deviceId, generation: body.generation, action: body.action, turnIndex: getActiveTurn(game)?.index ?? game.board.state.turnIndex ?? 0, now: Date.now() });
      } catch (error) { return json({ ok: false, error: (error as Error).message }, 409); }
      game.updatedAt = now();
      await this.commit({ type: "event_appended", reason: "computer_control_changed", game });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/presence") {
      const sessionId = asIdentity(body.sessionId);
      const status = body.status === "inactive" || body.status === "disconnecting" ? body.status : null;
      if (!sessionId) {
        return json({ ok: false, error: "invalid_session" }, 400);
      }
      if (!status) {
        return json({ ok: false, error: "invalid_presence_status" }, 400);
      }
      await this.applyPresenceSignal(identityId, sessionId, status, typeof body.lastEventSeq === "number" ? body.lastEventSeq : 0);
      return json({ ok: true, eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/join") {
      if (authActive(this.env)) {
        const token = asIdentity(body.inviteToken);
        const invite = token ? await resolveInvite(this.env, token) : null;
        body.inviteFromRole = invite?.gameId === game.id ? invite.sharedByRole : null;
      }
      const mode = body.mode === "viewer" ? "viewer" : body.mode === "player" ? "player" : null;
      if (!mode) {
        return json({ ok: false, error: "invalid_mode" }, 400);
      }
      if (mode === "viewer") {
        const added = ensureViewer(game, identityId, this.getSessionCount(identityId));
        game.updatedAt = now();
        if (added) {
          addNotification(game, "Viewer joined");
        }
        await this.commit({
          type: "event_appended",
          reason: added ? "viewer_joined" : "viewer_reconfirmed",
          game,
        });
        return json({ ok: true, pendingApproval: false, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
      }

      if (game.selfPlayMode) {
        return json({ ok: false, error: "self_play_player_join_disabled" }, 409);
      }
      if (game.player1?.identityId === identityId || game.player2?.identityId === identityId) {
        return json({ ok: false, error: "identity_already_player" }, 409);
      }
      const requestedSeat = !game.player1 ? "Player 1" : !game.player2 ? "Player 2" : null;
      if (!requestedSeat) {
        return json({ ok: false, error: "no_player_seat_available" }, 409);
      }

      const inviteFromRole =
        body.inviteFromRole === "Player 1" || body.inviteFromRole === "Player 2" || body.inviteFromRole === "Viewer"
          ? body.inviteFromRole
          : null;
      const sharedByPlayer = inviteFromRole === "Player 1" || inviteFromRole === "Player 2";

      if (!sharedByPlayer) {
        ensureViewer(game, identityId, this.getSessionCount(identityId));
        game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.identityId !== identityId);
        game.pendingJoinRequests.push({
          identityId,
          requestedSeat,
          requestedAt: now(),
          source: inviteFromRole ? "viewer_invite" : "home_list",
          status: "pending",
        });
        game.updatedAt = now();
        addNotification(game, "Player seat request pending approval");
        await this.commit({
          type: "join_request_created",
          requesterIdentityId: identityId,
          requestedSeat,
          game,
        });
        return json({ ok: true, pendingApproval: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
      }

      promoteIdentityToSeat(game, requestedSeat, identityId, this.getSessionCount(identityId));
      dismissCompetingJoinRequests(game, identityId);
      game.pendingJoinRequests = [];
      game.updatedAt = now();
      addNotification(game, "Player joined");
      await this.commit({
        type: "event_appended",
        reason: "player_joined",
        game,
      });
      return json({ ok: true, pendingApproval: false, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/approve") {
      const requesterIdentityId = asIdentity(body.requesterIdentityId);
      if (!requesterIdentityId) {
        return json({ ok: false, error: "invalid_requester" }, 400);
      }
      const requestItem = game.pendingJoinRequests.find((item) => item.identityId === requesterIdentityId);
      if (!requestItem) {
        return json({ ok: false, error: "request_not_found" }, 404);
      }
      const approverIdentityId = getApproverIdentityForSeat(game, requestItem.requestedSeat);
      if (!approverIdentityId || approverIdentityId !== identityId) {
        return json({ ok: false, error: "approval_not_allowed" }, 403);
      }
      game.pendingJoinRequests = game.pendingJoinRequests.filter((item) => item.identityId === requesterIdentityId);
      if (requestItem.requestedSeat === "Player 1" && !game.player1) {
        promoteIdentityToSeat(game, "Player 1", requesterIdentityId, this.getSessionCount(requesterIdentityId));
      }
      if (requestItem.requestedSeat === "Player 2" && !game.player2) {
        promoteIdentityToSeat(game, "Player 2", requesterIdentityId, this.getSessionCount(requesterIdentityId));
      }
      dismissCompetingJoinRequests(game, requesterIdentityId);
      game.pendingJoinRequests = [];
      game.updatedAt = now();
      addNotification(game, "Player request approved");
      await this.commit({
        type: "join_request_resolved",
        requesterIdentityId,
        accepted: true,
        seat: requestItem.requestedSeat,
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/revert-request") {
      const targetMoveId = asIdentity(body.targetMoveId);
      const requestedRequestId = asIdentity(body.requestId);
      if (!targetMoveId) {
        this.logDiagnostic("warn", "live_server_revert_request_rejected", { identityId, error: "invalid_target_move" });
        return json({ ok: false, error: "invalid_target_move" }, 400);
      }
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        this.logDiagnostic("warn", "live_server_revert_request_rejected", { identityId, error: "role_not_allowed" });
        return json({ ok: false, error: "role_not_allowed" }, 403);
      }
      const targetMove = game.moves.find((move) => move.moveId === targetMoveId) ?? (await readDecision(this.env, game.id, targetMoveId))?.move;
      if (!targetMove) {
        this.logDiagnostic("warn", "live_server_revert_request_rejected", { identityId, targetMoveId, error: "move_not_found" });
        return json({ ok: false, error: "move_not_found" }, 404);
      }
      if (targetMove.undone === true) {
        this.logDiagnostic("warn", "live_server_revert_request_rejected", { identityId, targetMoveId, error: "move_already_undone" });
        return json({ ok: false, error: "move_already_undone" }, 409);
      }
      const requesterSeat = role;
      const approverIdentityId = getApproverIdentityForSeat(game, requesterSeat);
      const autoApprove = !approverIdentityId || approverIdentityId === identityId;
      if (autoApprove) {
        const reverted = applyRevertToMove(game, targetMoveId, identityId, targetMove);
        if (!reverted.ok) {
          this.logDiagnostic("warn", "live_server_revert_request_rejected", { identityId, targetMoveId, error: reverted.error });
          return json({ ok: false, error: reverted.error }, 409);
        }
        addNotification(game, `Player ${identityId} accepted the undo request`);
        this.logDiagnostic("info", "live_server_revert_auto_approved", { identityId, targetMoveId }, true);
        await this.commit({
          type: "event_appended",
          reason: "moves_reverted",
          game,
        });
        return json({ ok: true, autoApproved: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
      }
      game.pendingRevertRequest = {
        requestId: requestedRequestId ?? nextMoveId(),
        requesterIdentityId: identityId,
        targetMoveId,
        targetMoveIndex: targetMove.index,
        requestedAt: now(),
        status: "pending",
      };
      this.logDiagnostic(
        "info",
        "live_server_revert_request_created",
        { requesterIdentityId: identityId, approverIdentityId, targetMoveId, requestId: game.pendingRevertRequest.requestId },
        true,
      );
      game.updatedAt = now();
      addNotification(game, "Undo request pending approval");
      await this.commit({
        type: "event_appended",
        reason: "revert_requested",
        game,
      });
      return json({ ok: true, pendingApproval: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/revert-approve") {
      const requestId = asIdentity(body.requestId);
      if (!requestId) {
        this.logDiagnostic("warn", "live_server_revert_approve_rejected", { identityId, error: "invalid_request_id" });
        return json({ ok: false, error: "invalid_request_id" }, 400);
      }
      const pendingRevertRequest = game.pendingRevertRequest;
      if (!pendingRevertRequest || pendingRevertRequest.requestId !== requestId || pendingRevertRequest.status !== "pending") {
        this.logDiagnostic("warn", "live_server_revert_approve_rejected", { identityId, requestId, error: "request_not_found" });
        return json({ ok: false, error: "request_not_found" }, 404);
      }
      const requesterRole = findRoleForIdentity(game, pendingRevertRequest.requesterIdentityId);
      if (requesterRole !== "Player 1" && requesterRole !== "Player 2") {
        this.logDiagnostic("warn", "live_server_revert_approve_rejected", { identityId, requestId, error: "requester_not_player" });
        return json({ ok: false, error: "requester_not_player" }, 409);
      }
      const approverIdentityId = getApproverIdentityForSeat(game, requesterRole);
      if (approverIdentityId && approverIdentityId !== identityId) {
        this.logDiagnostic(
          "warn",
          "live_server_revert_approve_rejected",
          { identityId, requestId, approverIdentityId, error: "approval_not_allowed" },
        );
        return json({ ok: false, error: "approval_not_allowed" }, 403);
      }
      const archivedTarget = (await readDecision(this.env, game.id, pendingRevertRequest.targetMoveId))?.move;
      const reverted = applyRevertToMove(game, pendingRevertRequest.targetMoveId, pendingRevertRequest.requesterIdentityId, archivedTarget);
      if (!reverted.ok) {
        this.logDiagnostic("warn", "live_server_revert_approve_rejected", { identityId, requestId, error: reverted.error });
        return json({ ok: false, error: reverted.error }, 409);
      }
      addNotification(game, `Player ${identityId} accepted the undo request`);
      this.logDiagnostic("info", "live_server_revert_approved", { identityId, requestId }, true);
      await this.commit({
        type: "event_appended",
        reason: "moves_reverted",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/revert-reject") {
      const requestId = asIdentity(body.requestId);
      if (!requestId) {
        this.logDiagnostic("warn", "live_server_revert_reject_rejected", { identityId, error: "invalid_request_id" });
        return json({ ok: false, error: "invalid_request_id" }, 400);
      }
      const pendingRevertRequest = game.pendingRevertRequest;
      if (!pendingRevertRequest || pendingRevertRequest.requestId !== requestId || pendingRevertRequest.status !== "pending") {
        this.logDiagnostic("warn", "live_server_revert_reject_rejected", { identityId, requestId, error: "request_not_found" });
        return json({ ok: false, error: "request_not_found" }, 404);
      }
      const requesterRole = findRoleForIdentity(game, pendingRevertRequest.requesterIdentityId);
      if (requesterRole !== "Player 1" && requesterRole !== "Player 2") {
        this.logDiagnostic("warn", "live_server_revert_reject_rejected", { identityId, requestId, error: "requester_not_player" });
        return json({ ok: false, error: "requester_not_player" }, 409);
      }
      const approverIdentityId = getApproverIdentityForSeat(game, requesterRole);
      if (approverIdentityId && approverIdentityId !== identityId) {
        this.logDiagnostic(
          "warn",
          "live_server_revert_reject_rejected",
          { identityId, requestId, approverIdentityId, error: "approval_not_allowed" },
        );
        return json({ ok: false, error: "approval_not_allowed" }, 403);
      }
      game.pendingRevertRequest = null;
      game.updatedAt = now();
      addNotification(game, `Player ${identityId} rejected the undo request`);
      this.logDiagnostic("info", "live_server_revert_rejected", { identityId, requestId }, true);
      await this.commit({
        type: "event_appended",
        reason: "revert_rejected",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/revert-rescind") {
      const requestId = asIdentity(body.requestId);
      if (!requestId) {
        this.logDiagnostic("warn", "live_server_revert_rescind_rejected", { identityId, error: "invalid_request_id" });
        return json({ ok: false, error: "invalid_request_id" }, 400);
      }
      const pendingRevertRequest = game.pendingRevertRequest;
      if (!pendingRevertRequest || pendingRevertRequest.requestId !== requestId || pendingRevertRequest.status !== "pending") {
        this.logDiagnostic("warn", "live_server_revert_rescind_rejected", { identityId, requestId, error: "request_not_found" });
        return json({ ok: false, error: "request_not_found" }, 404);
      }
      if (pendingRevertRequest.requesterIdentityId !== identityId) {
        this.logDiagnostic("warn", "live_server_revert_rescind_rejected", { identityId, requestId, error: "requester_mismatch" });
        return json({ ok: false, error: "requester_mismatch" }, 403);
      }
      game.pendingRevertRequest = null;
      game.updatedAt = now();
      addNotification(game, `Player ${identityId} rescinded the undo request`);
      this.logDiagnostic("info", "live_server_revert_rescinded", { identityId, requestId }, true);
      await this.commit({
        type: "event_appended",
        reason: "revert_rescinded",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/history") {
      const moveIndex = typeof body.moveIndex === "number" ? body.moveIndex : -1;
      if (moveIndex < 0 || moveIndex >= game.moves.length) {
        return json({ ok: false, error: "invalid_move_index" }, 400);
      }
      game.historyIndexByIdentity[identityId] = moveIndex;
      await this.persistCandidate(game, null);
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/live") {
      delete game.historyIndexByIdentity[identityId];
      await this.persistCandidate(game, null);
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/play-as-both") {
      const targetSeat = getClaimableDualSeat(game, identityId);
      if (!targetSeat) {
        return json({ ok: false, error: "play_as_both_unavailable" }, 409);
      }
      promoteIdentityToSeat(game, targetSeat, identityId, this.getSessionCount(identityId));
      game.selfPlayMode = true;
      game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.requestedSeat !== targetSeat);
      addNotification(game, "Play as both players enabled");
      await this.commit({
        type: "event_appended",
        reason: "play_as_both_players",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/load-scenario") {
      const scenario = asScenarioRecord(body.scenario);
      if (!scenario) {
        return json({ ok: false, error: "invalid_scenario_payload" }, 400);
      }
      if (game.moves.length > 0 || [game.player1, game.player2].some(player => player && player.identityId !== identityId) || game.computer) {
        return json({ ok: false, error: "scenario_target_not_empty_or_solely_owned" }, 409);
      }
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return json({ ok: false, error: "role_not_allowed" }, 403);
      }
      applyScenarioToGame(game, scenario);
      if (
        shouldReconcileImportedScenarioResultingState(
          "if_not_behind",
          Number(game.board.state?.turnIndex ?? 0),
          Number(scenario.resultingState?.turnIndex ?? 0),
        )
      ) {
        reconcileGameToScenarioResultingState(game, scenario);
      }
      game.updatedAt = now();
      await this.commit({
        type: "event_appended",
        reason: "scenario_loaded",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/legal") {
      const stable = game.board.state;
      return json({
        ok: true,
        state: stable,
        legalActions: listLegalActions(stable),
        game: withViewModel(game, identityId),
        eventSeq: this.eventSeq,
      });
    }

    if (request.method === "POST" && path === "/piece-moves") {
      const pieceId = asIdentity(body.pieceId);
      if (!pieceId) {
        return json({ ok: false, error: "invalid_piece_id" }, 400);
      }
      return json({
        ok: true,
        state: game.board.state,
        pieceId,
        actions: enumeratePieceActions(game.board.state, pieceId),
        previewActions: enumeratePieceActionPreviews(game.board.state, pieceId),
        game: withViewModel(game, identityId),
        eventSeq: this.eventSeq,
      });
    }

    return json({ ok: false, error: "not_found" }, 404);
  }

  private async handleWebSocket(url: URL) {
    const wsCtor = (globalThis as any).WebSocketPair;
    if (!wsCtor) {
      return new Response("WebSocket upgrade not supported in this runtime", { status: 426 });
    }
    const identityId = authActive(this.env) ? this.requestAuthority?.accountId ?? "" : asIdentity(url.searchParams.get("identityId"));
    const sessionId = asIdentity(url.searchParams.get("sessionId"));
    if (identityId === null) {
      return new Response("Invalid identity", { status: 400 });
    }
    if (!sessionId) {
      return new Response("Invalid session", { status: 400 });
    }
    const loaded = await this.ensureLoaded();
    if (!loaded) {
      return new Response("Game not found", { status: 404 });
    }
    const game = loaded;
    if (!authActive(this.env) && game.ownershipMode === "account_v1") throw new AuthProblem("temporarily_unavailable", 503);
    this.requestedGameId = game.id;
    const lastEventSeq = Number.parseInt(url.searchParams.get("lastEventSeq") || "0", 10) || 0;
    const socketPair = new wsCtor();
    const client = socketPair[0];
    const server = socketPair[1] as HibernationWebSocket;
    if (typeof this.state.acceptWebSocket !== "function") {
      return new Response("WebSocket hibernation not supported in this runtime", { status: 426 });
    }
    if (authActive(this.env) && this.requestAuthority) await registerSessionRoom(this.env, this.requestAuthority, game.id);
    this.state.acceptWebSocket(server);

    const session: SessionRecord = {
      ...(authActive(this.env) ? { authVersion: AUTH_PROTOCOL_VERSION, authority: this.requestAuthority ? { ...this.requestAuthority, renew: false } : null } : {}),
      compactHistory: url.searchParams.get(LIVE_HISTORY.socketQuery) === LIVE_HISTORY.snapshotValue,
      socket: server,
      gameId: game.id,
      sessionId,
      identityId,
      lastEventSeq,
      lastSeenAt: Date.now(),
      status: "active",
    };
    this.sessions.set(server, session);
    this.persistSessionAttachment(server, session);
    await this.setPresenceFromSessions(identityId, server);
    await this.syncSessionAlarm();

    // Recover from one current projection, never accumulated full-state events.
    if (lastEventSeq !== this.eventSeq) {
      const syncEvent: StateSyncEvent = { type: "state_sync", eventSeq: this.eventSeq, reason: "connected", game: clone(this.game ?? game) };
      await this.send(server, eventForSession(syncEvent, identityId));
    } else {
      await this.send(server, { type: "heartbeat_ack", protocolVersion: 2, gameId: game.id, eventSeq: this.eventSeq });
    }

    return new Response(null, { status: 101, webSocket: client } as any);
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    return this.enqueue(async () => {
      this.env = await withCutoverPolicy(this.env);
      this.requestAuthority = null;
      try {
        const session = this.sessions.get(socket);
        if (authActive(this.env) && (!session || !await this.authorizeSocket(session))) return;
        this.requestAuthority = session?.authority ?? null;
        await this.webSocketMessageQueued(socket, message);
      } catch { this.closeUnauthorizedSocket(socket); }
      finally { this.requestAuthority = null; }
    });
  }

  private async webSocketMessageQueued(socket: WebSocket, message: ArrayBuffer | string) {
    const text = typeof message === "string" ? message : "";
    let payload: ClientSocketMessage | null = null;
    try {
      payload = JSON.parse(text) as ClientSocketMessage;
    } catch {
      payload = null;
    }
    if (!payload || !["heartbeat", "inactive", "disconnecting"].includes(payload.type) || !Number.isSafeInteger(payload.lastEventSeq) || payload.lastEventSeq < 0) {
      return;
    }
    const current = this.sessions.get(socket);
    if (!current || current.identityId !== payload.identityId || current.sessionId !== payload.sessionId) {
      return;
    }
    current.lastEventSeq = payload.lastEventSeq;
    current.lastSeenAt = Date.now();
    if (payload.type === "heartbeat") {
      current.status = "active";
    } else {
      current.status = payload.type;
    }
    this.persistSessionAttachment(socket as HibernationWebSocket, current);
    await this.setPresenceFromSessions(payload.identityId);
    await this.syncSessionAlarm();
    if (payload.type === "heartbeat") await this.send(socket, { type: "heartbeat_ack", protocolVersion: 2, gameId: current.gameId, eventSeq: this.eventSeq });
  }

  async webSocketClose(socket: WebSocket) {
    return this.enqueue(() => this.webSocketCloseQueued(socket));
  }

  private async webSocketCloseQueued(socket: WebSocket) {
    const current = this.sessions.get(socket);
    if (!current) {
      return;
    }
    this.sessions.delete(socket);
    await this.setPresenceFromSessions(current.identityId);
    await this.syncSessionAlarm();
  }

  private async applyPresenceSignal(
    identityId: string,
    sessionId: string,
    status: Exclude<SessionStatus, "active">,
    lastEventSeq: number,
  ) {
    let changed = false;
    for (const [socket, session] of this.sessions.entries()) {
      if (session.identityId !== identityId || session.sessionId !== sessionId) {
        continue;
      }
      session.status = status;
      session.lastEventSeq = lastEventSeq;
      session.lastSeenAt = Date.now();
      this.persistSessionAttachment(socket as HibernationWebSocket, session);
      changed = true;
    }
    if (!changed) {
      return;
    }
    await this.setPresenceFromSessions(identityId);
    await this.syncSessionAlarm();
  }

  async alarm() {
    return this.enqueue(() => this.alarmQueued());
  }

  private async alarmQueued() {
    this.env = await withCutoverPolicy(this.env);
    if (authActive(this.env)) await this.recheckSockets();
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    const expiredIdentityIds = new Set<string>();
    for (const [socket, session] of [...this.sessions.entries()]) {
      if (session.status !== "active" || session.lastSeenAt >= cutoff) {
        continue;
      }
      expiredIdentityIds.add(session.identityId);
      this.sessions.delete(socket);
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    for (const identityId of expiredIdentityIds) {
      await this.setPresenceFromSessions(identityId);
    }
    await this.syncSessionAlarm();
  }

  private async ensureLoaded() {
    if (this.game) {
      return clone(this.game);
    }
    const gameId = this.getLoadedGameId();
    if (!gameId) {
      return null;
    }
    const projection = await loadGameProjection(this.env, gameId);
    if (!projection || projection.kind === "invalid") {
      return null;
    }
    this.game = projection.game;
    this.eventSeq = projection.eventSeq;
    return clone(this.game);
  }

  private getLoadedGameId() {
    return this.game?.id ?? this.requestedGameId ?? this.state.id?.name ?? null;
  }

  async setGameId(gameId: string) {
    return this.enqueue(() => this.setGameIdQueued(gameId));
  }

  private async setGameIdQueued(gameId: string) {
    this.requestedGameId = gameId;
    if (!this.game) {
      const projection = await loadGameProjection(this.env, gameId);
      if (projection?.kind === "ok") {
        this.game = projection.game;
        this.eventSeq = projection.eventSeq;
      }
    }
  }

  private getSessionCount(identityId: string) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.identityId === identityId && session.status === "active") {
        count += 1;
      }
    }
    return count;
  }

  private applyCurrentPresence(game:LiveGame):string|null {
    let changedIdentity:string|null=null;
    for(const participant of [game.player1,game.player2,...game.viewers])if(participant){
      const count=this.getSessionCount(participant.identityId),connected=count>0;
      if(participant.connected!==connected || participant.sessionCount!==count){
        changedIdentity??=participant.identityId;
        participant.connected=connected;participant.sessionCount=count;participant.lastHeartbeatAt=now();
      }
    }
    return changedIdentity;
  }

  private async setPresenceFromSessions(identityId: string, excludedSocket?: WebSocket) {
    this.env = await withCutoverPolicy(this.env);
    if (authActive(this.env) && (this.env.AUTH_ENABLED !== "true" || this.env.ACCOUNT_POLICY?.maintenance)) return;
    if (this.getLoadedGameId() && (await archiveRow(this.env,this.getLoadedGameId()!))?.status === "archiving") return;
    const loaded = await this.ensureLoaded();
    const game = loaded ? clone(loaded) : null;
    if (!game) {
      return;
    }
    if ((!authActive(this.env) && game.ownershipMode === "account_v1") || (authActive(this.env) && game.ownershipMode !== "account_v1")) return;
    const sessionCount = this.getSessionCount(identityId);
    const participants = getParticipantsForIdentity(game, identityId);
    if (participants.length === 0) {
      return;
    }
    const roles = getRolesForIdentity(game, identityId);
    const connected = sessionCount > 0;
    const lastHeartbeatAt = now();
    const changed = participants.some(
      ({ participant }) => participant.connected !== connected || participant.sessionCount !== sessionCount,
    );
    for (const { participant } of participants) {
      participant.connected = connected;
      participant.sessionCount = sessionCount;
      participant.lastHeartbeatAt = lastHeartbeatAt;
    }
    if (!changed) {
      return;
    }
    this.logDiagnostic("info", "live_server_presence_changed", { identityId, connected, sessionCount, roles }, true);
    const presenceEvent: PresenceChangedEvent = {
      type: "presence_changed",
      eventSeq: this.eventSeq + 1,
      identityId,
      role: roles[0] ?? "Viewer",
      roles,
      connected,
      game: clone(game),
    };
    await this.persistCandidate(game, presenceEvent, undefined, true, [], identityId);
    this.scheduleBroadcast(presenceEvent, excludedSocket);
  }

  private async commit(
    input:
      | { type: "event_appended"; reason: string; clientCommandId?: string | null; game: LiveGame }
      | { type: "join_request_created"; requesterIdentityId: string; requestedSeat: "Player 1" | "Player 2"; game: LiveGame }
      | { type: "join_request_resolved"; requesterIdentityId: string; accepted: boolean; seat: "Player 1" | "Player 2" | null; game: LiveGame },
  ) {
    const event =
      input.type === "event_appended"
          ? ({
            type: "event_appended",
            eventSeq: this.eventSeq + 1,
            reason: input.reason,
            clientCommandId: input.clientCommandId ?? null,
            game: clone(input.game),
          } satisfies EventAppendedEvent)
        : input.type === "join_request_created"
          ? ({
              type: "join_request_created",
              eventSeq: this.eventSeq + 1,
              requesterIdentityId: input.requesterIdentityId,
              requestedSeat: input.requestedSeat,
              game: clone(input.game),
            } satisfies JoinRequestCreatedEvent)
          : ({
              type: "join_request_resolved",
              eventSeq: this.eventSeq + 1,
              requesterIdentityId: input.requesterIdentityId,
              accepted: input.accepted,
              seat: input.seat,
              game: clone(input.game),
            } satisfies JoinRequestResolvedEvent);

    await this.persistCandidate(input.game, event);
    this.logDiagnostic("info", "live_server_commit_event", { type: event.type }, true);
    this.scheduleBroadcast(event);
  }

  private async handleSyncCommand(path: string, body: Record<string, unknown>, game: LiveGame) {
    if (body.protocolVersion !== 2) return json({ ok: false, error: "upgrade_required", protocolVersion: 2 }, 426);
    const reconcile = path === "/reconcile";
    if (reconcile ? !isReconcileRequest(body, game.id) : !isSyncCommand(body)) return json({ ok: false, error: "invalid_sync_request" }, 400);
    const commands = (reconcile ? body.commands : [body]) as SyncCommand[];
    for (const command of commands) {
      if (authActive(this.env) && !reconcile && command.authContextId !== this.requestAuthority?.contextId) throw new AuthProblem("session_changed", 409);
      if (command.gameId !== game.id || command.identityId !== body.identityId || await commandFingerprint(command) !== command.fingerprint) return json({ ok: false, error: "invalid_command_fingerprint" }, 400);
      const routeKind = path === "/moves" ? "move" : path === "/apply" ? "action" : path === "/shared" ? "shared" : "end_turn";
      if (!reconcile && command.kind !== routeKind) return json({ ok: false, error: "invalid_command_kind" }, 400);
    }
    const existing = !reconcile ? await loadCommandReceipt(this.env, game.id, commands[0].clientCommandId) : null;
    const outcomes = new Map<string, CommandOutcome>();
    const batch = new Map(commands.map((command) => [command.clientCommandId, command]));
    const resolve = async (command: SyncCommand): Promise<CommandOutcome> => {
      const resolved = outcomes.get(command.clientCommandId);
      if (resolved) return resolved;
      if (command.predecessor && batch.has(command.predecessor.clientCommandId)) await resolve(batch.get(command.predecessor.clientCommandId)!);
      const outcome = await this.resolveCommand(command, !reconcile);
      outcomes.set(command.clientCommandId, outcome);
      return outcome;
    };
    for (const command of commands) await resolve(command);
    const current = this.game!;
    const commandOutcomes = commands.map((command) => outcomes.get(command.clientCommandId)!);
    const result = commandOutcomes[0];
    const stored = !reconcile ? result as CommandReceipt & { result?: Record<string, unknown> } : null;
    const move = !reconcile ? current.moves.find((move) => move.clientCommandId === commands[0].clientCommandId) : undefined;
    return json({ ok: true, protocolVersion: 2, gameId: game.id, eventSeq: this.eventSeq, gameplayRevision: current.gameplayRevision, commandOutcomes,
      ...(!reconcile || body.knownSnapshotEventSeq !== this.eventSeq ? { game: withViewModel(current, String(body.identityId)) } : {}),
      ...(!reconcile ? { accepted: result.outcome === "accepted", clientCommandId: commands[0].clientCommandId, move, state: current.board.state, destroyedPieces: move?.destroyedPieces ?? [], removedPieces: [], ...(stored?.result ?? {}), duplicate: Boolean(existing && result.outcome === "accepted"), ...(result.outcome === "rejected" ? { validation: { ok: false, code: result.reason } } : {}) } : {}),
    });
  }

  private async resolveCommand(command: SyncCommand, execute: boolean): Promise<CommandOutcome> {
    const game = clone(this.game!);
    const outcome = (status: CommandOutcome["outcome"], reason: string | null, eventSeq = this.eventSeq, gameplayRevision = game.gameplayRevision): CommandOutcome => ({
      gameId: game.id, identityId: command.identityId, clientCommandId: command.clientCommandId, fingerprint: command.fingerprint, outcome: status, reason, eventSeq, gameplayRevision,
    });
    const receipt = await loadCommandReceipt(this.env, game.id, command.clientCommandId);
    if (receipt) return receipt.identityId === command.identityId && receipt.fingerprint === command.fingerprint ? receipt : outcome("rejected", "command_id_conflict");
    if (authActive(this.env) && command.authContextId !== this.requestAuthority?.contextId) return outcome("unknown", "retired_session");
    if (await hasLegacyCommandEvidence(this.env, game.id, command.clientCommandId)) return outcome("unknown", "legacy_evidence");
    const reject = async (reason: string) => {
      const rejected = outcome("rejected", reason, this.eventSeq + 1, this.game!.gameplayRevision) as CommandReceipt;
      await this.persistCandidate(clone(this.game!), null, rejected);
      return rejected;
    };
    if (command.predecessor) {
      const parent = await loadCommandReceipt(this.env, game.id, command.predecessor.clientCommandId);
      if (!parent) return outcome("unknown", "dependency_pending");
      if (parent.identityId !== command.identityId || parent.fingerprint !== command.predecessor.fingerprint) return reject("invalid_dependency");
      if (parent.outcome === "rejected") return reject("predecessor_rejected");
    } else if (command.expectedGameplayRevision > game.gameplayRevision) return reject("invalid_dependency");
    const expectedState = asGameState(command.expectedState);
    const sameBoard = expectedState && equivalentGameStates(expectedState, game.board.state);
    // Shared operations carry stable request/decision IDs or lease generations.
    // Their handlers enforce those guards even if unrelated gameplay advanced.
    if (command.kind !== "shared" && (command.expectedGameplayRevision !== game.gameplayRevision || !sameBoard || (command.kind === "end_turn" && command.expectedTurnIndex !== game.board.state.turnIndex))) return reject("stale_state");
    if (!execute) return outcome("unknown", "not_recorded");
    const role = findRoleForIdentity(game, command.identityId);
    if (role !== "Player 1" && role !== "Player 2") return reject("role_not_allowed");
    if (command.kind === "shared") {
      const operation = command.payload.operation;
      const values = command.payload.values;
      if (!SHARED_OPERATIONS.includes(operation as typeof SHARED_OPERATIONS[number]) || !values || typeof values !== "object" || Array.isArray(values)) return reject("invalid_shared_operation");
      this.sharedCommand=command;this.sharedReceipt=null;
      try {
        const response=await this.fetchQueued(new Request(`https://game-room/${operation}`,{method:"POST",headers:{"x-game-id":game.id,...(this.env.STORAGE_GENERATION?{[STORAGE_GENERATION_HEADER]:this.env.STORAGE_GENERATION}:{})},body:JSON.stringify({...values,protocolVersion:2,identityId:command.identityId})}));
        const body=await response.json() as Record<string,unknown>;
        if(!response.ok || body.ok===false) return await reject(String(body.error??"operation_rejected"));
        if(!this.sharedReceipt) await this.persistCandidate(clone(this.game!),null);
        return this.sharedReceipt!;
      } catch(error) {
        if(error instanceof StorageWriteLimitError)return await reject("state_capacity_exceeded");
        throw error;
      } finally {this.sharedCommand=null;this.sharedReceipt=null;}
    }
    const ownerSeat = command.kind === "end_turn" ? getActiveTurn(game)?.playerSeat : getSideToMoveSeat(game);
    if (!ownerSeat || getSeatIdentity(game, ownerSeat) !== command.identityId) return reject("not_your_turn");
    const payload = command.payload;
    if (game.computer) {
      const error = computerCommandError(game.computer, { ownerId: command.identityId, authContextId: this.requestAuthority?.contextId ?? '', side: ownerSeat === "Player 1" ? "P1" : "P2", turnIndex: getActiveTurn(game)?.index ?? game.board.state.turnIndex ?? 0, proof: payload.computer, now: Date.now() });
      if (error) return reject(error);
      if (payload.computer && command.kind !== 'action') return reject('invalid_computer_action');
      if (payload.computer) {
        const proof = payload.computer as ComputerProof;
        const attempt = await readAttempt(this.env, game.id, command.identityId, proof.attemptId, 'computer');
        if (!attempt || canonicalCommandJson(attempt.proof) !== canonicalCommandJson(proof) || attempt.gameplayRevision !== game.gameplayRevision
          || attempt.fingerprint !== deterministicStateHash(game.board.state) || attempt.outcome !== 'ready'
          || canonicalCommandJson(attempt.result?.action) !== canonicalCommandJson(payload.action)) return reject('invalid_computer_evidence');
      }
    } else if (payload.computer !== undefined) return reject('not_computer_game');
    let result;
    if (command.kind === "end_turn") result = endServerTurn(game, command.clientCommandId);
    else if (command.kind === "move") result = applyServerMove(game, typeof payload.notation === "string" ? payload.notation : undefined, command.clientCommandId);
    else {
      const action = asAction(payload.action);
      if (!action) return reject("invalid_action");
      result = applyServerActionWithExpectedState(game, action, asGameState(command.expectedState), typeof payload.notation === "string" ? payload.notation : undefined, command.clientCommandId);
    }
    if (!result.ok) return reject(result.error);
    if (payload.computer && game.moves.length) game.moves[game.moves.length - 1].computerProof = clone(payload.computer as ComputerProof);
    if (game.computer?.singleStep && payload.computer) { game.computer.paused = true; game.computer.singleStep = false; game.computer.generation++; }
    if (game.computer?.takeoverTurn !== null && game.computer?.takeoverTurn !== undefined && game.computer.takeoverTurn !== getActiveTurn(game)?.index) { game.computer.takeoverTurn = null; game.computer.generation++; }
    const accepted = { ...outcome("accepted", null, this.eventSeq + 1, game.gameplayRevision + 1), result: {
      ...("turn" in result ? { turn: result.turn } : {}),
      ...("removedPieces" in result ? { removedPieces: result.removedPieces } : {}),
      ...("destroyedPieces" in result ? { destroyedPieces: result.destroyedPieces } : {}),
    } } as CommandReceipt;
    const event: EventAppendedEvent = { type: "event_appended", reason: command.kind === "end_turn" ? "turn_ended" : "move_recorded", eventSeq: this.eventSeq + 1, clientCommandId: command.clientCommandId, game: clone(game) };
    try { await this.persistCandidate(game, event, accepted); }
    catch(error) {
      // Encoding limits are checked before DB.batch. The unchanged authoritative
      // game can record a durable rejection. Unknown writes never take this path.
      if(error instanceof StorageWriteLimitError)return reject("state_capacity_exceeded");
      throw error;
    }
    this.scheduleBroadcast(event);
    return accepted;
  }

  private scheduleRestoreStep(gameId:string,remaining:number) {
    this.scheduleStorageStep(gameId,remaining,"restore");
  }

  private scheduleStorageStep(gameId:string,remaining:number,kind:"restore"|"archive") {
    const limit=kind==="restore"?STORAGE_POLICY.restoreDrainSteps:STORAGE_POLICY.archiveDrainSteps;
    if(!Number.isSafeInteger(remaining) || remaining<=0 || remaining>limit)return;
    const rooms=(this.env as LiveGameEnv & {GAME_ROOMS?:{idFromName:(name:string)=>unknown;get:(id:unknown)=>{fetch:(request:Request)=>Promise<Response>}}}).GAME_ROOMS;
    if(!rooms || !this.state.waitUntil)return;
    // Separate serialized invocations keep each chunk inside provider limits.
    // Errors stop this chain; the next sweep resumes its durable cursor.
    this.state.waitUntil(rooms.get(rooms.idFromName(storageRoomName(this.env,gameId))).fetch(new Request("https://game-room/_storage/tick",{method:"POST",headers:{"x-game-id":gameId,[`x-storage-${kind}-steps`]:String(remaining-1),...(this.env.STORAGE_GENERATION?{[STORAGE_GENERATION_HEADER]:this.env.STORAGE_GENERATION}:{})}})).then(async response=>{if(!response.ok)console.warn(JSON.stringify({event:"storage_continuation_deferred",kind,status:response.status}));await response.body?.cancel();}).catch(()=>{console.warn(JSON.stringify({event:"storage_continuation_deferred",kind}));}));
  }

  private async persistCandidate(game: LiveGame, event: (ServerEvent & { eventSeq: number }) | null, receipt?: CommandReceipt, systemPresence = false, additionalStatements: D1Statement[] = [], presenceIdentity?:string) {
    this.env = await withCutoverPolicy(this.env);
    if (authActive(this.env) && (this.env.AUTH_ENABLED !== "true" || !maintenanceAllowed(this.env,this.requestAuthority?.accountId))) throw new AuthProblem("temporarily_unavailable",503);
    const permit = cutoverWritePermit(this.env,game.id,this.requestAuthority,systemPresence);
    if (!authActive(this.env) && game.ownershipMode === "account_v1") throw new AuthProblem("temporarily_unavailable", 503);
    if (authActive(this.env) && !this.requestAuthority && !systemPresence) throw new AuthProblem("invalid_credentials", 401);
    const archived=await archiveRow(this.env,game.id);
    if(archived && archived.status!=="archiving" && (systemPresence || ["/history","/live"].includes(this.requestOperation))) {
      const actor=presenceIdentity ?? this.requestAuthority?.accountId ?? this.requestIdentity;
      if(actor){
        try {
          this.eventSeq=await saveArchivedView(this.env,archived,game,actor,{before:[...permit.before as D1Statement[],...(this.requestAuthority && authActive(this.env)?gameGuardStatements(this.env,this.requestAuthority) as D1Statement[]:[])],after:permit.after as D1Statement[]});
          this.game=clone(game);return;
        } catch(error) {
          this.needsDurableReload=true;
          if(String(error).includes("storage_capacity"))throw new AuthProblem("storage_capacity",503);
          throw error;
        }
      }
    }
    if(archived){
      if(archived.status==="archiving")this.applyCurrentPresence(game);
      if(!await restoreArchiveStep(this.env,archived)){this.scheduleRestoreStep(game.id,STORAGE_POLICY.restoreDrainSteps);throw new AuthProblem("storage_restoring",503);}
      this.needsDurableReload=true;
      const projection=await loadGameProjection(this.env,game.id);
      if(projection?.kind!=="ok")throw new AuthProblem("archive_unavailable",503);
      this.game=projection.game;this.eventSeq=projection.eventSeq;this.needsDurableReload=false;
    }
    const started = Date.now();
    const base = this.eventSeq;
    const gameplay = (value: LiveGame | null) => value ? JSON.stringify([value.board, value.moves, value.turns]) : null;
    const gameplayChanged = Boolean(this.game && gameplay(this.game) !== gameplay(game));
    game.gameplayRevision = (this.game?.gameplayRevision ?? 0) + (gameplayChanged ? 1 : 0);
    // A rejection records evidence only. Preserve the already durable payload,
    // including saves written before a capacity setting was rolled back.
    const metadataOnly = Boolean(this.game && !gameplayChanged);
    const preservePayload = receipt?.outcome === "rejected" && JSON.stringify(game) === JSON.stringify(this.game);
    if (!receipt && this.sharedCommand) {
      const command=this.sharedCommand;
      receipt={gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:"accepted",reason:null,eventSeq:base+1,gameplayRevision:game.gameplayRevision};
    }
    const archive = preservePayload || (metadataOnly && game.archiveStartRevision !== undefined) ? [] : archiveStatements(this.env, this.game, game, base + 1);
    event ??= { type: "state_sync", eventSeq: base + 1, reason: "projection_updated", game: clone(game) };
    if ("game" in event) event.game = clone(game);
    if (receipt) {
      if (receipt.eventSeq !== base + 1 || receipt.gameplayRevision !== game.gameplayRevision) throw new Error("receipt_revision_mismatch");
      Object.assign(event, { commandOutcome: receipt });
    }
    try {
      await persistGameState(this.env, game, base + 1, event, { metadataOnly, preservePayload, baseEventSeq: base, invitesChanged: !this.game || JSON.stringify(this.game.inviteTokens) !== JSON.stringify(game.inviteTokens), activityChanged: !systemPresence && (!this.game || game.gameplayRevision !== this.game.gameplayRevision || Boolean(event && ["join_request_created", "join_request_resolved"].includes(event.type)) || Boolean(event && "reason" in event && /revert|seat|play_as|player_joined/.test(event.reason))), before: permit.before as D1Statement[], after: permit.after as D1Statement[], statements: [...archive, ...additionalStatements, ...(this.requestAuthority && authActive(this.env) ? gameGuardStatements(this.env, this.requestAuthority) as D1Statement[] : []), ...(receipt ? [commandReceiptStatement(this.env, receipt)] : [])] });
    } catch (error) {
      // A rejected batch response may follow a durable commit. Force a durable read
      // before any next mutation; never retain or acknowledge the speculative candidate.
      this.needsDurableReload = true;
      this.game = null;
      this.eventSeq = 0;
      try { await this.ensureLoaded(); this.needsDurableReload = false; } catch { /* Retry durable read before the next mutation. */ }
      this.env = await withCutoverPolicy(this.env);
      if (String(error).includes("storage_capacity")) throw new AuthProblem("storage_capacity",503);
      if (authActive(this.env) && !this.requestAuthority && !systemPresence) throw new AuthProblem("upgrade_required", 426);
      if (authActive(this.env) && this.requestAuthority && !await currentGameAuthority(this.env, this.requestAuthority)) throw new AuthProblem("session_changed", 409);
      throw error;
    }
    this.game = clone(game);
    this.eventSeq = base + 1;
    if (this.sharedCommand && receipt) this.sharedReceipt=receipt;
    this.logDiagnostic("info", "live_server_commit_completed", { commandId: receipt?.clientCommandId ?? null, databaseMs: Date.now() - started, gameplayRevision: game.gameplayRevision });
  }

  private scheduleBroadcast(event: ServerEvent, excludedSocket?: WebSocket) {
    const captured = clone(event);
    const env = this.env;
    const requestId = this.requestId;
    this.deliveryTail = this.deliveryTail.then(() => this.broadcast(captured, excludedSocket, env, requestId)).catch(error => {
      this.logDiagnostic("error", "live_server_delivery_failed", { error: String(error), deliveryEventSeq: "eventSeq" in captured ? captured.eventSeq : null });
    });
    this.state.waitUntil?.(this.deliveryTail);
  }

  private async broadcast(event: ServerEvent, excludedSocket?: WebSocket, capturedEnv = this.env, requestId = this.requestId) {
    const started = Date.now();
    const env = await withCutoverPolicy(capturedEnv);
    const enriched = authActive(env) ? await enrichAccountNames(event as unknown as Record<string, unknown>, env.DB as unknown as AuthDatabase) as unknown as ServerEvent : event;
    for (const session of this.sessions.values()) {
      if (session.socket === excludedSocket) continue;
      await this.send(session.socket, eventForSession(enriched, session.identityId), env, true);
    }
    this.logDiagnostic("info", "live_server_delivery_completed", { requestId, durationMs: Date.now() - started, deliveryEventSeq: "eventSeq" in event ? event.eventSeq : null });
  }

  private async send(socket: WebSocket, payload: ServerEvent, preparedEnv?: LiveGameEnv, namesPrepared = false) {
    const env = preparedEnv ?? await withCutoverPolicy(this.env);
    const session = this.sessions.get(socket);
    if (authActive(env)) {
      if (!namesPrepared) payload = await enrichAccountNames(payload as unknown as Record<string, unknown>, env.DB as unknown as AuthDatabase) as unknown as ServerEvent;
      if (!session || !await this.authorizeSocket(session, env)) return;
      payload = sanitizeGameResponse(payload as unknown as Record<string, unknown>, session.authority ?? null, !maintenanceAllowed(env,session.authority?.accountId)) as unknown as ServerEvent;
    }
    try {
      const projected = session?.compactHistory ? compactHistoryResponse(payload as unknown as Record<string,unknown>) : payload;
      socket.send(JSON.stringify({ ...projected, ...(env.STORAGE_GENERATION ? { storageGeneration: env.STORAGE_GENERATION } : {}), ...(authActive(env) ? { authProtocolVersion: AUTH_PROTOCOL_VERSION } : {}), protocolVersion: 2, gameId: this.getLoadedGameId() }));
    } catch {
      const session = this.sessions.get(socket);
      this.sessions.delete(socket);
      if (session) {
        void this.enqueue(async () => {
          await this.setPresenceFromSessions(session.identityId);
          await this.syncSessionAlarm();
        }).catch((error) => this.logDiagnostic("error", "live_server_presence_cleanup_failed", { error: String(error) }));
      }
      this.logDiagnostic("warn", "live_server_socket_send_failed", { payloadType: payload.type });
    }
  }

  private closeUnauthorizedSocket(socket: WebSocket) {
    const removed = this.sessions.get(socket);
    this.sessions.delete(socket);
    if (removed) {
      // Never await our own queue from a send already executing within it.
      void this.enqueue(async () => {
        this.requestAuthority = null;
        await this.setPresenceFromSessions(removed.identityId);
        await this.syncSessionAlarm();
      }).catch(() => {});
    }
    try { socket.close(4001, 'session_changed'); } catch {}
  }

  private async authorizeSocket(session: SessionRecord, env = this.env): Promise<boolean> {
    if (session.authVersion !== AUTH_PROTOCOL_VERSION) { this.closeUnauthorizedSocket(session.socket); return false; }
    if (!session.authority) return true;
    try { if (await currentGameAuthority(env, session.authority)) return true; } catch {}
    this.closeUnauthorizedSocket(session.socket);
    return false;
  }

  private async recheckSockets() {
    const removed = new Set<string>();
    for (const session of [...this.sessions.values()]) if (!await this.authorizeSocket(session)) removed.add(session.identityId);
    for (const identityId of removed) await this.setPresenceFromSessions(identityId);
    await this.syncSessionAlarm();
  }

  private restoreSessionsFromState() {
    const sockets = this.state.getWebSockets?.() ?? [];
    for (const socket of sockets) {
      const session = this.readSessionAttachment(socket as HibernationWebSocket);
      if (!session) {
        continue;
      }
      this.sessions.set(socket, session);
      this.requestedGameId ??= session.gameId;
    }
  }

  private configureWebSocketAutoResponse() {
    const pairCtor = (globalThis as any).WebSocketRequestResponsePair;
    if (!pairCtor || typeof this.state.setWebSocketAutoResponse !== "function") {
      return;
    }
    try {
      this.state.setWebSocketAutoResponse(new pairCtor("ping", "pong"));
    } catch {
      // ignore runtimes that expose a partial API surface
    }
  }

  private readSessionAttachment(socket: HibernationWebSocket): SessionRecord | null {
    const attachment = socket.deserializeAttachment?.();
    if (!attachment || typeof attachment !== "object") {
      return null;
    }
    const candidate = attachment as Partial<SessionAttachment>;
    if (!authActive(this.env) && candidate.authVersion === AUTH_PROTOCOL_VERSION) {
      try { socket.close(4001, "session_changed"); } catch {}
      return null;
    }
    if (authActive(this.env) && (candidate.authVersion !== AUTH_PROTOCOL_VERSION || (candidate.authority !== null && (!candidate.authority || typeof candidate.authority.tokenHash !== 'string' || typeof candidate.authority.contextId !== 'string' || candidate.authority.accountId !== candidate.identityId)))) {
      try { socket.close(4001, 'session_changed'); } catch {}
      return null;
    }
    if (
      typeof candidate.gameId !== "string" ||
      typeof candidate.sessionId !== "string" ||
      typeof candidate.identityId !== "string" ||
      typeof candidate.lastEventSeq !== "number" ||
      typeof candidate.lastSeenAt !== "number" ||
      (candidate.status !== "active" && candidate.status !== "inactive" && candidate.status !== "disconnecting")
    ) {
      return null;
    }
    return {
      socket,
      compactHistory: candidate.compactHistory === true,
      authVersion: candidate.authVersion,
      authority: candidate.authority,
      gameId: candidate.gameId,
      sessionId: candidate.sessionId,
      identityId: candidate.identityId,
      lastEventSeq: candidate.lastEventSeq,
      lastSeenAt: candidate.lastSeenAt,
      status: candidate.status,
    };
  }

  private persistSessionAttachment(socket: HibernationWebSocket, session: SessionRecord) {
    socket.serializeAttachment?.({
      ...(session.authVersion ? { authVersion: session.authVersion, authority: session.authority ?? null } : {}),
      compactHistory: session.compactHistory === true,
      gameId: session.gameId,
      sessionId: session.sessionId,
      identityId: session.identityId,
      lastEventSeq: session.lastEventSeq,
      lastSeenAt: session.lastSeenAt,
      status: session.status,
    });
  }

  private async reconcileAllPresenceFromSessions() {
    if (authActive(this.env)) await this.recheckSockets();
    const identities = new Set<string>();
    for (const session of this.sessions.values()) {
      identities.add(session.identityId);
    }
    for (const identityId of identities) {
      await this.setPresenceFromSessions(identityId);
    }
  }

  private async syncSessionAlarm() {
    const storage = this.state.storage;
    if (!storage?.setAlarm || !storage.deleteAlarm) {
      return;
    }
    let nextExpiryAt: number | null = null;
    for (const session of this.sessions.values()) {
      if (session.status !== "active") {
        continue;
      }
      const candidate = session.lastSeenAt + HEARTBEAT_TIMEOUT_MS;
      if (nextExpiryAt === null || candidate < nextExpiryAt) {
        nextExpiryAt = candidate;
      }
    }
    if (nextExpiryAt === null) {
      await storage.deleteAlarm();
      return;
    }
    await storage.setAlarm(nextExpiryAt);
  }
}
