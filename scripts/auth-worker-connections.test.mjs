import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createWorkerConnectionOrigin, createWorkerConnectionPool } from "./auth-worker-connections.mjs";
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn);
async function fixture(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, url: new URL(`http://127.0.0.1:${server.address().port}`),
    async close() { const done = new Promise(resolve => server.close(resolve)); for (const socket of sockets) socket.destroy(); await done; } };
}
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, trailers: res.trailers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject); req.end(body);
  });
}
test("only fixed loopback HTTP origins are accepted", async () => {
  for (const value of ["https://127.0.0.1:1234", "http://example.com:1234", "http://127.0.0.1", "http://u:p@127.0.0.1:1234", "http://127.0.0.1:1234/path", "http://127.0.0.1:1234/?q=1"])
    await assert.rejects(createWorkerConnectionOrigin(value), /fixed loopback/);
});
test("GET, HEAD and POST get fresh backend sockets without replay", async () => {
  for (const method of ["GET", "HEAD", "POST"]) {
    const seen = new Map(); let dispatches = 0;
    const backend = await fixture((req, res) => {
      dispatches++; const count = (seen.get(req.socket) || 0) + 1; seen.set(req.socket, count);
      req.resume(); req.on("end", () => {
        if (count > 1) req.socket.destroy();
        else { res.writeHead(200, { "Content-Length": "8", Connection: "keep-alive" }); res.end("complete"); }
      });
    });
    const origin = await createWorkerConnectionOrigin(backend.url);
    const keep = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      assert.equal((await request(backend.url, { method, agent: keep })).status, 200);
      await assert.rejects(request(backend.url, { method, agent: keep }), undefined, `${method} pooled control`);
      seen.clear(); dispatches = 0;
      for (let i = 0; i < 3; i++) assert.equal((await request(origin.url, { method, agent: keep }, method === "POST" ? "one mutation" : null)).status, 200);
      assert.equal(seen.size, 3); assert.equal(dispatches, 3); assert.deepEqual([...seen.values()], [1, 1, 1]);
    } finally { keep.destroy(); await origin.close(); await backend.close(); }
  }
});
test("large binary bodies, credentials, duplicate cookies, status and streamed trailers survive", async () => {
  const body = Buffer.alloc(512 * 1024); for (let i = 0; i < body.length; i++) body[i] = i % 251;
  let received;
  const backend = await fixture((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      received = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      res.writeHead(409, { "Content-Type": "application/octet-stream", "Set-Cookie": ["one=1; HttpOnly", "two=2; Secure"], Trailer: "X-Checksum" });
      res.write(body.subarray(0, 12345)); setImmediate(() => { res.write(body.subarray(12345)); res.addTrailers({ "X-Checksum": "complete" }); res.end(); });
    });
  });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try {
    const result = await request(new URL("/api/auth/login?q=exact", origin.url), { method: "POST", headers: { Authorization: "fixture-auth", Cookie: "session=fixture", "Content-Type": "application/octet-stream" } }, body);
    assert.equal(received.method, "POST"); assert.equal(received.url, "/api/auth/login?q=exact");
    assert.equal(received.headers.authorization, "fixture-auth"); assert.equal(received.headers.cookie, "session=fixture");
    assert.deepEqual(received.body, body); assert.deepEqual(result.body, body); assert.equal(result.status, 409);
    assert.deepEqual(result.headers["set-cookie"], ["one=1; HttpOnly", "two=2; Secure"]);
    assert.equal(result.trailers["x-checksum"], "complete");
  } finally { await origin.close(); await backend.close(); }
});
test("HEAD, 204 and 304 retain bodyless responses and metadata", async () => {
  const backend = await fixture((req, res) => { res.writeHead(Number(req.url.slice(1)), { ETag: '"fixture"', "Content-Length": "7" }); res.end(req.method === "HEAD" ? "ignored" : undefined); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try {
    for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 304]]) {
      const res = await request(new URL(`/${status}`, origin.url), { method });
      assert.equal(res.status, status); assert.equal(res.body.length, 0); assert.equal(res.headers.etag, '"fixture"');
    }
  } finally { await origin.close(); await backend.close(); }
});
test("a lost response after mutation is still an error and never repeats the POST", async () => {
  let mutations = 0;
  const backend = await fixture((req) => { req.resume(); req.on("end", () => { mutations++; req.socket.destroy(); }); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try { await assert.rejects(request(origin.url, { method: "POST" }, "commit-once")); assert.equal(mutations, 1); }
  finally { await origin.close(); await backend.close(); }
});
test("client cancellation releases an active backend stream", async () => {
  let observedClose;
  const closed = new Promise(resolve => { observedClose = resolve; });
  const backend = await fixture((_req, res) => { res.write("started"); res.on("close", observedClose); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(origin.url, res => { res.once("data", () => { req.destroy(); resolve(); }); res.on("error", () => {}); }); req.on("error", reject);
    });
    await closed;
  } finally { await origin.close(); await backend.close(); }
});
test("a response may stream beyond the five-second idle boundary without truncation", async () => {
  let timer;
  const backend = await fixture((_req, res) => { res.write("first-"); timer = setTimeout(() => res.end("last"), 5100); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try { assert.equal((await request(origin.url)).body.toString(), "first-last"); }
  finally { clearTimeout(timer); await origin.close(); await backend.close(); }
});
test("a partial response disconnect is visible and not retried", async () => {
  let dispatches = 0;
  const backend = await fixture((_req, res) => { dispatches++; res.write("incomplete"); setImmediate(() => res.socket.destroy()); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try { await assert.rejects(request(origin.url)); assert.equal(dispatches, 1); }
  finally { await origin.close(); await backend.close(); }
});
test("real upgrade preserves handshake, buffered bytes and bidirectional data", async () => {
  const backend = await fixture();
  backend.server.on("upgrade", (_req, socket, head) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nserver-first");
    if (head.length) socket.write(head); socket.pipe(socket);
  });
  const origin = await createWorkerConnectionOrigin(backend.url);
  const client = net.connect({ host: "127.0.0.1", port: Number(origin.url.port) });
  try {
    const result = new Promise((resolve, reject) => {
      let received = ""; client.on("data", b => { received += b.toString(); if (received.includes("server-first") && received.includes("client-first") && received.includes("client-next")) resolve(received); }); client.on("error", reject);
    });
    client.write("GET /upgrade HTTP/1.1\r\nHost: fixture\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nclient-first");
    client.write("client-next");
    assert.match(await result, /^HTTP\/1.1 101 Switching Protocols/);
  } finally { client.destroy(); await origin.close(); await backend.close(); }
});
test("rejected upgrade preserves HTTP failure and complete decoded body", async () => {
  const backend = await fixture((_req, res) => { res.writeHead(403, { "Content-Type": "text/plain" }); res.write("denied-"); res.end("complete"); });
  const origin = await createWorkerConnectionOrigin(backend.url);
  try {
    const res = await request(origin.url, { headers: { Connection: "Upgrade", Upgrade: "fixture" } });
    assert.equal(res.status, 403); assert.equal(res.body.toString(), "denied-complete");
  } finally { await origin.close(); await backend.close(); }
});
test("origin identity stays stable until a real backend change and teardown closes every origin", async () => {
  const a = await fixture((_q, s) => s.end("a")), b = await fixture((_q, s) => s.end("b"));
  const owner = {}, pool = createWorkerConnectionPool();
  try {
    const first = await pool.origin(owner, a.url); assert.equal((await pool.origin(owner, a.url)).origin, first.origin);
    const second = await pool.origin(owner, b.url); assert.notEqual(second.origin, first.origin);
    assert.equal((await request(second)).body.toString(), "b"); await assert.rejects(request(first));
    await pool.close(owner); await pool.close(owner); await assert.rejects(request(second));
    const stale = await pool.origin({}, a.url, () => false); assert.equal(stale.origin, a.url.origin);
  } finally { await pool.close(owner); await a.close(); await b.close(); }
});
test("superseded creation and concurrent teardown leave no usable new origin", async () => {
  const backend = await fixture((_q, s) => s.end("ok")); const owner = {}, pool = createWorkerConnectionPool();
  try {
    const pending = pool.origin(owner, backend.url); await pool.close(owner);
    assert.equal((await pending).origin, backend.url.origin);
    let calls = 0; const stale = await pool.origin(owner, backend.url, () => ++calls === 1);
    assert.equal(stale.origin, backend.url.origin);
  } finally { await pool.close(owner); await backend.close(); }
});
test("active response and upgrade survive origin retirement, then close at controller teardown", async () => {
  let response;
  const a = await fixture((_q, s) => { response = s; s.write("first-"); });
  a.server.on("upgrade", (_req, socket, head) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nready");
    if (head.length) socket.write(head); socket.pipe(socket);
  });
  const b = await fixture((_q, s) => s.end("new")), owner = {}, pool = createWorkerConnectionPool();
  let read, upgraded;
  try {
    const first = await pool.origin(owner, a.url);
    let body = "";
    const incoming = await new Promise((resolve, reject) => {
      read = http.get(first, r => { r.on("error", () => {}); r.on("data", chunk => { body += chunk; resolve(r); }); }); read.on("error", reject);
    });
    const bodyClosed = once(incoming, "close");
    upgraded = net.connect({ host: "127.0.0.1", port: Number(first.port) });
    let wire = ""; upgraded.on("data", chunk => { wire += chunk; });
    const waitFor = (stream, predicate) => new Promise((resolve, reject) => {
      const check = () => { if (predicate()) { stream.off("data", check); stream.off("error", reject); resolve(); } };
      stream.on("data", check); stream.once("error", reject); check();
    });
    upgraded.write("GET /upgrade HTTP/1.1\r\nHost: fixture\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n");
    await waitFor(upgraded, () => wire.includes("ready"));
    const upgradedClosed = once(upgraded, "close");
    const second = await pool.origin(owner, b.url); assert.notEqual(first.origin, second.origin);
    response.write("after-retire"); upgraded.write("still-connected");
    await Promise.all([waitFor(incoming, () => body.includes("after-retire")), waitFor(upgraded, () => wire.includes("still-connected"))]);
    assert.equal((await request(second)).body.toString(), "new");
    // once(close) would reject on the expected stream-abort error, so observe
    // closure directly after confirming data flowed through the retired origin.
    const closed = new Promise(resolve => incoming.once("close", resolve));
    bodyClosed.catch(() => {});
    await pool.close(owner); await closed; await upgradedClosed;
    await assert.rejects(request(first)); await assert.rejects(request(second));
  } finally { read?.destroy(); upgraded?.destroy(); await pool.close(owner); await a.close(); await b.close(); }
});
