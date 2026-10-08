// Isolated local account stack. No remote resources or production auth flags are changed.
import { localHttpsEnvironment } from "./local-https.mjs";
import { spawnAuthStackCommand, stopAuthStackCommand } from "./auth-stack-process.mjs";
import { createAuthFixtureControl } from "./auth-fixture-control.mjs";
import { createServer } from "node:http";
import { get } from "node:https";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LOCAL_DEV_PORT_VARIANTS, resolveLocalApiPort } from "../apps/web/local-dev-ports.js";
import { installProxyRepair } from "./auth-proxy-diagnostics.mjs";
import { observeAuthService } from "./auth-stack-diagnostics.mjs";

const root = process.cwd();
const webPort = String(LOCAL_DEV_PORT_VARIANTS.find(variant => variant.suffix === "auth-e2e").webPort);
const apiPort = String(resolveLocalApiPort(webPort));
const origin = `https://127.0.0.1:${webPort}`;
const temporary = await mkdtemp(path.join(os.tmpdir(), "righelt-auth-e2e-"));
const persist = path.join(temporary, "state");
const children = new Set();
const serviceReceipts = [];
const runId = path.basename(temporary);
const privateLogs = path.join(root, "test-results/auth-stack-private", runId);
const diagnostics = path.join(root, "test-results/auth-stack-diagnostics", runId);
let diagnosticsFailed = false;
let stopping = false;
let control;
let proxyDiagnosticsInstallation;

function run(args, { cwd = root, service = null, captureStderr = false } = {}) {
  if (stopping) throw new Error("Account stack is stopping");
  const env = args.includes("https") ? localHttpsEnvironment({ cwd }) : { ...process.env };
  const logDirectory = path.join(privateLogs, service || "setup");
  const child = spawnAuthStackCommand(args, { cwd, env: { ...env, WRANGLER_LOG_PATH: logDirectory,
    RIGHELT_AUTH_FRESH_CONNECTIONS: service ? "1" : "0" }, service: Boolean(service), captureStderr });
  children.add(child);
  child.on("close", () => children.delete(child));
  if (service) {
    serviceReceipts.push(observeAuthService(child, { service, logDirectory,
      outputFile: path.join(diagnostics, `${service}.json`), isStopping: () => stopping,
      onUnexpectedExit: code => { void shutdown(code); },
      onDiagnosticError: () => { diagnosticsFailed = true; console.error("[auth-e2e] Could not record service exit diagnostics"); },
    }));
    return child;
  }
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", chunk => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    child.once("error", reject);
    // close waits for the complete diagnostic stream before classifying a failure.
    child.once("close", code => code === 0 ? resolve() :
      reject(Object.assign(new Error(`Local command exited ${code}`), { stderr })));
  });
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  control?.close();
  const cleaned = await Promise.all([...children].map(stopAuthStackCommand));
  const receipts = await Promise.all(serviceReceipts);
  // A concurrent external shutdown must not hide an initiating service exit
  // while its diagnostic file is still being read.
  if (cleaned.some(ok => !ok) || diagnosticsFailed || receipts.some(receipt => !receipt.expected)) code = 1;
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
  // Test-only backport of the reviewed worker-identity fix. No request retries.
  proxyDiagnosticsInstallation = installProxyRepair();
  await proxyDiagnosticsInstallation;
  await mkdir(persist, { recursive: true });
  const apiConfig = path.join(temporary, "api.toml");
  let api = await readFile(path.join(root, "apps/api/wrangler.toml"), "utf8");
  api = api.replace('name = "righelt-api"', 'name = "righelt-auth-e2e-api"')
    .replace('main = "index.js"', `main = ${JSON.stringify(path.join(root, "apps/api/index.js"))}`)
    .replace('migrations_dir = "../../db/migrations"', `migrations_dir = ${JSON.stringify(path.join(root, "db/migrations"))}`)
    .replace('database_id = "22435cc4-6655-4bdf-a05d-d100cd8e6cc9"', 'database_id = "local-auth-e2e"');
  api = api.replace('AUTH_ENABLED = "false"', 'AUTH_ENABLED = "true"')
    .replace('service = "righelt-auth"', 'service = "righelt-auth-e2e-admission"');
  // Append vars to the existing table, rather than introducing duplicate bindings.
  api = api.replace('[vars]', `[vars]\nAUTH_ALLOWED_ORIGINS = ${JSON.stringify(origin)}\nAUTH_HMAC_SECRET = ${JSON.stringify(randomBytes(32).toString("hex"))}`);
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
  const { tsImport } = await import("tsx/esm/api");
  const { createInitialGame } = await tsImport(path.join(root, "packages/api-handler/src/shell-live-core.ts"), import.meta.url);
  const fixture = createInitialGame({gameId:"cutover-legacy-fixture",identityId:"cutover-legacy-owner",selfPlayMode:true});
  fixture.inviteTokens.player1 = "cutover-legacy-invite";
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const seedSql = `INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,state_json,event_seq) VALUES(${quote(fixture.id)},${quote(fixture.createdAt)},${quote(fixture.updatedAt)},${quote(fixture.updatedAt)},${quote(JSON.stringify(fixture))},0); INSERT INTO live_invites(token,game_id,shared_by_role) VALUES('cutover-legacy-invite','cutover-legacy-fixture','Player 1');`;
  const fixtureFile=path.join(temporary,"legacy.sql");
  await writeFile(fixtureFile,seedSql);
  await run([...d1,"execute","DB","--config",apiConfig,"--local","--persist-to",persist,"--file",fixtureFile]);
  run(["exec", "wrangler", "dev", ...configs.flatMap(file => ["--config", file]), "--local", "--port", apiPort,
    "--inspector-port", "9997", "--persist-to", persist], { service: "api" });
  await ready(`http://127.0.0.1:${apiPort}/api/health`);
  // Test-runner-only loopback control; never exposed through Pages or application routes.
  // Fixed SQL operations only, rejecting browser-origin requests. This is not an auth bypass.
  control = createServer(createAuthFixtureControl(sql =>
    run([...d1, "execute", "DB", "--config", apiConfig, "--local", "--persist-to", persist, "--command", sql],
      { captureStderr: true })
  )).listen(Number(webPort) + 100, "127.0.0.1");
  run(["exec", "wrangler", "pages", "dev", ".", "--port", webPort, "--local-protocol", "https", "--inspector-port", "9998"],
    { cwd: path.join(root, "apps/web"), service: "web" });
  await ready(origin);
  console.log(`[auth-e2e] Ready at ${origin}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
