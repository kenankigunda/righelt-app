import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

import { WEB_UNIT_TEST_FILES, classifyWebTestFile } from "./test-layers.mjs";

const testDir = import.meta.dirname;
const allWebTests = readdirSync(testDir)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

test("web test layers classify every test file exactly once", () => {
  assert.equal(new Set(WEB_UNIT_TEST_FILES).size, WEB_UNIT_TEST_FILES.length);

  const unknownFiles = WEB_UNIT_TEST_FILES.filter((file) => !allWebTests.includes(file));
  assert.deepEqual(unknownFiles, []);

  const unitFiles = allWebTests.filter((file) => classifyWebTestFile(file) === "unit");
  const integrationFiles = allWebTests.filter((file) => classifyWebTestFile(file) === "integration");

  assert.deepEqual(unitFiles, [...WEB_UNIT_TEST_FILES].sort());
  assert.equal(unitFiles.length + integrationFiles.length, allWebTests.length);
  assert.ok(integrationFiles.length > 0);
});

test("web test layer classification reserves integration for workflow-level coverage", () => {
  assert.equal(classifyWebTestFile("game-flow.integration.test.mjs"), "integration");
  assert.equal(classifyWebTestFile("routing.test.mjs"), "unit");
});
