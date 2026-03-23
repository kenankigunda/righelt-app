import { listLegalActions } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import {
  asAction,
  asGameState,
  asIdentity,
  asScenarioRecord,
  enumeratePieceActionPreviews,
  enumeratePieceActions,
  findRoleForIdentity,
  getSeatIdentity,
  getSideToMoveSeat,
  nextGameId,
  resolveLaunchParticipantCopyMode,
  withViewModel,
} from "./shell-live-core";
import { loadGameProjection, listVisibleGameProjections, resolveInvite, type D1DatabaseLike } from "./shell-live-db";

type DurableObjectIdLike = { name?: string; toString?: () => string };
type DurableObjectStubLike = { fetch: (request: Request) => Promise<Response> };
type DurableObjectNamespaceLike = {
  idFromName: (name: string) => DurableObjectIdLike;
  get: (id: DurableObjectIdLike) => DurableObjectStubLike;
};

export type LiveGameRequestEnv = {
  DB: D1DatabaseLike;
  GAME_ROOMS: DurableObjectNamespaceLike;
};

const CACHE_NO_STORE = "no-store";
const CACHE_BOOTSTRAP_SHORT = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const GAME_ROOMS_BINDING_ERROR = "server_misconfigured_game_rooms_binding";
const INVALID_PERSISTED_GAME_ERROR = "invalid_persisted_game";
const DEPLOY_SMOKE_PLAYER_ID = "smoke-player";

type HomeSectionKey = "my" | "other" | "smoke";

const json = (body: unknown, status = 200, cacheControl = CACHE_NO_STORE): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });

const hasGameRoomsBinding = (env: Partial<LiveGameRequestEnv>) =>
  Boolean(
    env?.GAME_ROOMS &&
      typeof env.GAME_ROOMS.idFromName === "function" &&
      typeof env.GAME_ROOMS.get === "function",
  );

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

const roomStubForGame = (env: LiveGameRequestEnv, gameId: string) => env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId));

const forwardRequestToGameRoom = (
  env: LiveGameRequestEnv,
  gameId: string,
  request: Request,
  path: string,
) => {
  const headers = new Headers(request.headers);
  headers.set("x-game-id", gameId);
  return roomStubForGame(env, gameId).fetch(
    new Request(`https://game-room${path}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect,
      duplex: "half",
    } as RequestInit),
  );
};

const fetchGameRoom = async (
  env: LiveGameRequestEnv,
  gameId: string,
  path: string,
  init: RequestInit,
) => {
  const headers = new Headers(init.headers || {});
  headers.set("x-game-id", gameId);
  return roomStubForGame(env, gameId).fetch(new Request(`https://game-room${path}`, { ...init, headers }));
};

const isPlayerRole = (role: string | null | undefined) => role === "Player 1" || role === "Player 2";

const gameIncludesIdentity = (game: Record<string, unknown>, identityId: string) => {
  const player1 = game.player1 as { identityId?: string } | null | undefined;
  const player2 = game.player2 as { identityId?: string } | null | undefined;
  const viewers = Array.isArray(game.viewers) ? game.viewers : [];
  const pendingJoinRequests = Array.isArray(game.pendingJoinRequests) ? game.pendingJoinRequests : [];
  return (
    player1?.identityId === identityId ||
    player2?.identityId === identityId ||
    viewers.some((viewer) => Boolean(viewer) && typeof viewer === "object" && (viewer as { identityId?: string }).identityId === identityId) ||
    pendingJoinRequests.some(
      (request) => Boolean(request) && typeof request === "object" && (request as { identityId?: string }).identityId === identityId,
    )
  );
};

const parseHomeSectionKey = (value: string | null): HomeSectionKey | null =>
  value === "my" || value === "other" || value === "smoke" ? value : null;

const parseNonNegativeInt = (value: string | null) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export const __resetLiveGameStateForTests = () => {
  // No process-local live state remains in the HTTP routing layer.
};

export const handleLiveGameWebSocketUpgrade = async (request: Request, env: LiveGameRequestEnv): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = parsePath(url.pathname);
  if (!route || request.method !== "GET") {
    return null;
  }
  if (route.length === 3 && route[0] === "games" && route[2] === "ws") {
    if (!hasGameRoomsBinding(env)) {
      return json({ ok: false, error: GAME_ROOMS_BINDING_ERROR }, 500);
    }
    return forwardRequestToGameRoom(env, route[1], request, `/ws${url.search}`);
  }
  if (route.length === 1 && route[0] === "ws") {
    return new Response("Legacy websocket route removed", { status: 404 });
  }
  return null;
};

export const handleLiveGameRequest = async (
  request: Request,
  env: LiveGameRequestEnv,
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
      cacheControl: CACHE_BOOTSTRAP_SHORT,
    };
  }

  if (request.method === "GET" && route.length === 1 && route[0] === "games") {
    const identityId = asIdentity(url.searchParams.get("identityId"));
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
    }
    const section = parseHomeSectionKey(url.searchParams.get("section"));
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const paginationRequested = section !== null || pageParam !== null || pageSizeParam !== null;
    const games = await listVisibleGameProjections(env);
    if (!paginationRequested) {
      return {
        handled: true,
        status: 200,
        body: { ok: true, games: games.map((game) => withViewModel(game, identityId, offline)) },
        cacheControl: CACHE_NO_STORE,
      };
    }
    const page = parseNonNegativeInt(pageParam);
    const pageSize = parseNonNegativeInt(pageSizeParam);
    if (!section || page === null || pageSize === null || pageSize <= 0) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_pagination" }, cacheControl: CACHE_NO_STORE };
    }
    const debug = url.searchParams.get("debug") === "1";
    const visibleGames = games
      .map((game) => withViewModel(game, identityId, offline))
      .filter((game) => {
        const isSmokeGame = gameIncludesIdentity(game, DEPLOY_SMOKE_PLAYER_ID);
        if (section === "smoke") {
          return debug && isSmokeGame;
        }
        if (debug && isSmokeGame) {
          return false;
        }
        if (section === "my") {
          return isPlayerRole(game.myRole);
        }
        return !isPlayerRole(game.myRole);
      });
    const totalGames = visibleGames.length;
    const totalPages = totalGames === 0 ? 0 : Math.ceil(totalGames / pageSize);
    const safePage = totalPages === 0 ? 0 : Math.min(page, totalPages - 1);
    const start = safePage * pageSize;
    const pagedGames = totalPages === 0 ? [] : visibleGames.slice(start, start + pageSize);
    return {
      handled: true,
      status: 200,
      body: {
        ok: true,
        section,
        page: safePage,
        pageSize,
        totalGames,
        totalPages,
        games: pagedGames,
      },
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "GET" && route.length === 2 && route[0] === "invites") {
    const token = asIdentity(route[1]);
    if (!token) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_invite_token" }, cacheControl: CACHE_NO_STORE };
    }
    const invite = await resolveInvite(env, token);
    if (!invite) {
      return { handled: true, status: 404, body: { ok: false, error: "invite_not_found" }, cacheControl: CACHE_NO_STORE };
    }
    const gameProjection = await loadGameProjection(env, invite.gameId);
    if (!gameProjection) {
      return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: CACHE_NO_STORE };
    }
    if (gameProjection.kind === "invalid") {
      return {
        handled: true,
        status: 500,
        body: { ok: false, error: INVALID_PERSISTED_GAME_ERROR },
        cacheControl: CACHE_NO_STORE,
      };
    }
    return {
      handled: true,
      status: 200,
      body: { ok: true, gameId: invite.gameId, inviteToken: token, inviteFromRole: invite.sharedByRole },
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "POST" && route.length === 1 && route[0] === "games") {
    if (!hasGameRoomsBinding(env)) {
      return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
    }
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
    }
    const gameId = nextGameId();
    const response = await fetchGameRoom(env, gameId, "/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId,
        playgroundMode: body.playgroundMode === true,
        offlineLocal: body.offlineLocal === true,
      }),
    });
    return {
      handled: true,
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "POST" && route.length === 2 && route[0] === "scenarios" && route[1] === "import") {
    if (!hasGameRoomsBinding(env)) {
      return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
    }
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    const scenario = asScenarioRecord(body.scenario);
    const targetGameId = asIdentity(body.targetGameId);
    const sourceGameId = asIdentity(body.sourceGameId);
    if (!identityId || !scenario) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_scenario_payload" }, cacheControl: CACHE_NO_STORE };
    }
    if (targetGameId) {
      const response = await fetchGameRoom(env, targetGameId, "/load-scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, scenario }),
      });
      return {
        handled: true,
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
        cacheControl: CACHE_NO_STORE,
      };
    }

    const sourceProjection = sourceGameId ? await loadGameProjection(env, sourceGameId) : null;
    if (sourceProjection?.kind === "invalid") {
      return {
        handled: true,
        status: 500,
        body: { ok: false, error: INVALID_PERSISTED_GAME_ERROR },
        cacheControl: CACHE_NO_STORE,
      };
    }
    const newGameId = nextGameId();
    const participantCopyMode = sourceProjection?.game
      ? resolveLaunchParticipantCopyMode(sourceProjection.game, identityId)
      : null;
    const response = await fetchGameRoom(env, newGameId, "/create-from-scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId: newGameId,
        scenario,
        playgroundMode: sourceProjection?.game.playgroundMode === true,
        offlineLocal: sourceProjection?.game.offlineLocal === true,
        sourceGame: sourceProjection?.game ?? null,
        participantCopyMode,
      }),
    });
    return {
      handled: true,
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "POST" && route.length === 2 && route[0] === "history" && route[1] === "branch") {
    if (!hasGameRoomsBinding(env)) {
      return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
    }
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    const sourceGameId = asIdentity(body.sourceGameId);
    const initialState = asGameState(body.initialState);
    const initialSelectionAction = asAction(body.initialSelectionAction);
    const sourceMoveIndex = typeof body.sourceMoveIndex === "number" && Number.isInteger(body.sourceMoveIndex) ? body.sourceMoveIndex : null;
    if (!identityId || !sourceGameId || sourceMoveIndex === null || !initialState || !initialSelectionAction) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_history_branch_payload" }, cacheControl: CACHE_NO_STORE };
    }
    const sourceProjection = await loadGameProjection(env, sourceGameId);
    if (!sourceProjection) {
      return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: CACHE_NO_STORE };
    }
    if (sourceProjection.kind === "invalid") {
      return {
        handled: true,
        status: 500,
        body: { ok: false, error: INVALID_PERSISTED_GAME_ERROR },
        cacheControl: CACHE_NO_STORE,
      };
    }
    const participantCopyMode = resolveLaunchParticipantCopyMode(sourceProjection.game, identityId);
    const newGameId = nextGameId();
    const response = await fetchGameRoom(env, newGameId, "/create-from-history-branch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId: newGameId,
        sourceGameId,
        sourceMoveIndex,
        initialState,
        initialSelectionAction,
        playgroundMode: sourceProjection.game.playgroundMode === true,
        offlineLocal: sourceProjection.game.offlineLocal === true,
        sourceGame: sourceProjection.game,
        participantCopyMode,
      }),
    });
    return {
      handled: true,
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (route.length >= 2 && route[0] === "games") {
    const gameId = route[1];
    const projection = await loadGameProjection(env, gameId);
    if (!projection) {
      return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: CACHE_NO_STORE };
    }
    if (projection.kind === "invalid") {
      return {
        handled: true,
        status: 500,
        body: { ok: false, error: INVALID_PERSISTED_GAME_ERROR },
        cacheControl: CACHE_NO_STORE,
      };
    }
    const game = projection.game;

    if (request.method === "GET" && route.length === 2) {
      const identityId = asIdentity(url.searchParams.get("identityId"));
      if (!identityId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
      }
      return {
        handled: true,
        status: 200,
        body: { ok: true, game: withViewModel(game, identityId, offline), eventSeq: projection.eventSeq },
        cacheControl: CACHE_NO_STORE,
      };
    }

    if (request.method !== "POST") {
      return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
    }

    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
    }

    if (route.length === 3 && route[2] === "join") {
      if (!hasGameRoomsBinding(env)) {
        return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      }
      if (offline && !game.offlineLocal) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_join_blocked" }, cacheControl: CACHE_NO_STORE };
      }
      let inviteFromRole =
        body.inviteFromRole === "Player 1" || body.inviteFromRole === "Player 2" || body.inviteFromRole === "Viewer"
          ? body.inviteFromRole
          : null;
      const inviteToken = asIdentity(body.inviteToken);
      if (inviteToken) {
        const inviteMeta = await resolveInvite(env, inviteToken);
        if (inviteMeta?.gameId === gameId) {
          inviteFromRole = inviteMeta.sharedByRole;
        }
      }
      const response = await fetchGameRoom(env, gameId, "/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identityId,
          mode: body.mode,
          inviteFromRole,
        }),
      });
      return {
        handled: true,
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
        cacheControl: CACHE_NO_STORE,
      };
    }

    if (
      route.length === 3 &&
      ["approve", "moves", "apply", "end-turn", "history", "live", "play-as-both", "go-online"].includes(route[2])
    ) {
      if (!hasGameRoomsBinding(env)) {
        return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      }
      if (
        offline &&
        !game.offlineLocal &&
        (route[2] === "moves" || route[2] === "apply" || route[2] === "end-turn" || route[2] === "play-as-both")
      ) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_move_local_only" }, cacheControl: CACHE_NO_STORE };
      }
      const response = await fetchGameRoom(env, gameId, `/${route[2]}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        handled: true,
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
        cacheControl: CACHE_NO_STORE,
      };
    }

    if (route.length === 3 && route[2] === "legal") {
      if (offline && !game.offlineLocal) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_move_local_only" }, cacheControl: CACHE_NO_STORE };
      }
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return { handled: true, status: 403, body: { ok: false, error: "role_not_allowed" }, cacheControl: CACHE_NO_STORE };
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return { handled: true, status: 409, body: { ok: false, error: "not_your_turn" }, cacheControl: CACHE_NO_STORE };
      }
      const stable = resolveToStability(game.board.state, { artifactMode: "full" });
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          state: stable,
          legalActions: listLegalActions(stable),
          game: withViewModel(game, identityId, offline),
        },
        cacheControl: CACHE_NO_STORE,
      };
    }

    if (route.length === 3 && route[2] === "piece-moves") {
      if (offline && !game.offlineLocal) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_move_local_only" }, cacheControl: CACHE_NO_STORE };
      }
      const role = findRoleForIdentity(game, identityId);
      if (role !== "Player 1" && role !== "Player 2") {
        return { handled: true, status: 403, body: { ok: false, error: "role_not_allowed" }, cacheControl: CACHE_NO_STORE };
      }
      const sideToMoveSeat = getSideToMoveSeat(game);
      const sideToMoveIdentity = getSeatIdentity(game, sideToMoveSeat);
      if (!sideToMoveIdentity || sideToMoveIdentity !== identityId) {
        return { handled: true, status: 409, body: { ok: false, error: "not_your_turn" }, cacheControl: CACHE_NO_STORE };
      }
      const bodyState = asGameState(body.state);
      const pieceId = asIdentity(body.pieceId);
      if (!bodyState) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_state" }, cacheControl: CACHE_NO_STORE };
      }
      if (!pieceId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_piece_id" }, cacheControl: CACHE_NO_STORE };
      }
      const stable = resolveToStability(game.board.state, { artifactMode: "full" });
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          state: stable,
          pieceId,
          actions: enumeratePieceActions(stable, pieceId),
          previewActions: enumeratePieceActionPreviews(stable, pieceId),
          game: withViewModel(game, identityId, offline),
        },
        cacheControl: CACHE_NO_STORE,
      };
    }

    return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
  }

  return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
};
