// Isolated local account stack. No remote resources or production auth flags are changed.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { get } from "node:https";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEV_PORT_VARIANTS, resolveLocalApiPort } from "../apps/web/local-dev-ports.js";
import { installProxyDiagnostics } from "./auth-proxy-diagnostics.mjs";

const root = process.cwd();
const webPort = String(LOCAL_DEV_PORT_VARIANTS.find(variant => variant.suffix === "auth-e2e").webPort);
const apiPort = String(resolveLocalApiPort(webPort));
const origin = `https://127.0.0.1:${webPort}`;
const temporary = await mkdtemp(path.join(os.tmpdir(), "righelt-auth-e2e-"));
const persist = path.join(temporary, "state");
const children = new Set();
let stopping = false;
let control;
let proxyDiagnosticsInstallation;

function run(args, { cwd = root, service = false } = {}) {
  const child = spawn("pnpm", args, { cwd, stdio: "inherit", detached: service });
  if (service) {
    children.add(child);
    child.on("exit", code => { children.delete(child); if (!stopping) void shutdown(code || 1); });
    return child;
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Local command exited ${code}`)));
  });
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  control?.close();
  await Promise.all([...children].map(child => new Promise(resolve => {
    const kill = signal => { try { process.kill(-child.pid, signal); } catch {} };
    child.once("exit", resolve);
    kill("SIGTERM");
    setTimeout(() => { kill("SIGKILL"); resolve(); }, 5000).unref();
  })));
  try { const restore = await proxyDiagnosticsInstallation; await restore?.(); }
  catch (error) { console.error(error); code = 1; }
  await rm(temporary, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
async function ready(url) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const ok = url.startsWith("https:")
        ? await new Promise(resolve => {
          const request = get(url, { rejectUnauthorized: false }, response => { response.resume(); resolve(response.statusCode === 200); });
          request.on("error", () => resolve(false));
          request.setTimeout(1000, () => request.destroy());
        })
        : (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
      if (ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local account stack not ready: ${url}`);
}
try {
  if (process.env.RIGHELT_AUTH_PROXY_DIAGNOSTICS === "1") {
    proxyDiagnosticsInstallation = installProxyDiagnostics();
    await proxyDiagnosticsInstallation;
  }
  await mkdir(persist, { recursive: true });
  const apiConfig = path.join(temporary, "api.toml");
  let api = await readFile(path.join(root, "apps/api/wrangler.toml"), "utf8");
  api = api.replace('name = "righelt-api"', 'name = "righelt-auth-e2e-api"')
    .replace('main = "index.js"', `main = ${JSON.stringify(path.join(root, "apps/api/index.js"))}`)
    .replace('migrations_dir = "../../db/migrations"', `migrations_dir = ${JSON.stringify(path.join(root, "db/migrations"))}`)
    .replace('database_id = "22435cc4-6655-4bdf-a05d-d100cd8e6cc9"', 'database_id = "local-auth-e2e"');
  api += `\n[vars]\nAUTH_ENABLED = "true"\nAUTH_ALLOWED_ORIGINS = ${JSON.stringify(origin)}\nAUTH_HMAC_SECRET = ${JSON.stringify(randomBytes(32).toString("hex"))}\n\n[[services]]\nbinding = "HASH_SERVICE"\nservice = "righelt-auth-e2e-admission"\n`;
  await writeFile(apiConfig, api);
  const configs = [apiConfig];
  for (const [folder, name] of [["auth", "admission"], ["auth-hash", "hash"]]) {
    let config = await readFile(path.join(root, "apps", folder, "wrangler.toml"), "utf8");
    config = config.replace(/name = "righelt-auth(?:-hash)?"/, `name = "righelt-auth-e2e-${name}"`)
      .replace('main = "index.mjs"', `main = ${JSON.stringify(path.join(root, "apps", folder, "index.mjs"))}`)
      .replace('service = "righelt-auth-hash"', 'service = "righelt-auth-e2e-hash"');
    const file = path.join(temporary, `${name}.toml`);
    await writeFile(file, config);
    configs.push(file);
  }
  const d1 = ["exec", "wrangler", "d1"];
  await run([...d1, "migrations", "apply", "DB", "--config", apiConfig, "--local", "--persist-to", persist]);
  run(["exec", "wrangler", "dev", ...configs.flatMap(file => ["--config", file]), "--local", "--port", apiPort,
    "--inspector-port", "9997", "--persist-to", persist], { service: true });
  await ready(`http://127.0.0.1:${apiPort}/api/health`);
  // Test-runner-only loopback control; never exposed through Pages or application routes.
  // Fixed SQL operations only, rejecting browser-origin requests. This is not an auth bypass.
  let busy = false;
  control = createServer(async (request, response) => {
    const sql = request.url === "/reset-limits" ? "DELETE FROM account_rate_limits"
      : request.url === "/expire-sessions" ? "UPDATE account_sessions SET expires_at = created_at + 1, last_activity_at = created_at" : null;
    if (request.method !== "POST" || request.headers.origin || !sql) { response.writeHead(404).end(); return; }
    if (busy) { response.writeHead(409).end(); return; }
    busy = true;
    try {
      await run([...d1, "execute", "DB", "--config", apiConfig, "--local", "--persist-to", persist, "--command", sql]);
      response.writeHead(200).end("done");
    } catch { response.writeHead(500).end("Local fixture operation failed"); }
    finally { busy = false; }
  }).listen(Number(webPort) + 100, "127.0.0.1");
  run(["exec", "wrangler", "pages", "dev", ".", "--port", webPort, "--local-protocol", "https", "--inspector-port", "9998"],
    { cwd: path.join(root, "apps/web"), service: true });
  await ready(origin);
  console.log(`[auth-e2e] Ready at ${origin}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
