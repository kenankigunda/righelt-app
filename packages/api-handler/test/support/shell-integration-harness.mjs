import { createLiveTransportStore } from "../../../../apps/web/shell/live-transport.js";
import { IDENTITY_KEY } from "../../../../apps/web/shell/persistence.js";
import { buildGameHash, buildInviteHash, parseRouteFromHash } from "../../../../apps/web/shell/routes.js";
import { handleApiRequest } from "./v2-test-adapter.mjs";
import { __resetLiveGameStateForTests } from "../../src/shell-live.ts";
import { createFakeD1 } from "./fake-d1.mjs";
import { createFakeGameRooms } from "./fake-game-rooms.mjs";

const env = {
  DB: createFakeD1(),
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

export const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const toAbsoluteUrl = (url) => {
  if (typeof url !== "string") {
    return "https://example.test/";
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `https://example.test${url}`;
};

const createFetcher = () => async (url, init = {}) => {
  const request = new Request(toAbsoluteUrl(String(url)), {
    method: init.method || "GET",
    headers: init.headers,
    body: init.body,
  });
  return handleApiRequest(request, env);
};

export const createShellIntegrationHarness = () => {
  __resetLiveGameStateForTests();
  env.DB.reset();
  env.GAME_ROOMS.reset();
  const fetcher = createFetcher();
  const waitFor = async (predicate, attempts = 20) => {
    let remaining = attempts;
    while (remaining > 0) {
      const result = await predicate();
      if (result) {
        return result;
      }
      remaining -= 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("timed_out_waiting_for_authoritative_game_state");
  };

  const createClient = (identityId) => {
    const storage = createMemoryStorage();
    storage.setItem(IDENTITY_KEY, identityId);
    const store = createLiveTransportStore({ storage, fetcher, random: () => 0.123456 });
    return { identityId, storage, store };
  };

  const acceptInviteAsPlayer = async (client, inviteHash) => {
    const route = parseRouteFromHash(inviteHash);
    if (route.name !== "invite") {
      throw new Error("expected_invite_route");
    }
    const resolved = await client.store.resolveInvite(route.inviteToken);
    const joined = await client.store.joinGame({
      gameId: resolved.gameId,
      mode: "player",
      inviteToken: resolved.inviteToken,
      inviteFromRole: resolved.inviteFromRole,
    });
    return {
      route: buildGameHash(resolved.gameId),
      routeInfo: parseRouteFromHash(buildGameHash(resolved.gameId)),
      resolved,
      joined,
      game: await client.store.loadGame(resolved.gameId, { openAsViewer: false }),
    };
  };

  const acceptInviteAsViewer = async (client, inviteHash) => {
    const route = parseRouteFromHash(inviteHash);
    if (route.name !== "invite") {
      throw new Error("expected_invite_route");
    }
    const resolved = await client.store.resolveInvite(route.inviteToken);
    const joined = await client.store.joinGame({
      gameId: resolved.gameId,
      mode: "viewer",
      inviteToken: resolved.inviteToken,
      inviteFromRole: resolved.inviteFromRole,
    });
    return {
      route: buildGameHash(resolved.gameId),
      routeInfo: parseRouteFromHash(buildGameHash(resolved.gameId)),
      resolved,
      joined,
      game: await client.store.loadGame(resolved.gameId, { openAsViewer: false }),
    };
  };

  const refreshGame = (client, gameId) => client.store.loadGame(gameId, { openAsViewer: false });
  const waitForGame = (client, gameId, predicate, attempts = 20) =>
    waitFor(async () => {
      const game = await refreshGame(client, gameId);
      return predicate(game) ? game : null;
    }, attempts);

  const buildPlayerInviteHash = (game) => buildInviteHash(game.inviteToken);

  return {
    createClient,
    acceptInviteAsPlayer,
    acceptInviteAsViewer,
    refreshGame,
    waitForGame,
    buildPlayerInviteHash,
  };
};
