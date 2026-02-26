import { applyAction } from "../../game-engine/src/apply";
import { listLegalActions } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import { createInitialState } from "../../game-engine/src/state";
import type { Action, GameState } from "../../game-engine/src/types";

const MAX_HISTORY = 200;

type Participant = {
  identityId: string;
  connected: boolean;
  joinedAt: string;
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
  at: string;
  notation: string;
  snapshot: GameState;
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
  moves: MoveEntry[];
  historyIndex: number | null;
  notifications: string[];
};

const games = new Map<string, ShellGame>();
let seq = 0;
const homeSubscribers = new Set<any>();
const gameSubscribers = new Map<string, Set<any>>();

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const nextId = () => {
  seq += 1;
  return `game-${seq.toString().padStart(6, "0")}`;
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
    return false;
  }
  game.viewers.push({ identityId, connected: true, joinedAt: now() });
  return true;
};

const withViewModel = (game: ShellGame, identityId: string, offline = false) => {
  const myRole = findRoleForIdentity(game, identityId);
  const inHistoryMode = typeof game.historyIndex === "number";
  const currentSnapshot =
    typeof game.historyIndex === "number" && game.moves[game.historyIndex]
      ? game.moves[game.historyIndex].snapshot
      : game.board.state;

  return {
    ...clone(game),
    myRole,
    inHistoryMode,
    currentSnapshot,
    canJoinAsPlayer: myRole !== "Player 1" && myRole !== "Player 2" && !game.playgroundMode && (!game.player1 || !game.player2),
    canInvite: !offline && !game.offlineLocal,
    showOfflineState: offline || game.offlineLocal,
    showJoinActions: !offline && !game.offlineLocal,
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

const applyServerMove = (game: ShellGame, notation?: string) => {
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const action = pickLegalAction(stable);
  if (!action) {
    return { ok: false as const, error: "no_legal_actions" };
  }
  const applied = applyAction(stable, action);
  const next = resolveToStability(applied.state, { artifactMode: "full" });

  const move: MoveEntry = {
    index: game.moves.length,
    at: now(),
    notation: notation || action.type.toUpperCase(),
    snapshot: next,
  };
  game.moves.push(move);
  if (game.moves.length > MAX_HISTORY) {
    game.moves.shift();
    for (let i = 0; i < game.moves.length; i += 1) {
      game.moves[i].index = i;
    }
  }
  game.board.state = next;
  game.lastMoveAt = move.at;
  game.updatedAt = move.at;
  addNotification(game, "Move recorded");
  return { ok: true as const, move };
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
  const gameId = scope === "game" ? asIdentity(url.searchParams.get("gameId")) : null;
  const socketPair = new wsCtor();
  const client = socketPair[0];
  const server = socketPair[1];
  server.accept();

  if (scope === "home") {
    homeSubscribers.add(server);
  } else if (scope === "game" && gameId) {
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

    return {
      handled: true,
      status: 200,
      body: { ok: true, games: listVisibleGames(identityId) },
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
      player1: { identityId, connected: true, joinedAt: createdAt },
      player2: playgroundMode ? { identityId, connected: true, joinedAt: createdAt } : null,
      viewers: [],
      pendingJoinRequests: [],
      moves: [],
      historyIndex: null,
      notifications: ["Game created", playgroundMode ? "Playground mode active" : "Invite a second player"],
    };

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

      const requestedSeat = !game.player1 ? "Player 1" : !game.player2 ? "Player 2" : null;
      if (!requestedSeat) {
        return { handled: true, status: 409, body: { ok: false, error: "no_player_seat_available" }, cacheControl: "no-store" };
      }

      const inviteFromRole = typeof body.inviteFromRole === "string" ? body.inviteFromRole : null;
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
        game.player1 = { identityId, connected: true, joinedAt: now() };
      } else {
        game.player2 = { identityId, connected: true, joinedAt: now() };
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
      game.pendingJoinRequests.splice(requestIndex, 1);

      if (requestItem.requestedSeat === "Player 1" && !game.player1) {
        game.player1 = { identityId: requestItem.identityId, connected: true, joinedAt: now() };
      }
      if (requestItem.requestedSeat === "Player 2" && !game.player2) {
        game.player2 = { identityId: requestItem.identityId, connected: true, joinedAt: now() };
      }
      game.updatedAt = now();
      addNotification(game, "Player request approved");
      broadcastLiveUpdate(game.id, "player_request_approved");

      return { handled: true, status: 200, body: { ok: true, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
    }

    if (route.length === 3 && route[2] === "moves") {
      const notation = typeof body.notation === "string" ? body.notation : undefined;
      const moved = applyServerMove(game, notation);
      if (!moved.ok) {
        return { handled: true, status: 409, body: { ok: false, error: moved.error }, cacheControl: "no-store" };
      }
      broadcastLiveUpdate(game.id, "move_recorded");
      return { handled: true, status: 200, body: { ok: true, move: moved.move, game: withViewModel(game, identityId, offline) }, cacheControl: "no-store" };
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
