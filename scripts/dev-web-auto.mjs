import { spawn } from "node:child_process";
import http from "node:http";
import { watch, promises as fs } from "node:fs";
import path from "node:path";
import { buildLocalApiOrigin, buildLocalApiPersistPath, resolveLocalApiPort } from "../apps/web/local-dev-ports.js";

const args = process.argv.slice(2);
const port = args[0] ?? "8788";
const watchBackend = args.includes("--watch-backend");
const withApi = args.includes("--with-api");
const localApiPort = String(resolveLocalApiPort(port));
const localApiPersistPath = buildLocalApiPersistPath(port);
const LOCAL_API_ORIGIN = buildLocalApiOrigin(port);
const LOCAL_API_HEALTH_URL = `${LOCAL_API_ORIGIN}/api/health`;
const LOCAL_API_READY_TIMEOUT_MS = 30_000;
const LOCAL_API_READY_POLL_MS = 250;

const cwd = process.cwd();
const webCwd = path.join(cwd, "apps", "web");
const touchTarget = path.join(cwd, "apps/web/functions/api/[[path]].js");
const scenarioCatalogPath = path.join(cwd, "apps/web/scenarios/catalog.json");
const watchRoots = [
  path.join(cwd, "packages/api-handler/src"),
  path.join(cwd, "packages/game-engine/src"),
  path.join(cwd, "packages/shared-types/src"),
];

const watchableExt = new Set([".ts", ".js", ".mjs", ".cjs", ".json"]);
let touchTimer = null;
let openTimer = null;
let openedBrowser = false;
let fixtureServer = null;
const managedChildren = new Set();
let apiWrangler = null;
let pagesWrangler = null;
let exitCode = 0;
let shuttingDown = false;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fixtureWriterPort = (() => {
  const numeric = Number.parseInt(port, 10);
  if (!Number.isFinite(numeric)) {
    return 9788;
  }
  return numeric + 1000;
})();

const jsonResponse = (response, status, body) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const readScenarioCatalog = async () => {
  const raw = await fs.readFile(scenarioCatalogPath, "utf8");
  return JSON.parse(raw);
};

const writeScenarioCatalog = async (catalog) => {
  await fs.writeFile(scenarioCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    let payload = "";
    request.on("data", (chunk) => {
      payload += chunk.toString();
    });
    request.on("end", () => {
      if (!payload) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(payload));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const startFixtureWriterServer = () => {
  fixtureServer = http.createServer(async (request, response) => {
    if (!request.url || !request.method) {
      jsonResponse(response, 400, { ok: false, error: "invalid_request" });
      return;
    }

    if (request.method === "OPTIONS") {
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && request.url === "/scenarios/catalog") {
      try {
        const catalog = await readScenarioCatalog();
        jsonResponse(response, 200, { ok: true, catalog });
      } catch (error) {
        jsonResponse(response, 500, {
          ok: false,
          error: "catalog_read_failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/scenarios/update") {
      try {
        const body = await readJsonBody(request);
        const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
        const expectedHash = typeof body.expectedFinalStateHash === "string" ? body.expectedFinalStateHash : "";
        const expectedOutcome = typeof body.expectedOutcome === "string" ? body.expectedOutcome : "";
        const description = typeof body.description === "string" ? body.description : null;
        const incorrect = typeof body.incorrect === "boolean" ? body.incorrect : null;

        if (!scenarioId || !UUID_V4_PATTERN.test(scenarioId) || (!expectedHash && !expectedOutcome && description === null && incorrect === null)) {
          jsonResponse(response, 400, { ok: false, error: "invalid_payload" });
          return;
        }

        const catalog = await readScenarioCatalog();
        const scenario = catalog.scenarios.find((entry) => entry.id === scenarioId);
        if (!scenario) {
          jsonResponse(response, 404, { ok: false, error: "scenario_not_found" });
          return;
        }

        if (expectedHash) {
          scenario.expectedFinalStateHash = expectedHash;
        }
        if (expectedOutcome) {
          scenario.expectedOutcome = expectedOutcome;
        }
        if (description !== null) {
          scenario.description = description;
        }
        if (incorrect !== null) {
          scenario.incorrect = incorrect;
        }
        await writeScenarioCatalog(catalog);
        jsonResponse(response, 200, { ok: true, scenarioId, catalog });
      } catch (error) {
        jsonResponse(response, 500, {
          ok: false,
          error: "scenario_update_failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/scenarios/save") {
      try {
        const body = await readJsonBody(request);
        const scenario = body.scenario;
        if (!scenario || typeof scenario !== "object") {
          jsonResponse(response, 400, { ok: false, error: "invalid_payload" });
          return;
        }

        const scenarioId = typeof scenario.id === "string" ? scenario.id : "";
        const title = typeof scenario.title === "string" ? scenario.title : "";
        const expectedHash = typeof scenario.expectedFinalStateHash === "string" ? scenario.expectedFinalStateHash : "";
        const expectedOutcome = typeof scenario.expectedOutcome === "string" ? scenario.expectedOutcome : "";

        if (!scenarioId || !UUID_V4_PATTERN.test(scenarioId) || !title || !expectedHash || !expectedOutcome) {
          jsonResponse(response, 400, { ok: false, error: "invalid_scenario_shape" });
          return;
        }

        const catalog = await readScenarioCatalog();
        if (catalog.scenarios.some((entry) => entry.id === scenarioId)) {
          jsonResponse(response, 409, { ok: false, error: "scenario_exists" });
          return;
        }

        catalog.scenarios.push(scenario);
        await writeScenarioCatalog(catalog);
        jsonResponse(response, 200, { ok: true, scenarioId, catalog });
      } catch (error) {
        jsonResponse(response, 500, {
          ok: false,
          error: "scenario_save_failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return;
    }

    jsonResponse(response, 404, { ok: false, error: "not_found" });
  });

  fixtureServer.listen(fixtureWriterPort, "127.0.0.1", () => {
    console.log(`[dev-web] local fixture writer available at http://127.0.0.1:${fixtureWriterPort}`);
  });
};

const openBrowserForUrl = (url) => {
  if (openedBrowser) {
    return;
  }
  openedBrowser = true;

  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    return;
  }

  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
};

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForLocalApiReady = async () => {
  const deadline = Date.now() + LOCAL_API_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (apiWrangler?.exitCode !== null) {
      throw new Error(`local api worker exited before becoming ready (exit code ${apiWrangler.exitCode})`);
    }

    try {
      const response = await fetch(LOCAL_API_HEALTH_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the worker is ready or times out.
    }

    await delay(LOCAL_API_READY_POLL_MS);
  }

  throw new Error(`timed out waiting for local api worker at ${LOCAL_API_HEALTH_URL}`);
};

const touch = async () => {
  const now = new Date();
  try {
    await fs.utimes(touchTarget, now, now);
  } catch {
    const handle = await fs.open(touchTarget, "a");
    await handle.close();
  }
};

const scheduleTouch = () => {
  if (touchTimer) {
    clearTimeout(touchTimer);
  }
  touchTimer = setTimeout(() => {
    touch().catch((error) => {
      console.error("[dev-web] failed to trigger function reload", error);
    });
  }, 120);
};

const watchers = [];
if (watchBackend) {
  for (const root of watchRoots) {
    try {
      const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          scheduleTouch();
          return;
        }
        const ext = path.extname(filename.toString());
        if (watchableExt.has(ext)) {
          scheduleTouch();
        }
      });
      watchers.push(watcher);
    } catch (error) {
      console.error(`[dev-web] failed to watch ${root}`, error);
      process.exit(1);
    }
  }
}

console.log(
  watchBackend
    ? `[dev-web] starting on :${port} with backend watcher enabled${withApi ? ` and local api orchestration on :${localApiPort}` : ""}`
    : `[dev-web] starting on :${port}${withApi ? ` with local api orchestration on :${localApiPort}` : ""}`,
);
startFixtureWriterServer();

const maybeOpenFromChunk = (chunk) => {
  const text = chunk.toString();
  const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  const byPort = urls.find((url) => url.includes(`:${port}`));
  if (byPort) {
    openBrowserForUrl(byPort);
    return;
  }
  const localhost = urls.find((url) => url.includes("localhost") || url.includes("127.0.0.1"));
  if (localhost) {
    openBrowserForUrl(localhost);
  }
};

const maybeExit = () => {
  if (managedChildren.size === 0) {
    process.exit(exitCode);
  }
};

const shutdown = (nextExitCode = exitCode) => {
  if (nextExitCode > exitCode) {
    exitCode = nextExitCode;
  }
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  if (fixtureServer) {
    fixtureServer.close();
    fixtureServer = null;
  }

  for (const child of managedChildren) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  maybeExit();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const attachChild = (child, { openBrowser = false, label }) => {
  managedChildren.add(child);

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (openBrowser && !openedBrowser) {
      maybeOpenFromChunk(chunk);
    }
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
    if (openBrowser && !openedBrowser) {
      maybeOpenFromChunk(chunk);
    }
  });

  child.on("exit", (code, signal) => {
    managedChildren.delete(child);
    if (shuttingDown) {
      maybeExit();
      return;
    }

    if (signal) {
      console.error(`[dev-web] ${label} exited via ${signal}`);
      shutdown(1);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[dev-web] ${label} exited with code ${code}`);
      shutdown(code ?? 1);
      return;
    }

    console.error(`[dev-web] ${label} exited unexpectedly`);
    shutdown(1);
  });
};

const startApiWrangler = () => {
  apiWrangler = spawn(
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
      localApiPort,
      "--persist-to",
      `../../${localApiPersistPath}`,
    ],
    {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  attachChild(apiWrangler, { label: "api worker" });
};

const startPagesWrangler = () => {
  pagesWrangler = spawn("pnpm", ["exec", "wrangler", "pages", "dev", ".", "--port", port], {
    cwd: webCwd,
    stdio: ["inherit", "pipe", "pipe"],
  });
  attachChild(pagesWrangler, { openBrowser: true, label: "pages dev" });
  openTimer = setTimeout(() => {
    openBrowserForUrl(`http://localhost:${port}`);
  }, 2000);
};

try {
  if (withApi) {
    startApiWrangler();
    await waitForLocalApiReady();
    console.log(`[dev-web] local api ready at ${LOCAL_API_ORIGIN}`);
  }
  startPagesWrangler();
} catch (error) {
  console.error("[dev-web] failed to start split-stack local dev", error);
  shutdown(1);
}

if (managedChildren.size === 0) {
  process.exit(exitCode);
}
