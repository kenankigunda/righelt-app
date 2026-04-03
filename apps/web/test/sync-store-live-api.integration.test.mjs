import test from "node:test";
import assert from "node:assert/strict";

import { createSyncStore } from "../shell/sync-store.js";
import { handleApiRequest } from "../../../packages/api-handler/src/index.ts";
import { __resetLiveGameStateForTests } from "../../../packages/api-handler/src/shell-live.ts";
import { createFakeD1 } from "../../../packages/api-handler/test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../../../packages/api-handler/test/support/fake-game-rooms.mjs";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const createApiEnv = () => {
  const env = {
    DB: createFakeD1(),
    GAME_ROOMS: null,
  };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  return env;
};

const toAbsoluteUrl = (url) => (String(url).startsWith("http") ? String(url) : `https://example.test${String(url)}`);

test("integration sync store keeps the optimistic game id when creating and immediately moving against the real API", async () => {
  __resetLiveGameStateForTests();
  const env = createApiEnv();
  const storage = createMemoryStorage();
  const requests = [];

  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
      requests.push({
        url: String(url),
        method: init.method || "GET",
        body: parsedBody,
      });
      return handleApiRequest(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  const requestedGameId = createHandle.result.id;

  const createdGame = await Promise.race([
    createHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("create commit timed out")), 2_000)),
  ]);

  assert.equal(createdGame.id, requestedGameId);
  const createRequest = requests.find((entry) => entry.url === "/api/shell/games" && entry.method === "POST");
  assert.equal(createRequest?.body?.gameId, requestedGameId);

  const action = createdGame.legalActions.find((entry) => entry.type !== "pass") ?? createdGame.legalActions[0];
  const moveHandle = await store.applyGameAction({
    gameId: requestedGameId,
    state: createdGame.currentSnapshot,
    action,
  });
  const committedMove = await Promise.race([
    moveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("move commit timed out")), 2_000)),
  ]);

  const applyRequest = requests.find((entry) => entry.url === `/api/shell/games/${requestedGameId}/apply` && entry.method === "POST");
  assert.ok(applyRequest);
  assert.equal(committedMove.accepted, true);
  assert.equal(store.getGameViewModel(requestedGameId)?.moves.length, 1);
});
