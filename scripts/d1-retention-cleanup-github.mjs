import { appendFileSync } from "node:fs";
import path from "node:path";
import { createCleanupSqlFiles, validateRetentionHours } from "./d1-retention-cleanup-shared.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const githubEnvPath = process.env.GITHUB_ENV;
const runnerTemp = process.env.RUNNER_TEMP;
const dbName = process.env.CLOUDFLARE_D1_DB_NAME || "righelt-db-dev";
const retentionHours = process.env.D1_RETENTION_HOURS;

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error("Missing required secret: CLOUDFLARE_API_TOKEN");
  process.exit(1);
}

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error("Missing required variable: CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

if (!githubEnvPath) {
  console.error("Missing required env var: GITHUB_ENV");
  process.exit(1);
}

if (!runnerTemp) {
  console.error("Missing required env var: RUNNER_TEMP");
  process.exit(1);
}

try {
  validateRetentionHours(retentionHours, "env var: D1_RETENTION_HOURS");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { reportSqlPath, cleanupSqlPath } = createCleanupSqlFiles({
  repoRoot,
  retentionHours,
  tempDir: runnerTemp,
});

console.log(`Running D1 retention cleanup for data older than ${retentionHours} hours`);
console.log(`Target D1 database: ${dbName}`);

appendFileSync(githubEnvPath, `REPORT_SQL_PATH=${reportSqlPath}\n`);
appendFileSync(githubEnvPath, `CLEANUP_SQL_PATH=${cleanupSqlPath}\n`);
