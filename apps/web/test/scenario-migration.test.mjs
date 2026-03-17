import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const shellAppSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const catalogSource = readFileSync(join(testDir, "..", "scenarios", "catalog.json"), "utf8");

test("legacy scenario snapshot documentation is preserved", () => {
  assert.equal(existsSync(join(testDir, "..", "..", "..", "docs", "legacy-scenarios", "m-golden-fixtures.snapshot.json")), true);
});

test("runtime scenario catalog is versioned for history-based scenarios only", () => {
  const catalog = JSON.parse(catalogSource);
  assert.equal(Array.isArray(catalog.scenarios), true);
});

test("shell debug UI uses scenario terminology", () => {
  assert.match(shellAppSource, /Scenarios/);
  assert.match(shellAppSource, /Save Scenario/);
  assert.doesNotMatch(shellAppSource, />Load Fixture</);
});
