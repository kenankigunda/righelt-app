import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const { scripts } = packageJson;
const devWebAutoSource = readFileSync(path.join(repoRoot, "scripts", "dev-web-auto.mjs"), "utf8");
const dbCleanupLocalSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-local.mjs"), "utf8");
const dbCleanupSharedSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-shared.mjs"), "utf8");
const dbCleanupGithubSource = readFileSync(path.join(repoRoot, "scripts", "db-retention-cleanup-github.mjs"), "utf8");
const generatedGuardSource = readFileSync(path.join(repoRoot, "scripts", "check-web-engine-generated.mjs"), "utf8");
const nodeTestRunnerSource = readFileSync(path.join(repoRoot, "scripts", "run-node-tests.mjs"), "utf8");
const webTestRunnerSource = readFileSync(path.join(repoRoot, "apps", "web", "test", "run-web-tests.mjs"), "utf8");
const dbCleanupSharedModule = await import(pathToFileURL(path.join(repoRoot, "scripts", "db-retention-cleanup-shared.mjs")).href);
const devWebAutoModule = await import(pathToFileURL(path.join(repoRoot, "scripts", "dev-web-auto.mjs")).href);

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
  assert.equal(scripts["check:web-engine-generated"], "node scripts/check-web-engine-generated.mjs");
  assert.equal(scripts["check:ticket-workflow"], "node scripts/check-ticket-workflow-setup.mjs");
  assert.match(scripts.test, /^pnpm typecheck && pnpm check:web-engine-generated && /);
  assert.equal(scripts["test:unit"], "pnpm test:engine:unit && pnpm test:web:unit && pnpm test:computer-player:unit");
  assert.equal(scripts["test:integration"], "pnpm test:engine:integration && pnpm test:api-handler && pnpm test:api-worker && pnpm test:web:integration && pnpm test:computer-player:integration");
  assert.equal(scripts["test:engine"], "node scripts/run-node-tests.mjs packages/game-engine/test");
  assert.equal(scripts["test:engine:unit"], "node scripts/run-node-tests.mjs packages/game-engine/test/unit");
  assert.equal(scripts["test:engine:integration"], "node scripts/run-node-tests.mjs packages/game-engine/test/integration");
  assert.equal(scripts["test:api-handler"], "node scripts/run-node-tests.mjs packages/api-handler/test");
  assert.equal(scripts["test:api-worker"], "node scripts/run-node-tests.mjs apps/api/test");
  assert.equal(scripts["test:web"], "node apps/web/test/run-web-tests.mjs");
  assert.equal(scripts["test:web:unit"], "node apps/web/test/run-web-tests.mjs --layer unit");
  assert.equal(scripts["test:web:integration"], "node apps/web/test/run-web-tests.mjs --layer integration");
  assert.equal(scripts["e2e:install"], "playwright install chromium");
  assert.equal("test:e2e:smoke" in scripts, false);
  assert.equal(scripts["test:e2e"], "playwright test");
  assert.equal(scripts["test:e2e:headed"], "playwright test --headed");
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

test("shared cleanup SQL generator expands zero-hour cleanup to a full-table predicate", () => {
  const cleanupTemplate = readFileSync(path.join(repoRoot, "db", "ops", "cleanup-live-data.sql"), "utf8");
  const zeroCleanupSql = dbCleanupSharedModule.buildCleanupSql(cleanupTemplate, "0");
  const fortyEightHourCleanupSql = dbCleanupSharedModule.buildCleanupSql(cleanupTemplate, "48");

  assert.match(zeroCleanupSql, /WHERE 1 = 1/);
  assert.doesNotMatch(zeroCleanupSql, /'0'/);
  assert.doesNotMatch(zeroCleanupSql, /__STALE_CONDITION__/);
  assert.match(fortyEightHourCleanupSql, /latest_activity_at < datetime\('now', '-48 hours'\)/);
  assert.doesNotMatch(fortyEightHourCleanupSql, /__STALE_CONDITION__/);
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
  assert.match(devWebAutoSource, /export const isValidScenarioShape = \(scenario\) => \{/);
  assert.match(devWebAutoSource, /const description = typeof scenario\.description === "string" \? scenario\.description\.trim\(\) : "";/);
  assert.match(devWebAutoSource, /if \(!isValidScenarioShape\(scenario\)\) \{\s*jsonResponse\(response, 400, \{ ok: false, error: "invalid_scenario_shape" \}\);/s);
  assert.match(devWebAutoSource, /const scenarioIndex = catalog\.scenarios\.findIndex\(\(entry\) => entry\.id === scenario\.id\);/);
  assert.match(devWebAutoSource, /catalog\.scenarios\.splice\(scenarioIndex, 1, scenario\);/);
  assert.doesNotMatch(devWebAutoSource, /const expectedHash = typeof body\.expectedFinalStateHash === "string"/);
});

test("local scenario writer validation rejects UUID-shaped non-v4 ids", () => {
  const validScenario = {
    id: "0066b0ed-c5ba-4a89-a81a-1811d08d2d9d",
    title: "Valid scenario",
    description: "Valid description",
    expectedFinalStateHash: "hash-live-state",
    expectedOutcome: "ongoing",
  };
  const wrongVersionScenario = {
    ...validScenario,
    id: "123e4567-e89b-12d3-a456-426614174000",
  };

  assert.equal(devWebAutoModule.isValidScenarioShape(validScenario), true);
  assert.equal(devWebAutoModule.isValidScenarioShape(wrongVersionScenario), false);
});

test("generated web runtime guard rebuilds and fails on stale output", () => {
  assert.match(generatedGuardSource, /const GENERATED_ROOT = "apps\/web\/generated";/);
  assert.match(generatedGuardSource, /run\("pnpm", \["build:web-engine"\]\);/);
  assert.match(generatedGuardSource, /git", \["status", "--short", "--untracked-files=all", "--", GENERATED_ROOT\]/);
  assert.match(generatedGuardSource, /Generated web engine output is stale/);
});

test("shared Node test runner discovers test files recursively and supports multiple reporters", () => {
  assert.match(nodeTestRunnerSource, /const reporters = \[];/);
  assert.match(nodeTestRunnerSource, /const reporterDestinations = \[];/);
  assert.match(nodeTestRunnerSource, /if \(reporters.length === 0\) \{\s*reporters\.push\("spec"\);/s);
  assert.match(nodeTestRunnerSource, /"--import", "tsx", "--test"/);
  assert.match(nodeTestRunnerSource, /Multiple reporters require explicit --reporter-destination entries/);
  assert.match(nodeTestRunnerSource, /if \(destination === "stdout" \|\| destination === "stderr"\)/);
  assert.match(nodeTestRunnerSource, /mkdirSync\(path\.dirname\(path\.resolve\(destination\)\), \{ recursive: true \}\);/);
  assert.match(nodeTestRunnerSource, /files\.push\(...collectTestFiles\(entryPath\)\)/);
  assert.match(nodeTestRunnerSource, /entry\.name\.endsWith\("\.test\.mjs"\)/);
});

test("web test runner forwards optional reporter settings into node --test", () => {
  assert.match(webTestRunnerSource, /if \(value === "--"\) \{\s*continue;\s*\}/);
  assert.match(webTestRunnerSource, /const reporters = \[];/);
  assert.match(webTestRunnerSource, /const reporterDestinations = \[];/);
  assert.match(webTestRunnerSource, /const args = \["--import", "tsx", "--test"\];/);
  assert.match(webTestRunnerSource, /if \(value === "--reporter"\)/);
  assert.match(webTestRunnerSource, /if \(value === "--reporter-destination"\)/);
  assert.match(webTestRunnerSource, /if \(reporters.length === 0\) \{\s*reporters\.push\("spec"\);/s);
  assert.match(webTestRunnerSource, /Multiple reporters require explicit --reporter-destination entries/);
  assert.match(webTestRunnerSource, /if \(reporterDestination === "stdout" \|\| reporterDestination === "stderr"\)/);
  assert.match(webTestRunnerSource, /mkdirSync\(path\.dirname\(path\.resolve\(reporterDestination\)\), \{ recursive: true \}\);/);
  assert.match(webTestRunnerSource, /args\.push\("--test-reporter", reporter\);/);
  assert.match(webTestRunnerSource, /args\.push\("--test-reporter-destination", reporterDestination\);/);
});
