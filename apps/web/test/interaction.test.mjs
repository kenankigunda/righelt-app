import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOCKED_PREVIEW_REASON,
  buildActionPayload,
  deriveForcedContinuationSelection,
  getBlockedPreviewLabel,
  pickBestActionTypeForTarget,
  shouldPreferActionTargetOnOccupiedCell,
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
    buildActionPayload("move", { row: 3, col: 6 }, { row: 3, col: 7 }, "C1"),
    {
      type: "move",
      actorId: "C1",
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

test("shouldPreferActionTargetOnOccupiedCell only prefers enemy target cells with previews", () => {
  assert.equal(
    shouldPreferActionTargetOnOccupiedCell({
      selectedPieceOwner: "P1",
      clickedPieceOwner: "P2",
      actionsAtTarget: [{ type: "push", to: { row: 4, col: 5 } }],
    }),
    true,
  );

  assert.equal(
    shouldPreferActionTargetOnOccupiedCell({
      selectedPieceOwner: "P1",
      clickedPieceOwner: "P2",
      actionsAtTarget: [],
    }),
    false,
  );

  assert.equal(
    shouldPreferActionTargetOnOccupiedCell({
      selectedPieceOwner: "P1",
      clickedPieceOwner: "P1",
      actionsAtTarget: [{ type: "push", to: { row: 4, col: 5 } }],
    }),
    false,
  );
});

test("getBlockedPreviewLabel maps player-facing preview copy", () => {
  assert.equal(
    getBlockedPreviewLabel(BLOCKED_PREVIEW_REASON.SUPPLY_DESTINATION_UNSUPPLIED),
    "Disallowed: destination would be unsupplied.",
  );
  assert.equal(
    getBlockedPreviewLabel(BLOCKED_PREVIEW_REASON.PUSH_STRENGTH_TOO_WEAK),
    "Disallowed: group strength too low to push this piece.",
  );
});

test("deriveForcedContinuationSelection auto-selects pushed piece and lone retreat", () => {
  const result = deriveForcedContinuationSelection(
    {
      continuation: {
        type: "push",
        phase: "retreat",
        pushedPieceId: "D1",
      },
      pieces: [{ id: "D1", position: { row: 4, col: 4 } }],
    },
    [{ type: "retreat", actorId: "D1", to: { row: 4, col: 5 } }],
  );

  assert.deepEqual(result, {
    selectedPieceId: "D1",
    source: { row: 4, col: 4 },
    target: { row: 4, col: 5 },
    actionType: "retreat",
  });
});

test("deriveForcedContinuationSelection auto-selects lone follow actor but not target when multiple moves exist", () => {
  const result = deriveForcedContinuationSelection(
    {
      continuation: {
        type: "push",
        phase: "follow",
      },
      pieces: [{ id: "F1", position: { row: 4, col: 2 } }],
    },
    [
      { type: "follow", actorId: "F1", to: { row: 4, col: 3 } },
      { type: "follow", actorId: "F1", to: { row: 3, col: 2 } },
    ],
  );

  assert.deepEqual(result, {
    selectedPieceId: "F1",
    source: { row: 4, col: 2 },
    target: null,
    actionType: "follow",
  });
});
