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

  const clearMotion = animation => {
    if (motion?.animation !== animation) return;
    motion.element.classList.remove('history-selection-transitioning');
    motion = null;
  };

  const cancelMotion = () => {
    const active = motion;
    if (!active) return;
    motion = null;
    active.animation.cancel();
    active.element.classList.remove('history-selection-transitioning');
  };

  const begin = scope => {
    owner = { generation: ++generation, scope };
    return owner;
  };

  const capture = element => {
    if (!isElement(element) || !element.isConnected) return null;
    if (!owner) { cancelMotion(); return null; }
    const height = element.getBoundingClientRect().height;
    const scroll = readScroll();
    cancelMotion();
    if (reducedMotion() || !validHeight(height)) return null;
    return { owner, element, height, scroll };
  };

  const present = captured => {
    if (!captured || owner !== captured.owner || !captured.element.isConnected) return false;
    const toHeight = captured.element.getBoundingClientRect().height;
    restoreScroll(captured.scroll);
    if (!validHeight(toHeight) || Math.abs(toHeight - captured.height) < 1 || typeof captured.element.animate !== 'function') return false;
    const animation = captured.element.animate(
      [{ height: `${captured.height}px` }, { height: `${toHeight}px` }],
      { duration, easing },
    );
    captured.element.classList.add('history-selection-transitioning');
    motion = { animation, element: captured.element, owner: captured.owner };
    animation.onfinish = () => clearMotion(animation);
    animation.oncancel = () => clearMotion(animation);
    return true;
  };

  const finish = token => {
    if (owner !== token) return false;
    owner = null;
    return true;
  };

  const run = async (scope, select) => {
    const token = begin(scope);
    try {
      return await select();
    } finally {
      finish(token);
    }
  };

  const cancel = () => {
    owner = null;
    generation += 1;
    cancelMotion();
  };

  return { begin, capture, present, finish, run, cancel };
}
