import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageHeightController} from '../board/message-height.js';

function fixture(initialPadding=0){
 const events=()=>({handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn);},removeEventListener(type){this.handlers.delete(type);}});
 const frames=new Map(),animations=[],observers=[];let id=0,current=40,rendered=75,width=400,padding=initialPadding,buttonTop=10;
 const motion={...events(),matches:false},fonts=events(),doc={...events(),fonts};
 const win={...events(),requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},matchMedia:()=>motion,
  ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}},
  MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}}};
 doc.defaultView=win;
 win.getComputedStyle=node=>node===slot?{paddingTop:String(slot.dataset.heightManaged==='true'?padding:0),paddingBottom:String(slot.dataset.heightManaged==='true'?padding:0)}:node===button?{outlineWidth:'2px',outlineOffset:'2px'}:{fontSize:'16px',fontFamily:'Manrope',lineHeight:'24px'};
 const live={getBoundingClientRect:()=>({height:current})};
 const replicas=[['primary',70],['fallback',75]].map(([font,height])=>({dataset:{sizingFont:font},getBoundingClientRect:()=>({height})}));
 const slot={dataset:{},isConnected:true,style:{removeProperty(key){delete this[key];}},querySelector:()=>live,querySelectorAll:()=>replicas,getBoundingClientRect:()=>({height:rendered,width,top:0,bottom:rendered}),animate(keys,options){const a={keys,options,cancel(){this.canceled=true;}};animations.push(a);return a;}};
 const button={matches:selector=>selector==='button',getBoundingClientRect:()=>({top:buttonTop,height:38}),disabled:false,textContent:'Next',hasAttribute:name=>name==='data-board-message-action',getAttribute:name=>name==='data-board-message-action'?'replay-next':null};
 doc.createElement=()=>({innerHTML:'',querySelectorAll(){return this.innerHTML.includes('Next')?[{disabled:this.innerHTML.includes('disabled'),textContent:'Next',getAttribute:name=>name==='data-board-message-action'?'replay-next':null}]:[];}});
 const label={...events(),ownerDocument:doc,closest:()=>slot,contains:node=>node===button};
 const controller=createMessageHeightController(label);
 const flush=()=>{for(const fn of frames.values()){frames.clear();fn();}};
 return{controller,slot,label,doc,win,fonts,motion,animations,observers,frames,button,flush,setPadding:value=>{padding=value;},setCurrent:value=>{current=value;},setButtonTop:value=>{buttonTop=value;},setWidth:value=>{width=value;},setRendered:value=>{rendered=value;},change(height,liveHeight=height){current=height;rendered=liveHeight;observers[0].fn();flush();}};
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

test('press onset freezes an already running height animation at the actual interpolated box',()=>{
 const f=fixture();f.change(160,75);f.setRendered(112);
 f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.button}});
 assert.equal(f.animations[0].canceled,true);assert.equal(f.slot.style.height,'112px');
 f.doc.handlers.get('pointerup')({type:'pointerup'});f.flush();
 assert.deepEqual(f.animations[1].keys,[{height:'112px'},{height:'160px'}]);f.controller.destroy();
});


test('outer paint guard is shared immediately by natural copy and both routine families',()=>{
 const f=fixture(4);assert.equal(f.slot.dataset.heightManaged,'true');
 assert.equal(f.slot.style.height,'83px');
 f.change(160,83);assert.equal(f.slot.style.height,'168px');
 f.controller.destroy();assert.equal(f.slot.style.height,undefined);assert.equal(f.slot.dataset.heightManaged,undefined);
});

test('surviving focused action publishes synchronously and snaps only when its full footprint would clip',()=>{
 const f=fixture();f.doc.activeElement=f.button;let publications=0;
 const publish=()=>{publications++;assert.equal(f.controller.deferContent('Longer Next',publish),false);f.setCurrent(180);f.setButtonTop(130);};
 assert.equal(f.controller.deferContent('Longer Next',publish),true);
 assert.equal(publications,1);assert.equal(f.slot.style.height,'180px');assert.equal(f.animations.length,0);assert.equal(f.doc.activeElement,f.button);
 f.setRendered(180);f.setButtonTop(10);
 assert.equal(f.controller.deferContent('Shorter Next',()=>{f.setCurrent(100);}),true);
 f.observers[0].fn();f.flush();assert.equal(f.animations.length,1);assert.equal(f.animations[0].options.duration,280);
 f.controller.destroy();
});

test('focused publication does not resurrect a disabled or removed action and always retires its reentry guard',()=>{
 const f=fixture();f.doc.activeElement=f.button;
 assert.equal(f.controller.deferContent('Next',()=>{f.button.disabled=true;}),true);assert.equal(f.slot.style.height,'75px');
 f.button.disabled=false;
 assert.throws(()=>f.controller.deferContent('Next',()=>{throw Error('publication');}),/publication/);
 assert.equal(f.controller.deferContent('Next',()=>{f.doc.activeElement=null;}),true);
 assert.equal(f.slot.style.height,'75px');f.controller.destroy();
});
