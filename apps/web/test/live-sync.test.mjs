import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSyncClient } from "../shell/live-sync.js";

class MockSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    MockSocket.instances.push(this);
  }

  static instances = [];

  addEventListener(name, fn) {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, []);
    }
    this.listeners.get(name).push(fn);
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

test("live sync routes local dev websocket traffic directly to the API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:8788",
      port: "8788",
    },
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-a",
      getLastEventSeq: () => 7,
      onEvent: () => {},
    });

    client.connectGame("g-123");
    assert.equal(MockSocket.instances.length, 1);
    assert.match(MockSocket.instances[0].url, /^ws:\/\/127\.0\.0\.1:8787\//);
    assert.match(MockSocket.instances[0].url, /\/api\/shell\/games\/g-123\/ws/);
    assert.match(MockSocket.instances[0].url, /lastEventSeq=7/);
    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    MockSocket.instances.length = 0;
  }
});

test("live sync routes suffixed local dev websocket traffic to the matching API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:8789",
      port: "8789",
    },
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-b",
      getLastEventSeq: () => 4,
      onEvent: () => {},
    });

    client.connectGame("g-789");
    assert.equal(MockSocket.instances.length, 1);
    assert.match(MockSocket.instances[0].url, /^ws:\/\/127\.0\.0\.1:8792\//);
    assert.match(MockSocket.instances[0].url, /\/api\/shell\/games\/g-789\/ws/);
    assert.match(MockSocket.instances[0].url, /lastEventSeq=4/);
    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    MockSocket.instances.length = 0;
  }
});

test("live sync keeps same-origin websocket host outside local dev", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-a",
      getLastEventSeq: () => 7,
      onEvent: () => {},
    });

    client.connectGame("g-456");
    assert.equal(MockSocket.instances.length, 1);
    assert.match(MockSocket.instances[0].url, /^wss:\/\/righelt\.pages\.dev\//);
    assert.match(MockSocket.instances[0].url, /\/api\/shell\/games\/g-456\/ws/);
    assert.match(MockSocket.instances[0].url, /lastEventSeq=7/);
    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    MockSocket.instances.length = 0;
  }
});

test("live sync can maintain separate sockets per game and disconnect only one subscription", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };

  try {
    const events = [];
    const client = createLiveSyncClient({
      identityId: "id-multi",
      getLastEventSeq: (gameId) => (gameId === "g-1" ? 2 : 5),
      onEvent: (_payload, meta) => {
        events.push(meta?.gameId ?? null);
      },
    });

    client.connectGame("g-1");
    client.connectGame("g-2");
    assert.equal(MockSocket.instances.length, 2);
    assert.match(MockSocket.instances[0].url, /g-1\/ws/);
    assert.match(MockSocket.instances[1].url, /g-2\/ws/);

    MockSocket.instances[1].emit("message", { data: JSON.stringify({ type: "state_sync", eventSeq: 8 }) });
    assert.deepEqual(events, ["g-2"]);

    client.disconnectGame("g-1");
    assert.equal(MockSocket.instances.length, 2);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    MockSocket.instances.length = 0;
  }
});
