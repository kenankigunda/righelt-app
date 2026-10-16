import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import { prepareProxySource } from "./auth-proxy-diagnostics.mjs";
import { createWorkerConnectionOrigin } from "./auth-worker-connections.mjs";

const packageFile = createRequire(import.meta.url).resolve("wrangler/package.json");
const { Miniflare, Log, LogLevel } = createRequire(packageFile)("miniflare");
const source = prepareProxySource(await readFile(new URL("./wrangler-dist/ProxyWorker.js", `file://${packageFile}`), "utf8"), "4.67.0");
async function closeAll(...closers) {
  const results = await Promise.allSettled(closers.map(close => Promise.resolve().then(close)));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Runtime fixture cleanup failed");
}
async function proxyFor(target) {
  let adapter, proxy;
  const close = () => closeAll(() => proxy?.dispose(), () => adapter?.close());
  const errors = [];
  let report;
  const reported = new Promise(resolve => { report = resolve; });
  try {
    adapter = await createWorkerConnectionOrigin(target);
    proxy = new Miniflare({
      modules: [{ type: "ESModule", path: "proxy.js", contents: source }],
      compatibilityDate: "2023-12-18", compatibilityFlags: ["nodejs_compat"],
      durableObjects: { DURABLE_OBJECT: { className: "ProxyWorker", unsafePreventEviction: true } },
      unsafeEphemeralDurableObjects: true, stripCfConnectingIp: false, cache: false,
      bindings: { PROXY_CONTROLLER_AUTH_SECRET: "fixture-only" },
      serviceBindings: { PROXY_CONTROLLER: async req => { errors.push(await req.json()); report(); return new Response(null, { status: 204 }); } },
      log: new Log(LogLevel.NONE),
    });
    await proxy.dispatchFetch("http://fixture/", { method: "POST", headers: { Authorization: "fixture-only" },
      cf: { hostMetadata: { type: "play", proxyData: { userWorkerUrl: { protocol: "http:", hostname: "127.0.0.1", port: adapter.url.port }, headers: {} } } } });
    return { proxy, errors, reported, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Runtime fixture setup and cleanup failed"); }
    throw error;
  }
}
async function backendFor(handler) {
  const sockets = new Set(), server = http.createServer(handler);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const close = async () => {
    const done = new Promise(resolve => server.close(resolve)); for (const socket of sockets) socket.destroy(); await done;
  };
  try { server.listen(0, "127.0.0.1"); await once(server, "listening"); }
  catch (error) { await close(); throw error; }
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}
test("actual pinned ProxyWorker preserves methods, bodies, cookies and application failures", { timeout: 15000 }, async () => {
  const records = [], connections = new Set();
  const backend = await backendFor((req, res) => {
    connections.add(req.socket); const chunks = []; req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      records.push({ method: req.method, url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      res.writeHead(409, { "Content-Type": "text/plain", "Set-Cookie": ["one=1; HttpOnly", "two=2; Secure"] }); res.end("application-response");
    });
  });
  let fixture;
  try {
    fixture = await proxyFor(backend.url);
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await fixture.proxy.dispatchFetch("http://fixture/api/auth/login?q=exact", { method,
        headers: { Cookie: "session=fixture", Authorization: "fixture-auth" }, ...(method === "POST" ? { body: "one-write" } : {}) });
      assert.equal(response.status, 409); assert.equal(await response.text(), method === "HEAD" ? "" : "application-response");
      assert.deepEqual(response.headers.getSetCookie(), ["one=1; HttpOnly", "two=2; Secure"]);
    }
    assert.deepEqual(records, ["GET", "HEAD", "POST"].map(method => ({ method, url: "/api/auth/login?q=exact", cookie: "session=fixture", authorization: "fixture-auth", body: method === "POST" ? "one-write" : "" })));
    assert.equal(connections.size, 3); assert.deepEqual(fixture.errors, []);
  } finally { await closeAll(() => fixture?.close(), () => backend.close()); }
});
test("actual pinned ProxyWorker never replays a POST after the backend mutates and disconnects", { timeout: 15000 }, async () => {
  let mutations = 0;
  const backend = await backendFor(req => { req.resume(); req.on("end", () => { mutations++; req.socket.destroy(); }); });
  let fixture;
  try {
    fixture = await proxyFor(backend.url);
    const response = await fixture.proxy.dispatchFetch("http://fixture/api/games", { method: "POST", body: "commit-once" });
    assert.equal(response.status, 500); assert.match(await response.text(), /Network connection lost/);
    await fixture.reported;
    assert.equal(mutations, 1); assert.equal(fixture.errors.length, 1);
  } finally { await closeAll(() => fixture?.close(), () => backend.close()); }
});
test("actual pinned ProxyWorker and Worker keep the WebSocket tunnel usable", { timeout: 15000 }, async () => {
  const worker = new Miniflare({ modules: true, compatibilityDate: "2023-12-18", log: new Log(LogLevel.NONE),
    script: 'export default {fetch() { const [client, server] = Object.values(new WebSocketPair()); server.accept(); server.addEventListener("message", e => server.send("echo:" + e.data)); server.addEventListener("close", e => server.close(e.code, e.reason)); return new Response(null, {status:101,webSocket:client}); }}' });
  let fixture, socket;
  try {
    fixture = await proxyFor(await worker.ready);
    const response = await fixture.proxy.dispatchFetch("http://fixture/live", { headers: { Upgrade: "websocket" } });
    assert.equal(response.status, 101); socket = response.webSocket; assert.ok(socket); socket.accept();
    const message = new Promise((resolve, reject) => { socket.addEventListener("message", event => resolve(event.data), { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.send("still-live"); assert.equal(await message, "echo:still-live"); assert.deepEqual(fixture.errors, []);
    const closed = new Promise(resolve => socket.addEventListener("close", resolve, { once: true }));
    socket.close(1000, "complete"); await closed;
  } finally {
    await closeAll(() => { if (socket?.readyState === 1) socket.close(1000); }, () => fixture?.close(), () => worker.dispose());
  }
});
