import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createProxyFailureJournal } from "./auth-proxy-failures.mjs";
import os from "node:os";
import path from "node:path";
import { recordAuthServiceExit, observeAuthService, summarizeWranglerLog } from "./auth-stack-diagnostics.mjs";
import { classifyProxyRejection } from "./auth-proxy-diagnostics.mjs";
import { localApiFailure } from "../apps/web/local-api-diagnostics.js";
const secret = "private-binding-password-cookie-and-query";
test('general service diagnostics cannot pass with missing logs during expected shutdown', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'general-exit-missing-'));
  try {
    const child = new EventEmitter(); child.pid = 1;
    let errors = 0, exit;
    const pending = observeAuthService(child, { service: 'web', logDirectory: path.join(dir, 'missing'),
      outputFile: path.join(dir, 'receipt.json'), requireLogs: true, isStopping: () => true,
      onDiagnosticError: () => errors++, onUnexpectedExit: code => { exit = code; } });
    child.emit('close', 0, 'SIGTERM');
    assert.deepEqual(await pending, { expected: true, diagnosticsFailed: true });
    assert.equal(errors, 1); assert.equal(exit, 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'receipt.json'), 'utf8')).logs, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("missing receipt logs and receipt ACK failures cannot become a clean shutdown", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    for (const mode of ["missing", "ack-failed"]) {
      const logDirectory = path.join(dir, mode); await mkdir(logDirectory);
      if (mode === "ack-failed") await writeFile(path.join(logDirectory, "wrangler-2026-10-09_20-00-00_000.log"), "[auth-e2e-proxy-receipt-failed]");
      const child = new EventEmitter(); child.pid = 1;
      let errors = 0, exit = 0;
      const result = observeAuthService(child, { service: "web", logDirectory, outputFile: path.join(dir, `${mode}.json`), requireProxyReceiptLogs: true,
        isStopping: () => true, onUnexpectedExit: code => { exit = code; }, onDiagnosticError: () => errors++ });
      child.emit("close", 0, "SIGTERM");
      assert.equal((await result).diagnosticsFailed, true); assert.equal(errors, 1); assert.equal(exit, 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("shutdown during a pending ACK fails even before the timeout marker is written", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    const runId = randomUUID(), requestId = randomUUID();
    const journal = path.join(dir, "journal"); await createProxyFailureJournal(journal, runId);
    const logDirectory = path.join(dir, "raw"); await mkdir(logDirectory);
    await writeFile(path.join(logDirectory, "wrangler-2026-10-09_20-00-00_000.log"),
      `[auth-e2e-proxy-receipt-required] ${JSON.stringify({ runId, requestId })}\n`);
    const child = new EventEmitter(); child.pid = 1;
    let errors = 0, exit = 0;
    const pending = observeAuthService(child, { service: "web", logDirectory, outputFile: path.join(dir, "exit.json"),
      requireProxyReceiptLogs: true, failureDirectory: journal, failureRunId: runId,
      isStopping: () => true, onDiagnosticError: () => errors++, onUnexpectedExit: code => { exit = code; } });
    child.emit("close", 0, "SIGTERM");
    assert.equal((await pending).diagnosticsFailed, true); assert.equal(errors, 1); assert.equal(exit, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("raw Wrangler details become only hashes and fixed diagnostic categories", () => {
  const record = summarizeWranglerLog(Buffer.from(`${secret}\nError in ProxyController: Error inside ProxyWorker\nNetwork connection lost.\nECONNRESET\nSSLV3_ALERT_CERTIFICATE_UNKNOWN`));
  assert.equal(record.proxyControllerError, true); assert.equal(record.networkConnectionLost, true);
  assert.equal(record.connectionReset, true); assert.equal(record.connectionRefused, false); assert.equal(record.certificateUnknown, true);
  assert.match(record.sha256, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(record).includes(secret));
});
test('connection loss summaries recognize the actual redacted proxy and Pages diagnostics', () => {
  const error = new Error(`Network connection lost: ${secret}`);
  const request = new Request(`http://localhost/api/shell/games/private-game?identityId=${secret}`);
  const reports = [
    ['[auth-e2e-proxy-rejection]', classifyProxyRejection(error, request, undefined, undefined)],
    ['[local-api-forwarding-failure]', localApiFailure(error, request, 'fetch')],
  ];
  for (const [marker, report] of reports) {
    assert.equal(report.message, 'network_connection_lost');
    const raw = Buffer.from(`${marker} ${JSON.stringify(report)}\n`);
    const summary = summarizeWranglerLog(raw);
    assert.equal(summary.networkConnectionLost, true, marker);
    assert.equal(summary.bytes, raw.length);
    assert.ok(!JSON.stringify(summary).includes(secret));
  }
  const unrelated = localApiFailure(new Error('Connection refused'), request, 'fetch');
  assert.equal(summarizeWranglerLog(Buffer.from(JSON.stringify(unrelated))).networkConnectionLost, false);
});
test('service exit receipts retain normalized connection loss without publishing raw request details', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'normalized-exit-test-'));
  try {
    const logDirectory = path.join(dir, 'raw'); await mkdir(logDirectory);
    const request = new Request(`http://localhost/api/shell/games/private-game?identityId=${secret}`);
    const report = localApiFailure(new Error(`Network connection lost: ${secret}`), request, 'fetch');
    const raw = `[local-api-forwarding-failure] ${JSON.stringify(report)}\n${secret}`;
    const logFile = path.join(logDirectory, 'wrangler-2026-10-25_21-00-00_000.log');
    await writeFile(logFile, raw);
    const outputFile = path.join(dir, 'receipt.json');
    await recordAuthServiceExit({ service: 'web', expected: true, logDirectory, outputFile });
    const receipt = await readFile(outputFile, 'utf8');
    assert.equal(JSON.parse(receipt).logs[0].networkConnectionLost, true);
    assert.ok(!receipt.includes(secret));
    assert.equal(await readFile(logFile, 'utf8'), raw, 'Raw evidence stays intact');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
test("service receipt excludes raw logs, uncontrolled signals and unrelated files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    const logDirectory = path.join(dir, "raw"); await mkdir(logDirectory);
    await writeFile(path.join(logDirectory, "wrangler-2026-10-08_13-24-38_125.log"), `Network connection lost. ${secret}`);
    await writeFile(path.join(logDirectory, `${secret}.log`), secret);
    const options = { service: "web", supervisorPid: 123, code: null, signal: secret, expected: false, logDirectory, outputFile: path.join(dir, "receipt.json") };
    const record = await recordAuthServiceExit(options);
    assert.equal(record.logs.length, 1); assert.equal(record.signal, "other"); assert.equal(record.expected, false);
    assert.ok(!(await readFile(options.outputFile, "utf8")).includes(secret));
    await assert.rejects(recordAuthServiceExit(options), /EEXIST/);
    await assert.rejects(recordAuthServiceExit({ ...options, service: secret }), /Unknown account test service/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("actual failed child exit is recorded before requesting stack shutdown", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    const child = spawn(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
    let exit;
    const outputFile = path.join(dir, "receipt.json");
    const receipt = await observeAuthService(child, { service: "api", logDirectory: path.join(dir, "none"), outputFile,
      isStopping: () => false, onUnexpectedExit: code => { exit = code; }, onDiagnosticError: () => assert.fail("diagnostics failed") });
    assert.equal(exit, 7);
    assert.deepEqual(receipt, { expected: false, diagnosticsFailed: false });
    const record = JSON.parse(await readFile(outputFile, "utf8"));
    assert.equal(record.supervisorPid, child.pid); assert.equal(record.code, 7); assert.equal(record.expected, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("expected shutdown is recorded, while diagnostic write errors force failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    let errors = 0, exits = 0;
    const options = { service: "web", logDirectory: path.join(dir, "none"), outputFile: path.join(dir, "receipt.json"),
      isStopping: () => true, onUnexpectedExit: code => { assert.equal(code, 1); exits++; }, onDiagnosticError: () => errors++ };
    const child = new EventEmitter(); child.pid = 1;
    const first = observeAuthService(child, options); child.emit("close", 0, "SIGTERM"); await first;
    assert.equal(JSON.parse(await readFile(options.outputFile, "utf8")).expected, true); assert.equal(exits, 0);
    const second = observeAuthService(child, options); child.emit("close", 0, "SIGTERM"); await second;
    assert.equal(errors, 1); assert.equal(exits, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent shutdown cannot reclassify an already observed unexpected exit", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-exit-test-"));
  try {
    let stopping = false, requestedExit;
    const child = new EventEmitter(); child.pid = 1;
    const outputFile = path.join(dir, "receipt.json");
    const pendingReceipt = observeAuthService(child, { service: "web", logDirectory: path.join(dir, "none"), outputFile,
      isStopping: () => stopping, onUnexpectedExit: code => { requestedExit = code; },
      onDiagnosticError: () => assert.fail("diagnostics failed") });
    child.emit("close", 7, null);
    stopping = true; // SIGTERM arrives while asynchronous log reads/writes are pending.
    const receipt = await pendingReceipt;
    assert.equal(receipt.expected, false);
    assert.equal(requestedExit, 7);
    assert.equal(JSON.parse(await readFile(outputFile, "utf8")).expected, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
