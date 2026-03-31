import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_SHELL_ASSETS,
  OFFLINE_SHELL_CACHE,
  handleOfflineShellFetch,
  isOfflineShellRequest,
  registerOfflineShellServiceWorker,
} from "../offline/bootstrap.js";

test("offline bootstrap precaches the shell assets required for offline-local startup", () => {
  assert.equal(OFFLINE_SHELL_CACHE, "righelt-offline-shell-v2");
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/index.html"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/main.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/shell/app.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/shell/live-transport.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/generated/packages/game-engine/src/index.js"), true);
});

test("offline bootstrap treats shell assets as offline-cacheable but excludes API requests", () => {
  assert.equal(isOfflineShellRequest(new Request("https://righelt.pages.dev/main.js")), true);
  assert.equal(isOfflineShellRequest(new Request("https://righelt.pages.dev/#/game/abc", { method: "GET" })), true);
  assert.equal(isOfflineShellRequest(new Request("https://righelt.pages.dev/api/shell/games")), false);
});

test("offline bootstrap prefers fresh network shell assets and refreshes the cache", async () => {
  const stored = new Map();
  const cache = {
    async put(key, value) {
      stored.set(typeof key === "string" ? key : key.url, value);
    },
    async match(key) {
      return stored.get(typeof key === "string" ? key : key.url) ?? null;
    },
  };
  const cacheStorage = {
    async open() {
      return cache;
    },
  };
  const networkResponse = new Response("fresh-shell", { status: 200 });
  const request = new Request("https://righelt.pages.dev/main.js");

  const response = await handleOfflineShellFetch({
    request,
    cacheStorage,
    fetcher: async () => networkResponse,
  });

  assert.equal(await response.text(), "fresh-shell");
  assert.equal(await (await cache.match(request)).text(), "fresh-shell");
});

test("offline bootstrap falls back to cached shell assets when the network is unavailable", async () => {
  const cachedResponse = new Response("cached-shell", { status: 200 });
  const stored = new Map([["https://righelt.pages.dev/main.js", cachedResponse.clone()]]);
  const cache = {
    async put(key, value) {
      stored.set(typeof key === "string" ? key : key.url, value);
    },
    async match(key) {
      return stored.get(typeof key === "string" ? key : key.url) ?? null;
    },
  };
  const cacheStorage = {
    async open() {
      return cache;
    },
  };
  const request = new Request("https://righelt.pages.dev/main.js");

  const response = await handleOfflineShellFetch({
    request,
    cacheStorage,
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(await response.text(), "cached-shell");
});

test("offline bootstrap registers the service worker as a module at the app root", async () => {
  const calls = [];
  const result = await registerOfflineShellServiceWorker(
    {
      serviceWorker: {
        register(url, options) {
          calls.push({ url, options });
          return Promise.resolve({ scope: options.scope });
        },
      },
    },
    { href: "https://righelt.pages.dev/#/home" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ url: "/offline-sw.js", options: { scope: "/", type: "module" } }]);
});

test("offline bootstrap exits cleanly when service workers are unsupported", async () => {
  const result = await registerOfflineShellServiceWorker({}, { href: "https://righelt.pages.dev/" });
  assert.deepEqual(result, { ok: false, reason: "unsupported" });
});
