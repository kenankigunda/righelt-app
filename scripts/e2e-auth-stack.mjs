import { createPublicApiConnection, reserveApiBackendPort, waitForOwnedApiReady } from "./api-public-connections.mjs";
import {storageFixtureConfig} from "./storage-fixture-config.mjs";
import { recordUnexpectedExit } from './testing/stack-status.mjs';
import { cliPath } from './resources/supervisor.mjs';
// Isolated local account stack. No remote resources or production auth flags are changed.
import { localHttpsEnvironment } from "./local-https.mjs";
import { spawnAuthStackCommand, stopAuthStackCommand } from "./auth-stack-process.mjs";
import { authFixtureWorkerSource } from './auth-fixture-worker.mjs';
import { executeFixtureRequest } from "./auth-fixture-request.mjs";
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
import { createProxyFailureJournal, completeProxyFailureJournal } from "./auth-proxy-failures.mjs";

const root = process.cwd();
const webPort = String(LOCAL_DEV_PORT_VARIANTS.find(variant => variant.suffix === "auth-e2e").webPort);
const apiPort = String(resolveLocalApiPort(webPort));
const origin = `https://127.0.0.1:${webPort}`;
const AUTH_READY_TIMEOUT_MS = 120_000;
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
let apiPublicConnection;
let proxyDiagnosticsInstallation;
const failureDirectory = process.env.RIGHELT_AUTH_FAILURE_DIRECTORY;
const failureRunId = process.env.RIGHELT_AUTH_FAILURE_RUN_ID;
let failureJournalReady = false;

function run(args, { cwd = root, service = null, captureStderr = false, captureOutput = false } = {}) {
  if (stopping) throw new Error("Account stack is stopping");
  const env = args.includes("https") ? localHttpsEnvironment({ cwd }) : { ...process.env };
  const logDirectory = path.join(privateLogs, service || "setup");
  const child = spawnAuthStackCommand(args, { cwd, env: { ...env, WRANGLER_LOG_PATH: logDirectory,
    RIGHELT_AUTH_FAILURE_SERVICE: service || "setup",
    RIGHELT_AUTH_FRESH_CONNECTIONS: service ? "1" : "0" }, service: Boolean(service), captureStderr, captureOutput });
  children.add(child);
  child.on("close", () => children.delete(child));
  if (service) {
    if (captureOutput) {
      child.stdout.on("data", chunk => process.stdout.write(chunk));
      child.stderr.on("data", chunk => process.stderr.write(chunk));
    }
    serviceReceipts.push(observeAuthService(child, { service, logDirectory,
      requireProxyReceiptLogs: true, failureDirectory, failureRunId,
      outputFile: path.join(diagnostics, `${service}.json`), isStopping: () => stopping,
      onUnexpectedExit: code => { recordUnexpectedExit(service, code, null); void shutdown(code); },
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
  try { await apiPublicConnection?.close(); }
  catch (error) { console.error(error); code = 1; }
  const cleaned = await Promise.all([...children].map(stopAuthStackCommand));
  const receipts = await Promise.all(serviceReceipts);
  // A concurrent external shutdown must not hide an initiating service exit
  // while its diagnostic file is still being read.
  if (cleaned.some(ok => !ok) || diagnosticsFailed || receipts.some(receipt => !receipt.expected)) code = 1;
  try { const restore = await proxyDiagnosticsInstallation; await restore?.(); }
  catch (error) { console.error(error); code = 1; }
  try {
    if (!failureJournalReady || await completeProxyFailureJournal(failureDirectory, failureRunId, code === 0)) code = 1;
  } catch { console.error("[auth-e2e] Failure accounting did not complete"); code = 1; }
  await rm(temporary, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
async function ready(url) {
  const deadline = Date.now() + AUTH_READY_TIMEOUT_MS;
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
  await createProxyFailureJournal(failureDirectory, failureRunId);
  failureJournalReady = true;
  // Test-only backport of the reviewed worker-identity fix. No request retries.
  proxyDiagnosticsInstallation = installProxyRepair();
  await proxyDiagnosticsInstallation;
  // A clean checkout has no ignored runtime bundles. Build them before serving
  // the real app so preparation cannot receive the SPA fallback for a manifest.
  await run(["exec", "node", "scripts/build-computer-player.mjs"]);
  await mkdir(persist, { recursive: true });
  const apiConfig = path.join(temporary, "api.toml");
  const fixtureToken = randomBytes(32).toString("hex");
  const fixtureWorker = path.join(temporary, "fixture-api.mjs");
  await writeFile(fixtureWorker, authFixtureWorkerSource(path.join(root, "apps/api/index.js"), fixtureToken), {mode:0o600});
  let api = storageFixtureConfig(await readFile(path.join(root, "apps/api/wrangler.toml"), "utf8"));
  api = api.replace('name = "righelt-api"', 'name = "righelt-auth-e2e-api"')
    .replace('main = "index.js"', `main = ${JSON.stringify(fixtureWorker)}`)
    .replace('migrations_dir = "../../db/migrations"', `migrations_dir = ${JSON.stringify(path.join(root, "db/migrations"))}`)
    .replace(/database_id = "[^"]+"/, 'database_id = "local-auth-e2e"');
  api = api.replace(/^STORAGE_GENERATION\s*=\s*"[^"]*"/m, 'STORAGE_GENERATION = ""');
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
  const backendPort = await reserveApiBackendPort([Number(apiPort), Number(webPort), Number(apiPort)+10, Number(webPort)+10, Number(webPort)+100]);
  if (stopping) throw new Error("Account stack stopped before API backend launch");
  const apiChild = run(["exec", "wrangler", "dev", ...configs.flatMap(file => ["--config", file]), "--local", "--port", String(backendPort),
    "--inspector-port", String(Number(apiPort)+10), "--persist-to", persist], { service: "api", captureOutput: true });
  await waitForOwnedApiReady(apiChild, backendPort, AUTH_READY_TIMEOUT_MS);
  await ready(`http://127.0.0.1:${backendPort}/api/health`);
  if (stopping || apiChild.exitCode !== null || apiChild.signalCode !== null)
    throw new Error("Owned account API stopped before public bridge creation");
  const connection = await createPublicApiConnection({ publicPort: Number(apiPort), backendPort });
  apiPublicConnection = connection;
  if (stopping || apiChild.exitCode !== null || apiChild.signalCode !== null) {
    await connection.close();
    throw new Error("Owned account API stopped during public bridge creation");
  }
  console.log(`[auth-e2e] owned public API bridge ${connection.url.origin} -> ${connection.target}`);
  await ready(`http://127.0.0.1:${apiPort}/api/health`);
  // Test-runner-only loopback control; never exposed through Pages or application routes.
  // Fixed SQL operations only, rejecting browser-origin requests. This is not an auth bypass.
  control = createServer(createAuthFixtureControl((sql, operation) => executeFixtureRequest({
    url: `http://127.0.0.1:${apiPort}/__righelt_fixture`, token: fixtureToken, sql, operation,
  }))).listen(Number(webPort) + 100, "127.0.0.1");
  run(["exec", "wrangler", "pages", "dev", ".", "--port", webPort, "--local-protocol", "https", "--inspector-port", String(Number(webPort)+10)],
    { cwd: path.join(root, "apps/web"), service: "web" });
  await ready(origin);
  console.log(`[auth-e2e] Ready at ${origin}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
