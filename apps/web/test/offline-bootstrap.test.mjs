import test from "node:test";
import assert from "node:assert/strict";

import { OFFLINE_SHELL_ASSETS, OFFLINE_SHELL_CACHE, registerOfflineShellServiceWorker } from "../offline/bootstrap.js";

test("offline bootstrap precaches the shell assets required for offline-local startup", () => {
  assert.equal(OFFLINE_SHELL_CACHE, "righelt-offline-shell-v1");
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/index.html"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/main.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/shell/app.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/shell/live-transport.js"), true);
  assert.equal(OFFLINE_SHELL_ASSETS.includes("/generated/packages/game-engine/src/index.js"), true);
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
