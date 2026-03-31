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

test("split-stack integration resolves invite tokens through the Pages proxy", async () => {
  const env = buildEnv();
  const create = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/shell/games?offline=0", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-invite", playgroundMode: false, offlineLocal: false }),
    }),
    env: {
      API_SERVICE: {
        fetch(request) {
          return apiWorker.fetch(request, env);
        },
      },
    },
  });
  const createBody = await create.json();

  const resolved = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/invites/${createBody.game.inviteToken}`),
    env: {
      API_SERVICE: {
        fetch(request) {
          return apiWorker.fetch(request, env);
        },
      },
    },
  });

  assert.equal(resolved.status, 200);
  const body = await resolved.json();
  assert.equal(body.gameId, createBody.game.id);
  assert.equal(body.inviteFromRole, "Player 1");
});

test("split-stack integration forwards history and return-to-live shell routes through the Pages proxy", async () => {
  const env = buildEnv();
  const apiServiceEnv = {
    API_SERVICE: {
      fetch(request) {
        return apiWorker.fetch(request, env);
      },
    },
  };

  const create = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/shell/games?offline=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-history", playgroundMode: true, offlineLocal: false }),
    }),
    env: apiServiceEnv,
  });
  const createBody = await create.json();

  const move = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/games/${createBody.game.id}/moves?offline=0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-history", notation: "M1" }),
    }),
    env: apiServiceEnv,
  });
  assert.equal(move.status, 200);

  const history = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/games/${createBody.game.id}/history?offline=0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-history", moveIndex: 0 }),
    }),
    env: apiServiceEnv,
  });
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.equal(historyBody.game.inHistoryMode, true);
  assert.equal(historyBody.game.historyIndex, 0);

  const live = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/games/${createBody.game.id}/live?offline=0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-history" }),
    }),
    env: apiServiceEnv,
  });
  assert.equal(live.status, 200);
  const liveBody = await live.json();
  assert.equal(liveBody.game.inHistoryMode, false);
  assert.equal(liveBody.game.historyIndex, null);
});

test("split-stack integration forwards presence updates through the Pages proxy", async () => {
  const env = buildEnv();
  const create = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/shell/games?offline=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-presence", playgroundMode: false, offlineLocal: false }),
    }),
    env: {
      API_SERVICE: {
        fetch(request) {
          return apiWorker.fetch(request, env);
        },
      },
    },
  });
  const createdBody = await create.json();

  const response = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/games/${createdBody.game.id}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId: "id-presence",
        sessionId: "session-through-proxy",
        status: "disconnecting",
        lastEventSeq: 0,
      }),
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
  assert.equal(typeof body.eventSeq, "number");
});

test("split-stack integration forwards go-online guardrails through the Pages proxy", async () => {
  const env = buildEnv();
  const apiServiceEnv = {
    API_SERVICE: {
      fetch(request) {
        return apiWorker.fetch(request, env);
      },
    },
  };

  const create = await proxyRequest({
    request: new Request("https://righelt.pages.dev/api/shell/games?offline=0", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    }),
    env: apiServiceEnv,
  });
  const createBody = await create.json();

  const goOnline = await proxyRequest({
    request: new Request(`https://righelt.pages.dev/api/shell/games/${createBody.game.id}/go-online?offline=0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-owner", confirmed: true }),
    }),
    env: apiServiceEnv,
  });

  assert.equal(goOnline.status, 409);
  const body = await goOnline.json();
  assert.equal(body.error, "game_not_offline_local");
});
