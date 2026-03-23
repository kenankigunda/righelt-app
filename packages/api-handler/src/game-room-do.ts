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
  applyServerAction,
  applyServerMove,
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
  resolveLaunchParticipantCopyMode,
  reconcileGameToScenarioResultingState,
  getSeatIdentity,
  getSeatForSide,
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

const HEARTBEAT_TIMEOUT_MS = 35_000;

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
};

type SessionRecord = {
  socket: WebSocket;
  identityId: string;
  lastEventSeq: number;
  lastHeartbeatAt: number;
};

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseCommandMetadata = (body: Record<string, unknown>): CommandMetadata => ({
  clientCommandId: typeof body.clientCommandId === "string" && body.clientCommandId ? body.clientCommandId : null,
});

const parseLaunchParticipantCopyMode = (value: unknown): LaunchParticipantCopyMode | null =>
  value === "copy_source_participants" || value === "viewer_as_player1" ? value : null;

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
  private heartbeatSweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state: DurableObjectStateLike, env: LiveGameEnv) {
    this.state = state;
    this.env = env;
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
        playgroundMode: body.playgroundMode === true,
        offlineLocal: body.offlineLocal === true,
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
        playgroundMode: body.playgroundMode === true,
        offlineLocal: body.offlineLocal === true,
      });
      const sourceGame = body.sourceGame && typeof body.sourceGame === "object" ? (body.sourceGame as LiveGame) : null;
      if (sourceGame) {
        const participantCopyMode =
          parseLaunchParticipantCopyMode(body.participantCopyMode) ?? resolveLaunchParticipantCopyMode(sourceGame, identityId);
        applyLaunchParticipantCopyMode(sourceGame, this.game, identityId, participantCopyMode);
      }
      applyScenarioToGame(this.game, scenario);
      if (body.preserveResultingState === true) {
        reconcileGameToScenarioResultingState(this.game, scenario);
      } else {
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

      if (game.playgroundMode) {
        return json({ ok: false, error: "playground_player_join_disabled" }, 409);
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

    if (request.method === "POST" && path === "/moves") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return json({ ok: false, error: "role_not_allowed" }, 403);
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
      const moved = applyServerAction(game, action, notation, commandMetadata.clientCommandId);
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
      if (game.player1?.identityId !== identityId) {
        return json({ ok: false, error: "not_player1" }, 409);
      }
      if (game.player2) {
        return json({ ok: false, error: "player2_already_joined" }, 409);
      }
      promoteIdentityToSeat(game, "Player 2", identityId, this.getSessionCount(identityId));
      game.playgroundMode = true;
      game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.requestedSeat !== "Player 2");
      addNotification(game, "Play as both players enabled");
      await this.commit({
        type: "event_appended",
        reason: "play_as_both_players",
        game,
      });
      return json({ ok: true, game: withViewModel(game, identityId), eventSeq: this.eventSeq });
    }

    if (request.method === "POST" && path === "/go-online") {
      if (body.confirmed !== true) {
        return json({ ok: false, error: "confirmation_required" }, 409);
      }
      game.offlineLocal = false;
      game.updatedAt = now();
      addNotification(game, "Game moved online");
      await this.commit({
        type: "event_appended",
        reason: "game_moved_online",
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
    if (!identityId) {
      return new Response("Invalid identity", { status: 400 });
    }
    const loaded = await this.ensureLoaded();
    if (!loaded) {
      return new Response("Game not found", { status: 404 });
    }
    const game = loaded;
    const lastEventSeq = Number.parseInt(url.searchParams.get("lastEventSeq") || "0", 10) || 0;
    const socketPair = new wsCtor();
    const client = socketPair[0];
    const server = socketPair[1];
    server.accept();

    const session: SessionRecord = {
      socket: server,
      identityId,
      lastEventSeq,
      lastHeartbeatAt: Date.now(),
    };
    this.sessions.set(server, session);
    this.startHeartbeatSweep();
    await this.setPresenceFromSessions(identityId);

    const replayEvents = lastEventSeq > 0 ? await loadEventsAfter(this.env, game.id, lastEventSeq) : [];
    if (
      replayEvents.length > 0 &&
      "eventSeq" in replayEvents[0] &&
      (replayEvents[0] as { eventSeq: number }).eventSeq === lastEventSeq + 1 &&
      (replayEvents[replayEvents.length - 1] as { eventSeq: number }).eventSeq === this.eventSeq
    ) {
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
    }

    server.addEventListener("message", async (event: MessageEvent) => {
      const text = typeof event.data === "string" ? event.data : "";
      let payload: ClientSocketMessage | null = null;
      try {
        payload = JSON.parse(text) as ClientSocketMessage;
      } catch {
        payload = null;
      }
      if (!payload) {
        return;
      }
      if (payload.type === "heartbeat") {
        const current = this.sessions.get(server);
        if (!current) {
          return;
        }
        current.lastHeartbeatAt = Date.now();
        current.lastEventSeq = payload.lastEventSeq;
        await this.setPresenceFromSessions(payload.identityId);
      }
      if (payload.type === "ack") {
        const current = this.sessions.get(server);
        if (!current) {
          return;
        }
        current.lastEventSeq = payload.lastEventSeq;
      }
    });

    server.addEventListener("close", async () => {
      this.sessions.delete(server);
      await this.setPresenceFromSessions(identityId);
      if (this.sessions.size === 0 && this.heartbeatSweepTimer) {
        clearTimeout(this.heartbeatSweepTimer);
        this.heartbeatSweepTimer = null;
      }
    });

    return new Response(null, { status: 101, webSocket: client } as any);
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
    return this.game?.id ?? this.requestedGameId;
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
      if (session.identityId === identityId) {
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
      await persistGameState(this.env, game, this.eventSeq, null);
      return;
    }
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
      this.sessions.delete(socket);
    }
  }

  private startHeartbeatSweep() {
    if (this.heartbeatSweepTimer) {
      return;
    }
    const tick = async () => {
      this.heartbeatSweepTimer = null;
      const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
      const expired: string[] = [];
      for (const [socket, session] of this.sessions.entries()) {
        if (session.lastHeartbeatAt < cutoff) {
          expired.push(session.identityId);
          this.sessions.delete(socket);
          try {
            socket.close();
          } catch {
            // ignore
          }
        }
      }
      for (const identityId of new Set(expired)) {
        await this.setPresenceFromSessions(identityId);
      }
      if (this.sessions.size > 0) {
        this.heartbeatSweepTimer = setTimeout(() => {
          void tick();
        }, 5_000);
      }
    };
    this.heartbeatSweepTimer = setTimeout(() => {
      void tick();
    }, 5_000);
  }
}
