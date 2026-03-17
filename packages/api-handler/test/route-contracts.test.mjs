import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleApiRequest } from "../src/index.ts";
import { createInitialState } from "../../game-engine/src/state.ts";
import { resolveToStability } from "../../game-engine/src/resolve.ts";

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
  assert.equal(Array.isArray(firstBody.previewActions), true);
  assert.equal(firstBody.actions.length > 0, true);
  assert.deepEqual(firstBody.actions, secondBody.actions);
  assert.deepEqual(firstBody.previewActions, secondBody.previewActions);

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
  assert.deepEqual(body.previewActions, []);
});

test("/api/engine/playground/piece-moves includes unsupplied-blocked previews but not legal actions", async () => {
  const { env } = buildEnv();
  const baseResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  const baseBody = await baseResponse.json();

  const state = {
    ...baseBody.state,
    sideToMove: "P1",
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "U2-wall-top", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "U2-wall-bottom", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "U2-block-north", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-south", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-east", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true },
    ],
    continuation: null,
    outcome: { status: "ongoing" },
  };

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, pieceId: "C1" }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);

  assert.equal(
    body.actions.some((action) => action.type === "move" && action.to?.row === 4 && action.to?.col === 5),
    false,
  );
  assert.equal(
    body.previewActions.some(
      (action) =>
        action.type === "move" &&
        action.to?.row === 4 &&
        action.to?.col === 5 &&
        action.legal === false &&
        action.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED",
    ),
    true,
  );
});

test("/api/engine/playground/piece-moves includes blocked push previews for inadequate group strength", async () => {
  const { env } = buildEnv();
  const baseResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/state", { method: "GET" }),
    env,
  );
  const baseBody = await baseResponse.json();

  const state = {
    ...baseBody.state,
    pieces: [
      ...baseBody.state.pieces,
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 3 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true },
    ],
  };

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/piece-moves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, pieceId: "A1" }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(
    body.actions.some((action) => action.type === "push" && action.to?.row === 4 && action.to?.col === 3),
    false,
  );
  assert.equal(
    body.actions.some((action) => action.type === "push" && action.to?.row === 5 && action.to?.col === 3),
    false,
  );
  assert.equal(
    body.previewActions.some(
      (action) =>
        action.type === "push" &&
        action.to?.row === 5 &&
        action.to?.col === 3 &&
        action.legal === false &&
        action.blockedReason === "PUSH_STRENGTH_TOO_WEAK",
    ),
    true,
  );
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

test("/api/engine/playground/apply returns removedPieces notice for no-retreat removal", async () => {
  const { env } = buildEnv();
  const state = resolveToStability({
    ...createInitialState(),
    pieces: [
      ...createInitialState().pieces,
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
      { id: "B1", owner: "P1", kind: "unit", position: { row: 3, col: 2 }, supplied: true, commanded: true },
      { id: "B2", owner: "P2", kind: "unit", position: { row: 5, col: 2 }, supplied: true, commanded: true },
      { id: "B3", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
    ],
  }, { artifactMode: "full" });

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state,
        action: {
          type: "push",
          actorId: "A1",
          from: { row: 4, col: 1 },
          to: { row: 4, col: 2 },
        },
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.accepted, true);
  assert.equal(Array.isArray(body.removedPieces), true);
  assert.deepEqual(body.removedPieces, [
    {
      pieceId: "D1",
      position: { row: 4, col: 2 },
      reason: "no_retreat",
      message: "Piece at (4, 2) destroyed because it could not retreat",
    },
  ]);
});

test("/api/engine/playground/apply returns removedPieces notice for loss-of-supply removal from M-007", async () => {
  const { env } = buildEnv();
  const rawCatalog = await readFile(new URL("../../../docs/legacy-scenarios/m-golden-fixtures.snapshot.json", import.meta.url), "utf8");
  const catalog = JSON.parse(rawCatalog);
  const fixture = catalog.fixtures.find((entry) => entry.id === "M-007");

  assert.ok(fixture);

  const response = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: fixture.initial_state,
        action: {
          type: "project",
          actorId: "C1",
          from: { row: 3, col: 6 },
          to: { row: 3, col: 4 },
        },
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.accepted, true);
  assert.equal(Array.isArray(body.removedPieces), true);
  assert.deepEqual(body.removedPieces, [
    {
      pieceId: "U2-2",
      position: { row: 4, col: 5 },
      reason: "loss_of_supply",
      message: "Piece at (4, 5) destroyed due to loss of supply",
    },
  ]);
});

test("/api/engine/playground/apply keeps push continuation active after retreat when follow remains", async () => {
  const { env } = buildEnv();
  const initial = resolveToStability({
    ...createInitialState(),
    pieces: [
      ...createInitialState().pieces,
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
    ],
  }, { artifactMode: "full" });

  const pushResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: initial,
        action: {
          type: "push",
          actorId: "A1",
          from: { row: 4, col: 1 },
          to: { row: 4, col: 2 },
        },
      }),
    }),
    env,
  );
  const pushed = await pushResponse.json();

  assert.equal(pushResponse.status, 200);
  assert.equal(pushed.accepted, true);
  assert.equal(pushed.state.sideToMove, "P2");
  assert.equal(pushed.state.continuation?.type, "push");
  assert.equal(pushed.state.continuation?.phase, "retreat");

  const retreatResponse = await handleApiRequest(
    new Request("https://righelt.pages.dev/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: pushed.state,
        action: {
          type: "retreat",
          actorId: "D1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      }),
    }),
    env,
  );
  const retreated = await retreatResponse.json();

  assert.equal(retreatResponse.status, 200);
  assert.equal(retreated.accepted, true);
  assert.equal(retreated.state.sideToMove, "P1");
  assert.equal(retreated.state.continuation?.type, "push");
  assert.equal(retreated.state.continuation?.phase, "follow");
  assert.deepEqual(retreated.legalActions, [
    {
      type: "follow",
      actorId: "A2",
      from: { row: 3, col: 1 },
      to: { row: 4, col: 1 },
    },
  ]);
});

test("/api/engine/playground/piece-moves returns invalid_piece_id when pieceId is missing", async () => {
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
      body: JSON.stringify({ state: stateBody.state }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_piece_id");
});

test("/api/engine/playground/apply returns invalid_action for malformed action payload", async () => {
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
        action: { from: { row: 3, col: 6 }, to: { row: 3, col: 7 } },
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), CACHE_NO_STORE);
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_action");
});
