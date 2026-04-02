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

test("CI runs unit, integration, smoke E2E, and broad E2E checks in fast-fail order", () => {
  const unitIndex = workflow.indexOf("- name: Unit tests");
  const integrationIndex = workflow.indexOf("- name: Integration tests");
  const installPlaywrightIndex = workflow.indexOf("- name: Install Playwright browser");
  const smokeIndex = workflow.indexOf("- name: E2E smoke tests");
  const broadIndex = workflow.indexOf("- name: E2E workflow tests");

  assert.notEqual(unitIndex, -1);
  assert.notEqual(integrationIndex, -1);
  assert.notEqual(installPlaywrightIndex, -1);
  assert.notEqual(smokeIndex, -1);
  assert.notEqual(broadIndex, -1);

  assert.ok(unitIndex < integrationIndex);
  assert.ok(integrationIndex < installPlaywrightIndex);
  assert.ok(installPlaywrightIndex < smokeIndex);
  assert.ok(smokeIndex < broadIndex);

  assert.match(workflow, /run: pnpm test:unit/);
  assert.match(workflow, /run: pnpm test:integration/);
  assert.match(workflow, /run: pnpm test:e2e:smoke/);
  assert.match(workflow, /run: pnpm test:e2e/);
});
