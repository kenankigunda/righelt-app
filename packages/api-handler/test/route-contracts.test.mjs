import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";

const CACHE_NO_STORE = "no-store";

function buildEnv(options = {}) {
  const mode = options.dbMode ?? "success";
  let lastMessage = null;

  const db = {
    prepare(query) {
      assert.equal(query, "INSERT INTO milestone_actions (message) VALUES (?1)");

      if (mode === "throw_prepare") {
        throw new Error("prepare failed");
      }

      return {
        bind(message) {
          lastMessage = message;

          if (mode === "throw_bind") {
            throw new Error("bind failed");
          }

          return this;
        },
        async run() {
          if (mode === "throw_run") {
            throw new Error("run failed");
          }
          if (mode === "run_unsuccessful") {
            return { success: false };
          }
          return { success: true, meta: { last_row_id: 7 } };
        },
      };
    },
  };

  return {
    env: { DB: db },
    getLastMessage() {
      return lastMessage;
    },
  };
}

test("malformed JSON body returns stable no-store error contracts across POST routes", async () => {
  const { env } = buildEnv();

  const cases = [
    {
      request: new Request("https://righelt.pages.dev/api/engine/playground/legal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      expectedStatus: 400,
      expectedError: "invalid_state",
    },
    {
      request: new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      expectedStatus: 400,
      expectedError: "invalid_state",
    },
    {
      request: new Request("https://righelt.pages.dev/api/engine/playground/hash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      expectedStatus: 400,
      expectedError: "invalid_state",
    },
    {
      request: new Request("https://righelt.pages.dev/api/engine/playground/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      expectedStatus: 400,
      expectedError: "invalid_state",
    },
    {
      request: new Request("https://righelt.pages.dev/api/commands/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      expectedStatus: 400,
      expectedError: "invalid_command",
    },
  ];

  for (const testCase of cases) {
    const response = await handleApiRequest(testCase.request, env);
    const body = await response.json();

    assert.equal(response.status, testCase.expectedStatus);
    assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
    assert.equal(body.ok, false);
    assert.equal(body.error, testCase.expectedError);
  }
});

test("wrong content-type with non-JSON payload follows same no-store parse-failure contracts", async () => {
  const { env } = buildEnv();

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_state");
});

test("unsupported method/path combinations return 404 not_found and no-store", async () => {
  const { env } = buildEnv();

  const requests = [
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "PUT" }),
    new Request("https://righelt.pages.dev/api/engine/playground/legal", { method: "GET" }),
    new Request("https://righelt.pages.dev/api/engine/playground/hash", { method: "GET" }),
    new Request("https://righelt.pages.dev/api/test-action", { method: "GET" }),
    new Request("https://righelt.pages.dev/api/unknown/path", { method: "POST" }),
  ];

  for (const request of requests) {
    const response = await handleApiRequest(request, env);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
  }
});

test("/api/test-action returns stable insert_failed contract for unsuccessful and thrown DB writes", async () => {
  const scenarios = ["run_unsuccessful", "throw_prepare", "throw_bind", "throw_run"];

  for (const dbMode of scenarios) {
    const { env } = buildEnv({ dbMode });
    const response = await handleApiRequest(
      new Request("https://righelt.pages.dev/api/test-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
      env,
    );

    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
    assert.equal(body.ok, false);
    assert.equal(body.error, "insert_failed");
  }
});

test("/api/test-action malformed JSON still succeeds with default message", async () => {
  const { env, getLastMessage } = buildEnv();
  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/test-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getLastMessage(), "Button clicked from web client");
});

test("/api/engine/playground/piece-moves returns deterministic sorted actions", async () => {
  const { env } = buildEnv();

  const stateResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  const stateBody = await stateResponse.json();

  const request = () =>
    handleApiRequest(
      new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: stateBody.state, pieceId: "C1" }),
      }),
      env,
    );

  const first = await request();
  const second = await request();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(second.headers.get("cache-control"), CACHE_NO_STORE);

  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.equal(firstBody.ok, true);
  assert.equal(Array.isArray(firstBody.actions), true);
  assert.equal(firstBody.actions.length > 0, true);
  assert.deepEqual(firstBody.actions, secondBody.actions);

  const serialized = firstBody.actions.map((action) => JSON.stringify(action));
  const sorted = [...serialized].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(serialized, sorted);
});

test("/api/engine/playground/piece-moves returns [] for unknown pieceId with stable shape", async () => {
  const { env } = buildEnv();

  const stateResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  const stateBody = await stateResponse.json();

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: stateBody.state, pieceId: "UNKNOWN" }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(body.ok, true);
  assert.equal(body.pieceId, "UNKNOWN");
  assert.deepEqual(body.actions, []);
});

test("/api/engine/playground/apply illegal action returns accepted=false with validation and legalActions", async () => {
  const { env } = buildEnv();

  const stateResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  const stateBody = await stateResponse.json();

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: stateBody.state,
        action: {
          type: "move",
          actorId: "C1",
          from: { row: 3, col: 6 },
          to: { row: 4, col: 7 },
        },
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(body.ok, true);
  assert.equal(body.accepted, false);
  assert.equal(typeof body.validation?.code, "string");
  assert.equal(Array.isArray(body.legalActions), true);
  assert.equal(body.legalActions.length > 0, true);
  assert.equal(typeof body.state?.turnIndex, "number");
});
