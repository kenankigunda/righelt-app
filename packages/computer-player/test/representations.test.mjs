import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, applyAction, listLegalActions, resolveToStability } from "../../game-engine/src/index";
import {
  canonicalizeAction,
  canonicalizeState,
  selectMove,
  getBotPersona,
} from "../src/index.ts";

test("CP-001 canonical state encoding is stable", () => {
  const state = createInitialState();
  const cloned = resolveToStability(
    {
      ...state,
      pieces: [...state.pieces].reverse(),
      artifacts: JSON.parse(JSON.stringify(state.artifacts)),
    },
    { artifactMode: "minimal" },
  );

  const first = canonicalizeState(resolveToStability(state, { artifactMode: "minimal" }));
  const second = canonicalizeState(cloned);

  assert.equal(first.version, "cp-state-v1");
  assert.equal(first.serialized, second.serialized);
  assert.equal(first.hash, second.hash);
});

test("CP-002 canonical action encoding is stable", () => {
  const actionA = {
    type: "move",
    actorId: "C1",
    from: { row: 3, col: 6 },
    to: { row: 3, col: 5 },
  };
  const actionB = {
    to: { row: 3, col: 5 },
    from: { row: 3, col: 6 },
    actorId: "C1",
    type: "move",
  };

  assert.equal(canonicalizeAction(actionA).key, canonicalizeAction(actionB).key);
});

test("CP-003 selectMove returns a legal deterministic action and diagnostics", () => {
  const state = createInitialState();
  const first = selectMove({
    personaId: "horus",
    state,
    seed: 42,
    trace: true,
  });
  const second = selectMove({
    personaId: "horus",
    state,
    seed: 42,
    trace: true,
  });

  assert.equal(first.diagnostics.persona.displayName, getBotPersona("horus").displayName);
  assert.deepEqual(first.action, second.action);
  assert.equal(first.diagnostics.selectedAction.key, second.diagnostics.selectedAction.key);
  assert.equal(first.diagnostics.searchTimeMs >= 0, true);
  assert.equal(first.diagnostics.trace.length > 0, true);

  const applied = applyAction(state, first.action);
  assert.equal(applied.state.sideToMove, "P2");
  assert.notEqual(first.action.type, "pass");
});

test("CP-004 selectMove keeps pass available when it is the only provided legal action", () => {
  const response = selectMove({
    personaId: "babs",
    state: createInitialState(),
    legalActions: [{ type: "pass" }],
    seed: 7,
  });

  assert.equal(response.action.type, "pass");
  assert.equal(response.diagnostics.selectedAction.key, "pass|-|-|-|-");
});

test("CP-005 selectMove ignores pass when a non-pass action is also legal", () => {
  const state = createInitialState();
  const firstPlayableAction = listLegalActions(state).find((action) => action.type !== "pass");
  assert.ok(firstPlayableAction, "expected at least one non-pass legal action");

  const response = selectMove({
    personaId: "babs",
    state,
    legalActions: [{ type: "pass" }, firstPlayableAction],
    seed: 11,
  });

  assert.notEqual(response.action.type, "pass");
  assert.notEqual(response.diagnostics.selectedAction.key, "pass|-|-|-|-");
});
