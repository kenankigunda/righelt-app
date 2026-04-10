import test from "node:test";
import assert from "node:assert/strict";

import {
  runPersonaProbeSuite,
  summarizeProbeRun,
} from "../src/index.ts";

function runsForLane(result, laneId) {
  return result.runs.filter((run) => run.laneId === laneId);
}

function runFor(result, laneId, personaId) {
  return result.runs.find((run) => run.laneId === laneId && run.personaId === personaId);
}

test("CP-010 persona probe suite is versioned and deterministic", () => {
  const first = runPersonaProbeSuite();
  const second = runPersonaProbeSuite();

  assert.equal(first.version, "cp-probe-suite-v1");
  assert.deepEqual(
    first.runs.map(summarizeProbeRun),
    second.runs.map(summarizeProbeRun),
  );
});

test("CP-011 probe suite captures aggression and defense separation", () => {
  const result = runPersonaProbeSuite();

  const sevAggression = runFor(result, "aggression", "sev");
  const tauAggression = runFor(result, "aggression", "tau");
  const tauDefense = runFor(result, "defense", "tau");
  const sevDefense = runFor(result, "defense", "sev");

  assert.ok(sevAggression);
  assert.ok(tauAggression);
  assert.ok(tauDefense);
  assert.ok(sevDefense);

  assert.equal(sevAggression.laneScore > tauAggression.laneScore, true);
  assert.equal(tauDefense.laneScore > sevDefense.laneScore, true);
});

test("CP-012 probe suite preserves conversion and forgiveness ordering", () => {
  const result = runPersonaProbeSuite();
  const horus = runFor(result, "conversion", "horus");
  const tau = runFor(result, "conversion", "tau");
  const babs = runFor(result, "forgiveness", "babs");
  const sev = runFor(result, "forgiveness", "sev");

  assert.ok(horus);
  assert.ok(tau);
  assert.ok(babs);
  assert.ok(sev);

  assert.equal(horus.response.diagnostics.selectedScore >= tau.response.diagnostics.selectedScore, true);
  assert.equal(babs.laneScore > sev.laneScore, true);
  assert.equal(runsForLane(result, "conversion").every((run) => run.elapsedMs >= 0), true);
});

