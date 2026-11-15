const validHeight = value => Number.isFinite(value) && value >= 0;

export function createHistorySelectionTransition({
  reducedMotion = () => false,
  duration = 180,
  easing = 'ease-out',
  isElement = value => typeof globalThis.HTMLElement === 'function' && value instanceof globalThis.HTMLElement,
  readScroll = () => ({ x: globalThis.scrollX ?? 0, y: globalThis.scrollY ?? 0 }),
  restoreScroll = position => globalThis.scrollTo?.({ left: position.x, top: position.y, behavior: 'instant' }),
} = {}) {
  let generation = 0;
  let owner = null;
  let motion = null;

  const transitionElements = element => {
    if (!isElement(element) || !element.isConnected) return [];
    const shell = element.matches?.('[data-game-shell-root]')
      ? element
      : element.closest?.('[data-game-shell-root]');
    if (!shell) return [element];
    return ['[data-game-panel="history"]', '[data-shell-panel="board"]']
      .map(selector => shell.querySelector?.(selector))
      .filter(target => isElement(target) && target.isConnected);
  };

  const clearMotion = animation => {
    if (!motion?.animations.includes(animation)) return;
    motion.animations = motion.animations.filter(active => active !== animation);
    if (motion.animations.length) return;
    const settled = motion;
    for (const element of settled.elements) element.classList.remove('history-selection-transitioning');
    motion = null;
    settled.resolve(true);
    if (settled.owner.generation === generation) settled.after?.(() => settled.owner.generation === generation);
  };

  const cancelMotion = () => {
    const active = motion;
    if (!active) return;
    motion = null;
    for (const animation of active.animations) animation.cancel();
    for (const element of active.elements) element.classList.remove('history-selection-transitioning');
    active.resolve(false);
  };

  const begin = scope => {
    cancelMotion();
    owner = { generation: ++generation, scope };
    return owner;
  };

  const capture = element => {
    const elements = transitionElements(element);
    if (!elements.length) return null;
    if (!owner) { cancelMotion(); return null; }
    const heights = elements.map(target => target.getBoundingClientRect().height);
    const scroll = readScroll();
    cancelMotion();
    if (heights.some(height => !validHeight(height))) return null;
    return { owner, elements, heights, scroll, reduced: reducedMotion() };
  };

  const present = (captured, after = null) => {
    if (!captured) {
      if (!owner) after?.(() => owner === null);
      return false;
    }
    if (owner !== captured.owner || captured.elements.some(element => !element.isConnected)) return false;
    const measurements = captured.elements.map((element, index) => ({
      element,
      fromHeight: captured.heights[index],
      toHeight: element.getBoundingClientRect().height,
    }));
    restoreScroll(captured.scroll);
    if (captured.reduced) {
      after?.(() => captured.owner.generation === generation, {immediate:true});
      return false;
    }
    const changed = measurements.filter(({element,fromHeight,toHeight}) =>
      validHeight(toHeight) && Math.abs(toHeight - fromHeight) >= 1 && typeof element.animate === 'function');
    if (!changed.length) {
      after?.(() => captured.owner.generation === generation);
      return false;
    }
    let resolve;
    const settled = new Promise(done => { resolve = done; });
    const animations = changed.map(({element,fromHeight,toHeight}) => element.animate(
      [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
      { duration, easing },
    ));
    const elements = changed.map(({element}) => element);
    for (const element of elements) element.classList.add('history-selection-transitioning');
    motion = { animations, elements, owner: captured.owner, after, settled, resolve };
    for (const animation of animations) {
      animation.onfinish = () => clearMotion(animation);
      animation.oncancel = () => clearMotion(animation);
    }
    return true;
  };

  const finish = token => {
    if (owner !== token) return false;
    owner = null;
    return true;
  };

  const waitForSettled = async token => {
    if (token.generation !== generation) return false;
    if (motion?.owner !== token) return true;
    return motion.settled;
  };

  const run = async (scope, select) => {
    const token = begin(scope);
    try {
      const value = await select();
      await waitForSettled(token);
      return value;
    } finally {
      finish(token);
    }
  };

  const cancel = () => {
    owner = null;
    generation += 1;
    cancelMotion();
  };

  return { begin, capture, present, finish, run, cancel, waitForSettled, version: () => generation };
}
