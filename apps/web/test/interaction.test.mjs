import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActionPayload,
  pickBestActionTypeForTarget,
  shouldAllowSelectionAtTarget,
  shouldResetSelectionOnDocumentClick,
  shouldSubmitOnEnter,
} from "../interaction.js";

function targetWithClosest(matcher) {
  return {
    closest(selector) {
      return matcher(selector) ? {} : null;
    },
  };
}

test("pickBestActionTypeForTarget keeps current type when available", () => {
  const result = pickBestActionTypeForTarget(
    [
      { type: "project", to: { row: 1, col: 1 } },
      { type: "rush", to: { row: 1, col: 1 } },
    ],
    "project",
  );

  assert.equal(result, "project");
});

test("pickBestActionTypeForTarget falls back to priority order", () => {
  const result = pickBestActionTypeForTarget(
    [
      { type: "project", to: { row: 1, col: 1 } },
      { type: "push", to: { row: 1, col: 1 } },
    ],
    "move",
  );

  assert.equal(result, "project");
});

test("buildActionPayload returns pass shape for pass", () => {
  assert.deepEqual(buildActionPayload("pass", { row: 3, col: 6 }, { row: 3, col: 7 }), { type: "pass" });
});

test("buildActionPayload returns targeted payload for non-pass", () => {
  assert.deepEqual(
    buildActionPayload("move", { row: 3, col: 6 }, { row: 3, col: 7 }),
    {
      type: "move",
      from: { row: 3, col: 6 },
      to: { row: 3, col: 7 },
    },
  );
});

test("shouldResetSelectionOnDocumentClick only resets on non-interactive targets", () => {
  const interactiveTarget = targetWithClosest((selector) => selector.includes("button"));
  const plainTarget = targetWithClosest(() => false);

  assert.equal(shouldResetSelectionOnDocumentClick(interactiveTarget), false);
  assert.equal(shouldResetSelectionOnDocumentClick(plainTarget), true);
});

test("shouldSubmitOnEnter blocks enter in editable and interactive contexts", () => {
  const inputTarget = targetWithClosest((selector) => selector.includes("input"));
  const buttonTarget = targetWithClosest((selector) => selector.includes("button"));

  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", target: inputTarget, actionType: "move", submitDisabled: false }),
    false,
  );
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", target: buttonTarget, actionType: "move", submitDisabled: false }),
    false,
  );
});

test("shouldSubmitOnEnter allows enter for actionable board context", () => {
  const boardTarget = targetWithClosest(() => false);

  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", target: boardTarget, actionType: "move", submitDisabled: false }),
    true,
  );
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", target: boardTarget, actionType: "pass", submitDisabled: false }),
    false,
  );
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", target: boardTarget, actionType: "move", submitDisabled: true }),
    false,
  );
});

test("shouldAllowSelectionAtTarget enforces strict mode by default", () => {
  assert.equal(
    shouldAllowSelectionAtTarget({
      allowFreeSelection: false,
      hasSelectedSource: false,
      actionsAtTarget: [],
    }),
    false,
  );

  assert.equal(
    shouldAllowSelectionAtTarget({
      allowFreeSelection: false,
      hasSelectedSource: true,
      actionsAtTarget: [],
    }),
    false,
  );

  assert.equal(
    shouldAllowSelectionAtTarget({
      allowFreeSelection: false,
      hasSelectedSource: true,
      actionsAtTarget: [{ type: "move", to: { row: 3, col: 4 } }],
    }),
    true,
  );
});

test("shouldAllowSelectionAtTarget allows free mode", () => {
  assert.equal(
    shouldAllowSelectionAtTarget({
      allowFreeSelection: true,
      hasSelectedSource: false,
      actionsAtTarget: [],
    }),
    true,
  );
});
