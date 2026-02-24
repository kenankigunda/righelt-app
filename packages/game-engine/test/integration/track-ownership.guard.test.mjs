import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENGINE_TRACK_SCOPES } from "../engine.test.config.mjs";

test("track scope config keeps P-series ownership disjoint", () => {
  const scenarioOwnership = new Map();

  for (const [track, scope] of Object.entries(ENGINE_TRACK_SCOPES)) {
    for (const scenarioId of scope.scenarioIds) {
      assert.equal(
        scenarioOwnership.has(scenarioId),
        false,
        `${scenarioId} is duplicated across tracks ${scenarioOwnership.get(scenarioId)} and ${track}`,
      );
      scenarioOwnership.set(scenarioId, track);
    }
  }

  const pSeries = Array.from(scenarioOwnership.keys())
    .filter((scenarioId) => scenarioId.startsWith("P-"))
    .sort();
  assert.deepEqual(pSeries, [
    "P-001",
    "P-002",
    "P-003",
    "P-004",
    "P-005",
    "P-006",
    "P-007",
    "P-008",
  ]);
  assert.equal(scenarioOwnership.get("P-005"), "C");
});

test("manifest matrix ownership aligns with track split", async () => {
  const manifest = JSON.parse(await readFile("docs/manifests/engine-matrix-ownership.json", "utf8"));

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(manifest.scenarios));
  assert.ok(manifest.scenarios.length > 0);

  const ownershipByMatrixId = new Map(
    manifest.scenarios.map((scenario) => [scenario.matrixId, scenario.ownerTrack]),
  );

  for (const matrixId of ENGINE_TRACK_SCOPES.A.matrixIds) {
    assert.equal(ownershipByMatrixId.get(matrixId), "A", `${matrixId} should be owned by track A`);
  }
  for (const matrixId of ENGINE_TRACK_SCOPES.B.matrixIds) {
    assert.equal(ownershipByMatrixId.get(matrixId), "B", `${matrixId} should be owned by track B`);
  }
  for (const matrixId of ENGINE_TRACK_SCOPES.C.matrixIds) {
    assert.equal(ownershipByMatrixId.get(matrixId), "C", `${matrixId} should be owned by track C`);
  }
});
