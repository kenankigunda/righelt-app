/** Keep the pressed control mounted until its activation event has dispatched. */
export const createRenderGestureGate = ({
  render,
  schedule = setTimeout,
  cancel = clearTimeout,
}) => {
  let held = false,
    pending = null,
    releaseTimer = null;
  const flush = () => {
    releaseTimer = null;
    held = false;
    const options = pending;
    pending = null;
    if (options) render(options);
  };
  return {
    begin() {
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
    end() {
      // pointerup and click run before the next task. Cancellation and drags
      // without a click also release the gate instead of leaving it held.
      if (releaseTimer === null) releaseTimer = schedule(flush, 0);
    },
    destroy() {
      cancel(releaseTimer);
      held = false;
      pending = null;
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
