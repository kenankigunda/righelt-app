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
import { loadEventsAfter, loadGameProjection, persistGameState, type LiveGameEnv } from "./shell-live-db";
import type { CommandMetadata } from "./shell-command-metadata";

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
  gameId: string;
  sessionId: string;
  identityId: string;
  lastEventSeq: number;
  lastSeenAt: number;
  status: SessionStatus;
};

type SessionRecord = {
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

const parseCommandMetadata = (body: Record<string, unknown>): CommandMetadata => ({
  clientCommandId: typeof body.clientCommandId === "string" && body.clientCommandId ? body.clientCommandId : null,
});

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

const eventForSession = (event: ServerEvent, identityId: string) => {
  if (!("game" in event)) {
    return event;
  }
  return {
    ...event,
    game: withViewModel(event.game as LiveGame, identityId),
  };
};

export class GameRoomDO {
  private readonly state: DurableObjectStateLike;
  private readonly env: LiveGameEnv;
  private game: LiveGame | null = null;
  private requestedGameId: string | null = null;
  private eventSeq = 0;
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
        ...payload,
      }),
    );
  }

  constructor(state: DurableObjectStateLike, env: LiveGameEnv) {
    this.state = state;
    this.env = env;
    this.restoreSessionsFromState();
    this.configureWebSocketAutoResponse();
    void this.state.blockConcurrencyWhile?.(async () => {
      await this.reconcileAllPresenceFromSessions();
      await this.syncSessionAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const headerGameId = asIdentity(request.headers.get("x-game-id"));
    if (headerGameId) {
      this.requestedGameId = headerGameId;
    }

    if (request.method === "GET" && path === "/ws") {
      return this.handleWebSocket(url);
    }

    if (request.method === "POST" && path === "/create") {
      const body = await parseBody(request);
      const identityId = asIdentity(body.identityId);
      const gameId = asIdentity(body.gameId);
      if (!identityId || !gameId) {
        return json({ ok: false, error: "invalid_identity" }, 400);
      }
      this.game = createInitialGame({
        gameId,
        identityId,
        selfPlayMode: body.selfPlayMode === true || body.playgroundMode === true,
      });
      this.eventSeq = 1;
      await persistGameState(this.env, this.game, this.eventSeq, null);
      return json({ ok: true, game: withViewModel(this.game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/create-from-scenario") {
      const body = await parseBody(request);
      const identityId = asIdentity(body.identityId);
      const gameId = asIdentity(body.gameId);
      const scenario = asScenarioRecord(body.scenario);
      const hasInitialSelectionAction = typeof body.initialSelectionAction !== "undefined" && body.initialSelectionAction !== null;
      const initialSelectionAction = typeof body.initialSelectionAction === "undefined" ? null : asAction(body.initialSelectionAction);
      if (!identityId || !gameId || !scenario || (hasInitialSelectionAction && !initialSelectionAction)) {
        return json({ ok: false, error: "invalid_scenario_payload" }, 400);
      }
      this.game = createInitialGame({
        gameId,
        identityId,
        selfPlayMode: body.selfPlayMode === true || body.playgroundMode === true,
      });
      const sourceGame = body.sourceGame && typeof body.sourceGame === "object" ? (body.sourceGame as LiveGame) : null;
      const participantCopyMode = sourceGame
        ? parseLaunchParticipantCopyMode(body.participantCopyMode) ?? resolveLaunchParticipantCopyMode(sourceGame, identityId)
        : null;
      if (sourceGame) {
        if (participantCopyMode === "copy_source_participants") {
          applyLaunchParticipantCopyMode(sourceGame, this.game, identityId, participantCopyMode);
        } else {
          this.game.player1 = null;
          this.game.player2 = null;
          this.game.viewers = [];
          this.game.pendingJoinRequests = [];
        }
        this.game.selfPlayMode = body.selfPlayMode === true || body.playgroundMode === true;
      }
      applyScenarioToGame(this.game, scenario);
      if (
        shouldReconcileImportedScenarioResultingState(
          body.preserveResultingState,
          Number(this.game.board.state?.turnIndex ?? 0),
          Number(scenario.resultingState?.turnIndex ?? 0),
        )
      ) {
        reconcileGameToScenarioResultingState(this.game, scenario);
      }
      if (sourceGame && participantCopyMode && participantCopyMode !== "copy_source_participants") {
        applyLaunchParticipantCopyMode(sourceGame, this.game, identityId, participantCopyMode);
      } else if (participantCopyMode !== "copy_source_participants") {
        assignIdentityToScenarioSeat(this.game, identityId, getSeatForSide(this.game.board.state.sideToMove));
      }
      this.game.initialSelectionAction = initialSelectionAction ? clone(initialSelectionAction) : null;
      this.eventSeq = 1;
      await persistGameState(this.env, this.game, this.eventSeq, null);
      return json({ ok: true, game: withViewModel(this.game, identityId), eventSeq: this.eventSeq });
    }

    const body = await parseBody(request);
    const commandMetadata = parseCommandMetadata(body);
    const identityId = asIdentity(body.identityId);
    if (!identityId) {
      return json({ ok: false, error: "invalid_identity" }, 400);
    }

    const loaded = await this.ensureLoaded();
    if (!loaded) {
      return json({ ok: false, error: "game_not_found" }, 404);
    }
    const game = loaded;

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
      const targetMove = game.moves.find((move) => move.moveId === targetMoveId);
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
        const reverted = applyRevertToMove(game, targetMoveId, identityId);
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
      const reverted = applyRevertToMove(game, pendingRevertRequest.targetMoveId, pendingRevertRequest.requesterIdentityId);
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

    if (request.method === "POST" && path === "/moves") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return json({ ok: false, error: "role_not_allowed" }, 403);
      }
      if (commandMetadata.clientCommandId) {
        const existingMove = game.moves.find(
          (entry) => entry.undone !== true && entry.clientCommandId === commandMetadata.clientCommandId,
        );
        if (existingMove) {
          return json({
            ok: true,
            move: existingMove,
            clientCommandId: commandMetadata.clientCommandId,
            game: withViewModel(game, identityId),
            eventSeq: this.eventSeq,
            duplicate: true,
          });
        }
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return json({ ok: false, error: "not_your_turn" }, 409);
      }
      const notation = typeof body.notation === "string" ? body.notation : undefined;
      const moved = applyServerMove(game, notation, commandMetadata.clientCommandId);
      if (!moved.ok) {
        return json({ ok: false, error: moved.error }, 409);
      }
      if (moved.duplicate) {
        return json({
          ok: true,
          move: moved.move,
          clientCommandId: commandMetadata.clientCommandId,
          game: withViewModel(game, identityId),
          eventSeq: this.eventSeq,
          duplicate: true,
        });
      }
      await this.commit({
        type: "event_appended",
        reason: "move_recorded",
        clientCommandId: commandMetadata.clientCommandId,
        game,
      });
      return json({
        ok: true,
        move: moved.move,
        clientCommandId: commandMetadata.clientCommandId,
        game: withViewModel(game, identityId),
        eventSeq: this.eventSeq,
      });
    }

    if (request.method === "POST" && path === "/apply") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return json({ ok: false, error: "role_not_allowed" }, 403);
      }
      if (commandMetadata.clientCommandId) {
        const existingMove = game.moves.find(
          (entry) => entry.undone !== true && entry.clientCommandId === commandMetadata.clientCommandId,
        );
        if (existingMove) {
          return json({
            ok: true,
            accepted: true,
            move: existingMove,
            clientCommandId: commandMetadata.clientCommandId,
            state: existingMove.snapshot,
            removedPieces: [],
            destroyedPieces: existingMove.destroyedPieces ?? [],
            game: withViewModel(game, identityId),
            eventSeq: this.eventSeq,
            duplicate: true,
          });
        }
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return json({ ok: false, error: "not_your_turn" }, 409);
      }
      const bodyState = asGameState(body.state);
      const action = asAction(body.action);
      if (!bodyState) {
        return json({ ok: false, error: "invalid_state" }, 400);
      }
      if (!action) {
        return json({ ok: false, error: "invalid_action" }, 400);
      }
      const notation = typeof body.notation === "string" ? body.notation : undefined;
      const moved = applyServerActionWithExpectedState(game, action, bodyState, notation, commandMetadata.clientCommandId);
      if (!moved.ok) {
        if (moved.validation && moved.state) {
          return json({
            ok: true,
            accepted: false,
            clientCommandId: commandMetadata.clientCommandId,
            validation: moved.validation,
            state: moved.state,
            legalActions: listLegalActions(moved.state),
            game: withViewModel(game, identityId),
            eventSeq: this.eventSeq,
          });
        }
        return json({ ok: false, error: moved.error }, 409);
      }
      if (moved.duplicate) {
        return json({
          ok: true,
          accepted: true,
          move: moved.move,
          clientCommandId: commandMetadata.clientCommandId,
          state: moved.state,
          removedPieces: moved.removedPieces,
          destroyedPieces: moved.destroyedPieces ?? [],
          game: withViewModel(game, identityId),
          eventSeq: this.eventSeq,
          duplicate: true,
        });
      }
      await this.commit({
        type: "event_appended",
        reason: "move_recorded",
        clientCommandId: commandMetadata.clientCommandId,
        game,
      });
      return json({
        ok: true,
        accepted: true,
        move: moved.move,
        clientCommandId: commandMetadata.clientCommandId,
        state: moved.state,
        removedPieces: moved.removedPieces,
        destroyedPieces: moved.destroyedPieces ?? [],
        game: withViewModel(game, identityId),
        eventSeq: this.eventSeq,
      });
    }

    if (request.method === "POST" && path === "/end-turn") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return json({ ok: false, error: "role_not_allowed" }, 403);
      }
      const activeTurn = getActiveTurn(game);
      if (!activeTurn) {
        return json({ ok: false, error: "turn_not_initialized" }, 409);
      }
      if (commandMetadata.clientCommandId) {
        const duplicateEvents = await loadEventsAfter(this.env, game.id, 0);
        const duplicateTurnEnd = duplicateEvents.find(
          (event) =>
            event.type === "event_appended" &&
            event.reason === "turn_ended" &&
            event.clientCommandId === commandMetadata.clientCommandId,
        );
        if (duplicateTurnEnd) {
          const completedTurn = game.turns.length > 1 ? clone(game.turns[game.turns.length - 2]) : null;
          return json({
            ok: true,
            turn: completedTurn,
            clientCommandId: commandMetadata.clientCommandId,
            game: withViewModel(game, identityId),
            eventSeq: this.eventSeq,
            duplicate: true,
          });
        }
      }
      const turnOwnerIdentity = getSeatIdentity(game, activeTurn.playerSeat);
      if (!turnOwnerIdentity || turnOwnerIdentity !== identityId) {
        return json({ ok: false, error: "not_your_turn" }, 409);
      }
      const ended = endServerTurn(game);
      if (!ended.ok) {
        return json({ ok: false, error: ended.error }, 409);
      }
      await this.commit({
        type: "event_appended",
        reason: "turn_ended",
        clientCommandId: commandMetadata.clientCommandId,
        game,
      });
      return json({
        ok: true,
        turn: ended.turn,
        clientCommandId: commandMetadata.clientCommandId,
        game: withViewModel(game, identityId),
        eventSeq: this.eventSeq,
      });
    }

    if (request.method === "POST" && path === "/history") {
      const moveIndex = typeof body.moveIndex === "number" ? body.moveIndex : -1;
      if (moveIndex < 0 || moveIndex >= game.moves.length) {
        return json({ ok: false, error: "invalid_move_index" }, 400);
      }
      game.historyIndexByIdentity[identityId] = moveIndex;
      await persistGameState(this.env, game, this.eventSeq, null);
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/live") {
      delete game.historyIndexByIdentity[identityId];
      await persistGameState(this.env, game, this.eventSeq, null);
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
      if (game.moves.length > 0) {
        return json({ ok: false, error: "scenario_target_not_empty" }, 409);
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
    const identityId = asIdentity(url.searchParams.get("identityId"));
    const sessionId = asIdentity(url.searchParams.get("sessionId"));
    if (!identityId) {
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
    this.requestedGameId = game.id;
    const lastEventSeq = Number.parseInt(url.searchParams.get("lastEventSeq") || "0", 10) || 0;
    const socketPair = new wsCtor();
    const client = socketPair[0];
    const server = socketPair[1] as HibernationWebSocket;
    if (typeof this.state.acceptWebSocket !== "function") {
      return new Response("WebSocket hibernation not supported in this runtime", { status: 426 });
    }
    this.state.acceptWebSocket(server);

    const session: SessionRecord = {
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
    await this.setPresenceFromSessions(identityId);
    await this.syncSessionAlarm();

    const replayEvents = lastEventSeq > 0 ? await loadEventsAfter(this.env, game.id, lastEventSeq) : [];
    if (
      replayEvents.length > 0 &&
      "eventSeq" in replayEvents[0] &&
      (replayEvents[0] as { eventSeq: number }).eventSeq === lastEventSeq + 1 &&
      (replayEvents[replayEvents.length - 1] as { eventSeq: number }).eventSeq === this.eventSeq
    ) {
      this.logDiagnostic(
        "info",
        "live_server_ws_replay_sent",
        { identityId, lastEventSeq, replayCount: replayEvents.length },
        true,
      );
      for (const event of replayEvents) {
        this.send(server, eventForSession(event, identityId));
      }
    } else {
      const syncEvent: StateSyncEvent = {
        type: "state_sync",
        eventSeq: this.eventSeq,
        reason: replayEvents.length > 0 ? "replay_unavailable" : "connected",
        game: clone(game),
      };
      this.send(server, eventForSession(syncEvent, identityId));
      this.logDiagnostic(
        "info",
        "live_server_ws_state_sync_sent",
        { identityId, lastEventSeq, reason: syncEvent.reason, replayCount: replayEvents.length },
        true,
      );
    }

    return new Response(null, { status: 101, webSocket: client } as any);
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    const text = typeof message === "string" ? message : "";
    let payload: ClientSocketMessage | null = null;
    try {
      payload = JSON.parse(text) as ClientSocketMessage;
    } catch {
      payload = null;
    }
    if (!payload) {
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
  }

  async webSocketClose(socket: WebSocket) {
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
      return this.game;
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
    return this.game;
  }

  private getLoadedGameId() {
    return this.game?.id ?? this.requestedGameId ?? this.state.id?.name ?? null;
  }

  async setGameId(gameId: string) {
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

  private async setPresenceFromSessions(identityId: string) {
    const game = await this.ensureLoaded();
    if (!game) {
      return;
    }
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
    this.eventSeq += 1;
    await persistGameState(this.env, game, this.eventSeq, presenceEvent);
    this.broadcast(presenceEvent);
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

    this.eventSeq += 1;
    await persistGameState(this.env, input.game, this.eventSeq, event);
    this.logDiagnostic("info", "live_server_commit_event", { type: event.type }, true);
    this.broadcast(event);
  }

  private broadcast(event: ServerEvent) {
    for (const session of this.sessions.values()) {
      this.send(session.socket, eventForSession(event, session.identityId));
    }
  }

  private send(socket: WebSocket, payload: ServerEvent) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      const session = this.sessions.get(socket);
      this.sessions.delete(socket);
      if (session) {
        void this.setPresenceFromSessions(session.identityId);
        void this.syncSessionAlarm();
      }
      this.logDiagnostic("warn", "live_server_socket_send_failed", { payloadType: payload.type });
    }
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
      gameId: session.gameId,
      sessionId: session.sessionId,
      identityId: session.identityId,
      lastEventSeq: session.lastEventSeq,
      lastSeenAt: session.lastSeenAt,
      status: session.status,
    });
  }

  private async reconcileAllPresenceFromSessions() {
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
