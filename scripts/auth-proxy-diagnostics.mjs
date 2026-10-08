import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const VERSION = "4.67.0";
const SOURCE_HASH = "9810e87b168d4b1d27c553b1342ca939566810b5920e8f11cf32012188a522b2";
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
      "if (userWorkerUrl.origin === newUserWorkerUrl?.origin)");
}

export async function installProxyRepair(packageFile = createRequire(import.meta.url).resolve("wrangler/package.json")) {
  const metadata = JSON.parse(await readFile(packageFile, "utf8"));
  const file = path.join(path.dirname(packageFile), "wrangler-dist/ProxyWorker.js");
  const original = await readFile(file, "utf8");
  const patched = prepareProxySource(original, metadata.version);
  await writeFile(file, patched);
  let restored = false;
  return async () => {
    if (restored) return;
    if (await readFile(file, "utf8") !== patched)
      throw new Error("Auth proxy diagnostics source changed during the run; refusing to overwrite it");
    await writeFile(file, original);
    restored = true;
  };
}
