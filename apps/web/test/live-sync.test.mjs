import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSyncClient } from "../shell/live-sync.js";

class MockSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
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

test("live sync connects to home and game websocket scopes and forwards events", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = [];

  const events = [];
  globalThis.WebSocket = MockSocket;
  globalThis.setInterval = (fn, delay) => {
    const token = { fn, delay, cleared: false };
    intervals.push(token);
    return token;
  };
  globalThis.clearInterval = (token) => {
    if (token) {
      token.cleared = true;
    }
  };
  globalThis.window = {
    location: {
      protocol: "http:",
      host: "localhost:8788",
    },
  };

  try {
    const client = createLiveSyncClient({
      identityId: "id-a",
      onEvent: (payload) => events.push(payload),
    });

    client.connectHome();
    assert.equal(MockSocket.instances.length, 1);
    assert.match(MockSocket.instances[0].url, /scope=home/);
    MockSocket.instances[0].emit("open");
    assert.equal(intervals.length, 1);
    intervals[0].fn();
    assert.deepEqual(MockSocket.instances[0].sent, ["ping"]);

    MockSocket.instances[0].emit("message", { data: JSON.stringify({ type: "game.updated", gameId: "g1" }) });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "game.updated");

    client.connectGame("g-123");
    assert.equal(MockSocket.instances.length, 2);
    assert.match(MockSocket.instances[1].url, /scope=game/);
    assert.match(MockSocket.instances[1].url, /gameId=g-123/);

    client.disconnect();
    assert.equal(intervals[0].cleared, true);
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    MockSocket.instances.length = 0;
  }
});
