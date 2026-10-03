import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

const CACHE_NO_STORE = "no-store";

function buildEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {return {activated_at:null,maintenance:0,canary_account_id:null};},
          async run() {
            return { success: true, meta: { last_row_id: 1 } };
          },
        };
      },
    },
    GAME_ROOMS: {
      idFromName(name) {
        return { name };
      },
      get() {
        return {
          async fetch() {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            });
          },
        };
      },
    },
  };
}

test("deprecated engine playground endpoints return not_found", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" });
  const response = await handleApiRequest(request, env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "not_found");
});

test("mutable and validation endpoints default to no-store cache policy", async () => {
  const env = buildEnv();
  const requestCases = [
    new Request("https://righelt.pages.dev/api/health", {
      method: "GET",
    }),
    new Request("https://righelt.pages.dev/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    new Request("https://righelt.pages.dev/api/commands/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    new Request("https://righelt.pages.dev/api/unknown", {
      method: "GET",
    }),
  ];

  for (const request of requestCases) {
    const response = await handleApiRequest(request, env);
    assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  }
});

test("/api/health reports missing GAME_ROOMS binding as unhealthy", async () => {
  const env = buildEnv();
  delete env.GAME_ROOMS;

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/health", {
      method: "GET",
    }),
    env,
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.bindings.gameRooms, false);
});
