import { SYNC_TIMING } from '../generated/packages/shared-types/src/sync-protocol.js';

// Presentation time is deliberately separate from durable-command deadlines.
// Returning to a game starts a fresh wait, even if background recovery is old.
export function createForegroundRecoveryWait({ clock = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) {
  let scope = null, startedAt = null, timer = null;
  const reset = () => {
    if (timer !== null) clearTimer(timer);
    timer = null; scope = null; startedAt = null;
  };
  return {
    reset,
    update({ scope: nextScope, active, blocked }) {
      if (!active || !blocked) { reset(); return 0; }
      if (scope !== nextScope || startedAt === null) { reset(); scope = nextScope; startedAt = clock(); }
      const elapsed = Math.max(0, clock() - startedAt);
      if (timer === null) {
        const next = [SYNC_TIMING.reconnectAlertMs, SYNC_TIMING.confirmationBudgetMs].find(value => value > elapsed);
        if (next !== undefined) timer = setTimer(() => { timer = null; onChange(); }, next - elapsed);
      }
      return elapsed;
    },
  };
}
