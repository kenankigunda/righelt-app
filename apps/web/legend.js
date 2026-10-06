export function getCommandLegendColor(snapshot, selectedPieceId = null) {
  const selectedPiece =
    snapshot?.pieces?.find?.((piece) => piece.id === selectedPieceId) ?? null;
  const owner = selectedPiece?.owner ?? snapshot?.sideToMove ?? "P1";
  return owner === "P2" ? "var(--player-p2)" : "var(--player-p1)";
}

export function getCommandLegendSwatchStyle(snapshot, selectedPieceId = null) {
  return `--swatch-command-color: ${getCommandLegendColor(snapshot, selectedPieceId)};`;
}

export function applyCommandLegendSwatch(element, snapshot, selectedPieceId = null) {
  if (!element) {
    return;
  }
  element.style.setProperty("--swatch-command-color", getCommandLegendColor(snapshot, selectedPieceId));
}

// Ignore identical visual updates so ordinary board renders cannot interrupt motion.
export function updateLegendVisibility(legend, visible, reducedMotion = false) {
  if (!legend) return;
  const changes = Object.entries(visible).flatMap(([key, value]) => {
    const item = legend.querySelector(`[data-legend-entry="${key}"]`);
    return item && item.hidden === value ? [{ item, hidden: !value }] : [];
  });
  if (!changes.length) return;
  const from = legend.getBoundingClientRect().height;
  legend.getAnimations().forEach(animation => animation.cancel());
  for (const { item, hidden } of changes) item.hidden = hidden;
  const to = legend.scrollHeight;
  if (!reducedMotion && from !== to) {
    legend.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 180, easing: 'ease-out' });
  }
}
