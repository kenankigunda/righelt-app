import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "./support/v2-test-adapter.mjs";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const env = {
  DB: createFakeD1(),
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));
const wsUrl = (gameId, identityId, sessionId, lastEventSeq = 0) =>
  `https://example.test/api/shell/games/${gameId}/ws?identityId=${identityId}&sessionId=${sessionId}&lastEventSeq=${lastEventSeq}`;

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.peer = null;
    this.listeners = new Map();
    this.sent = [];
    this.attachment = null;
    this.__runtime = null;
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return this.attachment ? structuredClone(this.attachment) : null;
  }

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
    if (this.peer?.__runtime && this.peer.readyState !== 3) {
      void this.peer.__runtime.webSocketMessage(this.peer, data);
      return;
    }
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
      if (this.peer.__runtime) {
        void this.peer.__runtime.webSocketClose(this.peer, 1000, "", true);
      }
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
  const response = await handleApiRequest(new Request(wsUrl(createBody.game.id, "id-a", "session-a")), env);

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
      new Request(wsUrl(gameId, "id-a", "session-dual")),
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

    client.send(JSON.stringify({ type: "heartbeat", identityId: "id-a", sessionId: "session-dual", lastEventSeq: 0 }));
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
      new Request(wsUrl(gameId, "id-heartbeat", "session-heartbeat")),
      env,
    );

    const client = response.webSocket;
    assert.ok(client);

    const persistedBeforeHeartbeat = env.DB.getGameState(gameId);
    const eventCountBeforeHeartbeat = env.DB.getEvents(gameId).length;

    client.send(JSON.stringify({ type: "heartbeat", identityId: "id-heartbeat", sessionId: "session-heartbeat", lastEventSeq: 0 }));
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

test("/api/shell/games/:id/ws replays contiguous events on reconnect when lastEventSeq is current-1", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return { status: 101, headers: new Headers(init.headers ?? {}), webSocket: init.webSocket };
    }
    return new RealResponse(body, init);
  };

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-replay" }),
      }),
      env,
    );
    const createdBody = await create.json();
    const gameId = createdBody.game.id;

    const first = await handleApiRequest(new Request(wsUrl(gameId, "id-replay", "session-replay-1")), env);
    assert.equal(first.status, 101);

    const move = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-replay" }),
      }),
      env,
    );
    const moveBody = await move.json();
    first.webSocket.close();
    await flushAsync();

    const replay = await handleApiRequest(
      new Request(wsUrl(gameId, "id-replay", "session-replay-2", moveBody.eventSeq - 1)),
      env,
    );
    assert.equal(replay.status, 101);

    const sent = replay.webSocket.peer.sent.map((payload) => JSON.parse(payload));
    const replayEvent = sent.find((payload) => payload.type === "event_appended" && payload.eventSeq === moveBody.eventSeq);
    assert.ok(replayEvent);
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
  }
});

test("/api/shell/games/:id/ws sends state_sync fallback when reconnect has no replay cursor", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return { status: 101, headers: new Headers(init.headers ?? {}), webSocket: init.webSocket };
    }
    return new RealResponse(body, init);
  };

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-sync" }),
      }),
      env,
    );
    const createdBody = await create.json();
    const gameId = createdBody.game.id;

    await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-sync" }),
      }),
      env,
    );

    const response = await handleApiRequest(new Request(wsUrl(gameId, "id-sync", "session-sync", 0)), env);
    assert.equal(response.status, 101);

    const sent = response.webSocket.peer.sent.map((payload) => JSON.parse(payload));
    const syncEvent = sent.find((payload) => payload.type === "state_sync");
    assert.ok(syncEvent);
    assert.equal(syncEvent.reason, "connected");
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
  }
});

test("/api/shell/games/:id/presence marks only the matching session inactive", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return { status: 101, headers: new Headers(init.headers ?? {}), webSocket: init.webSocket };
    }
    return new RealResponse(body, init);
  };

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-multi" }),
      }),
      env,
    );
    const { game } = await create.json();

    const first = await handleApiRequest(new Request(wsUrl(game.id, "id-multi", "session-1")), env);
    const second = await handleApiRequest(new Request(wsUrl(game.id, "id-multi", "session-2")), env);
    assert.ok(first.webSocket);
    assert.ok(second.webSocket);

    let state = env.DB.getGameState(game.id);
    assert.equal(state.player1.sessionCount, 2);

    const presenceResponse = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${game.id}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-multi", sessionId: "session-1", status: "inactive", lastEventSeq: 0 }),
      }),
      env,
    );
    assert.equal(presenceResponse.status, 200);
    await flushAsync();

    state = env.DB.getGameState(game.id);
    assert.equal(state.player1.connected, true);
    assert.equal(state.player1.sessionCount, 1);
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
  }
});

test("GameRoomDO alarm clears stale active sessions and does not keep dormant games scheduled", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  const realNow = Date.now;
  let fakeNow = new Date("2026-02-26T00:00:00.000Z").getTime();
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return { status: 101, headers: new Headers(init.headers ?? {}), webSocket: init.webSocket };
    }
    return new RealResponse(body, init);
  };
  Date.now = () => fakeNow;

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-alarm" }),
      }),
      env,
    );
    const { game } = await create.json();

    await handleApiRequest(new Request(wsUrl(game.id, "id-alarm", "session-alarm")), env);
    assert.ok(env.GAME_ROOMS.getAlarm(game.id));

    fakeNow += 96_000;
    await env.GAME_ROOMS.fireAlarm(game.id);

    const state = env.DB.getGameState(game.id);
    assert.equal(state.player1.connected, false);
    assert.equal(state.player1.sessionCount, 0);
    assert.equal(env.GAME_ROOMS.getAlarm(game.id), null);
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
    Date.now = realNow;
  }
});

test("GameRoomDO restores session attachments after a restart", async () => {
  const realWebSocketPair = globalThis.WebSocketPair;
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = FakeWebSocketPair;
  globalThis.Response = function ResponseShim(body, init = {}) {
    if (init?.status === 101) {
      return { status: 101, headers: new Headers(init.headers ?? {}), webSocket: init.webSocket };
    }
    return new RealResponse(body, init);
  };

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-restart" }),
      }),
      env,
    );
    const { game } = await create.json();

    const response = await handleApiRequest(new Request(wsUrl(game.id, "id-restart", "session-restart")), env);
    assert.equal(response.status, 101);
    env.GAME_ROOMS.restart(game.id);

    response.webSocket.send(JSON.stringify({ type: "heartbeat", identityId: "id-restart", sessionId: "session-restart", lastEventSeq: 0 }));
    await flushAsync();

    const state = env.DB.getGameState(game.id);
    assert.equal(state.player1.connected, true);
    assert.equal(state.player1.sessionCount, 1);
  } finally {
    globalThis.WebSocketPair = realWebSocketPair;
    globalThis.Response = RealResponse;
  }
});
