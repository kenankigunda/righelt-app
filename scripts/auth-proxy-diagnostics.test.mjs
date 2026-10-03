import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { classifyProxyRejection, instrumentProxySource, installProxyDiagnostics } from "./auth-proxy-diagnostics.mjs";

const packageFile = createRequire(import.meta.url).resolve("wrangler/package.json");
const source = await readFile(path.join(path.dirname(packageFile), "wrangler-dist/ProxyWorker.js"), "utf8");

test("diagnostics expose only allowlisted structure, never arbitrary error or request values", () => {
  const secret = "private-password-and-token";
  const report = classifyProxyRejection({ name: secret, code: secret,
    message: `Network connection lost: ${secret}`, cause: { code: "ECONNRESET", message: secret } },
  { method: "POST", url: `http://user:${secret}@localhost:9999/api/auth/login?token=${secret}`, headers: { Cookie: secret } },
  `http://user:${secret}@127.0.0.1:1234/private/${secret}?token=${secret}`, `https://${secret}.example/`);
  assert.deepEqual(report, { path: "/api/auth/login", method: "POST", name: "other", code: "other",
    causeCode: "ECONNRESET", message: "network_connection_lost", oldOrigin: "http://127.0.0.1:1234",
    newOrigin: "non-local", proxyPaused: false });
  assert.ok(!JSON.stringify(report).includes(secret));
  const unknown = classifyProxyRejection({ message: secret }, { method: secret, url: `http://localhost/api/invites/${secret}` }, undefined, undefined);
  assert.equal(unknown.path, "other");
  assert.equal(unknown.message, "other");
  assert.equal(unknown.proxyPaused, true);
  assert.ok(!JSON.stringify(unknown).includes(secret));
});

test("source guard rejects changed versions, changed source and already patched source", () => {
  assert.throws(() => instrumentProxySource(source, "4.68.0"), /exact reviewed/);
  assert.throws(() => instrumentProxySource(source + "\n", "4.67.0"), /exact reviewed/);
  const patched = instrumentProxySource(source, "4.67.0");
  assert.throws(() => instrumentProxySource(patched, "4.67.0"), /exact reviewed/);
});

test("instrumented actual proxy keeps forwarding failure response unchanged and logs safely", async () => {
  class WorkerHeaders extends Headers { getAll(name) { return name.toLowerCase() === "set-cookie" ? this.getSetCookie() : []; } }
  const invoke = async (input, log) => {
    const script = input.replace('import assert from "node:assert";', "")
      .replace(/export \{[\s\S]*?\};\s*$/, "globalThis.TestProxyWorker = ProxyWorker;");
    const context = { URL, Request, Response, Headers: WorkerHeaders, assert,
      console: { error: (...args) => log.push(args) },
      fetch: async () => { throw new TypeError("Network connection lost: private-secret"); } };
    vm.createContext(context); vm.runInContext(script, context);
    const proxy = new context.TestProxyWorker({}, { PROXY_CONTROLLER_AUTH_SECRET: "unused" });
    proxy.proxyData = { userWorkerUrl: { protocol: "http:", hostname: "127.0.0.1", port: "1234" }, headers: {} };
    const response = await proxy.fetch(new Request("http://127.0.0.1:8787/api/auth/register?token=private-secret", { method: "POST", body: "private-secret" }));
    return { status: response.status, headers: [...response.headers], body: await response.text() };
  };
  const log = [];
  const original = await invoke(source, []);
  assert.equal(original.status, 503);
  assert.deepEqual(await invoke(instrumentProxySource(source, "4.67.0"), log), original);
  assert.equal(log.length, 1);
  assert.equal(log[0][0], "[auth-e2e-proxy-rejection]");
  assert.equal(JSON.parse(log[0][1]).message, "network_connection_lost");
  assert.ok(!JSON.stringify(log).includes("private-secret"));
});

test("installation restores exact dependency bytes, and refuses to overwrite external changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auth-proxy-diagnostics-test-"));
  try {
    await mkdir(path.join(directory, "wrangler-dist"));
    const metadata = path.join(directory, "package.json");
    const file = path.join(directory, "wrangler-dist/ProxyWorker.js");
    await writeFile(metadata, JSON.stringify({ version: "4.67.0" }));
    await writeFile(file, source);
    const restore = await installProxyDiagnostics(metadata);
    assert.notEqual(await readFile(file, "utf8"), source);
    await restore(); await restore();
    assert.equal(await readFile(file, "utf8"), source);
    const restoreChanged = await installProxyDiagnostics(metadata);
    await writeFile(file, "external change");
    await assert.rejects(restoreChanged(), /refusing to overwrite/);
    assert.equal(await readFile(file, "utf8"), "external change");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
