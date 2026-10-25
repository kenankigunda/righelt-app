import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/api/[[path]].js";

const projectionUrl = "http://localhost:8788/api/shell/games/game-test?identityId=private-identity";
const connectionLoss = () => new Error("Network connection lost.");
async function withForwarder(fetcher, inspect) {
  const original = { fetch: globalThis.fetch, error: console.error, info: console.info };
  const calls = [], diagnostics = [];
  globalThis.fetch = async request => { calls.push(request); return fetcher(request, calls.length); };
  console.error = console.info = (...args) => diagnostics.push(args);
  try { await inspect(calls, diagnostics); }
  finally { globalThis.fetch = original.fetch; console.error = original.error; console.info = original.info; }
}

test("local projection connection loss repeats one fresh read with the same authority and correlation", async () => {
  const id = crypto.randomUUID(), controller = new AbortController();
  await withForwarder((_request, attempt) => {
    if (attempt === 1) throw connectionLoss();
    return new Response("projection", { headers: { "X-Righelt-Server-Build": "same-build" } });
  }, async (calls, diagnostics) => {
    const request = new Request(projectionUrl, { signal: controller.signal, headers: {
      "X-Righelt-Request-Id": id, "X-Righelt-Session": "private-session", Cookie: "private-cookie",
    } });
    const response = await onRequest({ request, env: {} });
    assert.equal(await response.text(), "projection"); assert.equal(calls.length, 2);
    assert.notEqual(calls[0], calls[1]);
    for (const forwarded of calls) {
      assert.equal(forwarded.url, projectionUrl.replace("localhost:8788", "127.0.0.1:8787"));
      assert.equal(forwarded.headers.get("X-Righelt-Session"), "private-session");
      assert.equal(forwarded.headers.get("Cookie"), "private-cookie");
      assert.equal(forwarded.headers.get("X-Righelt-Request-Id"), id);
      assert.equal(forwarded.body, null);
    }
    controller.abort(); assert.ok(calls.every(call => call.signal.aborted));
    assert.equal(response.headers.get("X-Righelt-Local-Forward-Attempts"), "2");
    assert.equal(response.headers.get("X-Righelt-Server-Build"), "same-build");
    assert.equal(response.headers.get("X-Righelt-Request-Id"), id);
    assert.equal(diagnostics[0][0], "[local-api-forwarding-failure]");
    assert.deepEqual(JSON.parse(diagnostics[1][1]), { requestId: id, attempts: 2, outcome: "recovered" });
    assert.ok(!JSON.stringify(diagnostics).includes("private-"));
  });
});

test("repeated local projection failure stops after two attempts and preserves safe503", async () => {
  await withForwarder(() => { throw connectionLoss(); }, async (calls, diagnostics) => {
    const response = await onRequest({ request: new Request(projectionUrl), env: {} });
    assert.equal(response.status, 503); assert.equal(calls.length, 2);
    assert.deepEqual(await response.json(), { ok: false, error: "local_api_unavailable" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("X-Righelt-Local-Forward-Attempts"), "2");
    assert.equal(diagnostics.filter(item => item[0] === "[local-api-forwarding-failure]").length, 2);
    assert.equal(JSON.parse(diagnostics.at(-1)[1]).outcome, "failed");
  });
});

test("received HTTP errors are never retried, including after a connection-loss retry", async () => {
  for (const status of [401, 404, 500, 503]) for (const loseFirst of [false, true]) {
    await withForwarder((_request, attempt) => {
      if (loseFirst && attempt === 1) throw connectionLoss();
      return new Response("original-error", { status });
    }, async calls => {
      const response = await onRequest({ request: new Request(projectionUrl), env: {} });
      assert.equal(response.status, status); assert.equal(await response.text(), "original-error");
      assert.equal(calls.length, loseFirst ? 2 : 1);
    });
  }
});

test("local retry excludes mutations, viewer joins, other routes, upgrades and unknown queries", async () => {
  const cases = [
    ...["POST", "PATCH", "PUT", "DELETE", "HEAD"].map(method => [projectionUrl, { method }]),
    [projectionUrl + "&openAsViewer=1", {}], [projectionUrl + "&futureOption=1", {}],
    ["http://localhost:8788/api/auth/session", {}], [projectionUrl.replace("?", "/live?"), {}],
    [projectionUrl, { headers: { Upgrade: "websocket" } }],
    [projectionUrl, { headers: { Connection: "keep-alive, Upgrade" } }],
  ];
  for (const [url, init] of cases) await withForwarder(() => { throw connectionLoss(); }, async calls => {
    const response = await onRequest({ request: new Request(url, init), env: {} });
    assert.equal(response.status, 503); assert.equal(calls.length, 1);
    assert.equal(response.headers.has("X-Righelt-Local-Forward-Attempts"), false);
  });
});

test("other exception types, near messages and hostile exception getters are never retried", async () => {
  const hostile = new Proxy({}, { get() { throw Error("private"); } });
  for (const error of [new TypeError("Network connection lost."), new DOMException("Network connection lost.", "AbortError"),
    Error("Network connection lost"), Error("Network connection lost. private-details"), Error("different"), hostile]) {
    await withForwarder(() => { throw error; }, async calls => {
      const response = await onRequest({ request: new Request(projectionUrl), env: {} });
      assert.equal(response.status, 503); assert.equal(calls.length, 1);
    });
  }
});

test("cancellation before a read or during its failed attempt prevents retry", async () => {
  for (const initiallyAborted of [false, true]) {
    const controller = new AbortController(); if (initiallyAborted) controller.abort();
    await withForwarder(() => { controller.abort(); throw connectionLoss(); }, async calls => {
      const response = await onRequest({ request: new Request(projectionUrl, { signal: controller.signal }), env: {} });
      assert.equal(response.status, 503); assert.equal(calls.length, initiallyAborted ? 0 : 1);
    });
  }
});

test("hosted service failures and response-body failures never trigger a local read retry", async () => {
  await withForwarder(() => { throw Error("unexpected local fetch"); }, async calls => {
    let hostedCalls = 0;
    const response = await onRequest({ request: new Request("https://righelt.pages.dev/api/shell/games/game-test"),
      env: { API_SERVICE: { fetch() { hostedCalls++; throw connectionLoss(); } } } });
    assert.equal(hostedCalls, 1); assert.equal(calls.length, 0); assert.equal(response.status, 503);
    assert.equal(response.headers.has("X-Righelt-Local-Forward-Attempts"), false);
  });
  await withForwarder(() => new Response(new ReadableStream({ start(controller) { controller.error(connectionLoss()); } })), async calls => {
    const response = await onRequest({ request: new Request(projectionUrl), env: {} });
    await assert.rejects(response.text(), /Network connection lost/); assert.equal(calls.length, 1);
  });
});

test("upstream exceptions keep correlation and return a safe retryable error",async()=>{
  const requestId=crypto.randomUUID();
  const response=await onRequest({request:new Request("https://righelt.pages.dev/api/health",{headers:{"X-Righelt-Request-Id":requestId}}),env:{API_SERVICE:{fetch(){throw Error("private infrastructure details");}}}});
  assert.equal(response.status,503);
  assert.equal(response.headers.get("X-Righelt-Request-Id"),requestId);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.deepEqual(await response.json(),{ok:false,error:"upstream_unavailable"});
});

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

  assert.equal(forwardedRequest.url, request.url);
  assert.equal(forwardedRequest.headers.get("X-Righelt-Request-Id"), response.headers.get("X-Righelt-Request-Id"));
  assert.match(response.headers.get("X-Righelt-Request-Id"), /^[0-9a-f-]{36}$/);
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
      request: new Request("http://localhost:8788/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-a" }),
      }),
      env: {},
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8787/api/shell/games");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.get("content-type"), "application/json");
    assert.deepEqual(await calls[0].json(), { identityId: "id-a" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy maps suffixed local dev pages ports to matching API worker ports", async () => {
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
      request: new Request("http://localhost:8789/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId: "id-b" }),
      }),
      env: {},
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8792/api/shell/games");
    assert.deepEqual(await calls[0].json(), { identityId: "id-b" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy returns a stable 503 when the local API worker is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const diagnostics = [];
  let calls = 0;
  const id = crypto.randomUUID();
  console.error = (...args) => diagnostics.push(args);
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("Network connection lost.");
  };

  try {
    const response = await onRequest({
      request: new Request("http://localhost:8788/api/shell/games", {
        method: 'POST', headers: { 'X-Righelt-Request-Id': id }, body: 'private-body',
      }),
      env: {},
    });

    assert.equal(response.status, 503);
    assert.equal(calls, 1);
    assert.equal(response.headers.get('X-Righelt-Request-Id'), id);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][0], '[local-api-forwarding-failure]');
    assert.deepEqual(JSON.parse(diagnostics[0][1]), {
      stage: 'fetch', requestId: id, method: 'POST', name: 'TypeError', code: 'other',
      causeCode: 'other', message: 'network_connection_lost',
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "local_api_unavailable",
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
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
      request: new Request("http://localhost:8788/api/shell/games", {
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
    assert.equal(calls[0].url, "http://127.0.0.1:8787/api/shell/games");
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

test("Pages validates attempt IDs and returns correlation on proxy failures",async()=>{
 const response=await onRequest({request:new Request("https://righelt.pages.dev/api/health",{headers:{"X-Righelt-Request-Id":"malformed"}}),env:{}});
 assert.equal(response.status,500);assert.match(response.headers.get("X-Righelt-Request-Id"),/^[0-9a-f-]{36}$/);
 const id=crypto.randomUUID();let forwarded;
 const success=await onRequest({request:new Request("https://righelt.pages.dev/api/health",{headers:{"X-Righelt-Request-Id":id}}),env:{API_SERVICE:{fetch:async request=>{forwarded=request;return Response.json({ok:true},{headers:{"X-Righelt-Server-Build":"build"}});}}}});
 assert.equal(forwarded.headers.get("X-Righelt-Request-Id"),id);assert.equal(success.headers.get("X-Righelt-Request-Id"),id);assert.equal(success.headers.get("X-Righelt-Server-Build"),"build");
});
