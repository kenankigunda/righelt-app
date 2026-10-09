import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { AUTH_PROXY_RECEIPT_TIMEOUT_MS } from "./auth-proxy-failures.mjs";

const VERSION = "4.67.0";
const SOURCE_HASH = "9810e87b168d4b1d27c553b1342ca939566810b5920e8f11cf32012188a522b2";
const RUNTIME_HASH = "5597846c83fce5efd353be1f77270d976b1ccde8f7a40aa99b929f8d7c296758";
const TARGET = "        const newUserWorkerUrl = this.proxyData && urlFromParts(this.proxyData.userWorkerUrl);\n";
const hash = source => createHash("sha256").update(source).digest("hex");

// This function is embedded in the test-only proxy. Never return arbitrary
// exception text, request values, headers, credentials, query strings or URLs.
export function classifyProxyRejection(error, request, oldUrl, newUrl) {
  const member = (value, key) => {
    try { return typeof value?.[key] === "string" ? value[key] : ""; } catch { return ""; }
  };
  const allowed = (value, list) => list.includes(value) ? value : "other";
  const origin = value => {
    try {
      const url = new URL(value);
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        && ["http:", "https:"].includes(url.protocol) ? url.origin : "non-local";
    } catch { return "unavailable"; }
  };
  let pathname = "other";
  try {
    pathname = allowed(new URL(request.url).pathname, [
      "/api/auth/register", "/api/auth/login", "/api/auth/logout",
      "/api/auth/session", "/api/auth/activity", "/api/auth/password",
      "/api/auth/username",
    ]);
  } catch {}
  const message = member(error, "message").toLowerCase();
  const codeList = ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"];
  let cause;
  try { cause = error?.cause; } catch {}
  return {
    path: pathname,
    method: allowed(member(request, "method"), ["GET", "HEAD", "POST", "PATCH"]),
    name: allowed(member(error, "name"), ["Error", "TypeError", "AbortError", "TimeoutError"]),
    code: allowed(member(error, "code"), codeList),
    causeCode: allowed(member(cause, "code"), codeList),
    message: message.includes("network connection lost") ? "network_connection_lost"
      : message.includes("disconnected") ? "disconnected"
      : message.includes("broken pipe") ? "broken_pipe"
      : message.includes("connection reset") ? "connection_reset"
      : message.includes("connection refused") ? "connection_refused"
      : message.includes("abort") ? "aborted"
      : message.includes("timeout") || message.includes("timed out") ? "timeout"
      : "other",
    oldOrigin: origin(oldUrl),
    newOrigin: origin(newUrl),
    proxyPaused: newUrl === undefined,
  };
}

export function prepareProxySource(source, version) {
  if (version !== VERSION || hash(source) !== SOURCE_HASH || source.split(TARGET).length !== 2)
    throw new Error("Auth proxy diagnostics require the exact reviewed Wrangler 4.67.0 source");
  const diagnostic = `        try { console.error("[auth-e2e-proxy-rejection]", JSON.stringify((${classifyProxyRejection.toString()})(error, request, userWorkerUrl, newUserWorkerUrl))); } catch {}\n`;
  // Backport workers-sdk#14593. The forwarded URL includes the request path
  // and query, while the current worker URL is a base URL. Compare identities
  // so an unchanged worker's failed read cannot be parked as a phantom reload.
  return source.replace(TARGET, TARGET + diagnostic)
    .replace("if (userWorkerUrl.href === newUserWorkerUrl?.href)",
      "if (userWorkerUrl.origin === newUserWorkerUrl?.origin)")
    .replace("}).catch((error) => {", "}).catch(async (error) => {")
    .replace('          void sendMessageToProxyController(this.env, {', `          if (this.env.RIGHELT_AUTH_FAILURE_RUN_ID && error?.name === "Error" && error?.message === "Network connection lost.") {
            const requestId = crypto.randomUUID();
            console.error("[auth-e2e-proxy-receipt-required]", JSON.stringify({ runId: this.env.RIGHELT_AUTH_FAILURE_RUN_ID, requestId }));
            const diagnostic = (${classifyProxyRejection.toString()})(error, request, userWorkerUrl, newUserWorkerUrl);
            const audit = (async () => {
            let timer;
            try {
              await Promise.race([(async () => {
              const ack = await sendMessageToProxyController(this.env, {
                type: "righelt-request-failure", schema: 1,
                runId: this.env.RIGHELT_AUTH_FAILURE_RUN_ID, requestId,
                category: "network_connection_lost", path: diagnostic.path, method: diagnostic.method
              });
              const body = await ack.json();
              if (ack.status !== 201 || body.schema !== 1 || body.recorded !== true
                || body.runId !== this.env.RIGHELT_AUTH_FAILURE_RUN_ID || body.requestId !== requestId)
                throw new Error("Account request failure receipt was not acknowledged");
              })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Receipt timeout")), ${AUTH_PROXY_RECEIPT_TIMEOUT_MS}); })]);
            } catch {
              console.error("[auth-e2e-proxy-receipt-failed]");
              void sendMessageToProxyController(this.env, { type: "error", error: {
                name: "Error", message: "Account request failure receipt was not acknowledged"
              }}).catch(() => {});
            } finally { clearTimeout(timer); deferredResponse.reject(error); }
            })();
            this.state.waitUntil(audit);
            await audit;
            return;
          }
          void sendMessageToProxyController(this.env, {`);
}

export function prepareRuntimeSource(source, version) {
  const ready = "const userWorkerUrl = await this.#mf.ready;";
  const dispose = "await this.#mf?.dispose();";
  if (version !== VERSION || hash(source) !== RUNTIME_HASH
    || source.split(ready).length !== 3 || source.split(dispose).length !== 3)
    throw new Error("Account worker connections require the exact reviewed Wrangler 4.67.0 runtime");
  const helper = `await import(${JSON.stringify(new URL("./auth-worker-connections.mjs", import.meta.url).href)})`;
  const receipts = `await import(${JSON.stringify(new URL("./auth-proxy-failures.mjs", import.meta.url).href)})`;
  return source.replaceAll(ready,
    `const userWorkerUrl = await (${helper}).workerConnectionOrigin(this, await this.#mf.ready, () => id === this.#currentBundleId);`)
    .replaceAll(dispose, `await (${helper}).closeWorkerConnections(this);\n        ${dispose}`)
    .replace('                  this.onProxyWorkerMessage(message);', `                  if (message.type === "righelt-request-failure") {
                    try {
                      const receipt = await (${receipts}).recordProxyFailure(message);
                      return new miniflare.Response(JSON.stringify(receipt), { status: 201 });
                    } catch {
                      this.emitErrorEvent("Account request failure accounting failed", { name: "Error", message: "Could not persist request failure receipt" });
                      return new miniflare.Response(null, { status: 500 });
                    }
                  }
                  this.onProxyWorkerMessage(message);`)
    .replace('PROXY_CONTROLLER_AUTH_SECRET: this.secret', 'RIGHELT_AUTH_FAILURE_RUN_ID: process.env.RIGHELT_AUTH_FAILURE_RUN_ID || "",\n                PROXY_CONTROLLER_AUTH_SECRET: this.secret');
}

export async function installProxyRepair(packageFile = createRequire(import.meta.url).resolve("wrangler/package.json")) {
  const metadata = JSON.parse(await readFile(packageFile, "utf8"));
  const entries = [];
  for (const [name, prepare] of [["ProxyWorker.js", prepareProxySource], ["cli.js", prepareRuntimeSource]]) {
    const file = path.join(path.dirname(packageFile), "wrangler-dist", name);
    const original = await readFile(file, "utf8");
    entries.push({ file, original, patched: prepare(original, metadata.version), written: false });
  }
  const restore = async () => {
    let changed = false;
    for (const entry of entries) {
      if (!entry.written) continue;
      if (await readFile(entry.file, "utf8") !== entry.patched) { changed = true; continue; }
      await writeFile(entry.file, entry.original); entry.written = false;
    }
    if (changed) throw new Error("Auth proxy source changed during the run; refusing to overwrite it");
  };
  try {
    for (const entry of entries) { await writeFile(entry.file, entry.patched); entry.written = true; }
  } catch (error) { await restore(); throw error; }
  return restore;
}
