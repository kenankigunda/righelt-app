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

const createMockWindow = ({ protocol = "https:", hostname = "righelt.pages.dev", host = "righelt.pages.dev", port = "" } = {}) => {
  const listeners = new Map();
  return {
    location: {
      protocol,
      hostname,
      host,
      port,
      origin: `${protocol}//${host}`,
    },
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

const setGlobalNavigator = (value) => {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
};

test("live sync routes local dev websocket traffic directly to the API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow({ protocol: "http:", hostname: "localhost", host: "localhost:8788", port: "8788" });
  globalThis.document = createMockDocument();
  setGlobalNavigator({ onLine: true });

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
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync routes suffixed local dev websocket traffic to the matching API worker", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow({ protocol: "http:", hostname: "localhost", host: "localhost:8789", port: "8789" });
  globalThis.document = createMockDocument();
  setGlobalNavigator({ onLine: true });

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
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync keeps same-origin websocket host outside local dev", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow();
  globalThis.document = createMockDocument();
  setGlobalNavigator({ onLine: true });

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
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync can maintain separate sockets per game and disconnect only one subscription", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow();
  globalThis.document = createMockDocument();
  setGlobalNavigator({ onLine: true });

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
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync suspends hidden-tab sockets and reconnects on visibility restore", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const documentMock = createMockDocument();
  const statuses = [];

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow();
  globalThis.document = documentMock;
  setGlobalNavigator({ onLine: true });

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
    const firstSessionId = new URL(MockSocket.instances[0].url).searchParams.get("sessionId");
    MockSocket.instances[0].emit("open");

    documentMock.hidden = true;
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent("visibilitychange");
    await flushAsync(5);

    assert.equal(statuses.some((status) => status.state === "suspended" && status.gameId === "g-visibility"), true);
    assert.equal(MockSocket.instances[0].sent.some((payload) => JSON.parse(payload).type === "inactive"), true);

    documentMock.hidden = false;
    documentMock.visibilityState = "visible";
    documentMock.dispatchEvent("visibilitychange");

    assert.equal(MockSocket.instances.length, 2);
    assert.match(MockSocket.instances[1].url, /g-visibility\/ws/);
    assert.notEqual(new URL(MockSocket.instances[1].url).searchParams.get("sessionId"), firstSessionId);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync heartbeats only while visible and online, then resume after recovery", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const documentMock = createMockDocument();
  const windowMock = createMockWindow();

  globalThis.WebSocket = MockSocket;
  globalThis.window = windowMock;
  globalThis.document = documentMock;
  setGlobalNavigator({ onLine: true });

  try {
    const client = createLiveSyncClient({
      identityId: "id-heartbeat-window",
      getLastEventSeq: () => 2,
      onEvent: () => {},
      heartbeatMs: 5,
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-heartbeat-window");
    MockSocket.instances[0].emit("open");
    await flushAsync(12);
    const baselineHeartbeats = MockSocket.instances[0].sent.filter((payload) => JSON.parse(payload).type === "heartbeat").length;
    assert.equal(baselineHeartbeats >= 2, true);

    documentMock.hidden = true;
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent("visibilitychange");
    const hiddenCountBefore = MockSocket.instances[0].sent.filter((payload) => JSON.parse(payload).type === "heartbeat").length;
    await flushAsync(12);
    const hiddenCountAfter = MockSocket.instances[0].sent.filter((payload) => JSON.parse(payload).type === "heartbeat").length;
    assert.equal(hiddenCountAfter, hiddenCountBefore);

    documentMock.hidden = false;
    documentMock.visibilityState = "visible";
    documentMock.dispatchEvent("visibilitychange");
    await flushAsync(12);
    const resumedHeartbeats = MockSocket.instances[0].sent.filter((payload) => JSON.parse(payload).type === "heartbeat").length;
    assert.equal(resumedHeartbeats > hiddenCountAfter, true);

    globalThis.navigator.onLine = false;
    windowMock.dispatchEvent("offline");
    await flushAsync(0);
    const closedAtOffline = MockSocket.instances.length;
    assert.equal(closedAtOffline >= 1, true);

    globalThis.navigator.onLine = true;
    windowMock.dispatchEvent("online");
    MockSocket.instances[1].emit("open");
    await flushAsync(12);
    const recoveredHeartbeats = MockSocket.instances[1].sent.filter((payload) => JSON.parse(payload).type === "heartbeat").length;
    assert.equal(recoveredHeartbeats >= 2, true);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync does not reconnect after intentional disconnect", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const documentMock = createMockDocument();

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow();
  globalThis.document = documentMock;
  setGlobalNavigator({ onLine: true });

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
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync does not send websocket ack frames after receiving events", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;

  globalThis.WebSocket = MockSocket;
  globalThis.window = createMockWindow();
  globalThis.document = createMockDocument();
  setGlobalNavigator({ onLine: true });

  try {
    const client = createLiveSyncClient({
      identityId: "id-no-ack",
      getLastEventSeq: () => 2,
      onEvent: () => {},
    });

    client.connectGame("g-no-ack");
    MockSocket.instances[0].emit("open");
    MockSocket.instances[0].sent.length = 0;
    MockSocket.instances[0].emit("message", { data: JSON.stringify({ type: "state_sync", eventSeq: 8 }) });

    assert.equal(MockSocket.instances[0].sent.length, 0);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    MockSocket.instances.length = 0;
  }
});

test("live sync sends beacon-backed disconnect hints on offline and reconnects on online", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const documentMock = createMockDocument();
  const windowMock = createMockWindow({ protocol: "http:", hostname: "localhost", host: "localhost:8789", port: "8789" });
  const beacons = [];
  const fetchCalls = [];

  globalThis.WebSocket = MockSocket;
  globalThis.window = windowMock;
  globalThis.document = documentMock;
  setGlobalNavigator({
    onLine: true,
    sendBeacon(url, payload) {
      beacons.push({ url, payload });
      return true;
    },
  });
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return new Response(null, { status: 200 });
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-online",
      getLastEventSeq: () => 6,
      onEvent: () => {},
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-online");
    MockSocket.instances[0].emit("open");
    globalThis.navigator.onLine = false;
    windowMock.dispatchEvent("offline");
    await flushAsync(0);

    assert.equal(beacons.length, 1);
    assert.equal(String(beacons[0].url), "http://localhost:8789/api/shell/games/g-online/presence");
    assert.equal(fetchCalls.length, 0);

    globalThis.navigator.onLine = true;
    windowMock.dispatchEvent("online");
    assert.equal(MockSocket.instances.length, 2);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    globalThis.fetch = originalFetch;
    MockSocket.instances.length = 0;
  }
});

test("live sync sends disconnecting hints on pagehide and beforeunload", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const windowMock = createMockWindow({ protocol: "http:", hostname: "localhost", host: "localhost:8789", port: "8789" });
  const beacons = [];
  const fetchCalls = [];

  globalThis.WebSocket = MockSocket;
  globalThis.window = windowMock;
  globalThis.document = createMockDocument();
  setGlobalNavigator({
    onLine: true,
    sendBeacon(url, payload) {
      beacons.push({ url, payload });
      return true;
    },
  });
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return new Response(null, { status: 200 });
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-pagehide",
      getLastEventSeq: () => 4,
      onEvent: () => {},
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-pagehide");
    MockSocket.instances[0].emit("open");
    windowMock.dispatchEvent("beforeunload");
    assert.equal(beacons.length, 1);
    assert.equal(String(beacons[0].url), "http://localhost:8789/api/shell/games/g-pagehide/presence");

    windowMock.dispatchEvent("pagehide");
    await flushAsync(0);
    assert.equal(beacons.length, 2);
    assert.equal(String(beacons[1].url), "http://localhost:8789/api/shell/games/g-pagehide/presence");
    assert.equal(fetchCalls.length, 0);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    globalThis.fetch = originalFetch;
    MockSocket.instances.length = 0;
  }
});

test("live sync keeps fetch keepalive presence fallback same-origin in local dev", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const documentMock = createMockDocument();
  const windowMock = createMockWindow({ protocol: "http:", hostname: "localhost", host: "localhost:8789", port: "8789" });
  const fetchCalls = [];

  globalThis.WebSocket = MockSocket;
  globalThis.window = windowMock;
  globalThis.document = documentMock;
  setGlobalNavigator({
    onLine: true,
    sendBeacon() {
      return false;
    },
  });
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return new Response(null, { status: 200 });
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-fetch-fallback",
      getLastEventSeq: () => 9,
      onEvent: () => {},
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });

    client.connectGame("g-fetch-fallback");
    MockSocket.instances[0].emit("open");
    windowMock.dispatchEvent("beforeunload");
    await flushAsync(0);

    assert.equal(fetchCalls.length, 1);
    assert.equal(String(fetchCalls[0].url), "http://localhost:8789/api/shell/games/g-fetch-fallback/presence");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.keepalive, true);
    client.disconnectAll();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    setGlobalNavigator(originalNavigator);
    globalThis.fetch = originalFetch;
    MockSocket.instances.length = 0;
  }
});
