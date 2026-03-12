import assert from "node:assert/strict";
import test from "node:test";

import apiWorker, { GameRoomDO } from "../index.js";
import { onRequest as proxyRequest } from "../../web/functions/api/[[path]].js";
import { createFakeD1 } from "../../../packages/api-handler/test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../../../packages/api-handler/test/support/fake-game-rooms.mjs";

const buildEnv = () => {
  const env = {
    DB: createFakeD1(),
    GAME_ROOMS: null,
  };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  return env;
};

test("api worker health reports active bindings when DB and GAME_ROOMS are present", async () => {
  const response = await apiWorker.fetch(new Request("https://righelt-api.example.workers.dev/api/health"), buildEnv());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    service: "righelt",
    bindings: {
      db: true,
      gameRooms: true,
    },
  });
});

test("api worker health reports missing GAME_ROOMS binding as unhealthy", async () => {
  const env = buildEnv();
  delete env.GAME_ROOMS;

  const response = await apiWorker.fetch(new Request("https://righelt-api.example.workers.dev/api/health"), env);

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.bindings.gameRooms, false);
});

test("api worker exports GameRoomDO for durable object registration", () => {
  assert.equal(typeof GameRoomDO, "function");
});

test("split-stack integration preserves health payload through Pages proxy", async () => {
  const env = buildEnv();
  const response = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/health"),
    env: {
      API_SERVICE: {
        fetch(request) {
          return apiWorker.fetch(request, env);
        },
      },
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.bindings.db, true);
  assert.equal(body.bindings.gameRooms, true);
});

test("split-stack integration creates a game through the Pages proxy", async () => {
  const env = buildEnv();
  const response = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/shell/games?offline=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    }),
    env: {
      API_SERVICE: {
        fetch(request) {
          return apiWorker.fetch(request, env);
        },
      },
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.game?.id, "string");
  assert.equal(body.game.player1.identityId, "id-a");
});
