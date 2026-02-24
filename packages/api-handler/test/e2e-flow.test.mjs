import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

const CACHE_BOOTSTRAP_SHORT = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const CACHE_NO_STORE = "no-store";

function buildEnv() {
  let lastMessage = null;

  return {
    env: {
      DB: {
        prepare(query) {
          assert.equal(query, "INSERT INTO milestone_actions (message) VALUES (?1)");
          return {
            bind(message) {
              lastMessage = message;
              return this;
            },
            async run() {
              return { success: true, meta: { last_row_id: 42 } };
            },
          };
        },
      },
    },
    getLastMessage() {
      return lastMessage;
    },
  };
}

test("end-to-end API flow returns consistent state transitions and cache contracts", async () => {
  const { env } = buildEnv();

  const startupResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  assert.equal(startupResponse.status, 200);
  assert.equal(startupResponse.headers.get("cache-control"), CACHE_BOOTSTRAP_SHORT);
  const startupBody = await startupResponse.json();
  assert.equal(startupBody.ok, true);

  const legalResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: startupBody.state }),
    }),
    env,
  );
  assert.equal(legalResponse.status, 200);
  assert.equal(legalResponse.headers.get("cache-control"), CACHE_NO_STORE);
  const legalBody = await legalResponse.json();
  assert.equal(legalBody.ok, true);
  assert.equal(Array.isArray(legalBody.legalActions), true);
  assert.equal(legalBody.legalActions.length > 0, true);

  const applyResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: legalBody.state,
        action: legalBody.legalActions[0],
      }),
    }),
    env,
  );

  assert.equal(applyResponse.status, 200);
  assert.equal(applyResponse.headers.get("cache-control"), CACHE_NO_STORE);
  const applyBody = await applyResponse.json();
  assert.equal(applyBody.ok, true);
  assert.equal(applyBody.accepted, true);
  assert.equal(applyBody.state.turnIndex, 1);
  assert.equal(applyBody.state.sideToMove, "P2");

  const hashResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/hash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: applyBody.state }),
    }),
    env,
  );
  assert.equal(hashResponse.status, 200);
  assert.equal(hashResponse.headers.get("cache-control"), CACHE_NO_STORE);
  const hashBody = await hashResponse.json();
  assert.equal(hashBody.ok, true);
  assert.equal(typeof hashBody.hash, "string");
  assert.equal(hashBody.hash.length > 0, true);

  const validateResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/commands/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: { type: "pass" } }),
    }),
    env,
  );
  assert.equal(validateResponse.status, 200);
  assert.equal(validateResponse.headers.get("cache-control"), CACHE_NO_STORE);
  const validateBody = await validateResponse.json();
  assert.equal(validateBody.ok, true);
  assert.equal(validateBody.accepted, true);
  assert.equal(validateBody.commandType, "pass");
});

test("/api/test-action trims message, writes DB row, and returns event payload", async () => {
  const { env, getLastMessage } = buildEnv();

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/test-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   Hello from E2E   " }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.actionId, 42);
  assert.equal(body.event.type, "test_action_recorded");
  assert.equal(body.event.payload.message, "Hello from E2E");
  assert.equal(getLastMessage(), "Hello from E2E");
});
