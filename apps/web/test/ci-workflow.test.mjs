import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

test("CI runs the generated web runtime freshness guard", () => {
  assert.match(workflow, /- name: Generated web runtime is up to date/);
  assert.match(workflow, /run: pnpm check:web-engine-generated/);
});

test("CI runs granular test steps in fast-fail order before the E2E gates", () => {
  const engineUnitIndex = workflow.indexOf("- name: Engine unit tests");
  const webUnitIndex = workflow.indexOf("- name: Web unit tests");
  const engineIntegrationIndex = workflow.indexOf("- name: Engine integration tests");
  const apiHandlerIntegrationIndex = workflow.indexOf("- name: API handler integration tests");
  const apiWorkerIntegrationIndex = workflow.indexOf("- name: API worker integration tests");
  const webIntegrationIndex = workflow.indexOf("- name: Web integration tests");
  const installPlaywrightIndex = workflow.indexOf("- name: Install Playwright browser");
  const smokeIndex = workflow.indexOf("- name: E2E smoke tests");
  const broadIndex = workflow.indexOf("- name: E2E workflow tests");

  assert.notEqual(engineUnitIndex, -1);
  assert.notEqual(webUnitIndex, -1);
  assert.notEqual(engineIntegrationIndex, -1);
  assert.notEqual(apiHandlerIntegrationIndex, -1);
  assert.notEqual(apiWorkerIntegrationIndex, -1);
  assert.notEqual(webIntegrationIndex, -1);
  assert.notEqual(installPlaywrightIndex, -1);
  assert.notEqual(smokeIndex, -1);
  assert.notEqual(broadIndex, -1);

  assert.ok(engineUnitIndex < webUnitIndex);
  assert.ok(webUnitIndex < engineIntegrationIndex);
  assert.ok(engineIntegrationIndex < apiHandlerIntegrationIndex);
  assert.ok(apiHandlerIntegrationIndex < apiWorkerIntegrationIndex);
  assert.ok(apiWorkerIntegrationIndex < webIntegrationIndex);
  assert.ok(webIntegrationIndex < installPlaywrightIndex);
  assert.ok(installPlaywrightIndex < smokeIndex);
  assert.ok(smokeIndex < broadIndex);

  assert.match(workflow, /run: pnpm test:engine:unit/);
  assert.match(workflow, /run: pnpm test:web:unit -- --reporter spec/);
  assert.match(workflow, /run: pnpm test:engine:integration/);
  assert.match(workflow, /run: pnpm test:api-handler/);
  assert.match(workflow, /run: pnpm test:api-worker/);
  assert.match(workflow, /run: pnpm test:web:integration -- --reporter spec/);
  assert.match(workflow, /run: pnpm test:e2e:smoke/);
  assert.match(workflow, /run: pnpm test:e2e/);
});

test("CI uploads Playwright results after the browser lanes", () => {
  assert.match(workflow, /- name: Upload Playwright results/);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /name: playwright-results/);
  assert.match(workflow, /path: test-results\//);
});
