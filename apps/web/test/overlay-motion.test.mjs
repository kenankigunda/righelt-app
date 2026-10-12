import test from 'node:test';
import assert from 'node:assert/strict';
import {overlaySourceFrames} from '../shell/overlay-motion.js';
test('source-linked overlay motion starts at the card center with uniform scale',()=>{
 const frames=overlaySourceFrames({left:100,top:100,width:800,height:400},{left:20,top:500,width:200,height:160});
 assert.deepEqual(frames,[{transform:'translate(-380px, 280px) scale(0.25)',opacity:0},{transform:'translate(0px, 0px) scale(1)',opacity:1}]);
});
test('missing or empty sources do not invent a motion origin',()=>{
 assert.equal(overlaySourceFrames({width:800,height:400},null),null);
 assert.equal(overlaySourceFrames({width:800,height:400},{width:0,height:20}),null);
});
