import { createLiveTransportStore } from "../../../../apps/web/shell/live-transport.js";
import { buildGameHash, buildInviteHash, parseRouteFromHash } from "../../../../apps/web/shell/routes.js";
import { handleApiRequest } from "../../src/index.ts";
import { __resetShellLiveStateForTests } from "../../src/shell-live.ts";
import { createFakeD1 } from "./fake-d1.mjs";

const IDENTITY_KEY = "righelt.identity.id.v1";

const env = {
  DB: createFakeD1(),
};

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
  __resetShellLiveStateForTests();
  env.DB.reset();
  const fetcher = createFetcher();

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

  const buildPlayerInviteHash = (game) => buildInviteHash(game.inviteToken);

  return {
    createClient,
    acceptInviteAsPlayer,
    acceptInviteAsViewer,
    refreshGame,
    buildPlayerInviteHash,
  };
};
