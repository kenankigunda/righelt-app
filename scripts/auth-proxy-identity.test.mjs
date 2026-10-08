import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { prepareProxySource } from "./auth-proxy-diagnostics.mjs";
const packageFile = createRequire(import.meta.url).resolve("wrangler/package.json");
const source = await readFile(path.join(path.dirname(packageFile), "wrangler-dist/ProxyWorker.js"), "utf8");
const repaired = prepareProxySource(source, "4.67.0");
const initial = { protocol: "http:", hostname: "127.0.0.1", port: "1234" };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(input) {
  const forwards = [], reports = [], logs = [];
  class WorkerHeaders extends Headers { getAll(name) { return name.toLowerCase() === "set-cookie" ? this.getSetCookie() : []; } }
  class WorkerResponse extends Response {
    get headers() {
      const headers = super.headers;
      headers.getAll = name => name.toLowerCase() === "set-cookie" ? headers.getSetCookie() : [];
      return headers;
    }
  }
  const context = { URL, Request, Response: WorkerResponse, Headers: WorkerHeaders, assert,
    console: { error: (...args) => logs.push(args) },
    fetch: (url, request) => new Promise((resolve, reject) => forwards.push({ url, request, resolve, reject })) };
  vm.createContext(context);
  vm.runInContext(input.replace('import assert from "node:assert";', "")
    .replace(/export \{[\s\S]*?\};\s*$/, "globalThis.TestProxyWorker = ProxyWorker;"), context);
  const proxy = new context.TestProxyWorker({ getWebSockets: () => [] }, {
    PROXY_CONTROLLER_AUTH_SECRET: "unused",
    PROXY_CONTROLLER: { fetch: async (_url, request) => { reports.push(JSON.parse(request.body)); return new Response(null, { status: 204 }); } },
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
