import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";

const env = {
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
    },
  },
};

test("/api/shell/ws returns 426 when runtime has no WebSocketPair support", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/shell/ws?scope=home&identityId=id-a"),
    env,
  );

  assert.equal(response.status, 426);
});

test("/api/shell/ws close immediately disconnects participant unless another socket remains active", async () => {
  const OriginalWebSocketPair = globalThis.WebSocketPair;
  const OriginalResponse = globalThis.Response;

  class MockSocket {
    constructor() {
      this.listeners = new Map();
    }
    accept() {}
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) {
        this.listeners.set(name, []);
      }
      this.listeners.get(name).push(fn);
    }
    send() {}
    close() {
      const handlers = this.listeners.get("close") || [];
      for (const handler of handlers) {
        handler({});
      }
    }
  }

  class MockWebSocketPair {
    constructor() {
      const client = new MockSocket();
      const server = new MockSocket();
      MockWebSocketPair.instances.push({ client, server });
      this[0] = client;
      this[1] = server;
    }
    static instances = [];
  }

  globalThis.WebSocketPair = MockWebSocketPair;

  try {
    const create = await handleApiRequest(
      new Request("https://example.test/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
      }),
      env,
    );
    const gameId = (await create.json()).game.id;

    await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-player2", mode: "player", inviteFromRole: "Player 1" }),
      }),
      env,
    );

    globalThis.Response = class MockUpgradeResponse {
      constructor(_body, init = {}) {
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
      }
    };

    const wsOne = await handleApiRequest(
      new Request(`https://example.test/api/shell/ws?scope=game&gameId=${gameId}&identityId=id-player2`),
      env,
    );
    assert.equal(wsOne.status, 101);
    globalThis.Response = OriginalResponse;

    let view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    let body = await view.json();
    assert.equal(body.game.player2.connected, true);

    const firstServer = MockWebSocketPair.instances[0].server;
    firstServer.close();

    view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    body = await view.json();
    assert.equal(body.game.player2.connected, false);

    globalThis.Response = class MockUpgradeResponse {
      constructor(_body, init = {}) {
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
      }
    };
    await handleApiRequest(
      new Request(`https://example.test/api/shell/ws?scope=game&gameId=${gameId}&identityId=id-player2`),
      env,
    );
    await handleApiRequest(
      new Request(`https://example.test/api/shell/ws?scope=home&identityId=id-player2`),
      env,
    );
    globalThis.Response = OriginalResponse;

    view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    body = await view.json();
    assert.equal(body.game.player2.connected, true);

    const secondServer = MockWebSocketPair.instances[1].server;
    secondServer.close();

    view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    body = await view.json();
    assert.equal(body.game.player2.connected, true);

    const thirdServer = MockWebSocketPair.instances[2].server;
    thirdServer.close();

    view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    body = await view.json();
    assert.equal(body.game.player2.connected, false);
  } finally {
    globalThis.WebSocketPair = OriginalWebSocketPair;
    globalThis.Response = OriginalResponse;
  }
});
