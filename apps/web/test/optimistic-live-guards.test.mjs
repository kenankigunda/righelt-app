import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "optimistic-live.js"), "utf8");

test("optimistic live reuses the settled legal-action set instead of recomputing from the pre-action board state", () => {
  assert.match(source, /const stable = workingGame\.board\.state;/);
  assert.doesNotMatch(source, /resolveToStability\(workingGame\.board\.state,\s*\{\s*artifactMode:\s*"full"\s*\}\)/);
  assert.match(source, /const settledLegalActions = listLegalActions\(settledState\);/);
  assert.match(source, /legalActions:\s*settledLegalActions,/);
  assert.match(source, /let latestLegalActions = null;/);
  assert.match(source, /liveLegalActions:\s*latestLegalActions/);
});
