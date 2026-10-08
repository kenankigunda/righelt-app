import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { classifyProxyRejection, prepareProxySource, installProxyRepair } from "./auth-proxy-diagnostics.mjs";

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
  assert.throws(() => prepareProxySource(source, "4.68.0"), /exact reviewed/);
  assert.throws(() => prepareProxySource(source + "\n", "4.67.0"), /exact reviewed/);
  const patched = prepareProxySource(source, "4.67.0");
  assert.throws(() => prepareProxySource(patched, "4.67.0"), /exact reviewed/);
});

test("installation restores exact dependency bytes, and refuses to overwrite external changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auth-proxy-diagnostics-test-"));
  try {
    await mkdir(path.join(directory, "wrangler-dist"));
    const metadata = path.join(directory, "package.json");
    const file = path.join(directory, "wrangler-dist/ProxyWorker.js");
    await writeFile(metadata, JSON.stringify({ version: "4.67.0" }));
    await writeFile(file, source);
    const restore = await installProxyRepair(metadata);
    assert.notEqual(await readFile(file, "utf8"), source);
    await restore(); await restore();
    assert.equal(await readFile(file, "utf8"), source);
    const restoreChanged = await installProxyRepair(metadata);
    await writeFile(file, "external change");
    await assert.rejects(restoreChanged(), /refusing to overwrite/);
    assert.equal(await readFile(file, "utf8"), "external change");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
