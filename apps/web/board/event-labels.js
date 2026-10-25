/** Compact presentation only. Legacy commander metadata does not prove a cause. */
export function destructionLabel(record) {
  if (record?.reason === "loss_of_supply") return "Lost supply";
  if (record?.reason === "no_retreat") return "No retreat";
  return "Destroyed";
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlap = (a, b) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** Rectangles use layout-viewport coordinates, including visual viewport offsets. */
export function placeEventLabels({ viewport, items, margin = 8, gap = 6 }) {
  const left = viewport.left + margin;
  const top = viewport.top + margin;
  const right = viewport.left + viewport.width - margin;
  const bottom = viewport.top + viewport.height - margin;
  if (right <= left || bottom <= top) return [];
  const placed = [];

  for (const item of items) {
    const width = Math.min(item.width, right - left);
    const height = Math.min(item.height, bottom - top);
    const anchor = item.anchor;
    if (!anchor || ["left", "top", "right", "bottom"].some(key => !Number.isFinite(anchor[key])) ||
        !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    const center = (anchor.left + anchor.right) / 2;
    const candidates = [];
    for (let lane = 0; lane <= items.length; lane++) {
      candidates.push({ left: center - width / 2, top: anchor.top - gap - height - lane * (height + gap), placement: "top" });
      candidates.push({ left: center - width / 2, top: anchor.bottom + gap + lane * (height + gap), placement: "bottom" });
    }
    candidates.push({ left: anchor.right + gap, top: (anchor.top + anchor.bottom - height) / 2, placement: "right" });
    candidates.push({ left: anchor.left - gap - width, top: (anchor.top + anchor.bottom - height) / 2, placement: "left" });

    let best;
    for (const candidate of candidates) {
      const rect = {
        ...candidate, id: item.id,
        left: clamp(candidate.left, left, right - width),
        top: clamp(candidate.top, top, bottom - height), width, height,
      };
      const collisions = placed.reduce((sum, other) => sum + overlap({
        left: rect.left - gap / 2, top: rect.top - gap / 2,
        width: width + gap, height: height + gap,
      }, other), 0);
      const shift = Math.abs(rect.left - candidate.left) + Math.abs(rect.top - candidate.top);
      const distance = Math.abs(rect.top + height / 2 - (anchor.top + anchor.bottom) / 2) +
        Math.abs(rect.left + width / 2 - center);
      const score = collisions * 1000 + shift * 2 + distance + (candidate.placement === "top" ? 0 : 1);
      if (!best || score < best.score) best = { rect, score };
    }
    placed.push(best.rect);
  }
  return placed;
}
