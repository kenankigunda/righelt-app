import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Track A owns A-family and replay foundations in manifest", async () => {
  const manifest = JSON.parse(await readFile("docs/manifests/engine-matrix-ownership.json", "utf8"));
  const trackA = manifest.trackTargets.find((target) => target.ownerTrack === "A");

  assert.ok(trackA, "missing track A target mapping");
  assert.deepEqual(trackA.matrixFamilies, ["A", "C", "D", "E", "F", "G", "L"]);
  assert.deepEqual(trackA.scenarioIds, ["P-006", "P-007", "P-008"]);
});

test.todo("A-001 standard setup");
test.todo("A-002 deterministic replay");
test.todo("A-003 no hidden randomness");
