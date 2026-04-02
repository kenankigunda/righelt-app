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
  const child = spawn(command, args, {
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
    if (shuttingDown) {
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
  await Promise.allSettled(
    [...managedChildren].map(
      (child) =>
        new Promise((resolve) => {
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null) {
              child.kill("SIGKILL");
            }
          }, 5_000);
        }),
    ),
  );

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

  spawnLogged(
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
  await waitForHttp(apiHealthUrl, "local API");

  spawnLogged("pages", "pnpm", ["exec", "wrangler", "pages", "dev", ".", "--port", webPort], {
    cwd: path.join(repoRoot, "apps", "web"),
  });
  await waitForHttp(webOrigin, "local Pages app");

  console.log(`[e2e-stack] ready at ${webOrigin} with API ${apiOrigin}`);
};

await run().catch(async (error) => {
  console.error("[e2e-stack] failed to start", error);
  await shutdown(1);
});
