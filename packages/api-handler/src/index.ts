import type { ClientCommand, ServerEvent } from "../../shared-types/src";
import { CACHE_NO_STORE } from "../../shared-types/src/http";
import { GameRoomDO } from "./game-room-do";
import { handleLiveGameRequest, handleLiveGameWebSocketUpgrade } from "./shell-live";

type D1RunResult = {
  success: boolean;
  meta?: {
    last_row_id?: number;
  };
};

type D1Statement = {
  bind: (...args: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<D1RunResult>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
};

export type ApiEnv = {
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

export const handleApiRequest = async (request: Request, env: ApiEnv): Promise<Response> => {
  const url = new URL(request.url);
  const websocketUpgrade = await handleLiveGameWebSocketUpgrade(request, env);
  if (websocketUpgrade) {
    return websocketUpgrade;
  }
  const liveResponse = await handleLiveGameRequest(request, env);
  if (liveResponse?.handled) {
    return json(liveResponse.body, liveResponse.status, liveResponse.cacheControl);
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

export { GameRoomDO };
