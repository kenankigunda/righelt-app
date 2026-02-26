import { spawn } from "node:child_process";
import { watch, promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const port = args[0] ?? "8788";
const watchBackend = args.includes("--watch-backend");

const cwd = process.cwd();
const touchTarget = path.join(cwd, "apps/web/functions/api/[[path]].ts");
const watchRoots = [
  path.join(cwd, "packages/api-handler/src"),
  path.join(cwd, "packages/game-engine/src"),
  path.join(cwd, "packages/shared-types/src"),
];

const watchableExt = new Set([".ts", ".js", ".mjs", ".cjs", ".json"]);
let touchTimer = null;
let openTimer = null;
let openedBrowser = false;

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
    ? `[dev-web] starting on :${port} with backend watcher enabled`
    : `[dev-web] starting on :${port}`,
);

const wrangler = spawn(
  "pnpm",
  ["--dir", "apps/web", "exec", "wrangler", "pages", "dev", ".", "--port", port],
  {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
  },
);

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

wrangler.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (!openedBrowser) {
    maybeOpenFromChunk(chunk);
  }
});

wrangler.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
  if (!openedBrowser) {
    maybeOpenFromChunk(chunk);
  }
});

openTimer = setTimeout(() => {
  openBrowserForUrl(`http://localhost:${port}`);
}, 2000);

let shuttingDown = false;
const shutdown = () => {
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

  if (!wrangler.killed) {
    wrangler.kill("SIGTERM");
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

wrangler.on("exit", (code, signal) => {
  shutdown();
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
