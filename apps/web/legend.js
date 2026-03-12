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
