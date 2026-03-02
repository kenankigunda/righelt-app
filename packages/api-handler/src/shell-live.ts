import { applyAction } from "../../game-engine/src/apply";
import { listLegalActions } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import { createInitialState } from "../../game-engine/src/state";
import type { Action, GameState } from "../../game-engine/src/types";

const MAX_HISTORY = 200;
const PRESENCE_STALE_MS = 30_000;

type Participant = {
  identityId: string;
  connected: boolean;
  joinedAt: string;
  lastSeenAt: string;
};

type Viewer = Participant;

type JoinRequest = {
  identityId: string;
  requestedSeat: "Player 1" | "Player 2";
  requestedAt: string;
  source: "viewer_invite" | "home_list";
};

type MoveEntry = {
  index: number;
  turnIndex: number;
  turnMoveIndex: number;
  at: string;
  notation: string;
  snapshot: GameState;
};

type TurnEntry = {
  index: number;
  startedAt: string;
  endedAt: string | null;
  playerSeat: "Player 1" | "Player 2";
  status: "active" | "complete";
  moveIndexes: number[];
  lastMoveAt: string | null;
};

type ShellGame = {
  id: string;
  createdAt: string;
  lastMoveAt: string | null;
  updatedAt: string;
  playgroundMode: boolean;
  offlineLocal: boolean;
  board: {
    state: GameState;
  };
  player1: Participant | null;
  player2: Participant | null;
  viewers: Viewer[];
  pendingJoinRequests: JoinRequest[];
  turns: TurnEntry[];
  moves: MoveEntry[];
  historyIndex: number | null;
  notifications: string[];
  inviteTokens: {
    viewer: string;
    player1: string;
    player2: string;
  };
};

const games = new Map<string, ShellGame>();
const inviteIndex = new Map<string, { gameId: string; sharedByRole: "Viewer" | "Player 1" | "Player 2" }>();
let seq = 0;
const homeSubscribers = new Set<any>();
const gameSubscribers = new Map<string, Set<any>>();

const now = () => new Date(Date.now()).toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const nextId = () => {
  seq += 1;
  return `game-${seq.toString().padStart(6, "0")}`;
};

const createInviteToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

const createInviteTokens = (gameId: string) => {
  const tokens = {
    viewer: createInviteToken(),
    player1: createInviteToken(),
    player2: createInviteToken(),
  };
  inviteIndex.set(tokens.viewer, { gameId, sharedByRole: "Viewer" });
  inviteIndex.set(tokens.player1, { gameId, sharedByRole: "Player 1" });
  inviteIndex.set(tokens.player2, { gameId, sharedByRole: "Player 2" });
  return tokens;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
};

const isFreshPresence = (participant: Participant | null) => {
  if (!participant) {
    return false;
  }
  const seenAt = participant.lastSeenAt || participant.joinedAt;
  return Date.now() - toTimestamp(seenAt) <= PRESENCE_STALE_MS;
};

const applyPresenceFreshness = (game: ShellGame) => {
  if (game.player1) {
    game.player1.connected = isFreshPresence(game.player1);
  }
  if (game.player2) {
    game.player2.connected = isFreshPresence(game.player2);
  }
  for (const viewer of game.viewers) {
    viewer.connected = isFreshPresence(viewer);
  }
};

const touchIdentityPresence = (game: ShellGame, identityId: string) => {
  const touchedAt = now();
  if (game.player1?.identityId === identityId) {
    game.player1.connected = true;
    game.player1.lastSeenAt = touchedAt;
  }
  if (game.player2?.identityId === identityId) {
    game.player2.connected = true;
    game.player2.lastSeenAt = touchedAt;
  }
  for (const viewer of game.viewers) {
    if (viewer.identityId === identityId) {
      viewer.connected = true;
      viewer.lastSeenAt = touchedAt;
    }
  }
};

const touchIdentityAcrossGames = (identityId: string) => {
  for (const game of games.values()) {
    touchIdentityPresence(game, identityId);
    applyPresenceFreshness(game);
  }
};

const getGameSubscriberSet = (gameId: string) => {
  let set = gameSubscribers.get(gameId);
  if (!set) {
    set = new Set();
    gameSubscribers.set(gameId, set);
  }
  return set;
};

const removeSocketFromAll = (socket: any) => {
  homeSubscribers.delete(socket);
  for (const [gameId, subscribers] of gameSubscribers.entries()) {
    subscribers.delete(socket);
    if (subscribers.size === 0) {
      gameSubscribers.delete(gameId);
    }
  }
};

const sendSocketEvent = (socket: any, payload: Record<string, unknown>) => {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    removeSocketFromAll(socket);
  }
};

const broadcastLiveUpdate = (gameId: string, reason: string) => {
  const payload = {
    type: "game.updated",
    gameId,
    reason,
    at: now(),
  };
  for (const socket of homeSubscribers.values()) {
    sendSocketEvent(socket, payload);
  }
  const subscribers = gameSubscribers.get(gameId);
  if (!subscribers) {
    return;
  }
  for (const socket of subscribers.values()) {
    sendSocketEvent(socket, payload);
  }
};

const findRoleForIdentity = (game: ShellGame, identityId: string): string => {
  if (game.player1?.identityId === identityId) return "Player 1";
  if (game.player2?.identityId === identityId) return "Player 2";
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) return "Viewer";
  return "Guest";
};

const ensureViewer = (game: ShellGame, identityId: string): boolean => {
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) {
    touchIdentityPresence(game, identityId);
    return false;
  }
  const touchedAt = now();
  game.viewers.push({ identityId, connected: true, joinedAt: touchedAt, lastSeenAt: touchedAt });
  return true;
};

const removeViewer = (game: ShellGame, identityId: string) => {
  game.viewers = game.viewers.filter((viewer) => viewer.identityId !== identityId);
};

const promoteIdentityToSeat = (game: ShellGame, seat: "Player 1" | "Player 2", identityId: string) => {
  const existingViewer = game.viewers.find((viewer) => viewer.identityId === identityId) ?? null;
  const joinedAt = existingViewer?.joinedAt ?? now();
  const lastSeenAt = existingViewer?.lastSeenAt ?? joinedAt;
  removeViewer(game, identityId);
  const participant = {
    identityId,
    connected: true,
    joinedAt,
    lastSeenAt,
  };
  if (seat === "Player 1") {
    game.player1 = participant;
    return;
  }
  game.player2 = participant;
};

const getSeatIdentity = (game: ShellGame, seat: "Player 1" | "Player 2"): string | null => {
  if (seat === "Player 1") {
    return game.player1?.identityId ?? null;
  }
  return game.player2?.identityId ?? null;
};

const getApproverIdentityForSeat = (game: ShellGame, seat: "Player 1" | "Player 2"): string | null => {
  if (seat === "Player 1") {
    return game.player2?.identityId ?? null;
  }
  return game.player1?.identityId ?? null;
};

const getSideToMoveSeat = (game: ShellGame): "Player 1" | "Player 2" => (game.board.state.sideToMove === "P1" ? "Player 1" : "Player 2");
const getSeatForSide = (side: GameState["sideToMove"]): "Player 1" | "Player 2" => (side === "P1" ? "Player 1" : "Player 2");
const getNextSeat = (seat: "Player 1" | "Player 2"): "Player 1" | "Player 2" => (seat === "Player 1" ? "Player 2" : "Player 1");
const getSideForSeat = (seat: "Player 1" | "Player 2"): GameState["sideToMove"] => (seat === "Player 1" ? "P1" : "P2");
const getActiveTurn = (game: ShellGame): TurnEntry | null => game.turns[game.turns.length - 1] ?? null;

const getJoinAsPlayerDisabledReason = (game: ShellGame, identityId: string, offline: boolean, myRole: string) => {
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already joined as a player.";
  }
  if (offline || game.offlineLocal) {
    return "Remote joining is unavailable while offline.";
  }
  if (game.playgroundMode) {
    return "Playground mode does not accept remote player joins.";
  }
  if (game.player1 && game.player2) {
    return "Game already has the maximum number of players.";
  }
  if (findRoleForIdentity(game, identityId) === "Viewer") {
    return null;
  }
  return null;
};

const getJoinAsViewerDisabledReason = (game: ShellGame, offline: boolean, myRole: string) => {
  if (myRole === "Viewer") {
    return "You are already joined as a viewer.";
  }
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already in this game.";
  }
  if (offline || game.offlineLocal) {
    return "Remote joining is unavailable while offline.";
  }
  return null;
};

const withViewModel = (game: ShellGame, identityId: string, offline = false) => {
  applyPresenceFreshness(game);
  const myRole = findRoleForIdentity(game, identityId);
  const inHistoryMode = typeof game.historyIndex === "number";
  const currentSnapshot =
    typeof game.historyIndex === "number" && game.moves[game.historyIndex]
      ? game.moves[game.historyIndex].snapshot
      : game.board.state;

  const sideToMoveSeat = getSideToMoveSeat(game);
  const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
  const isPlayer = myRole === "Player 1" || myRole === "Player 2";
  const legalNow = listLegalActions(game.board.state);
  const activeTurn = getActiveTurn(game);
  const approvableRequesterIds = game.pendingJoinRequests
    .filter((request) => getApproverIdentityForSeat(game, request.requestedSeat) === identityId)
    .map((request) => request.identityId);
  const myPendingJoinRequest = game.pendingJoinRequests.find((request) => request.identityId === identityId) ?? null;
  const joinAsPlayerDisabledReason = getJoinAsPlayerDisabledReason(game, identityId, offline, myRole);
  const joinAsViewerDisabledReason = getJoinAsViewerDisabledReason(game, offline, myRole);

  return {
    ...clone(game),
    myRole,
    inHistoryMode,
    currentSnapshot,
    canJoinAsPlayer: !joinAsPlayerDisabledReason,
    canJoinAsViewer: !joinAsViewerDisabledReason,
    joinAsPlayerDisabledReason,
    joinAsViewerDisabledReason,
    canInvite: !offline && !game.offlineLocal,
    inviteToken:
      myRole === "Player 1"
        ? game.inviteTokens.player1
        : myRole === "Player 2"
          ? game.inviteTokens.player2
          : game.inviteTokens.viewer,
    showOfflineState: offline || game.offlineLocal,
    showJoinActions: !offline && !game.offlineLocal,
    canRecordMove: isPlayer && !inHistoryMode && sideToMoveIdentity === identityId && legalNow.length > 0,
    canEndTurn: isPlayer && !inHistoryMode && sideToMoveIdentity === identityId && Boolean(activeTurn && activeTurn.moveIndexes.length > 0),
    currentTurn: activeTurn ? clone(activeTurn) : null,
    pendingPlayerRequestSeat: myPendingJoinRequest?.requestedSeat ?? null,
    approvableRequesterIds,
  };
};

const listVisibleGames = (identityId: string) => {
  return [...games.values()]
    .filter((game) => !game.offlineLocal)
    .sort((left, right) => {
      const leftTs = left.lastMoveAt || left.createdAt;
      const rightTs = right.lastMoveAt || right.createdAt;
      return rightTs.localeCompare(leftTs);
    })
    .map((game) => withViewModel(game, identityId));
};

const parsePath = (pathname: string) => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "shell") {
    return null;
  }
  return parts.slice(2);
};

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const asIdentity = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

const addNotification = (game: ShellGame, message: string) => {
  game.notifications.unshift(message);
  if (game.notifications.length > 50) {
    game.notifications = game.notifications.slice(0, 50);
  }
};

const pickLegalAction = (state: GameState): Action | null => {
  const legal = listLegalActions(state);
  if (legal.length === 0) {
    return null;
  }
  return legal[0] as Action;
};

const renumberHistory = (game: ShellGame) => {
  game.moves.forEach((move, index) => {
    move.index = index;
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = turn.moveIndexes
      .map((_, turnMoveIndex) =>
        game.moves.find((move) => move.turnIndex === turn.index && move.turnMoveIndex === turnMoveIndex)?.index ?? -1,
      )
      .filter((index) => index >= 0);
  });
};

const applyServerMove = (game: ShellGame, notation?: string) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const action = pickLegalAction(stable);
  if (!action) {
    return { ok: false as const, error: "no_legal_actions" };
  }
  const applied = applyAction(stable, action);
  const next = resolveToStability(applied.state, { artifactMode: "full" });
  next.sideToMove = getSideForSeat(activeTurn.playerSeat);
  next.turnIndex = activeTurn.index;

  const move: MoveEntry = {
    index: game.moves.length,
    turnIndex: activeTurn.index,
    turnMoveIndex: activeTurn.moveIndexes.length,
    at: now(),
    notation: notation || action.type.toUpperCase(),
    snapshot: next,
  };
  game.moves.push(move);
  activeTurn.moveIndexes.push(move.index);
  activeTurn.lastMoveAt = move.at;
  if (game.moves.length > MAX_HISTORY) {
    game.moves.shift();
    renumberHistory(game);
  }
  game.board.state = next;
  game.lastMoveAt = move.at;
  game.updatedAt = move.at;
  addNotification(game, `Move recorded in turn ${activeTurn.index + 1}`);
  return { ok: true as const, move };
};

const endServerTurn = (game: ShellGame) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  if (activeTurn.moveIndexes.length === 0) {
    return { ok: false as const, error: "turn_has_no_moves" };
  }

  const endedAt = now();
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";

  const nextSeat = getNextSeat(activeTurn.playerSeat);
  const nextTurn: TurnEntry = {
    index: activeTurn.index + 1,
    startedAt: endedAt,
    endedAt: null,
    playerSeat: nextSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  game.turns.push(nextTurn);
  game.board.state.sideToMove = getSideForSeat(nextSeat);
  game.board.state.turnIndex = nextTurn.index;
  game.updatedAt = endedAt;
  addNotification(game, `Turn ${activeTurn.index + 1} ended. ${nextSeat} to play`);
  return { ok: true as const, turn: clone(nextTurn) };
};

export const handleShellLiveWebSocketUpgrade = (request: Request): Response | null => {
  const url = new URL(request.url);
  const route = parsePath(url.pathname);
  if (!route || request.method !== "GET" || route.length !== 1 || route[0] !== "ws") {
    return null;
  }

  const wsCtor = (globalThis as any).WebSocketPair;
  if (!wsCtor) {
    return new Response("WebSocket upgrade not supported in this runtime", { status: 426 });
  }

  const scope = url.searchParams.get("scope");
  const identityId = asIdentity(url.searchParams.get("identityId"));
  const gameId = scope === "game" ? asIdentity(url.searchParams.get("gameId")) : null;
  const socketPair = new wsCtor();
  const client = socketPair[0];
  const server = socketPair[1];
  server.accept();

  if (scope === "home") {
    if (identityId) {
      touchIdentityAcrossGames(identityId);
    }
    homeSubscribers.add(server);
  } else if (scope === "game" && gameId) {
    const game = games.get(gameId);
    if (game && identityId) {
      touchIdentityPresence(game, identityId);
      applyPresenceFreshness(game);
    }
    getGameSubscriberSet(gameId).add(server);
  } else {
    return new Response("Invalid websocket scope", { status: 400 });
  }

  sendSocketEvent(server, { type: "socket.connected", scope, gameId, at: now() });

  server.addEventListener("message", (event: MessageEvent) => {
    const text = typeof event.data === "string" ? event.data : "";
    if (text === "ping") {
      sendSocketEvent(server, { type: "pong", at: now() });
    }
  });

  server.addEventListener("close", () => {
    removeSocketFromAll(server);
  });

  return new Response(null, { status: 101, webSocket: client } as any);
};

export const handleShellLiveRequest = async (
  request: Request,
): Promise<{ handled: boolean; status: number; body: Record<string, unknown>; cacheControl: string } | null> => {
  const url = new URL(request.url);
  const route = parsePath(url.pathname);
  if (!route) {
    return null;
  }

  const offline = url.searchParams.get("offline") === "1";

  if (request.method === "GET" && route.length === 1 && route[0] === "bootstrap") {
    return {
      handled: true,
      status: 200,
      body: {
        ok: true,
        app: "righelt-web-shell",
        specVersion: 1,
        tutorialSteps: [
          "Select your role",
          "Review board state",
          "Make a move",
          "Inspect history and return live",
          "Invite participants",
        ],
      },
      cacheControl: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    };
  }

  if (request.method === "GET" && route.length === 1 && route[0] === "games") {
    const identityId = asIdentity(url.searchParams.get("identityId"));
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: "no-store" };
    }

    touchIdentityAcrossGames(identityId);

    return {
      handled: true,
      status: 200,
      body: { ok: true, games: listVisibleGames(identityId) },
      cacheControl: "no-store",
    };
  }

  if (request.method === "GET" && route.length === 2 && route[0] === "invites") {
    const token = asIdentity(route[1]);
    if (!token) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_invite_token" }, cacheControl: "no-store" };
    }
    const invite = inviteIndex.get(token);
    if (!invite) {
      return { handled: true, status: 404, body: { ok: false, error: "invite_not_found" }, cacheControl: "no-store" };
    }
    const game = games.get(invite.gameId);
    if (!game) {
      return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: "no-store" };
    }
    return {
      handled: true,
      status: 200,
      body: { ok: true, gameId: invite.gameId, inviteToken: token, inviteFromRole: invite.sharedByRole },
      cacheControl: "no-store",
    };
  }

  if (request.method === "POST" && route.length === 1 && route[0] === "games") {
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: "no-store" };
    }

    const playgroundMode = body.playgroundMode === true;
    const offlineLocal = body.offlineLocal === true;
    const initial = resolveToStability(createInitialState(), { artifactMode: "full" });
    const createdAt = now();

    const game: ShellGame = {
      id: nextId(),
      createdAt,
      lastMoveAt: null,
      updatedAt: createdAt,
      playgroundMode,
      offlineLocal,
      board: { state: initial },
      player1: { identityId, connected: true, joinedAt: createdAt, lastSeenAt: createdAt },
      player2: playgroundMode ? { identityId, connected: true, joinedAt: createdAt, lastSeenAt: createdAt } : null,
      viewers: [],
      pendingJoinRequests: [],
      turns: [
        {
          index: initial.turnIndex ?? 0,
          startedAt: createdAt,
          endedAt: null,
          playerSeat: getSeatForSide(initial.sideToMove),
          status: "active",
          moveIndexes: [],
          lastMoveAt: null,
        },
      ],
      moves: [],
      historyIndex: null,
      notifications: ["Game created", playgroundMode ? "Playground mode active" : "Invite a second player"],
      inviteTokens: { viewer: "", player1: "", player2: "" },
    };
    game.inviteTokens = createInviteTokens(game.id);

    games.set(game.id, game);
    broadcastLiveUpdate(game.id, "game_created");
    return {
      handled: true,
      status: 200,
      body: { ok: true, game: withViewModel(game, identityId, offline) },
      cacheControl: "no-store",
    };
  }

  if (route.length >= 2 && route[0] === "games") {
    const gameId = route[1];
    const game = games.get(gameId) || null;
    if (!game) {
      return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: "no-store" };
    }

    if (request.method === "GET" && route.length === 2) {
      const identityId = asIdentity(url.searchParams.get("identityId"));
      if (!identityId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: "no-store" };
      }

      touchIdentityPresence(game, identityId);
      if (url.searchParams.get("openAsViewer") === "1") {
        const added = ensureViewer(game, identityId);
        if (added) {
          game.updatedAt = now();
          broadcastLiveUpdate(game.id, "viewer_open");
        }
      }

      return {
        handled: true,
        status: 200,
        body: { ok: true, game: withViewModel(game, identityId, offline) },
        cacheControl: "no-store",
      };
    }

    if (request.method !== "POST") {
      return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: "no-store" };
    }

    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "join") {
      const mode = body.mode === "viewer" ? "viewer" : body.mode === "player" ? "player" : null;
      if (!mode) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_mode" }, cacheControl: "no-store" };
      }

      if (offline && !game.offlineLocal) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_join_blocked" }, cacheControl: "no-store" };
      }

      if (mode === "viewer") {
        const added = ensureViewer(game, identityId);
        game.updatedAt = now();
        if (added) {
          addNotification(game, "Viewer joined");
          broadcastLiveUpdate(game.id, "viewer_joined");
        }
        return { handled: true, status: 200, body: { ok: true, pendingApproval: false, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
      }

      if (game.playgroundMode) {
        return { handled: true, status: 409, body: { ok: false, error: "playground_player_join_disabled" }, cacheControl: "no-store" };
      }

      if (game.player1?.identityId === identityId || game.player2?.identityId === identityId) {
        return { handled: true, status: 409, body: { ok: false, error: "identity_already_player" }, cacheControl: "no-store" };
      }

      const requestedSeat = !game.player1 ? "Player 1" : !game.player2 ? "Player 2" : null;
      if (!requestedSeat) {
        return { handled: true, status: 409, body: { ok: false, error: "no_player_seat_available" }, cacheControl: "no-store" };
      }

      const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken : null;
      const inviteMeta = inviteToken ? inviteIndex.get(inviteToken) : null;
      const inviteFromRole =
        inviteMeta && inviteMeta.gameId === game.id
          ? inviteMeta.sharedByRole
          : typeof body.inviteFromRole === "string"
            ? body.inviteFromRole
            : null;
      const sharedByPlayer = inviteFromRole === "Player 1" || inviteFromRole === "Player 2";
      if (!sharedByPlayer) {
        const added = ensureViewer(game, identityId);
        game.pendingJoinRequests.push({
          identityId,
          requestedSeat,
          requestedAt: now(),
          source: inviteFromRole ? "viewer_invite" : "home_list",
        });
        game.updatedAt = now();
        addNotification(game, "Player seat request pending approval");
        broadcastLiveUpdate(game.id, added ? "player_join_requested" : "player_join_requested_existing_viewer");
        return {
          handled: true,
          status: 200,
          body: { ok: true, pendingApproval: true, game: withViewModel(game, identityId, offline) },
          cacheControl: "no-store",
        };
      }

      if (requestedSeat === "Player 1") {
        promoteIdentityToSeat(game, "Player 1", identityId);
      } else {
        promoteIdentityToSeat(game, "Player 2", identityId);
      }
      game.updatedAt = now();
      addNotification(game, "Player joined");
      broadcastLiveUpdate(game.id, "player_joined");
      return { handled: true, status: 200, body: { ok: true, pendingApproval: false, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "approve") {
      const requesterIdentityId = asIdentity(body.requesterIdentityId);
      if (!requesterIdentityId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_requester" }, cacheControl: "no-store" };
      }

      const requestIndex = game.pendingJoinRequests.findIndex((item) => item.identityId === requesterIdentityId);
      if (requestIndex < 0) {
        return { handled: true, status: 404, body: { ok: false, error: "request_not_found" }, cacheControl: "no-store" };
      }

      const requestItem = game.pendingJoinRequests[requestIndex];
      const approverIdentityId = getApproverIdentityForSeat(game, requestItem.requestedSeat);
      if (!approverIdentityId || approverIdentityId !== identityId) {
        return { handled: true, status: 403, body: { ok: false, error: "approval_not_allowed" }, cacheControl: "no-store" };
      }
      game.pendingJoinRequests.splice(requestIndex, 1);

      if (requestItem.requestedSeat === "Player 1" && !game.player1) {
        promoteIdentityToSeat(game, "Player 1", requestItem.identityId);
      }
      if (requestItem.requestedSeat === "Player 2" && !game.player2) {
        promoteIdentityToSeat(game, "Player 2", requestItem.identityId);
      }
      game.updatedAt = now();
      addNotification(game, "Player request approved");
      broadcastLiveUpdate(game.id, "player_request_approved");

      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "moves") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return { handled: true, status: 403, body: { ok: false, error: "role_not_allowed" }, cacheControl: "no-store" };
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return { handled: true, status: 409, body: { ok: false, error: "not_your_turn" }, cacheControl: "no-store" };
      }
      const notation = typeof body.notation === "string" ? body.notation : undefined;
      const moved = applyServerMove(game, notation);
      if (!moved.ok) {
        return { handled: true, status: 409, body: { ok: false, error: moved.error }, cacheControl: "no-store" };
      }
      broadcastLiveUpdate(game.id, "move_recorded");
      return { handled: true, status: 200, body: { ok: true, move: moved.move, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "end-turn") {
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return { handled: true, status: 403, body: { ok: false, error: "role_not_allowed" }, cacheControl: "no-store" };
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return { handled: true, status: 409, body: { ok: false, error: "not_your_turn" }, cacheControl: "no-store" };
      }
      const ended = endServerTurn(game);
      if (!ended.ok) {
        return { handled: true, status: 409, body: { ok: false, error: ended.error }, cacheControl: "no-store" };
      }
      broadcastLiveUpdate(game.id, "turn_ended");
      return { handled: true, status: 200, body: { ok: true, turn: ended.turn, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "history") {
      const moveIndex = typeof body.moveIndex === "number" ? body.moveIndex : -1;
      if (moveIndex < 0 || moveIndex >= game.moves.length) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_move_index" }, cacheControl: "no-store" };
      }
      game.historyIndex = moveIndex;
      game.updatedAt = now();
      addNotification(game, "Viewing history (not live)");
      broadcastLiveUpdate(game.id, "history_selected");
      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "live") {
      game.historyIndex = null;
      game.updatedAt = now();
      broadcastLiveUpdate(game.id, "return_live");
      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "presence") {
      const role = body.role === "Player 1" || body.role === "Player 2" ? body.role : null;
      const connected = body.connected === true;
      if (!role) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_role" }, cacheControl: "no-store" };
      }
      const entry = role === "Player 1" ? game.player1 : game.player2;
      if (!entry) {
        return { handled: true, status: 404, body: { ok: false, error: "participant_not_found" }, cacheControl: "no-store" };
      }
      entry.connected = connected;
      entry.lastSeenAt = connected ? now() : new Date(0).toISOString();
      game.updatedAt = now();
      addNotification(game, `Participant ${connected ? "connected" : "disconnected"}`);
      broadcastLiveUpdate(game.id, connected ? "participant_connected" : "participant_disconnected");
      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "go-online") {
      const confirmed = body.confirmed === true;
      if (!confirmed) {
        return { handled: true, status: 409, body: { ok: false, error: "confirmation_required" }, cacheControl: "no-store" };
      }
      game.offlineLocal = false;
      game.updatedAt = now();
      addNotification(game, "Game moved online");
      broadcastLiveUpdate(game.id, "game_moved_online");
      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: "no-store" };
  }

  return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: "no-store" };
};
