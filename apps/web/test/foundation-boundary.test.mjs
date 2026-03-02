import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const mainSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");

test("shell entry imports board adapter only via contract+adapter modules", () => {
  assert.match(mainSource, /board-adapter-contract\.js/);
  assert.match(mainSource, /board-adapters\/engine-playground-adapter\.js/);
});

test("shell entry does not import engine internals directly", () => {
  assert.doesNotMatch(mainSource, /game-engine\/src/);
  assert.doesNotMatch(mainSource, /packages\/game-engine/);
});
