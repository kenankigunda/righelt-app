const actionsMatch = (left, right) =>
  left?.type === right?.type &&
  left?.actorId === right?.actorId &&
  left?.from?.row === right?.from?.row &&
  left?.from?.col === right?.from?.col &&
  left?.to?.row === right?.to?.row &&
  left?.to?.col === right?.to?.col;

export const resolveInitialSelectionHydration = ({
  gameId,
  initialSelectionAction,
  legalActions,
  consumedActionKey,
  toStableKey,
}) => {
  if (!gameId || !initialSelectionAction) {
    return { selectionAction: null, nextConsumedActionKey: null, shouldConsume: false };
  }

  const nextConsumedActionKey = toStableKey(initialSelectionAction);
  if (consumedActionKey === nextConsumedActionKey) {
    return { selectionAction: null, nextConsumedActionKey, shouldConsume: false };
  }

  const matchingAction = (Array.isArray(legalActions) ? legalActions : []).find((action) => actionsMatch(action, initialSelectionAction)) ?? null;
  return {
    selectionAction: matchingAction,
    nextConsumedActionKey,
    shouldConsume: true,
  };
};
