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

test('only changing active ancestor transforms need continuous measurements',async()=>{
 const {isMovingEdgeTransform}=await import('../shell/loading-edge.js');
 const animation=(frames,playState='running')=>({playState,effect:{getKeyframes:()=>frames}});
 assert.equal(isMovingEdgeTransform(animation([{transform:'translateX(0px)'},{transform:'translateX(80px)'}])),true);
 assert.equal(isMovingEdgeTransform(animation([{opacity:0},{opacity:1}])),false);
 assert.equal(isMovingEdgeTransform(animation([{strokeDashoffset:'0px'},{strokeDashoffset:'-1000px'}])),false);
 assert.equal(isMovingEdgeTransform(animation([{transform:'none'},{transform:'none'}])),false);
 assert.equal(isMovingEdgeTransform(animation([{transform:'none'},{transform:'translateX(80px)'}],'paused')),false);
 assert.equal(isMovingEdgeTransform(animation([{transform:'none'},{transform:'translateX(80px)'}],'finished')),false);
});
test('track clipping respects each overflow axis without moving the protected face',async()=>{
 const {edgeViewportClip}=await import('../shell/loading-edge.js');
 const frame={left:-12,top:18,right:312,bottom:422},viewport={left:8,top:20,right:308,bottom:400};
 assert.deepEqual(edgeViewportClip(frame,viewport,true,false),[0,4,0,20]);
 assert.deepEqual(edgeViewportClip(frame,viewport,false,true),[2,0,22,0]);
 assert.deepEqual(edgeViewportClip(frame,viewport,true,true),[2,4,22,20]);
 assert.deepEqual(edgeViewportClip(frame,viewport,false,false),[0,0,0,0]);
});
