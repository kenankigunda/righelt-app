import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/api/[[path]].js";

test("Pages proxy forwards requests through API_SERVICE when present", async () => {
  const request = new Request("https://righelt.pages.dev/api/health", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  let forwardedRequest = null;

  const response = await onRequest({
    request,
    env: {
      API_SERVICE: {
        fetch(nextRequest) {
          forwardedRequest = nextRequest;
          return new Response(JSON.stringify({ ok: true }), {
            status: 202,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        },
      },
    },
  });

  assert.equal(forwardedRequest, request);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});

test("Pages proxy falls back to local API origin when service binding is absent in local dev", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push(request);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };

  try {
    const response = await onRequest({
      request: new Request("http://localhost:8788/api/shell/games?offline=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-a" }),
      }),
      env: {},
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8787/api/shell/games?offline=1");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.get("content-type"), "application/json");
    assert.deepEqual(await calls[0].json(), { identityId: "id-a" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy returns a stable 503 when the local API worker is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Network connection lost.");
  };

  try {
    const response = await onRequest({
      request: new Request("http://localhost:8788/api/health"),
      env: {},
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "local_api_unavailable",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy bypasses API_SERVICE entirely for local dev requests", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let bindingCalls = 0;
  globalThis.fetch = async (request) => {
    calls.push(request);
    return new Response(JSON.stringify({ ok: true, source: "fallback" }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };

  try {
    const response = await onRequest({
      request: new Request("http://localhost:8788/api/shell/games?offline=0", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-a" }),
      }),
      env: {
        API_SERVICE: {
          async fetch() {
            bindingCalls += 1;
            return new Response("should not be called", { status: 500 });
          },
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(bindingCalls, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8787/api/shell/games?offline=0");
    assert.deepEqual(await response.json(), { ok: true, source: "fallback" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy returns a stable 500 when no service binding or local fallback is available", async () => {
  const response = await onRequest({
    request: new Request("https://righelt.pages.dev/api/health"),
    env: {},
  });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "server_misconfigured_api_service_binding",
  });
});
