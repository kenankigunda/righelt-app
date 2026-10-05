// Observe content, not the animated box: height animation must not trigger itself.
export const animateDialogSize = (dialog, {
  Observer = globalThis.ResizeObserver,
  motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),
} = {}) => {
  let previousHeight = 0, animation = null;
  // CSS height is unzoomed; screen rectangles include CSS zoom and transforms.
  const height = () => {
    const cssHeight = Number.parseFloat(globalThis.getComputedStyle?.(dialog).height);
    return Number.isFinite(cssHeight) ? cssHeight : dialog.getBoundingClientRect().height;
  };
  const reset = () => {
    animation?.cancel();
    animation = null;
    previousHeight = 0;
  };
  const resize = () => {
    if (!dialog.open) { reset(); return; }
    const from = animation ? height() : previousHeight;
    animation?.cancel();
    animation = null;
    // Removing the previous animation reveals the natural, viewport-bounded size.
    const to = height();
    previousHeight = to;
    if (!from || Math.abs(from - to) < 1 || motion?.matches || !dialog.animate) return;
    const current = dialog.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 180, easing: "ease-out",
    });
    animation = current;
    current.finished.then(() => {
      if (animation === current) animation = null;
    }, () => {});
  };
  const observer = Observer ? new Observer(resize) : null;
  motion?.addEventListener("change", () => {
    if (motion.matches) { reset(); if (dialog.open) previousHeight = height(); }
  });
  return {
    refresh() {
      observer?.disconnect();
      const content = dialog.querySelector("form");
      if (content) observer?.observe(content);
    },
    reset() { observer?.disconnect(); reset(); },
  };
};
