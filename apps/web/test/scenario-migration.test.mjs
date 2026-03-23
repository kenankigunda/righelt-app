import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const shellAppSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const catalogSource = readFileSync(join(testDir, "..", "scenarios", "catalog.json"), "utf8");
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("legacy scenario snapshot documentation is preserved", () => {
  assert.equal(existsSync(join(testDir, "..", "..", "..", "docs", "legacy-scenarios", "m-golden-fixtures.snapshot.json")), true);
});

test("runtime scenario catalog is versioned for history-based scenarios only", () => {
  const catalog = JSON.parse(catalogSource);
  assert.equal(Array.isArray(catalog.scenarios), true);
  assert.equal(catalog.scenarios.every((scenario) => UUID_V4_PATTERN.test(String(scenario.id))), true);
});

test("shell debug UI uses scenario terminology", () => {
  assert.match(shellAppSource, /Scenarios/);
  assert.match(shellAppSource, /Load a scenario/);
  assert.match(shellAppSource, /Create a scenario/);
  assert.match(shellAppSource, /Save current board as new scenario/);
  assert.doesNotMatch(shellAppSource, />Load Fixture</);
});
