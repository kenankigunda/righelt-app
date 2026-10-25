import test from 'node:test';
import assert from 'node:assert/strict';
import {createResultPresentation,renderResultMark,resultSound} from '../shell/result-presentation.js';

const fixture=()=>{let time=0,reduced=false;const motions=[];const mark={animate(frames,options){const motion={frames,options,currentTime:0,cancel(){this.cancelled=true;}};motions.push(motion);return motion;}};const root=()=>({querySelector:()=>mark,querySelectorAll:()=>[]});return{root,motions,time:value=>time=value,reduced:()=>reduced=true,controller:createResultPresentation({now:()=>time,reducedMotion:()=>reduced})};};
test('only observed live entry animates once, replacement DOM preserves elapsed time, and navigation cancels',()=>{
 const f=fixture();f.controller.mount(f.root(),'g');assert.equal(f.motions.length,0);
 f.controller.enter('g',{tone:'victory'});const root=f.root();f.controller.mount(root,'g');assert.equal(f.motions.length,1);
 f.time(350);f.controller.mount(root,'g');assert.equal(f.motions.length,1);
 f.controller.mount(f.root(),'g');assert.equal(f.motions[1].currentTime,350);
 f.time(1100);f.controller.mount(f.root(),'g');assert.equal(f.motions.length,2);
 f.controller.clear();assert(f.motions.every(motion=>motion.cancelled));f.controller.mount(f.root(),'g');assert.equal(f.motions.length,2);
});
test('defeat settles gently, while reduced motion, draws and spectators remain static',()=>{
 const f=fixture();f.controller.enter('g',{tone:'defeat'});f.controller.mount(f.root(),'g');assert.equal(f.motions[0].options.duration,650);
 f.reduced();f.controller.enter('g',{tone:'victory'});f.controller.mount(f.root(),'g');assert.equal(f.motions.length,1);
 for(const tone of ['draw','neutral']){const v=fixture();v.controller.enter('g',{tone});v.controller.mount(v.root(),'g');assert.equal(v.motions.length,0);}
});
test('perspective copy is accessible and visual ornaments never become actions',()=>{
 for(const tone of ['victory','defeat','draw','neutral']){const html=renderResultMark({tone});assert.match(html,/<svg[^>]*aria-hidden="true"/);assert.doesNotMatch(html,/result-perspective/);assert.doesNotMatch(html,/button|data-action|tabindex/);}
 assert.equal(resultSound({tone:'victory'}),'result-victory');assert.equal(resultSound({tone:'defeat'}),'result-defeat');assert.equal(resultSound({tone:'draw'}),'result-draw');assert.equal(resultSound({tone:'neutral'}),'result');
});
