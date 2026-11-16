/** Keep the pressed control mounted until its activation event has dispatched. */
export const createRenderGestureGate = ({
  render,
  schedule = setTimeout,
  cancel = clearTimeout,
}) => {
  const defaultOwner = Symbol("render-gesture"), owners = new Set();
  let held = false,
    pending = null,
    releaseTimer = null,
    flushWaiters = [];
  const settleFlush = (value, error = null) => {
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve(value);
  };
  const flush = () => {
    releaseTimer = null;
    if (owners.size) return;
    held = false;
    const options = pending;
    pending = null;
    try {
      if (options) render(options);
      settleFlush(Boolean(options));
    } catch (error) {
      settleFlush(false,error);
      throw error;
    }
  };
  const release = () => {
    if (!owners.size && releaseTimer === null) releaseTimer = schedule(flush, 0);
  };
  return {
    begin(owner = defaultOwner) {
      owners.add(owner);
      cancel(releaseTimer);
      releaseTimer = null;
      held = true;
    },
    defer(options) {
      if (!held) return false;
      pending = {
        ...options,
        includeBoard: Boolean(options.includeBoard || pending?.includeBoard),
      };
      return true;
    },
    end(owner = defaultOwner) {
      if (!owners.delete(owner)) return;
      // The final matching release keeps activation ahead of the next task.
      release();
    },
    waitForFlush() {
      if (!held && !pending) return Promise.resolve(false);
      return new Promise((resolve,reject) => flushWaiters.push({resolve,reject}));
    },
    cancelAll() {
      owners.clear();
      release();
    },
    destroy() {
      cancel(releaseTimer);
      releaseTimer = null;
      owners.clear();
      held = false;
      pending = null;
      settleFlush(false);
    },
  };
};


// A live snapshot may replace cells between keyboard focus and keydown. Restore
// only that board coordinate, never focus deliberately moved into another control.
export const preserveBoardFocus = ({ document, getGameId }, render) => {
  const focused = document.activeElement;
  const cell = focused?.matches?.("#shell-board button[data-row][data-col]") ? focused : null;
  const gameId = getGameId();
  const result = render();
  if (cell && !cell.isConnected && document.activeElement === document.body && gameId && getGameId() === gameId) {
    const replacement = [...document.querySelectorAll("#shell-board button[data-row][data-col]")]
      .find(button => button.dataset.row === cell.dataset.row && button.dataset.col === cell.dataset.col && !button.disabled);
    replacement?.focus({ preventScroll: true });
  }
  return result;
};
