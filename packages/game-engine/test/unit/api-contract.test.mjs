import test from "node:test";
import assert from "node:assert/strict";

import * as engine from "../../src/index.ts";

test("API-001 createInitialState is exported", () => {
  assert.equal(typeof engine.createInitialState, "function");
});

test("API-002 listLegalActions is exported", () => {
  assert.equal(typeof engine.listLegalActions, "function");
});

test("API-003 validateAction is exported", () => {
  assert.equal(typeof engine.validateAction, "function");
});

test("API-004 applyAction is exported", () => {
  assert.equal(typeof engine.applyAction, "function");
});

test("API-005 replayActions is exported", () => {
  assert.equal(typeof engine.replayActions, "function");
});

test("API-006 serializeState is exported", () => {
  assert.equal(typeof engine.serializeState, "function");
});

test("API-007 deserializeState is exported", () => {
  assert.equal(typeof engine.deserializeState, "function");
});
