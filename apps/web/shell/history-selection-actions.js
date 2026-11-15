export function createHistorySelectionActions({ transition, playSound = () => {}, onPendingChange = () => {} }) {
  if (!transition || typeof transition.run !== 'function' || typeof transition.version !== 'function') {
    throw new TypeError('History selection actions require one transition owner');
  }

  let generation = 0;
  let active = null;
  const run = async ({ scope, select, accepted = () => true, sound = null, after = () => {}, trigger = null }) => {
    if (typeof select !== 'function' || typeof accepted !== 'function' || typeof after !== 'function') {
      throw new TypeError('History selection action callbacks must be functions');
    }

    const actionGeneration = ++generation;
    const pendingOwner = `${actionGeneration}:${scope}`;
    active = {generation:actionGeneration,scope,key:`history-selection:${pendingOwner}`};
    onPendingChange(active);
    if (trigger?.isConnected) {
      trigger.classList?.add('history-selection-pending');
      trigger.setAttribute?.('aria-busy', 'true');
      trigger.setAttribute?.('data-history-selection-pending-owner', pendingOwner);
    }
    let committed = false;
    const pending = transition.run(scope, () => {
      committed = true;
      return select();
    });
    const transitionVersion = transition.version();
    let value;
    try {
      value = await pending;
    } finally {
      if (trigger?.getAttribute?.('data-history-selection-pending-owner') === pendingOwner) {
        trigger.classList?.remove('history-selection-pending');
        trigger.removeAttribute?.('aria-busy');
        trigger.removeAttribute?.('data-history-selection-pending-owner');
      }
      if (active?.generation === actionGeneration) {
        active = null;
        onPendingChange(null);
      }
    }
    const isCurrent = () => actionGeneration === generation && transition.version() === transitionVersion;
    if (!committed || !isCurrent()) return { accepted: false, value };
    const didAccept = accepted(value) === true && isCurrent();
    if (!didAccept) {
      if (isCurrent()) after({ accepted: false, value });
      return { accepted: false, value };
    }
    if (sound && isCurrent()) playSound(sound);
    if (!isCurrent()) return { accepted: false, value };
    after({ accepted: true, value });
    return { accepted: isCurrent(), value };
  };

  return { run, snapshot: () => active && {...active} };
}

export function captureHistorySelectionFocus({ document, root, trigger, keyboard = trigger?.matches?.(':focus-visible') }) {
  const ownsKeyboardFocus = Boolean(
    trigger?.isConnected
    && document?.activeElement === trigger
    && keyboard,
  );
  return () => {
    if (!ownsKeyboardFocus || trigger.isConnected || document.activeElement !== document.body) return false;
    const selected = root?.querySelector?.('[data-game-panel="history"] [aria-current="true"]');
    if (!selected?.isConnected || typeof selected.focus !== 'function') return false;
    selected.tabIndex = -1;
    selected.focus({ preventScroll: true });
    return document.activeElement === selected;
  };
}
