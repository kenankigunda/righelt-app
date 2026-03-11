import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webDir = path.resolve(import.meta.dirname, "..");
const wranglerConfigPath = path.join(webDir, "wrangler.toml");
const wranglerConfig = readFileSync(wranglerConfigPath, "utf8");

test("Pages advanced-mode config points main at _worker.js", () => {
  assert.match(wranglerConfig, /^main = "_worker\.js"$/m);
  assert.equal(existsSync(path.join(webDir, "_worker.js")), true);
});

test("Pages advanced-mode config does not opt into incompatible Pages config-file mode", () => {
  assert.doesNotMatch(wranglerConfig, /^pages_build_output_dir = /m);
});
