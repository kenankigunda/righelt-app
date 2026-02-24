import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

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
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.state.turnIndex, 0);
  assert.equal(body.state.sideToMove, "P1");
  assert.deepEqual(body.legalActions, [{ type: "pass" }]);
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
  assert.equal(response.headers.get("cache-control"), "no-store");
});
