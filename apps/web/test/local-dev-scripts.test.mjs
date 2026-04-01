import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const { scripts } = packageJson;
const devWebAutoSource = readFileSync(path.join(repoRoot, "scripts", "dev-web-auto.mjs"), "utf8");
const dbCleanupLocalSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-local.mjs"), "utf8");
const dbCleanupSharedSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-shared.mjs"), "utf8");
const dbCleanupGithubSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-github.mjs"), "utf8");

test("root package scripts keep suffixed local dev entrypoints in sync", () => {
  assert.equal(scripts.dev, "pnpm dev:web");
  assert.equal(scripts["dev:a"], "pnpm dev:web:a");
  assert.equal(scripts["dev:b"], "pnpm dev:web:b");
  assert.equal(scripts["dev:c"], "pnpm dev:web:c");

  assert.equal(
    scripts["dev:api:a"],
    "pnpm --dir apps/api exec wrangler dev --config wrangler.toml --port 8792 --persist-to ../../.wrangler/state/api-local-dev-a",
  );
  assert.equal(
    scripts["dev:api:b"],
    "pnpm --dir apps/api exec wrangler dev --config wrangler.toml --port 8793 --persist-to ../../.wrangler/state/api-local-dev-b",
  );
  assert.equal(
    scripts["dev:api:c"],
    "pnpm --dir apps/api exec wrangler dev --config wrangler.toml --port 8794 --persist-to ../../.wrangler/state/api-local-dev-c",
  );
  assert.equal(scripts["dev:all:a"], "node scripts/dev-web-auto.mjs 8789 --with-api");
  assert.equal(scripts["dev:all:b"], "node scripts/dev-web-auto.mjs 8790 --with-api");
  assert.equal(scripts["dev:all:c"], "node scripts/dev-web-auto.mjs 8791 --with-api");
});

test("root package scripts expose only db-prefixed local migration commands", () => {
  assert.equal(
    scripts["db:local:a"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-a",
  );
  assert.equal(
    scripts["db:local:b"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-b",
  );
  assert.equal(
    scripts["db:local:c"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-c",
  );
  assert.equal("d1:migrate:dev" in scripts, false);
  assert.equal("d1:migrate:dev:a" in scripts, false);
  assert.equal("d1:migrate:dev:b" in scripts, false);
  assert.equal("d1:migrate:dev:c" in scripts, false);
  assert.equal(scripts["db:cleanup:local"], "node scripts/db-retention-cleanup-local.mjs");
});

test("local D1 retention cleanup helper requires explicit hours and mirrors workflow steps", () => {
  assert.match(dbCleanupLocalSource, /const retentionHours = getArg\("--hours"\);/);
  assert.match(dbCleanupLocalSource, /validateRetentionHours\(retentionHours, "flag: --hours"\)/);
  assert.match(dbCleanupLocalSource, /describeRetentionWindow/);
  assert.match(dbCleanupLocalSource, /Running local D1 retention cleanup for \$\{describeRetentionWindow\(retentionHours\)\}/);
  assert.match(dbCleanupLocalSource, /Target D1 database: \$\{dbName\}/);
  assert.match(dbCleanupLocalSource, /Local D1 persist path: \$\{persistTo\}/);
  assert.match(dbCleanupLocalSource, /createCleanupSqlFiles/);
  assert.match(dbCleanupLocalSource, /Delete stale live-game data/);
  assert.match(dbCleanupLocalSource, /"wrangler",\s*"d1",\s*"execute"/s);
  assert.match(dbCleanupLocalSource, /"--local"/);
  assert.match(dbCleanupLocalSource, /"--persist-to"/);
});

test("shared D1 retention cleanup helpers centralize validation and SQL generation", () => {
  assert.match(dbCleanupSharedSource, /export const validateRetentionHours = \(value, sourceLabel = "retention hours"\)/);
  assert.match(dbCleanupSharedSource, /Missing required \$\{sourceLabel\}/);
  assert.match(dbCleanupSharedSource, /\$\{sourceLabel\} must be a non-negative integer/);
  assert.match(dbCleanupSharedSource, /retentionHours === "0"/);
  assert.match(dbCleanupSharedSource, /"all games"/);
  assert.match(dbCleanupSharedSource, /export const buildReportSql = \(retentionHours\) =>/);
  assert.match(dbCleanupSharedSource, /latest_activity_at < datetime\('now', '-\$\{retentionHours\} hours'\)/);
  assert.doesNotMatch(dbCleanupSharedSource, /live_participants/);
  assert.doesNotMatch(dbCleanupSharedSource, /live_join_requests/);
  assert.match(dbCleanupSharedSource, /export const createCleanupSqlFiles = \(\{/);
  assert.match(dbCleanupSharedSource, /righelt-db-retention-/);
});

test("GitHub D1 retention cleanup helper reuses the shared cleanup generator", () => {
  assert.match(dbCleanupGithubSource, /createCleanupSqlFiles/);
  assert.match(dbCleanupGithubSource, /describeRetentionWindow/);
  assert.match(dbCleanupGithubSource, /validateRetentionHours/);
  assert.match(dbCleanupGithubSource, /validateRetentionHours\(retentionHours, "env var: DB_RETENTION_HOURS"\)/);
  assert.match(dbCleanupGithubSource, /Running DB retention cleanup for \$\{describeRetentionWindow\(retentionHours\)\}/);
  assert.match(dbCleanupGithubSource, /appendFileSync\(githubEnvPath, `REPORT_SQL_PATH=/);
  assert.match(dbCleanupGithubSource, /appendFileSync\(githubEnvPath, `CLEANUP_SQL_PATH=/);
});

test("local scenario writer replaces full scenario records during update", () => {
  assert.match(devWebAutoSource, /const isValidScenarioShape = \(scenario\) => \{/);
  assert.match(devWebAutoSource, /const description = typeof scenario\.description === "string" \? scenario\.description\.trim\(\) : "";/);
  assert.match(devWebAutoSource, /if \(!isValidScenarioShape\(scenario\)\) \{\s*jsonResponse\(response, 400, \{ ok: false, error: "invalid_scenario_shape" \}\);/s);
  assert.match(devWebAutoSource, /const scenarioIndex = catalog\.scenarios\.findIndex\(\(entry\) => entry\.id === scenario\.id\);/);
  assert.match(devWebAutoSource, /catalog\.scenarios\.splice\(scenarioIndex, 1, scenario\);/);
  assert.doesNotMatch(devWebAutoSource, /const expectedHash = typeof body\.expectedFinalStateHash === "string"/);
});
