export const ACTION_PRIORITY = ["rush", "move", "project", "push", "follow", "retreat"];
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

export function deriveForcedContinuationSelection(snapshot, legalActions) {
  if (!snapshot?.continuation || snapshot.continuation.type !== "push" || !Array.isArray(legalActions)) {
    return null;
  }

  if (snapshot.continuation.phase === "retreat") {
    const pushedPieceId = snapshot.continuation.pushedPieceId;
    if (!pushedPieceId) {
      return null;
    }
    const pushedPiece = snapshot.pieces?.find((piece) => piece.id === pushedPieceId);
    if (!pushedPiece) {
      return null;
    }
    const retreatActions = legalActions.filter((action) => action.type === "retreat" && action.actorId === pushedPieceId);
    return {
      selectedPieceId: pushedPieceId,
      source: { ...pushedPiece.position },
      target: retreatActions.length === 1 && retreatActions[0].to ? { ...retreatActions[0].to } : null,
      actionType: "retreat",
    };
  }

  if (snapshot.continuation.phase === "follow") {
    const followActions = legalActions.filter((action) => action.type === "follow");
    const actorIds = [...new Set(followActions.map((action) => action.actorId).filter(Boolean))];
    if (actorIds.length !== 1) {
      return null;
    }

    const piece = snapshot.pieces?.find((candidate) => candidate.id === actorIds[0]);
    if (!piece) {
      return null;
    }

    return {
      selectedPieceId: piece.id,
      source: { ...piece.position },
      target: followActions.length === 1 && followActions[0].to ? { ...followActions[0].to } : null,
      actionType: "follow",
    };
  }

  return null;
}

export function deriveAutoSelectedTarget(actions) {
  if (!Array.isArray(actions) || actions.length !== 1) {
    return null;
  }

  const [onlyAction] = actions;
  if (!onlyAction?.to) {
    return null;
  }

  return { ...onlyAction.to };
}

export function buildActionPayload(type, source, target, actorId = null) {
  if (type === "pass") {
    return { type };
  }

  return {
    type,
    actorId: actorId ?? undefined,
    from: source,
    to: target,
  };
}

export function deriveContinuationHighlightByPieceId(snapshot, legalActions) {
  const movedPieceIds = new Set();
  const pendingPieceIds = new Set();

  if (!snapshot?.continuation) {
    return { movedPieceIds, pendingPieceIds };
  }

  if (snapshot.continuation.type === "push") {
    for (const pieceId of snapshot.continuation.followGroupPieceIds ?? []) {
      const piece = snapshot.pieces?.find((candidate) => candidate.id === pieceId);
      if (!piece) {
        continue;
      }
      if (piece.shifted) {
        movedPieceIds.add(pieceId);
      } else {
        pendingPieceIds.add(pieceId);
      }
    }
    return { movedPieceIds, pendingPieceIds };
  }

  if (snapshot.continuation.type === "rush") {
    for (const pieceId of snapshot.continuation.rushedPieceIds ?? []) {
      movedPieceIds.add(pieceId);
    }
    for (const action of Array.isArray(legalActions) ? legalActions : []) {
      if (action?.type !== "rush" || typeof action.actorId !== "string") {
        continue;
      }
      if (!movedPieceIds.has(action.actorId)) {
        pendingPieceIds.add(action.actorId);
      }
    }
  }

  return { movedPieceIds, pendingPieceIds };
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
