import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

const CACHE_BOOTSTRAP_SHORT = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const CACHE_NO_STORE = "no-store";

function buildEnv() {
  return {
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
  };
}

test("GET /api/engine/playground/state returns deterministic bootstrap payload", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/engine/playground/state", {
    method: "GET",
  });

  const response = await handleApiRequest(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), CACHE_BOOTSTRAP_SHORT);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.state.turnIndex, 0);
  assert.equal(body.state.sideToMove, "P1");
  assert.equal(Array.isArray(body.legalActions), true);
  assert.equal(body.legalActions.some((action) => action.type === "pass"), true);
  assert.equal(body.legalActions.some((action) => action.type === "move"), true);
});

test("bootstrap payload is not affected by client-side mutation of prior response body", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/engine/playground/state", {
    method: "GET",
  });

  const firstResponse = await handleApiRequest(request, env);
  const firstBody = await firstResponse.json();
  firstBody.state.turnIndex = 999;
  firstBody.state.sideToMove = "P2";

  const secondResponse = await handleApiRequest(request, env);
  const secondBody = await secondResponse.json();

  assert.equal(secondBody.state.turnIndex, 0);
  assert.equal(secondBody.state.sideToMove, "P1");
});

test("non-bootstrap API responses remain non-cacheable", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/health", {
    method: "GET",
  });

  const response = await handleApiRequest(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
});

test("startup route keeps a deterministic response body across repeated requests", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/engine/playground/state", {
    method: "GET",
  });

  const firstResponse = await handleApiRequest(request, env);
  const secondResponse = await handleApiRequest(request, env);

  const firstPayload = await firstResponse.text();
  const secondPayload = await secondResponse.text();

  assert.equal(firstPayload, secondPayload);
});

test("startup route keeps deterministic legalActions payload across requests", async () => {
  const env = buildEnv();
  const request = new Request("https://righelt.pages.dev/api/engine/playground/state", {
    method: "GET",
  });

  const firstResponse = await handleApiRequest(request, env);
  const secondResponse = await handleApiRequest(request, env);
  const firstBody = await firstResponse.json();
  const secondBody = await secondResponse.json();

  assert.deepEqual(firstBody.legalActions, secondBody.legalActions);
});

test("mutable and validation endpoints default to no-store cache policy", async () => {
  const env = buildEnv();
  const requestCases = [
    new Request("https://righelt.pages.dev/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    new Request("https://righelt.pages.dev/api/engine/playground/hash", {
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
