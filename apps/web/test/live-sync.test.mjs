import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSyncClient } from "../shell/live-sync.js";

class MockSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.readyState = 0;
    this.sent = [];
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
    if (name === "open") {
      this.readyState = 1;
    }
    if (name === "close") {
      this.readyState = 3;
    }
    const handlers = this.listeners.get(name) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.emit("close", {});
  }
}

const createMockDocument = () => {
  const listeners = new Map();
  return {
    hidden: false,
    visibilityState: "visible",
    addEventListener(name, handler) {
      const current = listeners.get(name) ?? [];
      current.push(handler);
      listeners.set(name, current);
    },
    dispatchEvent(name) {
      for (const handler of listeners.get(name) ?? []) {
        handler();
      }
    },
  };
};

const flushAsync = async (delay = 0) => {
  await new Promise((resolve) => setTimeout(resolve, delay));
};

test("live sync routes local dev websocket traffic directly to the API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:8788",
      port: "8788",
    },
  };
  globalThis.document = createMockDocument();

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
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});

test("live sync routes suffixed local dev websocket traffic to the matching API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:8789",
      port: "8789",
    },
  };
  globalThis.document = createMockDocument();

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
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});

test("live sync keeps same-origin websocket host outside local dev", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };
  globalThis.document = createMockDocument();

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
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});

test("live sync can maintain separate sockets per game and disconnect only one subscription", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };
  globalThis.document = createMockDocument();

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
    MockSocket.instances[0].emit("open");
    MockSocket.instances[1].emit("open");

    MockSocket.instances[1].emit("message", { data: JSON.stringify({ type: "state_sync", eventSeq: 8 }) });
    assert.deepEqual(events, ["g-2"]);

    client.disconnectGame("g-1");
    assert.equal(MockSocket.instances.length, 2);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});

test("live sync suspends hidden-tab sockets and reconnects on visibility restore", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const documentMock = createMockDocument();
  const statuses = [];

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };
  globalThis.document = documentMock;

  try {
    const client = createLiveSyncClient({
      identityId: "id-visibility",
      getLastEventSeq: () => 3,
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
      visibilitySuspendGraceMs: 1,
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-visibility");
    assert.equal(MockSocket.instances.length, 1);
    MockSocket.instances[0].emit("open");

    documentMock.hidden = true;
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent("visibilitychange");
    await flushAsync(5);

    assert.equal(statuses.some((status) => status.state === "suspended" && status.gameId === "g-visibility"), true);

    documentMock.hidden = false;
    documentMock.visibilityState = "visible";
    documentMock.dispatchEvent("visibilitychange");

    assert.equal(MockSocket.instances.length, 2);
    assert.match(MockSocket.instances[1].url, /g-visibility\/ws/);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});

test("live sync does not reconnect after intentional disconnect", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const documentMock = createMockDocument();

  globalThis.WebSocket = MockSocket;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "righelt.pages.dev",
      host: "righelt.pages.dev",
      port: "",
    },
  };
  globalThis.document = documentMock;

  try {
    const client = createLiveSyncClient({
      identityId: "id-stop",
      getLastEventSeq: () => 1,
      onEvent: () => {},
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-stop");
    assert.equal(MockSocket.instances.length, 1);
    MockSocket.instances[0].emit("open");

    client.disconnectGame("g-stop");
    await flushAsync(15);

    assert.equal(MockSocket.instances.length, 1);
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    MockSocket.instances.length = 0;
  }
});
