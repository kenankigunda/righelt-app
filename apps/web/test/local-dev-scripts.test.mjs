import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const { scripts } = packageJson;
const devWebAutoSource = readFileSync(path.join(repoRoot, "scripts", "dev-web-auto.mjs"), "utf8");

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

test("root package scripts expose suffixed local D1 migration commands", () => {
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
  assert.equal(
    scripts["d1:migrate:dev:a"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-a",
  );
  assert.equal(
    scripts["d1:migrate:dev:b"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-b",
  );
  assert.equal(
    scripts["d1:migrate:dev:c"],
    "pnpm --dir apps/api exec wrangler d1 migrations apply ${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev} --config wrangler.toml --local --persist-to ../../.wrangler/state/api-local-dev-c",
  );
});

test("local scenario writer replaces full scenario records during update", () => {
  assert.match(devWebAutoSource, /const isValidScenarioShape = \(scenario\) => \{/);
  assert.match(devWebAutoSource, /const description = typeof scenario\.description === "string" \? scenario\.description\.trim\(\) : "";/);
  assert.match(devWebAutoSource, /if \(!isValidScenarioShape\(scenario\)\) \{\s*jsonResponse\(response, 400, \{ ok: false, error: "invalid_scenario_shape" \}\);/s);
  assert.match(devWebAutoSource, /const scenarioIndex = catalog\.scenarios\.findIndex\(\(entry\) => entry\.id === scenario\.id\);/);
  assert.match(devWebAutoSource, /catalog\.scenarios\.splice\(scenarioIndex, 1, scenario\);/);
  assert.doesNotMatch(devWebAutoSource, /const expectedHash = typeof body\.expectedFinalStateHash === "string"/);
});
