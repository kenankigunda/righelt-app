import { POSITION_PROJECTION } from "../../shared-types/src/sync-protocol";
import { computerModelForCreation } from '../../shared-types/src/computer-play';
import { storageRoomName } from "./storage-generation";
import { AUTH_PROTOCOL_VERSION } from '../../shared-types/src/auth-policy.js';
import { authorizeGameRequest, authActive, sanitizeGameResponse, type GameAuthority } from './auth-game';
import { AuthProblem } from './auth-controls';
import { readSyncBody, SyncBodyError } from "./sync-body";
import { CACHE_BOOTSTRAP_SHORT, CACHE_NO_STORE } from "../../shared-types/src/http";
import {
  asAction,
  asIdentity,
  asScenarioRecord,
  nextGameId,
  withPositionViewModel,
} from "./shell-live-core";
import {
  countHomeSectionGames,
  loadPositionProjection,
  listHomeSectionStaticGameCardPage,
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
  STORAGE_GENERATION?: string;
  AUTH_ENABLED?: string;
  AUTH_REQUIRED?: string;
  ACCOUNT_POLICY?: import("./account-cutover").CutoverPolicy;
  AUTH_TURNSTILE_SITE_KEY?: string;
  AUTH_ALLOWED_ORIGINS?: string;
  DB: D1DatabaseLike;
  GAME_ROOMS: DurableObjectNamespaceLike;
};

const GAME_ROOMS_BINDING_ERROR = "server_misconfigured_game_rooms_binding";
const nowMs = () => Date.now();

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

const roomStubForGame = (env: LiveGameRequestEnv, gameId: string) => env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(storageRoomName(env, gameId)));

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
  request: Request,
  env: LiveGameRequestEnv,
  gameId: string,
  path: string,
  init: RequestInit,
) => {
  const headers = new Headers(request.headers);
  new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
  headers.delete("content-length");
  headers.set("x-game-id", gameId);
  return roomStubForGame(env, gameId).fetch(new Request(`https://game-room${path}`, { ...init, headers }));
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
  let url = new URL(request.url);
  const route = parsePath(url.pathname);
  if (!route || request.method !== "GET") {
    return null;
  }
  if (route.length === 3 && route[0] === "games" && route[2] === "ws") {
    ({ request } = await authorizeGameRequest(request, env, true));
    url = new URL(request.url);
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
): Promise<{ handled: boolean; status: number; body: Record<string, unknown>; cacheControl: string } | { handled: true; response: Response } | null> => {
  let url = new URL(request.url);
  const route = parsePath(url.pathname);
  if (!route) return null;
  const authorized = await authorizeGameRequest(request, env);
  request = authorized.request;
  const authority = authorized.authority;
  url = new URL(request.url);

  if (request.method === "GET" && route.length === 1 && route[0] === "bootstrap") {
    return {
      handled: true,
      status: 200,
      body: {
        ok: true,
        app: "righelt-web-shell",
        specVersion: 1,
        ...(env.STORAGE_GENERATION ? { storageGeneration: env.STORAGE_GENERATION } : {}),
        authProtocolVersion: AUTH_PROTOCOL_VERSION, accountsRequired: authActive(env), accountsAvailable: env.AUTH_ENABLED === "true", maintenance: Boolean(env.ACCOUNT_POLICY?.maintenance),
        ...(authActive(env) && env.AUTH_TURNSTILE_SITE_KEY
          ? { turnstileSiteKey: env.AUTH_TURNSTILE_SITE_KEY } : {}),
        tutorialSteps: [
          "Select your role",
          "Review board state",
          "Make a move",
          "Inspect history and return live",
          "Invite participants",
        ],
      },
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "GET" && route.length === 1 && route[0] === "games") {
    const identityId = asIdentity(url.searchParams.get("identityId")) ?? (authActive(env) ? "" : null);
    if (identityId === null) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
    }
    const section = parseHomeSectionKey(url.searchParams.get("section"));
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = parseNonNegativeInt(pageParam);
    const pageSize = parseNonNegativeInt(pageSizeParam);
    if (!section || page === null || pageSize === null || pageSize <= 0) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_pagination" }, cacheControl: CACHE_NO_STORE };
    }
    if (authActive(env) && !authority && section === "my") return { handled: true, status: 200, body: { ok: true, section, page: 0, pageSize, totalGames: 0, totalPages: 0, games: [] }, cacheControl: CACHE_NO_STORE };
    const debug = !authActive(env) && url.searchParams.get("debug") === "1";
    const totalStart = nowMs();
    const totalGames = await countHomeSectionGames(env, { identityId, section, debug });
    const countMs = nowMs() - totalStart;
    const totalPages = totalGames === 0 ? 0 : Math.ceil(totalGames / pageSize);
    const safePage = totalPages === 0 ? 0 : Math.min(page, totalPages - 1);
    const queryStart = nowMs();
    const pagedGameResult =
      totalPages === 0
        ? { games: [], parseMs: 0, cardModelMs: 0 }
        : await listHomeSectionStaticGameCardPage(env, { identityId, section, page: safePage, pageSize, debug });
    const queryMs = nowMs() - queryStart;
    const pagedGames = pagedGameResult.games;
    const timing = {
      countMs,
      queryMs,
      parseMs: pagedGameResult.parseMs,
      cardModelMs: pagedGameResult.cardModelMs,
      totalMs: countMs + queryMs,
    };
    console.info(JSON.stringify({
      event: "shell_games_list_timing",
      at: new Date().toISOString(),
      identityId,
      section,
      page,
      safePage,
      pageSize,
      totalGames,
      totalPages,
      resultCount: pagedGames.length,
      ...timing,
    }));
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
        ...(debug ? { timing } : {}),
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
    const metadataResponse = await fetchGameRoom(request, env, invite.gameId, "/metadata", {method:"GET"});
    if (!metadataResponse.ok) return {handled:true,response:metadataResponse};
    const metadata = await metadataResponse.json() as {ownershipMode?:string};
    return {
      handled: true,
      status: 200,
      body: { ok: true, gameId: invite.gameId, inviteToken: token, inviteFromRole: invite.sharedByRole, ...(authActive(env) ? { ownershipMode: metadata.ownershipMode } : {}) },
      cacheControl: CACHE_NO_STORE,
    };
  }

  if (request.method === "POST" && route.length === 1 && route[0] === "games") {
    if (!hasGameRoomsBinding(env)) {
      return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
    }
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    const requestedGameId = asIdentity(body.gameId);
    if (!identityId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
    }
    if (body.creatorSide !== undefined && body.creatorSide !== "p1" && body.creatorSide !== "p2") return { handled: true, status: 400, body: { ok: false, error: "invalid_creator_side" }, cacheControl: CACHE_NO_STORE };
    if (body.computer !== undefined && !computerModelForCreation(body.computerModelId)) return { handled: true, status: 400, body: { ok: false, error: 'invalid_computer_model' }, cacheControl: CACHE_NO_STORE };
    const gameId = requestedGameId ?? nextGameId();
    const response = await fetchGameRoom(request, env, gameId, "/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId,
        selfPlayMode: body.selfPlayMode === true || body.playgroundMode === true,
        creatorSide: body.creatorSide === "p2" ? "p2" : "p1",
        ...(body.computer === undefined ? {} : { computer: body.computer, computerModelId: body.computerModelId }),
      }),
    });
    return { handled: true, response };
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
    const initialSelectionAction = asAction(body.initialSelectionAction);
    if (!identityId || !scenario) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_scenario_payload" }, cacheControl: CACHE_NO_STORE };
    }
    if (targetGameId) {
      const response = await fetchGameRoom(request, env, targetGameId, "/load-scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, scenario, protocolVersion: body.protocolVersion }),
      });
      return { handled: true, response };
    }

    let sourceSelfPlay = false;
    if (sourceGameId) {
      const metadataResponse = await fetchGameRoom(request, env, sourceGameId, "/metadata", {method:"GET"});
      if (!metadataResponse.ok && metadataResponse.status !== 404) return {handled:true,response:metadataResponse};
      if (metadataResponse.ok) sourceSelfPlay = (await metadataResponse.json() as {selfPlayMode?:boolean}).selfPlayMode === true;
      else await metadataResponse.body?.cancel();
    }
    const requestedGameId = asIdentity(body.gameId);
    const newGameId = requestedGameId ?? nextGameId();
    const response = await fetchGameRoom(request, env, newGameId, "/create-from-scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId: newGameId,
        scenario,
        selfPlayMode: sourceSelfPlay,
        initialSelectionAction,
        preserveResultingState: "if_not_behind",
      }),
    });
    return { handled: true, response };
  }

  if (request.method === "POST" && route.length === 2 && route[0] === "history" && route[1] === "branch") {
    if (!hasGameRoomsBinding(env)) {
      return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
    }
    const body = await parseBody(request);
    const identityId = asIdentity(body.identityId);
    const sourceGameId = asIdentity(body.sourceGameId);
    const sourceMoveIndex = typeof body.sourceMoveIndex === "number" && Number.isInteger(body.sourceMoveIndex) ? body.sourceMoveIndex : null;
    if (!identityId || !sourceGameId) {
      return { handled: true, status: 400, body: { ok: false, error: "invalid_history_branch_payload" }, cacheControl: CACHE_NO_STORE };
    }
    if (body.computer !== undefined && !computerModelForCreation(body.computerModelId)) return { handled: true, status: 400, body: { ok: false, error: 'invalid_computer_model' }, cacheControl: CACHE_NO_STORE };
    // Derive the immutable position where the history lives. The outer Worker
    // handles only this bounded position, never the source's complete history.
    const prepared = await fetchGameRoom(request, env, sourceGameId, "/prepare-branch", {
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({identityId,protocolVersion:2,sourceMoveIndex,sourceDecisionId:body.sourceDecisionId,sourceGameplayRevision:body.sourceGameplayRevision}),
    });
    if (!prepared.ok) return {handled:true,response:prepared};
    const {scenario,initialSelectionAction} = await prepared.json() as Record<string,unknown>;
    const requestedGameId = asIdentity(body.gameId);
    const newGameId = requestedGameId ?? nextGameId();
    const response = await fetchGameRoom(request, env, newGameId, "/create-from-scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        gameId: newGameId,
        scenario,
        initialSelectionAction,
        selfPlayMode: body.selfPlayMode === true,
        creatorSide: body.creatorSide === "p2" ? "p2" : "p1",
        ...(body.computer === undefined ? {} : { computer: body.computer, computerModelId: body.computerModelId }),
        preserveResultingState: true,
      }),
    });
    return { handled: true, response };
  }

  if (route.length >= 2 && route[0] === "games") {
    const gameId = route[1];
    if (request.method === "POST" && route.length === 3 && ["moves", "apply", "end-turn", "shared", "reconcile"].includes(route[2])) {
      let syncBody;
      try { syncBody = await readSyncBody(request); }
      catch (error) {
        if (error instanceof SyncBodyError) return { handled: true, status: error.status, body: { ok: false, error: error.message }, cacheControl: CACHE_NO_STORE };
        throw error;
      }
      if (!hasGameRoomsBinding(env)) return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      const response = await fetchGameRoom(request, env, gameId, `/${route[2]}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(syncBody) });
      return { handled: true, response };
    }
    // A pure durable read stays independent of room queue/search work. Its
    // distinct envelope cannot acknowledge a command or establish sync state.
    if (request.method === "GET" && route.length === 3 && route[2] === "position") {
      const identityId = asIdentity(url.searchParams.get("identityId")) ?? (authActive(env) ? "" : null);
      if (identityId === null) return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
      const projection = await loadPositionProjection(env, gameId);
      if (!projection) return { handled: true, status: 404, body: { ok: false, error: "game_not_found" }, cacheControl: CACHE_NO_STORE };
      if (projection.kind === "invalid") return { handled: true, status: 500, body: { ok: false, error: "invalid_persisted_game" }, cacheControl: CACHE_NO_STORE };
      const game = withPositionViewModel(projection.game, authActive(env) && projection.game.ownershipMode !== "account_v1" ? "" : identityId);
      return { handled: true, status: 200, body: { ok: true, protocolVersion: 2, projection: POSITION_PROJECTION, game, eventSeq: projection.eventSeq }, cacheControl: CACHE_NO_STORE };
    }
    // Room replies are already personalized and checked there. Keep the outer
    // Worker independent of history size, including legacy full projections.
    if (request.method === "GET" && route.length === 2) {
      const identityId = asIdentity(url.searchParams.get("identityId")) ?? (authActive(env) ? "" : null);
      if (identityId === null) return { handled: true, status: 400, body: { ok: false, error: "invalid_identity" }, cacheControl: CACHE_NO_STORE };
      if (!hasGameRoomsBinding(env)) return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      return { handled: true, response: await fetchGameRoom(request, env, gameId, `/snapshot?identityId=${encodeURIComponent(identityId)}`, { method: "GET" }) };
    }
    if (request.method === "POST" && route.length === 3 && [
      "computer-control", "decision-history", "decision-snapshot", "decision-notes", "decision-attempt", "decision-attempts",
      "approve", "history", "live", "play-as-both", "presence", "legal", "piece-moves", "revert-request", "revert-approve", "revert-reject", "revert-rescind",
    ].includes(route[2])) {
      if (!hasGameRoomsBinding(env)) return { handled: true, status: 500, body: { ok: false, error: GAME_ROOMS_BINDING_ERROR }, cacheControl: CACHE_NO_STORE };
      return { handled: true, response: await forwardRequestToGameRoom(env, gameId, request, `/${route[2]}`) };
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
      const response = await fetchGameRoom(request, env, gameId, "/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identityId,
          mode: body.mode,
          protocolVersion: body.protocolVersion,
          inviteFromRole,
          inviteToken: body.inviteToken,
        }),
      });
      return { handled: true, response };
    }

    return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
  }

  return { handled: true, status: 404, body: { ok: false, error: "not_found" }, cacheControl: CACHE_NO_STORE };
};
