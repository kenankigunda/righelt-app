import test from "node:test";
import assert from "node:assert/strict";

import { resolveInitialSelectionHydration } from "../shell/selection-hydration.js";

const toStableKey = (value) => (value == null ? "null" : JSON.stringify(value));

test("initial selection hydration matches the current legal action exactly once", () => {
  const initialSelectionAction = {
    type: "move",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  };
  const legalActions = [
    initialSelectionAction,
    {
      type: "rush",
      actorId: "B1",
      from: { row: 5, col: 5 },
      to: { row: 5, col: 7 },
    },
  ];

  const firstHydration = resolveInitialSelectionHydration({
    gameId: "game-branch",
    initialSelectionAction,
    legalActions,
    consumedActionKey: null,
    toStableKey,
  });
  assert.deepEqual(firstHydration.selectionAction, initialSelectionAction);
  assert.equal(firstHydration.shouldConsume, true);

  const secondHydration = resolveInitialSelectionHydration({
    gameId: "game-branch",
    initialSelectionAction,
    legalActions,
    consumedActionKey: firstHydration.nextConsumedActionKey,
    toStableKey,
  });
  assert.equal(secondHydration.selectionAction, null);
  assert.equal(secondHydration.shouldConsume, false);
});

test("initial selection hydration consumes stale or illegal actions without replaying them", () => {
  const initialSelectionAction = {
    type: "move",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  };

  const hydration = resolveInitialSelectionHydration({
    gameId: "game-branch",
    initialSelectionAction,
    legalActions: [
      {
        type: "rush",
        actorId: "A1",
        from: { row: 4, col: 2 },
        to: { row: 5, col: 2 },
      },
    ],
    consumedActionKey: null,
    toStableKey,
  });

  assert.equal(hydration.selectionAction, null);
  assert.equal(hydration.shouldConsume, true);
  assert.equal(hydration.nextConsumedActionKey, JSON.stringify(initialSelectionAction));
});
