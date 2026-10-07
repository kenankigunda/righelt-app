// Approved Cut stone family. Geometry scales within the existing token footprint.
export const PIECE_PATHS = Object.freeze({
  unit:'M6 0H18L24 6V18L18 24H6L0 18V6Z',
  commander:'M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M6 11H18V16H6Z',
  supply:'M9 0H15V6H19V12H24V24H16V16H8V24H0V12H5V6H9Z',
});
export const renderPieceSymbol = kind => `<svg class="piece-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${kind === 'commander' ? '<rect class="commander-cutout" x="6" y="11" width="12" height="5" fill="transparent"/>' : ''}<path class="piece-body" fill-rule="evenodd" d="${PIECE_PATHS[kind] || PIECE_PATHS.unit}"/></svg>`;
