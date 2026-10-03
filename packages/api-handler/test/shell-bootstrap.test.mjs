import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const env = {
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() { return {activated_at:null,maintenance:0,canary_account_id:null}; },
        async run() {
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
    },
  },
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

test("/api/shell/bootstrap is deterministic and does not cache account cutover policy", async () => {
  const a = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), env);
  const b = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), env);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.headers.get("cache-control"), "no-store");

  const bodyA = await a.json();
  const bodyB = await b.json();
  assert.deepEqual(bodyA, bodyB);
  assert.equal(bodyA.app, "righelt-web-shell");
  assert.ok(Array.isArray(bodyA.tutorialSteps));
});

test("bootstrap exposes only the public Turnstile key when accounts are enabled", async () => {
  const authEnv = { ...env, AUTH_ENABLED: "true", AUTH_TURNSTILE_SITE_KEY: "public-test-key", TURNSTILE_SECRET: "private-test-secret" };
  const response = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), authEnv);
  const body = await response.json();
  assert.equal(body.accountsRequired, true);
  assert.equal(body.turnstileSiteKey, "public-test-key");
  assert.equal(JSON.stringify(body).includes("private-test-secret"), false);
  const disabled = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), { ...authEnv, AUTH_ENABLED: "false" });
  assert.equal(Object.hasOwn(await disabled.json(), "turnstileSiteKey"), false);
});
