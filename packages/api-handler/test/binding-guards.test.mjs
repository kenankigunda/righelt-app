import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

const buildEnv = () => ({
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  },
});

test("shell create-game fails with stable misconfiguration error when GAME_ROOMS binding is missing", async () => {
  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-a", selfPlayMode: false }),
    }),
    buildEnv(),
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: "server_misconfigured_game_rooms_binding",
  });
});
