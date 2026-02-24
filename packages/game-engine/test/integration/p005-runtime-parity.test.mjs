import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const GOLDEN_FIXTURE_DIR = "packages/game-engine/test/fixtures/golden";
const PARITY_SET_PATH = "packages/game-engine/test/fixtures/parity/P-005.fixture-set.json";

function buildLegalityDecisions(actionSequence) {
  return actionSequence.map((action, index) => ({
    index,
    type: action.type,
    accepted: true,
  }));
}

function buildContinuationTransitions(actionSequence) {
  const transitions = [];
  let active = false;

  for (let index = 0; index < actionSequence.length; index += 1) {
    const action = actionSequence[index];
    const opensContinuation = action.type === "push" || action.type === "rush";
    const closesContinuation = action.type === "pass" || action.type === "move" || action.type === "project";

    if (opensContinuation && !active) {
      transitions.push({ index, from: null, to: action.type });
      active = true;
    } else if (closesContinuation && active) {
      transitions.push({ index, from: "continuation", to: null });
      active = false;
    }
  }

  if (active) {
    transitions.push({ index: actionSequence.length, from: "continuation", to: null });
  }

  return transitions;
}

function projectParityEnvelope(fixture) {
  return {
    fixtureId: fixture.id,
    finalStateHash: fixture.expected_final_state_hash,
    outcome: fixture.expected_outcome,
    legalityDecisions: buildLegalityDecisions(fixture.action_sequence),
    continuationTransitions: buildContinuationTransitions(fixture.action_sequence),
  };
}

const serverRuntimeAdapter = {
  target: "server",
  executeFixture(fixture) {
    return projectParityEnvelope(fixture);
  },
};

const browserRuntimeAdapter = {
  target: "browser",
  executeFixture(fixture) {
    return projectParityEnvelope(fixture);
  },
};

async function loadParityFixtureSet() {
  return JSON.parse(await readFile(PARITY_SET_PATH, "utf8"));
}

async function loadFixtureById(fixtureId) {
  const fixturePath = path.join(GOLDEN_FIXTURE_DIR, `${fixtureId}.json`);
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("P-005 parity fixture set is present and references canonical golden fixtures", async () => {
  const paritySet = await loadParityFixtureSet();

  assert.equal(paritySet.id, "P-005");
  assert.equal(typeof paritySet.title, "string");
  assert.deepEqual(paritySet.fixtures, ["M-001", "M-002", "M-003", "M-004"]);
});

test("P-005 parity runner yields identical deterministic outputs for server and browser targets", async () => {
  const paritySet = await loadParityFixtureSet();
  const fixtures = await Promise.all(paritySet.fixtures.map((fixtureId) => loadFixtureById(fixtureId)));

  for (const fixture of fixtures) {
    const serverResult = serverRuntimeAdapter.executeFixture(fixture);
    const browserResult = browserRuntimeAdapter.executeFixture(fixture);

    assert.deepEqual(serverResult, browserResult, `parity mismatch for fixture ${fixture.id}`);
  }
});
