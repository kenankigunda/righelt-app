import { cliPath, supervise } from './resources/supervisor.mjs';
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildLocalApiOrigin, resolveLocalApiPort } from "../apps/web/local-dev-ports.js";

export const DEFAULT_E2E_WEB_PORT = "9888";
export const DEFAULT_E2E_READY_TIMEOUT_MS = 120_000;
const DEFAULT_DB_NAME = process.env.CLOUDFLARE_D1_DB_NAME || "righelt-db-dev";

const repoRoot = process.cwd();
const webPort = process.env.RIGHELT_E2E_WEB_PORT || DEFAULT_E2E_WEB_PORT;
const apiPort = String(resolveLocalApiPort(webPort));
const apiOrigin = buildLocalApiOrigin(webPort);
const apiHealthUrl = `${apiOrigin}/api/health`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const autoPersistRoot = process.env.RIGHELT_E2E_PERSIST_ROOT || "";
const managedChildren = new Set();
let tempRoot = "";
let shuttingDown = false;
const intentionalStops = new Set();
let controlServer;
let restartActive = false;
const stopChild = async child => {
 intentionalStops.add(child);
 const signal = value => { try { child.kill(value); } catch {} };
 const stopped = new Promise(resolve=>child.once("exit",resolve));
 signal("SIGTERM");
 const timer=setTimeout(()=>signal("SIGKILL"),5000);
 await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,6000))]);
 clearTimeout(timer);
 signal("SIGKILL");
};

export const createE2ePersistRoot = async () => {
  if (autoPersistRoot) {
    await mkdir(autoPersistRoot, { recursive: true });
    return autoPersistRoot;
  }
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "righelt-e2e-"));
  return tempRoot;
};

const waitForHttp = async (url, label, timeoutMs = DEFAULT_E2E_READY_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the stack is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label} at ${url}`);
};

const spawnLogged = (label, command, args, options) => {
  const child = spawn(process.execPath, [cliPath, "run", "--kind", "preview", "--", command, ...args], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedChildren.add(child);
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    managedChildren.delete(child);
    if (shuttingDown || intentionalStops.has(child)) {
      return;
    }
    if (code !== 0) {
      console.error(`[e2e-stack] ${label} exited with code ${code}${signal ? ` (signal ${signal})` : ""}`);
      shutdown(code ?? 1);
    }
  });
  return child;
};

const runBlocking = (label, command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
    child.on("error", reject);
  });

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  controlServer?.close();
  await Promise.allSettled([...managedChildren].map(stopChild));

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  process.exit(exitCode);
};

const run = async () => {
  const persistRoot = await createE2ePersistRoot();
  const apiPersistPath = path.join(persistRoot, "api-state");
  await mkdir(apiPersistPath, { recursive: true });

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  await runBlocking(
    "local D1 migrations",
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      DEFAULT_DB_NAME,
      "--config",
      "wrangler.toml",
      "--local",
      "--persist-to",
      apiPersistPath,
    ],
    { cwd: repoRoot },
  );

  const startApi = () => spawnLogged(
    "api",
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.toml",
      "--port",
      apiPort,
      "--persist-to",
      apiPersistPath,
    ],
    { cwd: repoRoot },
  );
  let apiChild = startApi();
  // Test-runner-only loopback control: not served by Pages or the application Worker.
  controlServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/restart") { response.writeHead(404).end(); return; }
    if (restartActive) { response.writeHead(409).end(); return; }
    restartActive=true;
    try {
      await stopChild(apiChild);
      const deadline=Date.now()+5000;
      let down=false;
      while(Date.now()<deadline) {
        try { await fetch(apiHealthUrl,{signal:AbortSignal.timeout(500)}); } catch { down=true; break; }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if (!down || shuttingDown) throw new Error("API did not stop or stack is shutting down");
      apiChild = startApi();
      await waitForHttp(apiHealthUrl, "restarted local API");
      response.writeHead(200).end("restarted");
    } catch (error) { response.writeHead(500).end(String(error)); } finally { restartActive=false; }
  }).listen(Number(webPort) + 100, "127.0.0.1");
  await waitForHttp(apiHealthUrl, "local API");

  spawnLogged("pages", "pnpm", ["exec", "wrangler", "pages", "dev", ".", "--port", webPort], {
    cwd: path.join(repoRoot, "apps", "web"),
  });
  await waitForHttp(webOrigin, "local Pages app");

  console.log(`[e2e-stack] ready at ${webOrigin} with API ${apiOrigin}`);
};

if (!process.env.RIGHELT_RESOURCE_RUN) {
  process.exitCode = (await supervise([process.execPath, ...process.argv.slice(1)], { kind: 'preview' })).code;
} else await run().catch(async (error) => {
  console.error("[e2e-stack] failed to start", error);
  await shutdown(1);
});
