export function createHistorySelectionActions({ transition, playSound = () => {} }) {
  if (!transition || typeof transition.run !== 'function') {
    throw new TypeError('History selection actions require one transition owner');
  }

  const run = async ({ scope, select, accepted = () => true, sound = null, after = () => {} }) => {
    if (typeof select !== 'function' || typeof accepted !== 'function' || typeof after !== 'function') {
      throw new TypeError('History selection action callbacks must be functions');
    }

    let committed = false;
    const value = await transition.run(scope, () => {
      committed = true;
      return select();
    });
    const didAccept = committed && accepted(value) === true;
    if (didAccept && sound) playSound(sound);
    after({ accepted: didAccept, value });
    return { accepted: didAccept, value };
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
