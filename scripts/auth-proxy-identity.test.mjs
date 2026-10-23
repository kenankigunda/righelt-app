import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { prepareProxySource } from "./auth-proxy-diagnostics.mjs";
const packageFile = createRequire(import.meta.url).resolve("wrangler/package.json");
const source = await readFile(path.join(path.dirname(packageFile), "wrangler-dist/ProxyWorker.js"), "utf8");
const repaired = prepareProxySource(source, "4.67.0");
const initial = { protocol: "http:", hostname: "127.0.0.1", port: "1234" };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(input, { enabled = false, receiptReply } = {}) {
  const forwards = [], reports = [], logs = [];
  class WorkerHeaders extends Headers { getAll(name) { return name.toLowerCase() === "set-cookie" ? this.getSetCookie() : []; } }
  class WorkerResponse extends Response {
    get headers() {
      const headers = super.headers;
      headers.getAll = name => name.toLowerCase() === "set-cookie" ? headers.getSetCookie() : [];
      return headers;
    }
  }
  const context = { URL, Request, Response: WorkerResponse, Headers: WorkerHeaders, assert, crypto: webcrypto, setTimeout, clearTimeout,
    console: { error: (...args) => logs.push(args) },
    fetch: (url, request) => new Promise((resolve, reject) => forwards.push({ url, request, resolve, reject })) };
  vm.createContext(context);
  vm.runInContext(input.replace('import assert from "node:assert";', "")
    .replace(/export \{[\s\S]*?\};\s*$/, "globalThis.TestProxyWorker = ProxyWorker;"), context);
  const proxy = new context.TestProxyWorker({ getWebSockets: () => [], waitUntil: promise => promise.catch(assert.fail) }, {
    RIGHELT_AUTH_FAILURE_RUN_ID: enabled ? "e1c9435b-9daa-43f1-a63b-717157b677b0" : "",
    PROXY_CONTROLLER_AUTH_SECRET: "unused",
    PROXY_CONTROLLER: { fetch: async (_url, request) => {
      const message = JSON.parse(request.body); reports.push(message);
      if (message.type === "righelt-request-failure") return receiptReply(message);
      return new Response(null, { status: 204 });
    } },
  });
  proxy.proxyData = { userWorkerUrl: initial, headers: {} };
  const start = (url, method) => {
    const request = new Request(url, { method, headers: { Cookie: "session=fixture", Authorization: "fixture-auth" },
      ...(method === "POST" ? { body: "one-mutation" } : {}) });
    const result = {};
    const done = proxy.fetch(request).then(response => { result.response = response; }, error => { result.error = error; });
    return { result, done };
  };
  return { proxy, forwards, reports, logs, start };
}
test("recorded transport failure waits for its matching ACK, still rejects, and never replays", async () => {
  let acknowledge;
  const f = fixture(repaired, { enabled: true, receiptReply: () => new Promise(resolve => { acknowledge = resolve; }) });
  const request = f.start("http://localhost:8787/api/auth/logout?private=secret", "POST");
  const failure = new Error("Network connection lost."); f.forwards[0].reject(failure);
  await settle(); assert.deepEqual(request.result, {});
  const message = f.reports[0]; assert.equal(message.type, "righelt-request-failure");
  assert.equal(message.path, "/api/auth/logout"); assert.ok(!JSON.stringify(message).includes("secret"));
  acknowledge(new Response(JSON.stringify({ schema: 1, runId: message.runId, requestId: message.requestId, recorded: true }), { status: 201 }));
  await request.done; assert.equal(request.result.error, failure);
  assert.equal(f.reports.length, 1); assert.equal(f.forwards.length, 1); assert.equal(f.proxy.requestRetryQueue.size, 0);
});
for (const [label, reply] of [
  ["wrong run", message => new Response(JSON.stringify({ ...message, runId: "other", recorded: true }), { status: 201 })],
  ["wrong request", message => new Response(JSON.stringify({ ...message, requestId: "other", recorded: true }), { status: 201 })],
  ["generic 204", () => new Response(null, { status: 204 })],
  ["write failure", () => new Response(null, { status: 500 })],
  ["controller disconnected", () => { throw new Error("socket lost"); }],
]) test(`receipt ${label} stays fatal and rejects the original request`, async () => {
  const f = fixture(repaired, { enabled: true, receiptReply: reply });
  const request = f.start("http://localhost:8787/api/auth/logout", "POST");
  const failure = new Error("Network connection lost."); f.forwards[0].reject(failure);
  await request.done; assert.equal(request.result.error, failure);
  assert.deepEqual(f.reports.map(item => item.type), ["righelt-request-failure", "error"]);
  assert.ok(f.logs.some(args => args[0] === "[auth-e2e-proxy-receipt-failed]"));
  assert.equal(f.forwards.length, 1);
});
for (const error of [new TypeError("Network connection lost."), new Error("Network connection lost: different cause"), new Error("Programming error")]) {
  test(`unmatched ${error.name}/${error.message} retains fatal reporting`, async () => {
    const f = fixture(repaired, { enabled: true, receiptReply: () => assert.fail("unexpected receipt") });
    const request = f.start("http://localhost:8787/api/auth/logout", "POST"); f.forwards[0].reject(error);
    await request.done; assert.equal(request.result.error, error);
    assert.equal(f.reports.length, 1); assert.equal(f.reports[0].type, "error");
  });
}
nodeTest("a stalled ACK body is bounded, recorded as accounting failure and never replayed", { timeout: 5000 }, async () => {
  const f = fixture(repaired, { enabled: true, receiptReply: () => ({ status: 201, json: () => new Promise(() => {}) }) });
  const request = f.start("http://localhost:8787/api/auth/logout", "POST");
  const failure = new Error("Network connection lost."); f.forwards[0].reject(failure);
  await request.done; assert.equal(request.result.error, failure);
  assert.deepEqual(f.reports.map(item => item.type), ["righelt-request-failure", "error"]);
  assert.equal(f.forwards.length, 1);
});
for (const pathname of ["/", "/api/auth/session", "/?query=fixture", "/api/auth/session?query=fixture"]) {
  for (const method of ["GET", "HEAD", "POST"]) {
    test(`${method} ${pathname}: unchanged worker failure rejects promptly without a retry`, async () => {
      const f = fixture(repaired); const request = f.start(`http://localhost:8787${pathname}`, method);
      const failure = new Error("Network connection lost."); f.forwards[0].reject(failure);
      await settle();
      assert.equal(request.result.error, failure);
      assert.equal(f.reports.length, 1); assert.equal(f.reports[0].type, "error");
      assert.equal(f.proxy.requestRetryQueue.size, 0); assert.equal(f.forwards.length, 1);
      await request.done;
    });
  }
}
test("negative control: pinned original parks an unchanged-worker path GET and mislabels a POST", async () => {
  const get = fixture(source); const read = get.start("http://localhost:8787/api/auth/session", "GET");
  get.forwards[0].reject(new Error("Network connection lost.")); await settle();
  assert.deepEqual(read.result, {}); assert.equal(get.proxy.requestRetryQueue.size, 1); assert.equal(get.reports.length, 0);
  // Settle the deliberately parked control, so the fixture itself leaves no work behind.
  get.proxy.processQueue(); get.forwards[1].resolve(new Response("completed control")); await read.done;
  const post = fixture(source); const write = post.start("http://localhost:8787/api/auth/login", "POST");
  post.forwards[0].reject(new Error("Network connection lost.")); await write.done;
  assert.equal(write.result.response.status, 503); assert.match(await write.result.response.text(), /worker restarted/);
  assert.equal(post.forwards.length, 1);
});
for (const [label, replacement] of [
  ["port", { ...initial, port: "2345" }], ["host", { ...initial, hostname: "localhost" }],
  ["protocol", { ...initial, protocol: "https:" }], ["paused", undefined],
]) {
  for (const method of ["GET", "HEAD", "POST"]) {
    test(`${method}: actual ${label} change retains reload behavior without mutation replay`, async () => {
      const f = fixture(repaired); const request = f.start("http://localhost:8787/api/auth/session?fixture=1", method);
      f.proxy.proxyData = replacement ? { userWorkerUrl: replacement, headers: {} } : undefined;
      f.forwards[0].reject(new Error("Network connection lost.")); await settle();
      assert.equal(f.reports.length, 0); assert.equal(f.forwards.length, 1);
      if (method === "POST") {
        assert.equal(request.result.response.status, 503); assert.equal(f.proxy.requestRetryQueue.size, 0);
        f.proxy.proxyData = { userWorkerUrl: replacement || initial, headers: {} }; f.proxy.processQueue();
        assert.equal(f.forwards.length, 1); // A lost POST response is never resubmitted.
      } else {
        assert.deepEqual(request.result, {}); assert.equal(f.proxy.requestRetryQueue.size, 1);
        f.proxy.proxyData = { userWorkerUrl: replacement || initial, headers: {} }; f.proxy.processQueue();
        assert.equal(f.forwards.length, 2); f.forwards[1].resolve(new Response("after actual reload")); await request.done;
        assert.equal(request.result.response.status, 200); assert.equal(f.proxy.requestRetryQueue.size, 0);
      }
    });
  }
}
test("successful and application-error responses preserve forwarding and never retry", async () => {
  for (const status of [200, 500]) {
    const f = fixture(repaired); const request = f.start("http://localhost:8787/api/auth/login?q=fixture", "POST");
    const forwarded = f.forwards[0];
    assert.equal(forwarded.url.href, "http://127.0.0.1:1234/api/auth/login?q=fixture");
    assert.equal(forwarded.request.method, "POST"); assert.equal(await forwarded.request.text(), "one-mutation");
    assert.equal(forwarded.request.headers.get("Cookie"), "session=fixture");
    assert.equal(forwarded.request.headers.get("Authorization"), "fixture-auth");
    forwarded.resolve(new Response("unchanged body", { status, headers: { "Set-Cookie": "result=fixture; HttpOnly" } }));
    await request.done; assert.equal(request.result.response.status, status);
    assert.equal(await request.result.response.text(), "unchanged body");
    assert.equal(request.result.response.headers.get("Set-Cookie"), "result=fixture; HttpOnly");
    assert.equal(f.forwards.length, 1); assert.equal(f.reports.length, 0);
  }
});
