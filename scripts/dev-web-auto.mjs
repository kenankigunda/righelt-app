import { spawn } from "node:child_process";
import { watch, promises as fs } from "node:fs";
import path from "node:path";

const port = process.argv[2] ?? "8788";
const cwd = process.cwd();
const touchTarget = path.join(cwd, "apps/web/functions/api/[[path]].ts");
const watchRoots = [
  path.join(cwd, "packages/api-handler/src"),
  path.join(cwd, "packages/game-engine/src"),
  path.join(cwd, "packages/shared-types/src"),
];

const watchableExt = new Set([".ts", ".js", ".mjs", ".cjs", ".json"]);
let touchTimer = null;

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
      console.error("[dev-web-auto] failed to trigger function reload", error);
    });
  }, 120);
};

const watchers = [];
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
    console.error(`[dev-web-auto] failed to watch ${root}`, error);
    process.exit(1);
  }
}

console.log(`[dev-web-auto] watching backend packages; serving on :${port}`);

const wrangler = spawn(
  "pnpm",
  ["--dir", "apps/web", "exec", "wrangler", "pages", "dev", ".", "--port", port],
  {
    stdio: "inherit",
    shell: true,
    cwd,
  },
);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

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
