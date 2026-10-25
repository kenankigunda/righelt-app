import test from 'node:test';
import assert from 'node:assert/strict';
import {stoneOutlinePoints,edgeProtectedRect} from '../shell/loading-edge.js';
test('stone geometry resolves the existing CSS polygon without duplicating its shape',()=>{
 assert.deepEqual(stoneOutlinePoints('polygon(18px 0,calc(100% - 28px) 0,100% 28px,0 100%)',320,600),[[18,0],[292,0],[320,28],[0,600]]);
 assert.deepEqual(stoneOutlinePoints('polygon(0 0,100% 0,100% 100%)',1440,800),[[0,0],[1440,0],[1440,800]]);
});
test('unsupported or empty outlines fail quiet instead of crossing the card content',()=>{
 for(const shape of ['none','polygon(0 0,foo bar,100% 100%)','polygon(0 0,10px 10px)','url(anything)'])assert.equal(stoneOutlinePoints(shape,320,600),null);
 assert.equal(stoneOutlinePoints('polygon(0 0,100% 0,100% 100%)',0,600),null);
});
test('content rectangles cut the perimeter mask with clearance, including external axis labels',()=>{
 assert.deepEqual(edgeProtectedRect({left:12,top:80,width:30,height:16},{left:16,top:50}),{x:-4,y:30,width:34,height:20});
});
