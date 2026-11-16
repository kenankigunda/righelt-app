export function createHistorySelectionActions({ transition, playSound = () => {}, onPendingChange = () => {}, onPresentationReady = () => {} }) {
  if (!transition || typeof transition.run !== 'function' || typeof transition.version !== 'function') {
    throw new TypeError('History selection actions require one transition owner');
  }

  let generation = 0;
  let active = null;
  let acceptedPresentation = null;
  const publicEpisode = episode => episode ? {generation:episode.generation,scope:episode.scope,key:episode.key} : null;
  const clearPending = actionGeneration => {
    if (active?.generation !== actionGeneration) return false;
    active = null;
    onPendingChange(null);
    return true;
  };
  const run = async ({ scope, select, accepted = () => true, sound = null, after = () => {}, trigger = null }) => {
    if (typeof select !== 'function' || typeof accepted !== 'function' || typeof after !== 'function') {
      throw new TypeError('History selection action callbacks must be functions');
    }

    const actionGeneration = ++generation;
    const pendingOwner = `${actionGeneration}:${scope}`;
    acceptedPresentation = null;
    active = {generation:actionGeneration,scope,key:`history-selection:${pendingOwner}`};
    onPendingChange(publicEpisode(active));
    if (trigger?.isConnected) {
      trigger.classList?.add('history-selection-pending');
      trigger.setAttribute?.('aria-busy', 'true');
      trigger.setAttribute?.('data-history-selection-pending-owner', pendingOwner);
    }
    let committed = false;
    let transitionVersion;
    let didAccept = false;
    const isCurrent = () => actionGeneration === generation && transition.version() === transitionVersion;
    const pending = transition.run(scope, () => {
      committed = true;
      return select();
    }, async value => {
      if (!committed || !isCurrent()) return;
      didAccept = accepted(value) === true && isCurrent();
      if (!didAccept) return;
      if (active?.generation === actionGeneration) acceptedPresentation = publicEpisode(active);
      const readyPresentation = publicEpisode(acceptedPresentation);
      if (!readyPresentation || !isCurrent()) return;
      try {
        await onPresentationReady(readyPresentation);
      } catch (error) {
        if (acceptedPresentation?.key === readyPresentation.key) acceptedPresentation = null;
        throw error;
      }
    });
    transitionVersion = transition.version();
    let value;
    try {
      value = await pending;
    } catch (error) {
      clearPending(actionGeneration);
      throw error;
    } finally {
      if (trigger?.getAttribute?.('data-history-selection-pending-owner') === pendingOwner) {
        trigger.classList?.remove('history-selection-pending');
        trigger.removeAttribute?.('aria-busy');
        trigger.removeAttribute?.('data-history-selection-pending-owner');
      }
    }
    if (!committed || !isCurrent()) {
      clearPending(actionGeneration);
      return { accepted: false, value };
    }
    if (!didAccept) {
      clearPending(actionGeneration);
      if (isCurrent()) after({ accepted: false, value });
      return { accepted: false, value };
    }
    clearPending(actionGeneration);
    if (sound && isCurrent()) playSound(sound);
    if (!isCurrent()) return { accepted: false, value };
    after({ accepted: true, value });
    return { accepted: isCurrent(), value };
  };

  const presentation = () => publicEpisode(acceptedPresentation);
  const consumePresentation = key => {
    if (typeof key !== 'string') return false;
    if (acceptedPresentation?.key !== key) return false;
    acceptedPresentation = null;
    return true;
  };
  const retire = () => {
    generation += 1;
    acceptedPresentation = null;
    if (active) {
      active = null;
      onPendingChange(null);
    }
  };

  return { run, snapshot: () => publicEpisode(active), presentation, consumePresentation, retire };
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
