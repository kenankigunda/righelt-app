import {
  asGameState,
  asIdentity,
  asScenarioRecord,
  enumeratePieceActionPreviews,
  enumeratePieceActions,
  deriveCanonicalSession,
  applyCanonicalProjection,
  nextGameId,
  withViewModel,
} from "./shell-live-core";
import {
  loadGameProjection,
  listVisibleGameProjections,
  persistGameState,
  resolveInvite,
  type D1DatabaseLike,
} from "./shell-live-db";

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
    const games = await listVisibleGameProjections(env);
    return {
      handled: true,
      status: 200,
      body: { ok: true, games: games.map((game) => withViewModel(game, identityId, offline)) },
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
    const newGameId = nextGameId();
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
    const game = projection.game;
    const canonicalSession = deriveCanonicalSession(game);
    if (canonicalSession.repaired) {
      applyCanonicalProjection(game, canonicalSession);
      await persistGameState(env, game, projection.eventSeq, null);
    }

    if (request.method === "GET" && route.length === 2) {
      const identityId = asIdentity(url.searchParams.get("identityId"));
      if (!identityId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
      }
      return {
        handled: true,
        status: 200,
        body: {
          ok: true,
          game: withViewModel(game, identityId, offline, canonicalSession),
          eventSeq: projection.eventSeq,
        },
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
      if (!hasGameRoomsBinding(env)) {
        return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      }
      const response = await fetchGameRoom(env, gameId, "/legal", {
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

    if (route.length === 3 && route[2] === "piece-moves") {
      if (offline && !game.offlineLocal) {
        return { handled: true, status: 409, body: { ok: false, error: "offline_move_local_only" }, cacheControl: CACHE_NO_STORE };
      }
      if (!hasGameRoomsBinding(env)) {
        return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      }
      const bodyState = asGameState(body.state);
      const pieceId = asIdentity(body.pieceId);
      if (!bodyState) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_state" }, cacheControl: CACHE_NO_STORE };
      }
      if (!pieceId) {
        return { handled: true, status: 400, body: { ok: false, error: "invalid_piece_id" }, cacheControl: CACHE_NO_STORE };
      }
      const response = await fetchGameRoom(env, gameId, "/piece-moves", {
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

    return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
  }

  return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
};
