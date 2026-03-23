import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const env = {
  DB: createFakeD1(),
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.peer = null;
    this.listeners = new Map();
    this.sent = [];
  }

  accept() {}

  addEventListener(type, handler) {
    const current = this.listeners.get(type) ?? [];
    current.push(handler);
    this.listeners.set(type, current);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  send(data) {
    this.sent.push(data);
    this.peer?.dispatch("message", { data });
  }

  close() {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.dispatch("close", {});
    if (this.peer && this.peer.readyState !== 3) {
      this.peer.readyState = 3;
      this.peer.dispatch("close", {});
    }
  }
}

class FakeWebSocketPair {
  constructor() {
    const client = new FakeSocket();
    const server = new FakeSocket();
    client.peer = server;
    server.peer = client;
    this[0] = client;
    this[1] = server;
  }
}

test("/api/shell/games/:id/ws returns 426 when runtime has no WebSocketPair support", async () => {
  const create = await handleApiRequest(
    new Request("https://example.test/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-a" }),
    }),
    env,
  );
  const createBody = await create.json();
  const response = await handleApiRequest(new Request(`https://example.test/api/shell/games/${createBody.game.id}/ws?identityId=id-a&lastEventSeq=0`), env);

  assert.equal(response.status, 426);
});

test("/api/shell/games/:id/ws syncs both seats for a dual-seat identity", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  const realNow = Date.now;
  let fakeNow = new Date("2026-02-26T00:00:00.000Z").getTime();
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return {
        status: 101,
        headers: new Headers(init.headers ?? {}),
        webSocket: init.webSocket,
      };
    }
    return new RealResponse(body, init);
  };
  Date.now = () => fakeNow;

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-a" }),
      }),
      env,
    );
    const createdBody = await create.json();
    const gameId = createdBody.game.id;

    await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/play-as-both`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-a" }),
      }),
      env,
    );

    const response = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/ws?identityId=id-a&lastEventSeq=0`),
      env,
    );

    assert.equal(response.status, 101);
    const client = response.webSocket;
    assert.ok(client);

    let state = env.DB.getGameState(gameId);
    assert.equal(state.player1.connected, true);
    assert.equal(state.player2.connected, true);
    let lastEvent = env.DB.getEvents(gameId).at(-1);
    let payload = JSON.parse(lastEvent.payload_json);
    assert.equal(payload.type, "presence_changed");
    assert.equal(payload.role, "Player 1");
    assert.deepEqual(payload.roles, ["Player 1", "Player 2"]);

    client.send(JSON.stringify({ type: "heartbeat", identityId: "id-a", lastEventSeq: 0 }));
    await flushAsync();
    state = env.DB.getGameState(gameId);
    assert.equal(state.player1.connected, true);
    assert.equal(state.player2.connected, true);
    assert.equal(state.player1.sessionCount, 1);
    assert.equal(state.player2.sessionCount, 1);

    client.close();
    await flushAsync();
    state = env.DB.getGameState(gameId);
    assert.equal(state.player1.connected, false);
    assert.equal(state.player2.connected, false);
    assert.equal(state.player1.sessionCount, 0);
    assert.equal(state.player2.sessionCount, 0);
    lastEvent = env.DB.getEvents(gameId).at(-1);
    payload = JSON.parse(lastEvent.payload_json);
    assert.equal(payload.type, "presence_changed");
    assert.deepEqual(payload.roles, ["Player 1", "Player 2"]);
    assert.equal(payload.connected, false);
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
    Date.now = realNow;
  }
});

test("/api/shell/games/:id/ws heartbeat does not persist or append events when presence is unchanged", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return {
        status: 101,
        headers: new Headers(init.headers ?? {}),
        webSocket: init.webSocket,
      };
    }
    return new RealResponse(body, init);
  };

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-heartbeat" }),
      }),
      env,
    );
    const createdBody = await create.json();
    const gameId = createdBody.game.id;

    const response = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/ws?identityId=id-heartbeat&lastEventSeq=0`),
      env,
    );

    const client = response.webSocket;
    assert.ok(client);

    const persistedBeforeHeartbeat = env.DB.getGameState(gameId);
    const eventCountBeforeHeartbeat = env.DB.getEvents(gameId).length;

    client.send(JSON.stringify({ type: "heartbeat", identityId: "id-heartbeat", lastEventSeq: 0 }));
    await flushAsync();

    const persistedAfterHeartbeat = env.DB.getGameState(gameId);
    const eventCountAfterHeartbeat = env.DB.getEvents(gameId).length;

    assert.equal(eventCountAfterHeartbeat, eventCountBeforeHeartbeat);
    assert.equal(persistedAfterHeartbeat.player1.lastHeartbeatAt, persistedBeforeHeartbeat.player1.lastHeartbeatAt);

    client.close();
    await flushAsync();
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
  }
});
