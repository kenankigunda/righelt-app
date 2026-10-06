// Shared, nestable viewport lock for modal surfaces. Flyouts that leave the
// page interactive do not acquire this lock.
const locks = new WeakMap();
export const lockOverlayScroll = (document) => {
  const view = document.defaultView;
  const root = document.documentElement;
  let state = locks.get(document);
  if (!state) {
    state = {count:0, x:view.scrollX, y:view.scrollY, overflow:root.style.overflow, overscroll:root.style.overscrollBehavior, gutter:root.style.scrollbarGutter};
    if(root.clientWidth < view.innerWidth) root.style.scrollbarGutter = 'stable';
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    locks.set(document, state);
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count) return;
    root.style.overflow = state.overflow;
    root.style.scrollbarGutter = state.gutter;
    root.style.overscrollBehavior = state.overscroll;
    locks.delete(document);
    view.scrollTo({left:state.x, top:state.y, behavior:'instant'});
  };
};
