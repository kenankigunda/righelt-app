import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, applyAction, resolveToStability } from "../../game-engine/src/index";
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
});
