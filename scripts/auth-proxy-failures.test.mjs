import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createProxyFailureJournal, recordProxyFailure, completeProxyFailureJournal, checkProxyFailureJournal } from "./auth-proxy-failures.mjs";
import Reporter from "./auth-proxy-failure-reporter.mjs";

async function fixture(work) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "auth-request-receipts-"));
  const directory = path.join(temporary, "journal"), runId = randomUUID();
  const env = { RIGHELT_AUTH_FAILURE_DIRECTORY: directory, RIGHELT_AUTH_FAILURE_RUN_ID: runId, RIGHELT_AUTH_FAILURE_SERVICE: "web" };
  const message = () => ({ schema: 1, runId, requestId: randomUUID(), category: "network_connection_lost", path: "/api/auth/logout", method: "POST" });
  try { await work({ directory, runId, env, message, reporter: new Reporter({ directory, runId }) }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
test("empty accounting passes only after successful complete cleanup", () => fixture(async f => {
  assert.deepEqual(await f.reporter.onEnd({ status: "passed" }), { status: "failed" });
  await createProxyFailureJournal(f.directory, f.runId);
  await assert.rejects(createProxyFailureJournal(f.directory, f.runId), /EEXIST/);
  assert.deepEqual(await f.reporter.onEnd({ status: "passed" }), { status: "failed" });
  await completeProxyFailureJournal(f.directory, f.runId, true);
  assert.deepEqual(await checkProxyFailureJournal(f.directory, f.runId), { count: 0, passed: true });
  for (const status of ["passed", "failed", "interrupted", "timedout"]) assert.deepEqual(await f.reporter.onEnd({ status }), { status });
}));
test("concurrent receipts persist once each, are sanitized and always fail ordinary validation", () => fixture(async f => {
  await createProxyFailureJournal(f.directory, f.runId);
  const messages = [f.message(), f.message()];
  const acknowledgements = await Promise.all(messages.map(message => recordProxyFailure({ ...message, secret: "never-copy" }, f.env)));
  for (let index = 0; index < messages.length; index++) {
    assert.deepEqual(acknowledgements[index], { schema: 1, runId: f.runId, requestId: messages[index].requestId, recorded: true });
    const bytes = await readFile(path.join(f.directory, "requests", `${messages[index].requestId}.json`), "utf8");
    assert.ok(!bytes.includes("never-copy"));
  }
  await assert.rejects(recordProxyFailure(messages[0], f.env), /EEXIST/);
  assert.equal(await completeProxyFailureJournal(f.directory, f.runId, true), 2);
  assert.deepEqual(await checkProxyFailureJournal(f.directory, f.runId), { count: 2, passed: false });
  assert.deepEqual(await f.reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(await f.reporter.onEnd({ status: "interrupted" }), { status: "interrupted" });
}));
test("wrong run, malformed receipt, failed cleanup and truncated evidence cannot pass", () => fixture(async f => {
  await createProxyFailureJournal(f.directory, f.runId);
  await assert.rejects(recordProxyFailure({ ...f.message(), runId: randomUUID() }, f.env));
  await assert.rejects(recordProxyFailure({ ...f.message(), path: "/secret" }, f.env));
  assert.deepEqual(await readdir(path.join(f.directory, "requests")), []);
  await completeProxyFailureJournal(f.directory, f.runId, false);
  assert.deepEqual(await f.reporter.onEnd({ status: "passed" }), { status: "failed" });
  await writeFile(path.join(f.directory, "complete.json"), '{"broken":');
  assert.deepEqual(await f.reporter.onEnd({ status: "passed" }), { status: "failed" });
  await writeFile(path.join(f.directory, "requests", "partial.json"), '{');
  await assert.rejects(checkProxyFailureJournal(f.directory, f.runId));
}));
