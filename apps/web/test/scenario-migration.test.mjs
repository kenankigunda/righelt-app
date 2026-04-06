import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const shellAppSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const catalogSource = readFileSync(join(testDir, "..", "scenarios", "catalog.json"), "utf8");
const catalog = JSON.parse(catalogSource);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("legacy scenario snapshot documentation is preserved", () => {
  assert.equal(existsSync(join(testDir, "..", "..", "..", "docs", "legacy-scenarios", "m-golden-fixtures.snapshot.json")), true);
});

test("runtime scenario catalog is versioned for history-based scenarios only", () => {
  assert.equal(Array.isArray(catalog.scenarios), true);
  assert.equal(catalog.scenarios.every((scenario) => UUID_V4_PATTERN.test(String(scenario.id))), true);
});

test("catalog includes a scenario where capturing the supply point wins by unsupplying the commander", () => {
  const scenario = catalog.scenarios.find((entry) => entry.id === "09e27624-2b34-4a63-b113-dbc740caad2d");
  assert.ok(scenario);
  assert.equal(scenario.expectedOutcome, "p1_win");
  assert.equal(scenario.moves.at(-1)?.notation, "PROJECT (9,2) -> (9,0)");
  assert.deepEqual(scenario.resultingState.outcome, {
    status: "p1_win",
    reason: "p2_commander_unsupplied",
  });
  assert.equal(scenario.resultingState.pieces.some((piece) => piece.id === "U1-7" && piece.position?.row === 9 && piece.position?.col === 0), true);
});

test("shell debug UI uses scenario terminology", () => {
  assert.match(shellAppSource, /Scenarios/);
  assert.match(shellAppSource, /Load a scenario/);
  assert.match(shellAppSource, /Create a scenario/);
  assert.match(shellAppSource, /Save current board as new scenario/);
  assert.doesNotMatch(shellAppSource, />Load Fixture</);
});
