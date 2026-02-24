import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("matrix ownership manifest exists", async () => {
  const manifest = JSON.parse(await readFile("docs/manifests/engine-matrix-ownership.json", "utf8"));

  assert.equal(manifest.version, "1.0.0");
  assert.ok(Array.isArray(manifest.scenarios));
  assert.ok(manifest.scenarios.length > 0);
});
