import { withCutoverPolicy, maintenanceAllowed, type CutoverEnv } from './account-cutover';
import { enrichAccountNames } from './account-profiles';
import type { AuthDatabase } from './auth-db';
import { AUTH_PROTOCOL_VERSION } from '../../shared-types/src/auth-policy.js';
import { authActive, readGameAuthority, sanitizeGameResponse, authErrorResponse, deliverRevocations } from './auth-game';
import { authenticatedActor } from './auth-handler';
import { authCookie, readAuthCookie } from './auth-security';
import { AuthProblem } from './auth-controls';
import { handleAuthRequest, type AuthEnv } from './auth-handler';
import type { ClientCommand, ServerEvent } from "../../shared-types/src";
import { LIVE_HISTORY, ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION } from "../../shared-types/src/sync-protocol";
import { CACHE_NO_STORE } from "../../shared-types/src/http";
import { GameRoomDO, compactHistoryResponse } from "./game-room-do";
import { handleLiveGameRequest, handleLiveGameWebSocketUpgrade } from "./shell-live";

import type { D1DatabaseLike } from "./shell-live-db";
import { assertStorageGeneration } from "./storage-generation";
import { STORAGE_GENERATION_HEADER } from "../../shared-types/src/storage-policy";
export type { D1DatabaseLike } from "./shell-live-db";

export type ApiEnv = CutoverEnv & {
  STORAGE_GENERATION?: string;
  AUTH_ENABLED?: string;
  AUTH_ALLOWED_ORIGINS?: string;
  DB: D1DatabaseLike;
  GAME_ROOMS: {
    idFromName: (name: string) => { name?: string; toString?: () => string } | string;
    get: (id: { name?: string; toString?: () => string } | string) => {
      fetch: (request: Request) => Promise<Response>;
    };
  };
};

const hasGameRoomsBinding = (env: Partial<ApiEnv>) =>
  Boolean(env?.GAME_ROOMS && typeof env.GAME_ROOMS.idFromName === "function" && typeof env.GAME_ROOMS.get === "function");

const json = (body: unknown, status = 200, cacheControl = CACHE_NO_STORE): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });

const jsonNoStore = (body: unknown, status = 200): Response => json(body, status, CACHE_NO_STORE);
const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const handleApiRequestInternal = async (request: Request, env: ApiEnv): Promise<Response> => {
  assertStorageGeneration(request, env);
  env = await withCutoverPolicy(env);
  const url = new URL(request.url);
  const authResponse = await handleAuthRequest(request, env as unknown as AuthEnv);
  if (authResponse) {
    if (authActive(env)) { try { await deliverRevocations(env as unknown as Parameters<typeof deliverRevocations>[0]); } catch {} }
    return authResponse;
  }
  const websocketUpgrade = await handleLiveGameWebSocketUpgrade(request, env);
  if (websocketUpgrade) {
    return websocketUpgrade;
  }
  const initialAuthority = authActive(env) ? await readGameAuthority(request, env) : null;
  const initialPolicy = JSON.stringify([env.AUTH_ENABLED, env.AUTH_REQUIRED, env.ACCOUNT_POLICY]);
  const liveResponse = await handleLiveGameRequest(request, env);
  if (liveResponse?.handled) {
    if ("response" in liveResponse) {
      const response = liveResponse.response;
      // The room owns JSON projection/sanitization. Recheck small authority and
      // policy records here without decoding its potentially multi-MB response.
      try {
        env = await withCutoverPolicy(env);
        if (initialPolicy !== JSON.stringify([env.AUTH_ENABLED, env.AUTH_REQUIRED, env.ACCOUNT_POLICY])) throw new AuthProblem("temporarily_unavailable", 503);
        const authority = authActive(env) ? await readGameAuthority(request, env) : null;
        if (initialAuthority && (!authority || authority.contextId !== initialAuthority.contextId)) throw new AuthProblem("session_changed", 409);
        const headers = new Headers(response.headers);
        headers.set("cache-control", CACHE_NO_STORE);
        if (authActive(env) && request.method === "POST" && response.status < 400) {
          const actor = await authenticatedActor(request, env as unknown as AuthEnv), token = readAuthCookie(request);
          if (actor && token) headers.append("Set-Cookie", authCookie(token, Math.max(0, Math.floor((actor.expires_at - actor.read_at) / 1000))));
        }
        return new Response(response.body, {status:response.status, statusText:response.statusText, headers});
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
    }
    if (authActive(env)) liveResponse.body = await enrichAccountNames(liveResponse.body, env.DB as unknown as AuthDatabase);
    env = await withCutoverPolicy(env);
    const authority = authActive(env) ? await readGameAuthority(request, env) : null;
    if (initialAuthority && (!authority || authority.contextId !== initialAuthority.contextId)) throw new AuthProblem("session_changed", 409);
    const accountGame = (liveResponse.body.game as { ownershipMode?: string } | undefined)?.ownershipMode === "account_v1";
    const body = authActive(env) || accountGame ? sanitizeGameResponse(liveResponse.body, authority, !maintenanceAllowed(env,authority?.accountId)) : liveResponse.body;
    if (authActive(env)) body.authProtocolVersion = AUTH_PROTOCOL_VERSION;
    const response = json(request.headers.get(LIVE_HISTORY.requestHeader) === LIVE_HISTORY.requestValue ? compactHistoryResponse(body) : body, liveResponse.status, liveResponse.cacheControl);
    if (authActive(env) && request.method === 'POST' && response.status < 400) {
      const actor = await authenticatedActor(request, env as unknown as AuthEnv), token = readAuthCookie(request);
      if (actor && token) response.headers.append('Set-Cookie', authCookie(token, Math.max(0, Math.floor((actor.expires_at - actor.read_at) / 1000))));
    }
    return response;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    const gameRooms = hasGameRoomsBinding(env);
    return jsonNoStore(
      {
        ok: gameRooms,
        service: "righelt",
        bindings: {
          db: Boolean(env.DB),
          gameRooms,
        },
      },
      gameRooms ? 200 : 500,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/commands/validate") {
    const body = await parseJsonBody(request);
    const command = body.command as ClientCommand | undefined;

    if (!command || typeof command.type !== "string") {
      return jsonNoStore({ ok: false, error: "invalid_command" }, 400);
    }

    return jsonNoStore({ ok: true, accepted: true, commandType: command.type });
  }

  return jsonNoStore({ ok: false, error: "not_found" }, 404);
};

export const handleApiRequest = async (request: Request, env: ApiEnv): Promise<Response> => {
  const incoming = request.headers.get("X-Righelt-Request-Id") ?? "";
  const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(request.headers); headers.set("X-Righelt-Request-Id", requestId);
  request = new Request(request, { headers });
  const started = Date.now();
  let response: Response;
  try { response = await handleApiRequestInternal(request, env); }
  catch (error) {
    // Keep correlation and generation headers on every application-controlled
    // failure. A platform-generated 500 cannot carry our recovery evidence.
    response = authErrorResponse(error);
  }
  // WebSocket upgrade responses must retain their platform-specific socket.
  if (response.status !== 101) {
    const headers = new Headers(response.headers);
    headers.set("X-Righelt-Request-Id", requestId);
    headers.set(ACTION_CONTRACT_HEADER, String(ACTION_CONTRACT_VERSION));
    if (env.STORAGE_GENERATION) headers.set(STORAGE_GENERATION_HEADER, env.STORAGE_GENERATION);
    headers.set("X-Righelt-Server-Build", String((env as ApiEnv & { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? "unavailable"));
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  console.info(JSON.stringify({ event: "api_request_completed", requestId, path: new URL(request.url).pathname, status: response.status, serverBuild: (env as ApiEnv & { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? "unavailable", durationMs: Date.now() - started }));
  return response;
};
export { GameRoomDO };
export { runStorageMaintenance } from "./storage-maintenance";
