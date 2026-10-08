import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Wrangler's raw debug logs can contain bindings or request data. Retain them
// locally, but publish only these fixed categories and content hashes in CI.
export function summarizeWranglerLog(raw) {
  const text = raw.toString("utf8");
  return {
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
    proxyControllerError: text.includes("Error in ProxyController: Error inside ProxyWorker"),
    networkConnectionLost: text.includes("Network connection lost"),
    connectionRefused: text.includes("ECONNREFUSED"),
    connectionReset: text.includes("ECONNRESET"),
    certificateUnknown: text.includes("SSLV3_ALERT_CERTIFICATE_UNKNOWN"),
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
export function observeAuthService(child, { isStopping, onUnexpectedExit, onDiagnosticError, ...options }) {
  return new Promise(resolve => {
    child.once("close", async (code, signal) => {
      const expected = isStopping();
      let failed = false;
      try {
        const record = await recordAuthServiceExit({ ...options, supervisorPid: child.pid, code, signal, expected });
        console.error("[auth-e2e-service-exit]", JSON.stringify(record));
      } catch {
        failed = true;
        onDiagnosticError();
      }
      resolve({ expected, diagnosticsFailed: failed });
      if (!expected || failed) onUnexpectedExit(code || 1);
    });
  });
}
