export const ACTION_PRIORITY = ["move", "rush", "project", "push", "follow", "retreat"];

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
