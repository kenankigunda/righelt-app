const DEFAULT_CONFIRMING_DELAY_MS = 5_000;
const DEFAULT_OVERDUE_DELAY_MS = 15_000;

export const createGameActionFeedback = ({
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  confirmingDelayMs = DEFAULT_CONFIRMING_DELAY_MS,
  overdueDelayMs = DEFAULT_OVERDUE_DELAY_MS,
  onChange = () => {},
} = {}) => {
  const operations = new Map();
  let nextToken = 0;

  const publish = () => onChange(snapshot());

  const cancelTimers = operation => {
    if (operation.confirmingTimer) clearTimer(operation.confirmingTimer);
    if (operation.overdueTimer) clearTimer(operation.overdueTimer);
    operation.confirmingTimer = null;
    operation.overdueTimer = null;
  };

  const scheduleConfirmation = operation => {
    const elapsed = Math.max(0, now() - operation.visibleAt);
    operation.confirmingTimer = setTimer(() => {
      operation.confirmingTimer = null;
      if (!operations.has(operation.token)) return;
      operation.phase = "confirming";
      publish();
    }, Math.max(0, confirmingDelayMs - elapsed));
    operation.overdueTimer = setTimer(() => {
      operation.overdueTimer = null;
      if (!operations.has(operation.token)) return;
      operation.phase = "overdue";
      publish();
    }, Math.max(0, overdueDelayMs - elapsed));
    operation.confirmingTimer?.unref?.();
    operation.overdueTimer?.unref?.();
  };

  const begin = ({ key = null, gameId = null, affectsBoard = false, generation = null, id = null } = {}) => {
    const token = id || `game-action-${++nextToken}`;
    if (operations.has(token)) return token;
    operations.set(token, {
      token,
      key,
      gameId,
      affectsBoard: Boolean(affectsBoard),
      generation,
      phase: "waiting-visible-effect",
      startedAt: now(),
      visibleAt: null,
      confirmingTimer: null,
      overdueTimer: null,
    });
    publish();
    return token;
  };

  const markVisible = (token, { awaitingConfirmation = false } = {}) => {
    const operation = operations.get(token);
    if (!operation) return false;
    cancelTimers(operation);
    if (!awaitingConfirmation || !operation.affectsBoard) {
      operations.delete(token);
      publish();
      return true;
    }
    operation.visibleAt = now();
    operation.phase = "awaiting-confirmation";
    scheduleConfirmation(operation);
    publish();
    return true;
  };

  const finish = token => {
    const operation = operations.get(token);
    if (!operation) return false;
    cancelTimers(operation);
    operations.delete(token);
    publish();
    return true;
  };

  const retire = ({ generation = undefined, gameId = undefined } = {}) => {
    let changed = false;
    for (const operation of operations.values()) {
      const generationMismatch = generation !== undefined && operation.generation !== generation;
      const gameMismatch = gameId !== undefined && operation.gameId && operation.gameId !== gameId;
      if (!generationMismatch && !gameMismatch) continue;
      cancelTimers(operation);
      operations.delete(operation.token);
      changed = true;
    }
    if (changed) publish();
  };

  const snapshot = () => {
    const ctaKeys = new Set();
    const boardGameIds = new Set();
    const overdueGameIds = new Set();
    for (const operation of operations.values()) {
      if (operation.phase === "waiting-visible-effect" && operation.key) ctaKeys.add(operation.key);
      if (operation.affectsBoard && operation.gameId &&
        (operation.phase === "waiting-visible-effect" || operation.phase === "confirming" || operation.phase === "overdue")) {
        boardGameIds.add(operation.gameId);
      }
      if (operation.affectsBoard && operation.gameId && operation.phase === "overdue") overdueGameIds.add(operation.gameId);
    }
    return {
      ctaKeys,
      boardGameIds,
      overdueGameIds,
      operations: [...operations.values()].map(({ confirmingTimer, overdueTimer, ...entry }) => ({ ...entry })),
    };
  };

  return {
    begin,
    markVisible,
    finish,
    retire,
    snapshot,
    isCtaPending: key => Boolean(key) && snapshot().ctaKeys.has(key),
    isBoardPending: gameId => Boolean(gameId) && snapshot().boardGameIds.has(gameId),
    isOverdue: gameId => Boolean(gameId) && snapshot().overdueGameIds.has(gameId),
  };
};
