export const MOBILE_NAVIGATION = Object.freeze({ idleMs: 3000, hideDistance: 24, revealDistance: 12 });

export function mountMobileNavigation({ window, document, isNarrow, isBlocked = () => false }) {
  let visible = true, timer = null, previousY = Math.max(0, window.scrollY), distance = 0, direction = 0, destroyed = false, keyboardHandoff = false;
  const nav = () => document.querySelector('.shell-mobile-tabbar');
  const keyboardFocus = () => Boolean(nav()?.contains(document.activeElement) && (keyboardHandoff || document.activeElement?.matches(':focus-visible')));
  const render = () => {
    const element = nav();
    if (!element) return;
    const shown = visible && !isBlocked();
    element.dataset.visible = String(shown);
    element.querySelector('[data-mobile-nav-controls]')?.toggleAttribute('inert', !shown);
    element.querySelector('[data-mobile-nav-reveal]')?.setAttribute('aria-expanded', String(shown));
  };
  const schedule = () => {
    window.clearTimeout(timer);
    if (!isNarrow() || destroyed) return;
    timer = window.setTimeout(() => {
      if (keyboardFocus() || nav()?.matches(':hover') && window.matchMedia('(hover:hover)').matches) { schedule(); return; }
      visible = false; render();
    }, MOBILE_NAVIGATION.idleMs);
  };
  const resetScroll = () => { previousY = Math.max(0, window.scrollY); distance = 0; direction = 0; };
  const reveal = () => { resetScroll(); visible = true; render(); schedule(); };
  const onScroll = () => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const current = Math.min(maximum, Math.max(0, window.scrollY));
    const delta = current - previousY; previousY = current;
    if (!isNarrow() || !delta || keyboardFocus()) return;
    const next = Math.sign(delta);
    distance = next === direction ? distance + Math.abs(delta) : Math.abs(delta); direction = next;
    if (next < 0 && distance >= MOBILE_NAVIGATION.revealDistance) reveal();
    else if (next > 0 && distance >= MOBILE_NAVIGATION.hideDistance) { visible = false; render(); }
  };
  const onClick = event => { if (event.target.closest('[data-mobile-nav-reveal]')) reveal(); else schedule(); };
  const onFocus = () => {
    if (!nav()?.contains(document.activeElement)) keyboardHandoff = false;
    if (keyboardFocus()) reveal();
  };
  const onKeyDown = event => {
    const target = document.activeElement;
    if (event.isTrusted && event.key === 'Tab' && !event.defaultPrevented && !event.shiftKey && !event.ctrlKey && !event.metaKey &&
        isNarrow() && !isBlocked() && event.target === target && nav()?.contains(target) && target?.matches('[data-mobile-nav-reveal]')) {
      // Native default traversal may scroll before focusin/:focus-visible.
      keyboardHandoff = true; reveal();
    }
  };
  const onKeyUp = event => { if (event.isTrusted && event.key === 'Tab') keyboardHandoff = false; };
  const onPointerDown = event => { if (event.isTrusted) keyboardHandoff = false; };
  const onBlur = () => { keyboardHandoff = false; };
  const onResize = () => { resetScroll(); render(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('click', onClick);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('blur', onBlur);
  return {
    sync: render,
    reveal,
    restoreScroll(top) {
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' }); resetScroll();
      // Scroll events are asynchronous. Reset from the restored offset immediately.
      reveal();
    },
    destroy() {
      destroyed = true; keyboardHandoff = false; window.clearTimeout(timer);
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize);
      document.removeEventListener('click', onClick); document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp); document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', onBlur);
    },
  };
}
