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
