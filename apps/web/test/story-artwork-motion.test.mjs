import test from 'node:test';
import assert from 'node:assert/strict';
import {storyArtworkFrames,createStoryArtworkMotion,STORY_SWAP_DURATION} from '../shell/story-artwork-motion.js';

test('story motion preserves full scale through reverse anticipation and mirrors Back',()=>{
 const forward=storyArtworkFrames(1),back=storyArtworkFrames(-1);
 assert.equal(STORY_SWAP_DURATION,760);
 assert.equal(forward.outgoing[1].offset,.2);assert.equal(forward.outgoing[1].transform,'translateX(6%)');
 assert.equal(forward.incoming[1].transform,'translateX(118%)');assert.equal(forward.incoming.at(-1).transform,'translateX(0%)');
 assert.equal(back.outgoing[1].transform,'translateX(-6%)');assert.equal(back.outgoing.at(-1).transform,'translateX(112%)');
 for(const frames of [forward.outgoing,forward.incoming,back.outgoing,back.incoming])for(const frame of frames){assert.equal(frame.opacity,1);assert.doesNotMatch(frame.transform,/scale|rotate/);assert.equal(frame.filter,undefined);}
});

const image=()=>({animations:[],animate(frames,options){let resolve,reject;const animation={frames,options,canceled:false,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),finish:()=>resolve(),cancel(){this.canceled=true;reject(new Error('canceled'));}};this.animations.push(animation);return animation;}});
test('rapid replacement samples rendered transforms and retires only owned animation effects',async()=>{
 const first=image(),second=image(),third=image(),styles=new Map();
 const motion=createStoryArtworkMotion({getStyle:node=>({transform:styles.get(node)??'none'}),reducedMotion:()=>false});
 motion.swap(first,second,1);const old=[first.animations[0],second.animations[0]];
 styles.set(second,'matrix(1, 0, 0, 1, 40, 0)');motion.swap(second,third,-1);
 assert.ok(old.every(animation=>animation.canceled));assert.equal(second.animations[1].frames[0].transform,'matrix(1, 0, 0, 1, 40, 0)');
 assert.equal(third.animations[0].options.fill,'both');assert.equal(third.animations[0].options.duration,760);
 second.animations[1].finish();third.animations[0].finish();await Promise.resolve();await Promise.resolve();
 assert.equal(second.animations[1].canceled,true);assert.equal(third.animations[0].canceled,true);
 motion.cancel();
});

test('reduced motion and retirement never leave a delayed or stale artwork owner',async()=>{
 const first=image(),second=image();let reduced=true;
 const motion=createStoryArtworkMotion({getStyle:()=>({transform:'none'}),reducedMotion:()=>reduced});
 motion.swap(first,second,1);assert.equal(first.animations.length,0);assert.equal(second.animations.length,0);
 reduced=false;motion.swap(first,second,1);motion.cancel();assert.ok(first.animations[0].canceled);assert.ok(second.animations[0].canceled);
 await Promise.resolve();motion.swap(second,first,-1);assert.equal(first.animations[1].canceled,false);motion.cancel();
});


test('changing reduced motion settles active effects and disposal removes its preference owner',async()=>{
 const handlers=new Map(),preference={matches:false,addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type)};
 const first=image(),second=image(),motion=createStoryArtworkMotion({motionPreference:preference,getStyle:()=>({transform:'none'})});
 motion.swap(first,second,1);preference.matches=true;handlers.get('change')();assert.equal(first.animations[0].canceled,true);assert.equal(second.animations[0].canceled,true);
 motion.swap(second,first,-1);assert.equal(first.animations.length,1);motion.destroy();assert.equal(handlers.size,0);await Promise.resolve();
});
