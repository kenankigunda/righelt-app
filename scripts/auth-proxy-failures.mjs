// Test-stack failure accounting. A recorded transport failure is never a pass,
// a cancellation classification, or permission to replay a request.
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const AUTH_PROXY_RECEIPT_TIMEOUT_MS = 3000;

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const paths = ["other", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/session", "/api/auth/activity", "/api/auth/password", "/api/auth/username"];
const methods = ["other", "GET", "HEAD", "POST", "PATCH"];
async function durableJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
  const directory = await open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
const json = async file => JSON.parse(await readFile(file, "utf8"));
function binding(directory, runId) {
  if (!path.isAbsolute(directory || "") || !uuid(runId)) throw new Error("Invalid account failure journal binding");
}
export async function createProxyFailureJournal(directory, runId) {
  binding(directory, runId);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory); // Never reuse a previous run's journal.
  await mkdir(path.join(directory, "requests"));
  await durableJson(path.join(directory, "run.json"), { schema: 1, runId });
}
export async function recordProxyFailure(message, env = process.env) {
  const directory = env.RIGHELT_AUTH_FAILURE_DIRECTORY, runId = env.RIGHELT_AUTH_FAILURE_RUN_ID;
  binding(directory, runId);
  if (message?.schema !== 1 || message.runId !== runId || !uuid(message.requestId)
    || message.category !== "network_connection_lost" || !paths.includes(message.path)
    || !methods.includes(message.method) || !["api", "web"].includes(env.RIGHELT_AUTH_FAILURE_SERVICE))
    throw new Error("Invalid account request failure receipt");
  const manifest = await json(path.join(directory, "run.json"));
  if (manifest.schema !== 1 || manifest.runId !== runId) throw new Error("Account failure journal run mismatch");
  // Select fields explicitly: no arbitrary exception, URL, body or credential.
  const receipt = { schema: 1, runId, requestId: message.requestId,
    observedAt: new Date().toISOString(), service: env.RIGHELT_AUTH_FAILURE_SERVICE,
    category: "network_connection_lost", path: message.path, method: message.method };
  await durableJson(path.join(directory, "requests", `${receipt.requestId}.json`), receipt);
  return { schema: 1, runId, requestId: receipt.requestId, recorded: true };
}
async function readReceipts(directory, runId) {
  const manifest = await json(path.join(directory, "run.json"));
  if (manifest.schema !== 1 || manifest.runId !== runId) throw new Error("Account failure journal run mismatch");
  const files = await readdir(path.join(directory, "requests"));
  for (const file of files) {
    const record = await json(path.join(directory, "requests", file));
    if (record.schema !== 1 || record.runId !== runId || !uuid(record.requestId)
      || file !== `${record.requestId}.json` || record.category !== "network_connection_lost"
      || !paths.includes(record.path) || !methods.includes(record.method)
      || !["api", "web"].includes(record.service)) throw new Error("Malformed account failure journal");
  }
  return files.length;
}
// Called only after all owned services have stopped and their diagnostics flushed.
export async function completeProxyFailureJournal(directory, runId, successfulCleanup) {
  binding(directory, runId);
  const count = await readReceipts(directory, runId);
  await durableJson(path.join(directory, "complete.json"), { schema: 1, runId, count, successfulCleanup: successfulCleanup === true });
  return count;
}
export async function checkProxyFailureJournal(directory, runId) {
  binding(directory, runId);
  const count = await readReceipts(directory, runId);
  const complete = await json(path.join(directory, "complete.json"));
  if (complete.schema !== 1 || complete.runId !== runId || complete.count !== count || complete.successfulCleanup !== true)
    throw new Error("Account failure journal is incomplete");
  return { count, passed: count === 0 };
}
export async function checkRequiredProxyReceipts(directory, runId, required) {
  binding(directory, runId);
  for (const item of required) {
    if (item?.runId !== runId || !uuid(item.requestId)) throw new Error("Invalid required receipt identity");
    const receipt = await json(path.join(directory, "requests", `${item.requestId}.json`));
    if (receipt.schema !== 1 || receipt.runId !== runId || receipt.requestId !== item.requestId)
      throw new Error("Observed proxy failure has no matching receipt");
  }
}
