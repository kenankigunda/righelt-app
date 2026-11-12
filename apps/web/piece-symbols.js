// Approved Cut stone family. Geometry scales within the existing token footprint.
// This window is shared by the SVG hole and its cell-floor occlusion patch.
export const COMMANDER_WINDOW = Object.freeze({x:6,y:11,width:12,height:5,size:24});
const {x,y,width,height,size}=COMMANDER_WINDOW;
export const PIECE_PATHS = Object.freeze({
  unit:'M6 0H18L24 6V18L18 24H6L0 18V6Z',
  commander:`M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M${x} ${y}H${x+width}V${y+height}H${x}Z`,
  supply:'M9 0H15V6H19V12H24V24H16V16H8V24H0V12H5V6H9Z',
});
// Quiet veins remain inside the native faces, away from windows and arches.
const PIECE_MINERAL = Object.freeze({
  unit:'M3 10C8 8 6 15 13 14S17 19 21 17M10 3Q14 7 12 10M7 15L5 19',
  commander:'M8 5Q12 7 16 5M4 18Q8 20 12 18M15 19Q18 21 22 21',
  supply:'M10 3Q13 4 14 7M3 15Q5 18 5 22M18 14Q20 17 21 21',
});
const floorClip=`inset(calc(100% * ${y} / ${size}) calc(100% * ${size-x-width} / ${size}) calc(100% * ${size-y-height} / ${size}) calc(100% * ${x} / ${size}))`;
export const renderPieceSymbol = kind => `${kind === 'commander' ? `<span class="commander-floor" aria-hidden="true" style="clip-path:${floorClip}"></span>` : ''}<svg class="piece-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${kind === 'commander' ? `<rect class="commander-cutout" x="${x}" y="${y}" width="${width}" height="${height}" fill="transparent"/>` : ''}<path class="piece-body" fill-rule="evenodd" d="${PIECE_PATHS[kind] || PIECE_PATHS.unit}"/><path class="piece-mineral" d="${PIECE_MINERAL[kind] || PIECE_MINERAL.unit}"/></svg>`;
