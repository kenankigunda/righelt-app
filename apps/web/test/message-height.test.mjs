import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageHeightController} from '../board/message-height.js';

function fixture(){
 const events=()=>({handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn);},removeEventListener(type){this.handlers.delete(type);}});
 const frames=new Map(),animations=[],observers=[];let id=0,current=40,rendered=75,width=400;
 const motion={...events(),matches:false},fonts=events(),doc={...events(),fonts};
 const win={...events(),requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},matchMedia:()=>motion,
  ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}},
  MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}}};
 doc.defaultView=win;
 const live={getBoundingClientRect:()=>({height:current})};
 const replicas=[['primary',70],['fallback',75]].map(([font,height])=>({dataset:{sizingFont:font},getBoundingClientRect:()=>({height})}));
 const slot={dataset:{},isConnected:true,style:{removeProperty(key){delete this[key];}},querySelector:()=>live,querySelectorAll:()=>replicas,getBoundingClientRect:()=>({height:rendered,width}),animate(keys,options){const a={keys,options,cancel(){this.canceled=true;}};animations.push(a);return a;}};
 const button={disabled:false,textContent:'Next',hasAttribute:name=>name==='data-board-message-action',getAttribute:name=>name==='data-board-message-action'?'replay-next':null};
 doc.createElement=()=>({innerHTML:'',querySelectorAll(){return this.innerHTML.includes('Next')?[{disabled:this.innerHTML.includes('disabled'),textContent:'Next',getAttribute:name=>name==='data-board-message-action'?'replay-next':null}]:[];}});
 const label={...events(),ownerDocument:doc,closest:()=>slot,contains:node=>node===button};
 const controller=createMessageHeightController(label);
 const flush=()=>{for(const fn of frames.values()){frames.clear();fn();}};
 return{controller,slot,label,doc,win,fonts,motion,animations,observers,frames,button,flush,setWidth:value=>{width=value;},change(height,liveHeight=height){current=height;rendered=liveHeight;observers[0].fn();flush();}};
}
test('controller preserves native press geometry, retargets from rendered height and cleans every owner',()=>{
 const f=fixture();assert.equal(f.slot.style.height,'75px');assert.equal(f.animations.length,0);
 f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.button}});
 f.change(160,75);assert.equal(f.slot.style.height,'75px');assert.equal(f.animations.length,0);
 f.doc.handlers.get('pointerup')({type:'pointerup'});f.flush();assert.equal(f.slot.style.height,'160px');assert.equal(f.animations[0].options.duration,450);
 f.change(90,112);assert.deepEqual(f.animations[1].keys,[{height:'112px'},{height:'90px'}]);assert.equal(f.animations[1].options.duration,280);assert.equal(f.animations[0].canceled,true);
 f.fonts.handlers.get('loadingdone')();f.flush();assert.equal(f.animations[1].canceled,true);assert.equal(f.animations.length,2);
 f.observers[1].fn();assert.equal(f.frames.size,1);f.controller.destroy();assert.equal(f.frames.size,0);assert(f.observers.every(x=>x.closed));assert.equal(f.label.handlers.size,0);assert.equal(f.doc.handlers.size,0);assert.equal(f.win.handlers.size,0);assert.equal(f.fonts.handlers.size,0);assert.equal(f.motion.handlers.size,0);assert.equal(f.slot.dataset.heightManaged,undefined);
});

test('container-only width changes snap and retired presses cannot leave height deferred',()=>{
 for(const retirement of ['blur','visibilitychange']){
  const f=fixture();f.change(160,75);assert.equal(f.animations.length,1);
  f.setWidth(300);f.change(190,110);assert.equal(f.slot.style.height,'190px');assert.equal(f.animations.length,1);assert.equal(f.animations[0].canceled,true);
  f.doc.handlers.get('keydown')({type:'keydown',key:'Enter',target:{closest:()=>f.button}});
  f.change(210,190);assert.equal(f.slot.style.height,'190px');
  (retirement==='blur'?f.win:f.doc).handlers.get(retirement)();f.flush();assert.equal(f.slot.style.height,'210px');assert.equal(f.animations.length,1);
  f.controller.destroy();
 }
});

test('same action defers wrapping content until after release while changed availability cancels deferral',()=>{
 const f=fixture();let published=0;
 f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.button}});
 assert.equal(f.controller.deferContent('Longer prose Next',()=>published++),true);assert.equal(published,0);
 f.doc.handlers.get('pointerup')({type:'pointerup'});assert.equal(published,0);f.flush();assert.equal(published,1);
 f.doc.handlers.get('keydown')({type:'keydown',key:' ',target:{closest:()=>f.button}});
 assert.equal(f.controller.deferContent('Another prose Next',()=>published++),true);
 assert.equal(f.controller.deferContent('Next disabled',()=>published++),false);
 f.doc.handlers.get('keyup')({type:'keyup',key:' '});f.flush();assert.equal(published,1,'obsolete same-action prose is not published after genuine availability changes');f.controller.destroy();
});
