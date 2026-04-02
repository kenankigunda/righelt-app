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
