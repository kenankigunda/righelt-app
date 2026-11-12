// Rendered semantics here. Actual cascade/paint/native geometry use commander-floor.spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDER_WINDOW,PIECE_PATHS,renderPieceSymbol} from '../piece-symbols.js';
test('actual commander rendering retains its enclosed native window and independent opaque floor patch',()=>{
 assert.deepEqual(COMMANDER_WINDOW,{x:6,y:11,width:12,height:5,size:24});
 const html=renderPieceSymbol('commander');
 assert.match(html,/<span class="commander-floor" aria-hidden="true"/);
 assert.match(html,/inset\(calc\(100% \* 11 \/ 24\) calc\(100% \* 6 \/ 24\) calc\(100% \* 8 \/ 24\) calc\(100% \* 6 \/ 24\)\)/);
 assert.match(html,/<rect class="commander-cutout" x="6" y="11" width="12" height="5" fill="transparent"/);
 assert(html.includes(`d="${PIECE_PATHS.commander}"`));assert.equal(PIECE_PATHS.commander,'M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M6 11H18V16H6Z');
 for(const kind of ['unit','supply'])assert(!renderPieceSymbol(kind).includes('commander-floor'));
});
