import { destructionLabel, placeEventLabels } from "./event-labels.js";

/** The caller supplies active events. Runtime expiry remains the only event clock. */
export function createBoardEventLabels({ boardEl, portalRoot = boardEl.ownerDocument.body }) {
  const doc = boardEl.ownerDocument;
  const view = doc.defaultView;
  const entries = new Map();
  let layer = null, frame = null, scope, destroyed = false, positions = [];

  const viewport = () => {
    const visual = view.visualViewport;
    return {
      left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
      width: visual?.width ?? view.innerWidth, height: visual?.height ?? view.innerHeight,
    };
  };
  const removeEntry = entry => {
    resize?.unobserve(entry.node);
    entry.node.remove();
  };
  const clear = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    for (const entry of entries.values()) removeEntry(entry);
    entries.clear();
    layer?.remove();
    layer = null;
    positions = [];
  };
  const unavailable = () => !boardEl.isConnected || doc.hidden ||
    Boolean(boardEl.closest('[hidden],[inert],[aria-hidden="true"]')) ||
    boardEl.dataset.interactionMode === "static" || !boardEl.getClientRects().length ||
    view.getComputedStyle(boardEl).visibility === "hidden";

  const paint = () => {
    frame = null;
    if (destroyed) return;
    if (unavailable()) { clear(); return; }
    const bounds = viewport();
    const items = [];
    for (const [id, entry] of entries) {
      const anchor = entry.anchorEl;
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      const visible = rect && rect.right > bounds.left && rect.left < bounds.left + bounds.width &&
        rect.bottom > bounds.top && rect.top < bounds.top + bounds.height;
      entry.node.hidden = !visible;
      entry.node.style.visibility = "hidden";
      if (!visible) continue;
      entry.node.style.maxWidth = `${Math.max(1, bounds.width - 16)}px`;
      entry.node.style.maxHeight = `${Math.max(1, bounds.height - 16)}px`;
      const measured = entry.node.getBoundingClientRect();
      items.push({ id, anchor: rect, width: measured.width, height: measured.height });
    }
    positions = placeEventLabels({ viewport: bounds, items });
    for (const position of positions) {
      const node = entries.get(position.id).node;
      node.style.left = `${position.left}px`;
      node.style.top = `${position.top}px`;
      node.dataset.placement = position.placement;
      node.style.visibility = "visible";
    }
  };
  const schedule = () => {
    if (!destroyed && frame === null && entries.size) frame = view.requestAnimationFrame(paint);
  };
  const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(schedule) : null;
  resize?.observe(boardEl);
  const mutation = typeof view.MutationObserver === "function" ? new view.MutationObserver(schedule) : null;
  for (let ancestor = boardEl; ancestor; ancestor = ancestor.parentElement) {
    mutation?.observe(ancestor, {
      attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style", "data-interaction-mode"],
      childList: true,
    });
  }
  view.addEventListener("resize", schedule);
  view.addEventListener("scroll", schedule, true);
  view.visualViewport?.addEventListener("resize", schedule);
  view.visualViewport?.addEventListener("scroll", schedule);
  const visibility = () => { if (doc.hidden) clear(); else schedule(); };
  doc.addEventListener("visibilitychange", visibility);
  doc.fonts?.addEventListener("loadingdone", schedule);
  void doc.fonts?.ready?.then(schedule);

  return {
    update({ scope: nextScope, events = [], enabled = true }) {
      if (destroyed) return;
      if (scope !== nextScope) { clear(); scope = nextScope; }
      if (!enabled) { clear(); return; }
      const next = new Map(events.filter(event => event?.id != null && event.anchorEl).map(event => [event.id, event]));
      for (const [id, entry] of entries) {
        if (!next.has(id)) { removeEntry(entry); entries.delete(id); }
      }
      if (!next.size) { clear(); return; }
      if (!layer) {
        layer = doc.createElement("div");
        layer.className = "board-event-label-layer";
        layer.setAttribute("aria-hidden", "true");
        layer.inert = true;
        Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none" });
        portalRoot.appendChild(layer);
      }
      for (const [id, event] of next) {
        let entry = entries.get(id);
        if (!entry) {
          const node = doc.createElement("span");
          node.className = "board-event-label";
          node.setAttribute("role", "presentation");
          Object.assign(node.style, { position: "absolute", boxSizing: "border-box", visibility: "hidden", pointerEvents: "none" });
          layer.appendChild(node);
          entry = { node };
          entries.set(id, entry);
          resize?.observe(node);
        }
        entry.anchorEl = event.anchorEl;
        const text = destructionLabel(event.record);
        if (entry.node.textContent !== text) entry.node.textContent = text;
      }
      schedule();
    },
    clear,
    positions: () => positions.map(position => ({ ...position })),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      resize?.disconnect();
      mutation?.disconnect();
      view.removeEventListener("resize", schedule);
      view.removeEventListener("scroll", schedule, true);
      view.visualViewport?.removeEventListener("resize", schedule);
      view.visualViewport?.removeEventListener("scroll", schedule);
      doc.removeEventListener("visibilitychange", visibility);
      doc.fonts?.removeEventListener("loadingdone", schedule);
    },
  };
}
