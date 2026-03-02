export const ACTION_PRIORITY = ["move", "rush", "project", "push", "follow", "retreat"];
export const BLOCKED_PREVIEW_REASON = {
  SUPPLY_DESTINATION_UNSUPPLIED: "SUPPLY_DESTINATION_UNSUPPLIED",
  PUSH_STRENGTH_TOO_WEAK: "PUSH_STRENGTH_TOO_WEAK",
};

export function pickBestActionTypeForTarget(actionsAtTarget, currentType) {
  if (!Array.isArray(actionsAtTarget) || actionsAtTarget.length === 0) {
    return null;
  }

  if (actionsAtTarget.some((action) => action.type === currentType)) {
    return currentType;
  }

  for (const type of ACTION_PRIORITY) {
    if (actionsAtTarget.some((action) => action.type === type)) {
      return type;
    }
  }

  return actionsAtTarget[0]?.type ?? null;
}

export function shouldAllowSelectionAtTarget({
  allowFreeSelection,
  hasSelectedSource,
  actionsAtTarget,
}) {
  if (allowFreeSelection) {
    return true;
  }

  if (!hasSelectedSource) {
    return false;
  }

  return Array.isArray(actionsAtTarget) && actionsAtTarget.length > 0;
}

export function shouldPreferActionTargetOnOccupiedCell({
  selectedPieceOwner,
  clickedPieceOwner,
  actionsAtTarget,
}) {
  if (!selectedPieceOwner || !clickedPieceOwner || selectedPieceOwner === clickedPieceOwner) {
    return false;
  }

  return Array.isArray(actionsAtTarget) && actionsAtTarget.length > 0;
}

export function getBlockedPreviewLabel(blockedReason) {
  if (blockedReason === BLOCKED_PREVIEW_REASON.SUPPLY_DESTINATION_UNSUPPLIED) {
    return "Disallowed: destination would be unsupplied.";
  }
  if (blockedReason === BLOCKED_PREVIEW_REASON.PUSH_STRENGTH_TOO_WEAK) {
    return "Disallowed: group strength too low to push this piece.";
  }
  return `Disallowed: ${blockedReason ?? "rule violation"}.`;
}

export function buildActionPayload(type, source, target) {
  if (type === "pass") {
    return { type };
  }

  return {
    type,
    from: source,
    to: target,
  };
}

export function shouldResetSelectionOnDocumentClick(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return !target.closest("button, input, select, textarea, a, label, [role='button'], [role='link']");
}

export function shouldSubmitOnEnter({ key, target, actionType, submitDisabled }) {
  if (key !== "Enter") {
    return false;
  }

  if (submitDisabled || actionType === "pass") {
    return false;
  }

  if (target && typeof target.closest === "function") {
    if (target.closest("input, textarea, [contenteditable='true']")) {
      return false;
    }
    if (target.closest("button, a, [role='button'], [role='link']")) {
      return false;
    }
  }

  return true;
}
