import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createCleanupSqlFiles, validateRetentionHours } from "./d1-retention-cleanup-shared.mjs";

const args = process.argv.slice(2);

const getArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultDbName = process.env.CLOUDFLARE_D1_DB_NAME || "righelt-db-dev";
const defaultPersistTo = path.join(repoRoot, ".wrangler", "state", "api-local-dev");
const retentionHours = getArg("--hours");
const dbName = getArg("--db") || defaultDbName;
const persistTo = getArg("--persist-to") || defaultPersistTo;

try {
  validateRetentionHours(retentionHours, "flag: --hours");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Running local D1 retention cleanup for data older than ${retentionHours} hours`);
console.log(`Target D1 database: ${dbName}`);
console.log(`Local D1 persist path: ${persistTo}`);
const { reportSqlPath, cleanupSqlPath, workingDir } = createCleanupSqlFiles({
  repoRoot,
  retentionHours,
});

const runWrangler = (label, filePath) => {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--config",
      "wrangler.toml",
      "--local",
      "--persist-to",
      persistTo,
      "--file",
      filePath,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

try {
  runWrangler("Stale row counts before cleanup", reportSqlPath);
  runWrangler("Delete stale live-game data", cleanupSqlPath);
  runWrangler("Stale row counts after cleanup", reportSqlPath);
} finally {
  rmSync(workingDir, { recursive: true, force: true });
}
