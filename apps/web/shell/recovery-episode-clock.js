import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';

export const RECOVERY_ACTIVE_BOUNDARIES_MS = Object.freeze([
  SYNC_TIMING.reconnectAlertMs,
  SYNC_TIMING.confirmationBudgetMs,
  SYNC_TIMING.connectionFailureMs,
]);

export const createRecoveryEpisodeClock = ({
  clock = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onBoundary = () => {},
  onFailure = () => {},
} = {}) => {
  let scope = null, elapsedMs = 0, activeSince = null, boundaryIndex = 0, timer = null, terminal = false;

  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const sameScope = ({ gameId, episodeId } = {}) => Boolean(scope && scope.gameId === gameId && scope.episodeId === episodeId);
  const activeElapsed = () => elapsedMs + (activeSince === null ? 0 : Math.max(0, clock() - activeSince));
  const snapshot = () => ({
    gameId: scope?.gameId ?? null,
    episodeId: scope?.episodeId ?? null,
    activeMs: Math.min(RECOVERY_ACTIVE_BOUNDARIES_MS.at(-1), activeElapsed()),
    running: activeSince !== null,
    terminal,
  });
  const retire = () => {
    clearScheduled();scope = null;elapsedMs = 0;activeSince = null;boundaryIndex = 0;terminal = false;
  };
  const publishReachedBoundaries = () => {
    while (!terminal && boundaryIndex < RECOVERY_ACTIVE_BOUNDARIES_MS.length
      && elapsedMs >= RECOVERY_ACTIVE_BOUNDARIES_MS[boundaryIndex]) {
      const boundaryMs = RECOVERY_ACTIVE_BOUNDARIES_MS[boundaryIndex++];
      const event = { ...scope, activeMs: boundaryMs, boundaryMs };
      onBoundary(event);
      if (boundaryMs === RECOVERY_ACTIVE_BOUNDARIES_MS.at(-1)) {
        terminal = true;activeSince = null;elapsedMs = boundaryMs;onFailure(event);
      }
    }
  };
  const accrue = () => {
    if (activeSince === null || terminal) return;
    const now = clock();elapsedMs += Math.max(0, now - activeSince);activeSince = now;
    publishReachedBoundaries();
  };
  const schedule = () => {
    clearScheduled();
    if (activeSince === null || terminal || boundaryIndex >= RECOVERY_ACTIVE_BOUNDARIES_MS.length) return;
    const delay = Math.max(0, RECOVERY_ACTIVE_BOUNDARIES_MS[boundaryIndex] - activeElapsed());
    const expected = scope;
    timer = setTimer(() => {
      timer = null;
      if (scope !== expected || activeSince === null || terminal) return;
      accrue();schedule();
    }, delay);
  };
  const update = ({ gameId, episodeId, active = false, visible = false, history = false } = {}) => {
    if (gameId == null || episodeId == null) {retire();return snapshot();}
    if (!sameScope({ gameId, episodeId })) {
      retire();scope = { gameId, episodeId };
    }
    const shouldRun = Boolean(active && visible && !history && !terminal);
    if (shouldRun && activeSince === null) activeSince = clock();
    else if (!shouldRun && activeSince !== null) {accrue();activeSince = null;}
    schedule();return snapshot();
  };
  const resolve = candidate => {
    if (sameScope(candidate)) retire();
    return snapshot();
  };

  return { update, resolve, reset: retire, snapshot, dispose: retire };
};
