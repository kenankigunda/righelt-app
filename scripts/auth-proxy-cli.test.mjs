// Run separately from tests that read the original pinned dependency bytes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readdir, rm, cp, mkdir } from "node:fs/promises";
import { once } from "node:events";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { installProxyRepair } from "./auth-proxy-diagnostics.mjs";
import { createProxyFailureJournal, completeProxyFailureJournal, checkProxyFailureJournal } from "./auth-proxy-failures.mjs";
import { spawnAuthStackCommand, stopAuthStackCommand } from "./auth-stack-process.mjs";

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
test("native CLI survives a canceled upload while rejecting it, recording it and never replaying it", { timeout: 40000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "auth-cli-regression-"));
  let restore, child, client, timer, primaryError;
  const sockets = new Set();
  let received = 0, mutations = 0, requests = 0, started;
  const receiving = new Promise(resolve => { started = resolve; });
  const backend = http.createServer(request => {
    requests++;
    request.on("error", () => {});
    request.on("data", chunk => { received += chunk.length; started(); });
    request.on("end", () => { mutations++; request.socket.destroy(); });
  });
  backend.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  try {
    backend.listen(0, "127.0.0.1"); await once(backend, "listening");
    const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const worker = `let instance; export default {async fetch(request) {
      instance ??= crypto.randomUUID();
      const pathname = new URL(request.url).pathname;
      if (pathname === '/health') return new Response(instance);
      if (pathname === '/normal') return new Response(await request.text());
      return fetch(${JSON.stringify(`http://127.0.0.1:${backend.address().port}/`)}, new Request(request));
    }};`;
    await writeFile(path.join(temporary, "worker.mjs"), worker);
    const config = path.join(temporary, "wrangler.toml");
    await writeFile(config, 'name = "account-proxy-regression"\nmain = "worker.mjs"\ncompatibility_date = "2026-02-19"\n');
    const runId = randomUUID(), directory = path.join(temporary, "journal");
    await createProxyFailureJournal(directory, runId);
    restore = await installProxyRepair();
    child = spawnAuthStackCommand(["exec", "wrangler", "dev", "--local", "--config", config, "--port", String(port), "--inspector-port", "0"], {
      cwd: process.cwd(), service: true, captureStderr: true,
      env: { ...process.env, CI: "1", WRANGLER_LOG_PATH: path.join(temporary, "logs"), RIGHELT_AUTH_FRESH_CONNECTIONS: "1",
        RIGHELT_AUTH_FAILURE_DIRECTORY: directory, RIGHELT_AUTH_FAILURE_RUN_ID: runId, RIGHELT_AUTH_FAILURE_SERVICE: "web" },
    });
    child.stderr.on("data", chunk => process.stderr.write(chunk));
    let instance;
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(child.exitCode, null, "native CLI exited during startup");
      try { const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(200) }); if (response.status === 200) instance = await response.text(); } catch {}
      if (instance) break;
      await sleep(100);
    }
    assert.match(instance || "", /^[0-9a-f-]{36}$/);
    const failed = new Promise(resolve => {
      client = http.request(origin + "/api/auth/logout", { method: "POST", headers: { "Content-Length": "1000000" } });
      client.once("error", error => resolve({ kind: "error", error }));
      client.once("response", response => { response.resume(); resolve({ kind: "response", status: response.statusCode }); });
      client.write("x".repeat(1024));
    });
    await Promise.race([receiving, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Upload did not reach backend")), 5000); })]);
    clearTimeout(timer); client.destroy(); assert.equal((await failed).kind, "error", "canceled upload returned an HTTP response");
    for (let attempt = 0; attempt < 100 && !(await readdir(path.join(directory, "requests"))).length; attempt++) {
      assert.equal(child.exitCode, null, "cancellation terminated native CLI"); await sleep(50);
    }
    assert.equal((await readdir(path.join(directory, "requests"))).length, 1);
    assert.equal(await (await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) })).text(), instance, "worker restarted");
    const response = await fetch(origin + "/normal", { method: "POST", body: "complete", signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200); assert.equal(await response.text(), "complete");
    assert.equal(child.exitCode, null); assert.equal(requests, 1); assert.equal(received, 1024); assert.equal(mutations, 0);
    assert.equal(await stopAuthStackCommand(child), true);
    await completeProxyFailureJournal(directory, runId, true);
    assert.deepEqual(await checkProxyFailureJournal(directory, runId), { count: 1, passed: false });
  } catch (error) { primaryError = error; throw error; }
  finally {
    clearTimeout(timer); client?.destroy();
    try {
      if (child) {
        const stopped = await stopAuthStackCommand(child);
        if (!primaryError) assert.equal(stopped, true);
      }
    }
    finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => backend.close(resolve));
      try { await restore?.(); } finally {
        if (primaryError) {
          const evidence = path.resolve("test-results/auth-stack-private", path.basename(temporary));
          await mkdir(path.dirname(evidence), { recursive: true }); await cp(temporary, evidence, { recursive: true });
          console.error(`[auth-e2e] Native regression failure evidence: ${evidence}`);
        }
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
});
