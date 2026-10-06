import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const e2eStackSource = readFileSync(path.join(repoRoot, "scripts", "e2e-stack.mjs"), "utf8");
const playwrightConfigSource = readFileSync(path.join(repoRoot, "playwright.config.mjs"), "utf8");

test("root scripts expose layered E2E commands", () => {
  assert.equal(packageJson.scripts["e2e:install"], "playwright install chromium firefox webkit");
  assert.equal("test:e2e:smoke" in packageJson.scripts, false);
  assert.equal(packageJson.scripts["test:e2e"], "node scripts/resources/cli.mjs run --kind heavy -- playwright test");
  assert.equal(packageJson.scripts["test:e2e:headed"], "node scripts/resources/cli.mjs run --kind heavy -- playwright test --headed");
});

test("E2E stack launcher provisions isolated local state and split-stack readiness checks", () => {
  assert.match(e2eStackSource, /export const DEFAULT_E2E_WEB_PORT = "9888";/);
  assert.match(e2eStackSource, /mkdtemp\(path\.join\(os\.tmpdir\(\), "righelt-e2e-"\)\)/);
  assert.match(e2eStackSource, /"wrangler",\s*"d1",\s*"migrations",\s*"apply"/s);
  assert.match(e2eStackSource, /"--local"/);
  assert.match(e2eStackSource, /"--persist-to"/);
  assert.match(e2eStackSource, /waitForHttp\(apiHealthUrl, "local API"\)/);
  assert.match(e2eStackSource, /waitForHttp\(webOrigin, "local Pages app"\)/);
  assert.match(e2eStackSource, /wrangler",\s*"pages",\s*"dev"/s);
});

test("Playwright config boots the shared local stack and captures failure artifacts", () => {
  assert.match(playwrightConfigSource, /testDir: "\.\/e2e"/);
  assert.match(playwrightConfigSource, /workers: 1/);
  assert.match(playwrightConfigSource, /process\.env\.CI/);
  assert.match(playwrightConfigSource, /PLAYWRIGHT_JUNIT_OUTPUT_FILE/);
  assert.match(playwrightConfigSource, /PLAYWRIGHT_OUTPUT_DIR/);
  assert.match(playwrightConfigSource, /"github"/);
  assert.match(playwrightConfigSource, /"junit"/);
  assert.match(playwrightConfigSource, /test-results\/playwright\/results\.xml/);
  assert.match(playwrightConfigSource, /test-results\/playwright\/artifacts/);
  assert.match(playwrightConfigSource, /trace: "retain-on-failure"/);
  assert.match(playwrightConfigSource, /screenshot: "only-on-failure"/);
  assert.match(playwrightConfigSource, /command: "node scripts\/resources\/cli\.mjs run --kind preview -- node scripts\/e2e-stack\.mjs"/);
  assert.match(playwrightConfigSource, /reuseExistingServer: false/);
});
