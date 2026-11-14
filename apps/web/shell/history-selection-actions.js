export function createHistorySelectionActions({ transition, playSound = () => {} }) {
  if (!transition || typeof transition.run !== 'function' || typeof transition.version !== 'function') {
    throw new TypeError('History selection actions require one transition owner');
  }

  let generation = 0;
  const run = async ({ scope, select, accepted = () => true, sound = null, after = () => {} }) => {
    if (typeof select !== 'function' || typeof accepted !== 'function' || typeof after !== 'function') {
      throw new TypeError('History selection action callbacks must be functions');
    }

    const actionGeneration = ++generation;
    let committed = false;
    const pending = transition.run(scope, () => {
      committed = true;
      return select();
    });
    const transitionVersion = transition.version();
    const value = await pending;
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

  return { run };
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
