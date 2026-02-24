import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { assertHexHash } from "../helpers/assertions.mjs";
import { ENGINE_TRACK_SCOPES } from "../engine.test.config.mjs";

const GOLDEN_FIXTURE_DIR = "packages/game-engine/test/fixtures/golden";

async function loadGoldenFixtures() {
  const entries = (await readdir(GOLDEN_FIXTURE_DIR)).filter((entry) => entry.endsWith(".json")).sort();
  const fixtures = await Promise.all(
    entries.map(async (entry) => {
      const raw = await readFile(path.join(GOLDEN_FIXTURE_DIR, entry), "utf8");
      return JSON.parse(raw);
    }),
  );
  return fixtures;
}

test("golden fixtures include all M-series ids owned by track C", async () => {
  const fixtures = await loadGoldenFixtures();
  const fixtureIds = fixtures.map((fixture) => fixture.id).sort();
  const expectedMIds = ENGINE_TRACK_SCOPES.C.scenarioIds
    .filter((scenarioId) => scenarioId.startsWith("M-"))
    .sort();

  assert.deepEqual(fixtureIds, expectedMIds);
});

test("golden fixtures are bound to matrix M and carry expected output contract fields", async () => {
  const fixtures = await loadGoldenFixtures();
  assert.equal(fixtures.length, 4);

  for (const fixture of fixtures) {
    assert.equal(fixture.matrixId, "M");
    assert.equal(typeof fixture.title, "string");
    assert.equal(typeof fixture.initial_state, "object");
    assert.ok(Array.isArray(fixture.action_sequence));
    assert.ok(fixture.action_sequence.length >= 1);
    assertHexHash(fixture.expected_final_state_hash);
    assert.match(fixture.id, /^M-00[1-4]$/);
    assert.ok(["ongoing", "p1_win", "p2_win", "draw"].includes(fixture.expected_outcome));
  }
});
