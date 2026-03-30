import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

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
const cleanupSqlPath = path.join(repoRoot, "db", "ops", "cleanup-live-data.sql");

if (!retentionHours) {
  console.error("Missing required flag: --hours");
  process.exit(1);
}

if (!/^[1-9][0-9]*$/.test(retentionHours)) {
  console.error("--hours must be a positive integer");
  process.exit(1);
}

console.log(`Running local D1 retention cleanup for data older than ${retentionHours} hours`);
console.log(`Target D1 database: ${dbName}`);
console.log(`Local D1 persist path: ${persistTo}`);

const staleCondition = `latest_activity_at < datetime('now', '-${retentionHours} hours')`;
const reportSql = `SELECT 'live_games' AS table_name, COUNT(*) AS stale_row_count
FROM live_games
WHERE ${staleCondition}
UNION ALL
SELECT 'live_events' AS table_name, COUNT(*) AS stale_row_count
FROM live_events
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_participants' AS table_name, COUNT(*) AS stale_row_count
FROM live_participants
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_join_requests' AS table_name, COUNT(*) AS stale_row_count
FROM live_join_requests
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_invites' AS table_name, COUNT(*) AS stale_row_count
FROM live_invites
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
);`;

const cleanupSql = readFileSync(cleanupSqlPath, "utf8").replace(/\?1/g, retentionHours);
const tempDir = mkdtempSync(path.join(os.tmpdir(), "righelt-d1-retention-"));
const reportSqlPath = path.join(tempDir, "d1-retention-report.sql");
const expandedCleanupSqlPath = path.join(tempDir, "d1-retention-cleanup.sql");

writeFileSync(reportSqlPath, reportSql);
writeFileSync(expandedCleanupSqlPath, cleanupSql);

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
  runWrangler("Delete stale live-game data", expandedCleanupSqlPath);
  runWrangler("Stale row counts after cleanup", reportSqlPath);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
