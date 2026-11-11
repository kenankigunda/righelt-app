// Source contract only. Native textured-pixel/cascade/geometry proof is pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMANDER_WINDOW,PIECE_PATHS,renderPieceSymbol} from '../piece-symbols.js';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('actual commander rendering retains its enclosed native window and independent opaque floor patch',()=>{
 assert.deepEqual(COMMANDER_WINDOW,{x:6,y:11,width:12,height:5,size:24});
 const html=renderPieceSymbol('commander');
 assert.match(html,/<span class="commander-floor" aria-hidden="true"/);
 assert.match(html,/inset\(calc\(100% \* 11 \/ 24\) calc\(100% \* 6 \/ 24\) calc\(100% \* 8 \/ 24\) calc\(100% \* 6 \/ 24\)\)/);
 assert.match(html,/<rect class="commander-cutout" x="6" y="11" width="12" height="5" fill="transparent"/);
 assert(html.includes(`d="${PIECE_PATHS.commander}"`));assert.equal(PIECE_PATHS.commander,'M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M6 11H18V16H6Z');
 for(const kind of ['unit','supply'])assert(!renderPieceSymbol(kind).includes('commander-floor'));
});
test('cell and commander share texture paint while current miniature footprints and semantic rings remain',()=>{
 const css=read('../styles.css'),refresh=read('../shell/refresh.css'),shell=read('../shell/shell.css');
 for(const declaration of ['background-color:var(--cell-floor-color)','background-image:var(--cell-floor-image)','background-size:var(--cell-floor-size)']){
  assert(css.replaceAll(' ','').includes(declaration));
 }
 assert.match(css,/background-position:\s*center;/);assert.match(css,/background-position:var\(--commander-floor-position,center\)/);
 assert.match(css,/--piece-size:\s*20px/);assert.match(shell,/--piece-size:\s*12px/);
 assert.match(css,/calc\(50% - var\(--piece-size\) \* \.22\) calc\(50% - var\(--piece-size\) \* \.32\)/);
 assert.doesNotMatch(refresh,/\.commander-cutout\s*\{[^}]*fill:var\(/);
 assert.doesNotMatch(refresh,/\.cell\.target\.target-side-p[12][^{]+\{[^}]*--player-p/);
 assert.match(css,/--move-source: #7650A6; --move-target: #1F7A5A/);
 assert.match(refresh,/\.mini-board-preview-wrap \.cell \{--cell-floor-image:none;\}/);
 assert.match(refresh,/--cell-floor-image:none;--cell-floor-color:Canvas/);
});
test('commander body owns existing removal opacity while floor needs no new layout observer',()=>{
 const css=read('../styles.css'),source=read('../piece-symbols.js');
 assert.match(css,/\.removal-piece\.commander \{animation-name:none;\}/);
 assert.match(css,/\.removal-piece\.commander \.piece-symbol \{animation-delay:inherit;\}/);
 assert.match(css,/animation:removal-piece-flash var\(--removal-flash-duration\) ease-in-out var\(--removal-flash-count\) alternate/);
 assert.doesNotMatch(source,/getBoundingClientRect|requestAnimationFrame|ResizeObserver|MutationObserver|setTimeout/);
});


test('actual rush-other CSS rule shares its opaque quiet floor with the commander patch',()=>{
 const css=read('../styles.css');
 const body=selector=>{const anchor=selector+' {',start=css.indexOf(anchor);assert.equal(css.split(anchor).length-1,1,selector);return css.slice(start+anchor.length,css.indexOf('}',start)).replace(/\s+/g,'');};
 const cell=body('.cell.rush-guidance-other'),patch=body('.cell .piece-token > .commander-floor');
 assert(!/(?:^|;)background:/.test(cell),'a shorthand must not reset only the real cell image');
 assert(cell.includes('--cell-floor-image:linear-gradient(var(--surface-hover-quiet),var(--surface-hover-quiet));'));
 for(const declaration of ['background-color:var(--cell-floor-color);','background-image:var(--cell-floor-image);']){assert(cell.includes(declaration));assert(patch.includes(declaration));}
 assert.match(css,/--cell-floor-color:\s*var\(--cell-fill\)/,'opaque cell substrate is shared, not the translucent wash alone');
 assert(!cell.includes('--cell-floor-color:var(--surface-hover-quiet)'));
});
test('commander SVG hole segment is derived from the same window source with exact external path bytes',()=>{
 const source=read('../piece-symbols.js');
 assert(source.indexOf('export const COMMANDER_WINDOW')<source.indexOf('export const PIECE_PATHS'));
 assert(source.includes('M${x} ${y}H${x+width}V${y+height}H${x}Z'));
 assert.equal(PIECE_PATHS.commander,'M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M6 11H18V16H6Z');
});
