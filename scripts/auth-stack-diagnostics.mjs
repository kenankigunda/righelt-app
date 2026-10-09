import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkRequiredProxyReceipts } from "./auth-proxy-failures.mjs";

// Wrangler's raw debug logs can contain bindings or request data. Retain them
// locally, but publish only these fixed categories and content hashes in CI.
export function summarizeWranglerLog(raw) {
  const text = raw.toString("utf8");
  const requiredReceipts = [];
  let malformedRequiredReceipt = false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const match of text.matchAll(/\[auth-e2e-proxy-receipt-required\]([^\r\n]*)/g)) {
    try {
      const item = JSON.parse(match[1].trim());
      if (!uuid.test(item.runId) || !uuid.test(item.requestId)) throw new Error("Invalid receipt identity");
      requiredReceipts.push({ runId: item.runId, requestId: item.requestId });
    } catch { malformedRequiredReceipt = true; }
  }
  return {
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
    proxyControllerError: text.includes("Error in ProxyController: Error inside ProxyWorker"),
    networkConnectionLost: text.includes("Network connection lost"),
    connectionRefused: text.includes("ECONNREFUSED"),
    connectionReset: text.includes("ECONNRESET"),
    certificateUnknown: text.includes("SSLV3_ALERT_CERTIFICATE_UNKNOWN"),
    proxyReceiptFailed: text.includes("[auth-e2e-proxy-receipt-failed]"),
    requiredReceipts, malformedRequiredReceipt,
  };
}

export async function recordAuthServiceExit({ service, supervisorPid, code, signal, expected, logDirectory, outputFile }) {
  if (!["api", "web"].includes(service)) throw new Error("Unknown account test service");
  const files = await readdir(logDirectory).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const logs = [];
  for (const file of files.sort()) {
    if (/^wrangler-[\d_-]+\.log$/.test(file))
      logs.push(summarizeWranglerLog(await readFile(path.join(logDirectory, file))));
  }
  const record = {
    schema: 1, observedAt: new Date().toISOString(), service,
    supervisorPid: Number.isSafeInteger(supervisorPid) ? supervisorPid : null,
    code: Number.isSafeInteger(code) ? code : null,
    signal: [null, "SIGTERM", "SIGINT", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(signal) ? signal : "other",
    expected: expected === true, logs,
  };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return record;
}

// Capture the initiating exit before triggering sibling cleanup. Expected
// shutdowns still get a receipt, and diagnostics failure cannot make a run pass.
export function observeAuthService(child, { isStopping, onUnexpectedExit, onDiagnosticError, requireProxyReceiptLogs = false, failureDirectory, failureRunId, ...options }) {
  return new Promise(resolve => {
    child.once("close", async (code, signal) => {
      const expected = isStopping();
      let failed = false;
      try {
        const record = await recordAuthServiceExit({ ...options, supervisorPid: child.pid, code, signal, expected });
        console.error("[auth-e2e-service-exit]", JSON.stringify(record));
        if (requireProxyReceiptLogs) {
          if (!record.logs.length || record.logs.some(log => log.proxyReceiptFailed || log.malformedRequiredReceipt))
            throw new Error("Incomplete request failure accounting");
          const required = record.logs.flatMap(log => log.requiredReceipts);
          if (required.length) await checkRequiredProxyReceipts(failureDirectory, failureRunId, required);
        }
      } catch {
        failed = true;
        onDiagnosticError();
      }
      resolve({ expected, diagnosticsFailed: failed });
      if (!expected || failed) onUnexpectedExit(code || 1);
    });
  });
}
