import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRevealScrollDelta} from '../shell/history-reveal.js';

test('History reveal scrolls only the overflow needed to expose a selected preview',()=>{
 assert.equal(historyRevealScrollDelta({top:200,bottom:650,visibleBottom:500}),150);
 assert.equal(historyRevealScrollDelta({top:120,bottom:480,visibleBottom:500}),0);
 assert.equal(historyRevealScrollDelta({top:-20,bottom:300,visibleBottom:500}),-32);
});
