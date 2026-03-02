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
      this.sent = [];
    }
    accept() {}
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) {
        this.listeners.set(name, []);
      }
      this.listeners.get(name).push(fn);
    }
    send(payload) {
      this.sent.push(payload);
    }
    emit(name, payload = {}) {
      const handlers = this.listeners.get(name) || [];
      for (const handler of handlers) {
        handler(payload);
      }
    }
    close() {
      this.emit("close", {});
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

test("/api/shell/ws ping refresh keeps an active participant connected", async () => {
  const OriginalWebSocketPair = globalThis.WebSocketPair;
  const OriginalResponse = globalThis.Response;
  const realNow = Date.now;
  let fakeNow = new Date("2026-02-26T00:00:00.000Z").getTime();
  Date.now = () => fakeNow;

  class MockSocket {
    constructor() {
      this.listeners = new Map();
      this.sent = [];
    }
    accept() {}
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) {
        this.listeners.set(name, []);
      }
      this.listeners.get(name).push(fn);
    }
    send(payload) {
      this.sent.push(payload);
    }
    emit(name, payload = {}) {
      const handlers = this.listeners.get(name) || [];
      for (const handler of handlers) {
        handler(payload);
      }
    }
    close() {
      this.emit("close", {});
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

    globalThis.Response = class MockUpgradeResponse {
      constructor(_body, init = {}) {
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
      }
    };

    const upgrade = await handleApiRequest(
      new Request(`https://example.test/api/shell/ws?scope=game&gameId=${gameId}&identityId=id-owner`),
      env,
    );
    assert.equal(upgrade.status, 101);
    globalThis.Response = OriginalResponse;

    fakeNow += 20_000;
    const server = MockWebSocketPair.instances[0].server;
    server.emit("message", { data: "ping" });

    fakeNow += 20_000;
    const view = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    const body = await view.json();
    assert.equal(body.game.player1.connected, true);
    assert.equal(server.sent.some((payload) => String(payload).includes("\"type\":\"pong\"")), true);
  } finally {
    Date.now = realNow;
    globalThis.WebSocketPair = OriginalWebSocketPair;
    globalThis.Response = OriginalResponse;
  }
});

test("/api/shell/ws approved viewer promotion is reflected as a connected player", async () => {
  const OriginalWebSocketPair = globalThis.WebSocketPair;
  const OriginalResponse = globalThis.Response;

  class MockSocket {
    constructor() {
      this.listeners = new Map();
      this.sent = [];
    }
    accept() {}
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) {
        this.listeners.set(name, []);
      }
      this.listeners.get(name).push(fn);
    }
    send(payload) {
      this.sent.push(payload);
    }
    emit(name, payload = {}) {
      const handlers = this.listeners.get(name) || [];
      for (const handler of handlers) {
        handler(payload);
      }
    }
    close() {
      this.emit("close", {});
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
        body: JSON.stringify({ identityId: "id-requester", mode: "player", inviteFromRole: null }),
      }),
      env,
    );

    globalThis.Response = class MockUpgradeResponse {
      constructor(_body, init = {}) {
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
      }
    };
    const upgrade = await handleApiRequest(
      new Request(`https://example.test/api/shell/ws?scope=game&gameId=${gameId}&identityId=id-requester`),
      env,
    );
    assert.equal(upgrade.status, 101);
    globalThis.Response = OriginalResponse;

    await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-owner", requesterIdentityId: "id-requester" }),
      }),
      env,
    );

    await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-requester`),
      env,
    );

    const ownerView = await handleApiRequest(
      new Request(`https://example.test/api/shell/games/${gameId}?identityId=id-owner`),
      env,
    );
    const ownerBody = await ownerView.json();
    assert.equal(ownerBody.game.player2.identityId, "id-requester");
    assert.equal(ownerBody.game.player2.connected, true);
    assert.equal(ownerBody.game.viewers.some((viewer) => viewer.identityId === "id-requester"), false);
  } finally {
    globalThis.WebSocketPair = OriginalWebSocketPair;
    globalThis.Response = OriginalResponse;
  }
});
