import test from 'node:test';
import assert from 'node:assert/strict';
import { lockOverlayScroll } from '../shell/overlay-scroll.js';
test('nested overlays retain one original position and restore existing styles only on final close',()=>{
 const restored=[];
 const document={documentElement:{style:{overflow:'auto',overscrollBehavior:'contain'}},defaultView:{scrollX:4,scrollY:650,scrollTo:p=>restored.push(p)}};
 const first=lockOverlayScroll(document), second=lockOverlayScroll(document);
 assert.equal(document.documentElement.style.overflow,'hidden');
 first();first();assert.equal(restored.length,0);
 second();assert.deepEqual(restored,[{left:4,top:650,behavior:'instant'}]);
 assert.equal(document.documentElement.style.overflow,'auto');assert.equal(document.documentElement.style.overscrollBehavior,'contain');
});
