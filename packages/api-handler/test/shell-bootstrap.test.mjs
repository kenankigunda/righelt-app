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
        async run() {
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
    },
  },
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

test("/api/shell/bootstrap is deterministic and uses bootstrap cache policy", async () => {
  const a = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), env);
  const b = await handleApiRequest(new Request("https://example.test/api/shell/bootstrap"), env);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.match(a.headers.get("cache-control") || "", /s-maxage=60/);
  assert.match(a.headers.get("cache-control") || "", /stale-while-revalidate=300/);

  const bodyA = await a.json();
  const bodyB = await b.json();
  assert.deepEqual(bodyA, bodyB);
  assert.equal(bodyA.app, "righelt-web-shell");
  assert.ok(Array.isArray(bodyA.tutorialSteps));
});
