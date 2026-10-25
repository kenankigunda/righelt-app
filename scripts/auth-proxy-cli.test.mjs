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
test("native CLI survives a canceled upload while rejecting it, recording it and never replaying it", { timeout: 40000 }, async context => {
  let temporary, restore, child, client, timer, primaryError, reservation, cleanupPromise, pendingSetup;
  let phase = "setup", rejectAbort;
  const timeline = [];
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // An abort can arrive between steps. Keep its rejection observed until the
  // next raced operation unwinds the body into the registered teardown.
  aborted.catch(() => {});
  const sockets = new Set();
  let received = 0, mutations = 0, requests = 0, started;
  const note = (event, details = {}) => {
    const entry = { at: new Date().toISOString(), event, phase, received, mutations, requests,
      guardianExitCode: child?.exitCode ?? null, guardianSignal: child?.signalCode ?? null, ...details };
    timeline.push(entry);
    console.error(`[auth-cli-regression] ${JSON.stringify(entry)}`);
  };
  const step = async (name, operation) => {
    context.signal.throwIfAborted();
    phase = name; note("phase-start");
    const value = await Promise.race([Promise.resolve().then(() => { context.signal.throwIfAborted(); return operation(); }), aborted]);
    note("phase-complete");
    return value;
  };
  const setup = async operation => {
    context.signal.throwIfAborted();
    pendingSetup = Promise.resolve().then(() => { context.signal.throwIfAborted(); return operation(); });
    return pendingSetup;
  };
  const receiving = new Promise(resolve => { started = resolve; });
  const backend = http.createServer(request => {
    requests++;
    note("backend-request");
    request.on("error", error => note("backend-error", { code: error.code }));
    request.on("data", chunk => { received += chunk.length; note("backend-data", { bytes: chunk.length }); started(); });
    request.on("end", () => { mutations++; request.socket.destroy(); });
  });
  backend.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const releaseConnections = () => {
    clearTimeout(timer); client?.destroy();
    for (const socket of sockets) socket.destroy();
    if (reservation?.listening) reservation.close();
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    note("cleanup-start");
    // Do this before awaiting the guardian: a half-open upload must not keep
    // either endpoint alive while shutdown is waiting for native streams.
    releaseConnections();
    const backendClosed = new Promise(resolve => backend.close(resolve));
    try {
      // Filesystem setup cannot be aborted mid-write. Finish its current
      // operation before restoring dependency bytes or removing its directory.
      if (pendingSetup) await pendingSetup.catch(() => {});
      if (child) {
        note("guardian-stop-start");
        const stopped = await stopAuthStackCommand(child);
        note("guardian-stop-complete", { stopped });
        if (!primaryError) assert.equal(stopped, true);
      }
    } finally {
      await backendClosed;
      try { await restore?.(); } finally {
        if (temporary) {
          await writeFile(path.join(temporary, "timeline.json"), JSON.stringify(timeline, null, 2));
          if (primaryError || context.signal.aborted) {
            const evidence = path.resolve("test-results/auth-stack-private", path.basename(temporary));
            await mkdir(path.dirname(evidence), { recursive: true }); await cp(temporary, evidence, { recursive: true });
            console.error(`[auth-e2e] Native regression failure evidence: ${evidence}`);
          }
          await rm(temporary, { recursive: true, force: true });
        }
      }
      note("cleanup-complete");
    }
  })();
  const onAbort = () => {
    primaryError ??= context.signal.reason;
    note("test-abort", { message: String(context.signal.reason) });
    releaseConnections();
    child?.kill("SIGTERM");
    rejectAbort(context.signal.reason);
  };
  context.signal.addEventListener("abort", onAbort, { once: true });
  context.after(async () => {
    try { await cleanup(); } finally { context.signal.removeEventListener("abort", onAbort); }
  });
  try {
    await setup(async () => { temporary = await mkdtemp(path.join(os.tmpdir(), "auth-cli-regression-")); });
    await step("backend-listening", () => { backend.listen(0, "127.0.0.1"); return once(backend, "listening"); });
    reservation = http.createServer();
    await step("port-reservation", () => { reservation.listen(0, "127.0.0.1"); return once(reservation, "listening"); });
    const port = reservation.address().port; await step("release-reservation", () => new Promise(resolve => reservation.close(resolve)));
    const origin = `http://127.0.0.1:${port}`;
    const worker = `let instance; export default {async fetch(request) {
      instance ??= crypto.randomUUID();
      const pathname = new URL(request.url).pathname;
      if (pathname === '/health') return new Response(instance);
      if (pathname === '/normal') return new Response(await request.text());
      return fetch(${JSON.stringify(`http://127.0.0.1:${backend.address().port}/`)}, new Request(request));
    }};`;
    await setup(() => writeFile(path.join(temporary, "worker.mjs"), worker));
    const config = path.join(temporary, "wrangler.toml");
    await setup(() => writeFile(config, 'name = "account-proxy-regression"\nmain = "worker.mjs"\ncompatibility_date = "2026-02-19"\n'));
    const runId = randomUUID(), directory = path.join(temporary, "journal");
    await setup(() => createProxyFailureJournal(directory, runId));
    await setup(async () => { restore = await installProxyRepair(); });
    context.signal.throwIfAborted();
    child = spawnAuthStackCommand(["exec", "wrangler", "dev", "--local", "--config", config, "--port", String(port), "--inspector-port", "0"], {
      cwd: process.cwd(), service: true, captureStderr: true,
      env: { ...process.env, CI: "1", WRANGLER_LOG_PATH: path.join(temporary, "logs"), RIGHELT_AUTH_FRESH_CONNECTIONS: "1",
        RIGHELT_AUTH_FAILURE_DIRECTORY: directory, RIGHELT_AUTH_FAILURE_RUN_ID: runId, RIGHELT_AUTH_FAILURE_SERVICE: "web" },
    });
    child.stderr.on("data", chunk => process.stderr.write(chunk));
    child.on("exit", (code, signal) => note("guardian-exit", { code, signal }));
    child.on("close", (code, signal) => note("guardian-close", { code, signal }));
    let instance;
    for (let attempt = 0; attempt < 150; attempt++) {
      context.signal.throwIfAborted();
      assert.equal(child.exitCode, null, "native CLI exited during startup");
      phase = "startup-health";
      try { const response = await fetch(origin + "/health", { signal: AbortSignal.any([context.signal, AbortSignal.timeout(200)]) }); if (response.status === 200) instance = await step("startup-health-body", () => response.text()); } catch { context.signal.throwIfAborted(); }
      if (instance) break;
      await sleep(100);
    }
    assert.match(instance || "", /^[0-9a-f-]{36}$/);
    const failed = new Promise(resolve => {
      client = http.request(origin + "/api/auth/logout", { method: "POST", headers: { "Content-Length": "1000000" } });
      client.once("error", error => { note("client-error", { code: error.code }); resolve({ kind: "error", error }); });
      client.once("response", response => { note("client-response", { status: response.statusCode }); response.resume(); resolve({ kind: "response", status: response.statusCode }); });
      client.once("close", () => note("client-close"));
      client.write("x".repeat(1024));
    });
    await step("upload-reaches-backend", () => Promise.race([receiving, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Upload did not reach backend")), 5000); })]));
    clearTimeout(timer); client.destroy(); assert.equal((await step("cancelled-client-result", () => failed)).kind, "error", "canceled upload returned an HTTP response");
    phase = "failure-journal"; note("phase-start");
    for (let attempt = 0; attempt < 100 && !(await readdir(path.join(directory, "requests"))).length; attempt++) {
      context.signal.throwIfAborted();
      assert.equal(child.exitCode, null, "cancellation terminated native CLI"); await sleep(50);
    }
    assert.equal((await readdir(path.join(directory, "requests"))).length, 1);
    assert.equal(await step("worker-identity", async () => (await fetch(origin + "/health", { signal: AbortSignal.any([context.signal, AbortSignal.timeout(1000)]) })).text()), instance, "worker restarted");
    const response = await step("normal-request", () => fetch(origin + "/normal", { method: "POST", body: "complete", signal: AbortSignal.any([context.signal, AbortSignal.timeout(1000)]) }));
    assert.equal(response.status, 200); assert.equal(await step("normal-response", () => response.text()), "complete");
    assert.equal(child.exitCode, null); assert.equal(requests, 1); assert.equal(received, 1024); assert.equal(mutations, 0);
    releaseConnections();
    assert.equal(await step("verified-guardian-stop", () => stopAuthStackCommand(child)), true);
    await completeProxyFailureJournal(directory, runId, true);
    assert.deepEqual(await checkProxyFailureJournal(directory, runId), { count: 1, passed: false });
  } catch (error) { primaryError = error; note("body-error", { message: error.message }); throw error; }
  finally { await cleanup(); }
});
