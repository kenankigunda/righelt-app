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

test("live sync connects to home and game websocket scopes and forwards events", async () => {
  const originalWs = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  const events = [];
  globalThis.WebSocket = MockSocket;
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

    MockSocket.instances[0].emit("message", { data: JSON.stringify({ type: "game.updated", gameId: "g1" }) });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "game.updated");

    client.connectGame("g-123");
    assert.equal(MockSocket.instances.length, 2);
    assert.match(MockSocket.instances[1].url, /scope=game/);
    assert.match(MockSocket.instances[1].url, /gameId=g-123/);

    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
    globalThis.window = originalWindow;
    MockSocket.instances.length = 0;
  }
});
