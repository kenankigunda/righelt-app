import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageHeightController} from '../board/message-height.js';

function fixture(initialPadding=0,initialFloor=75,{metrics=null,fontSize=16,initialWidth=400,rowLines=3,pattern=null}={}){
 const events=()=>({handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn);},removeEventListener(type){this.handlers.delete(type);}});
 const frames=new Map(),animations=[],observers=[];let id=0,current=40,rendered=initialFloor,width=initialWidth,padding=initialPadding,buttonTop=10,contextButtonTop=10,primary=initialFloor-5,fallback=initialFloor;
 const motion={...events(),matches:false},fonts=events(),doc={...events(),fonts};
 const win={...events(),requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},matchMedia:()=>motion,
  ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}},
  MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}}};
 doc.defaultView=win;
 win.getComputedStyle=node=>node===slot?{paddingTop:String(slot.dataset.heightManaged==='true'?padding:0),paddingBottom:String(slot.dataset.heightManaged==='true'?padding:0),getPropertyValue:name=>metrics?.[name]??''}:node===button||node===contextButton?{outlineWidth:'2px',outlineOffset:'2px'}:{fontSize:`${fontSize}px`,fontFamily:'Manrope',lineHeight:'24px',getPropertyValue:name=>name==='--board-message-row-lines'?String(rowLines):''};
 const live={getBoundingClientRect:()=>({height:current}),contains:node=>node===button||node===contextButton};
 const replicas=[['primary',70],['fallback',75]].map(([font,height])=>({dataset:{sizingFont:font,...(pattern?{promptPattern:pattern}:{})},getBoundingClientRect:()=>({height:font==='primary'?primary:fallback})}));
 const slot={dataset:{},isConnected:true,style:{removeProperty(key){delete this[key];}},querySelector:()=>live,querySelectorAll:()=>replicas,getBoundingClientRect:()=>({height:rendered,width,top:0,bottom:rendered}),animate(keys,options){const a={keys,options,cancel(){this.canceled=true;}};animations.push(a);return a;}};
 const button={matches:selector=>selector==='button',getBoundingClientRect:()=>({top:buttonTop,height:38}),disabled:false,textContent:'Next',hasAttribute:name=>name==='data-board-message-action',getAttribute:name=>name==='data-board-message-action'?'replay-next':null};
 const contextButton={matches:selector=>selector==='button',getBoundingClientRect:()=>({top:contextButtonTop,height:38}),disabled:false,textContent:'Dismiss',hasAttribute:()=>false,getAttribute:()=>null};
 doc.createElement=()=>({innerHTML:'',querySelectorAll(){return this.innerHTML.includes('Next')?[{disabled:this.innerHTML.includes('disabled'),textContent:'Next',getAttribute:name=>name==='data-board-message-action'?'replay-next':null}]:[];}});
 const label={...events(),ownerDocument:doc,closest:()=>slot,contains:node=>node===button};
 const controller=createMessageHeightController(label);
 const flush=()=>{for(const fn of frames.values()){frames.clear();fn();}};
 return{controller,slot,label,doc,win,fonts,motion,animations,observers,frames,button,contextButton,flush,setFloors:(a,b)=>{primary=a;fallback=b;},setPadding:value=>{padding=value;},setCurrent:value=>{current=value;},setButtonTop:value=>{buttonTop=value;},setContextButtonTop:value=>{contextButtonTop=value;},setWidth:value=>{width=value;},setRendered:value=>{rendered=value;},change(height,liveHeight=height){current=height;rendered=liveHeight;observers[0].fn();flush();}};
}
test('controller fixes ordinary content geometry and defers finite-grammar metric changes until release',()=>{
 const f=fixture();assert.equal(f.slot.style.height,'75px');assert.equal(f.animations.length,0);
 for(const content of [60,40,70]){f.change(content,75);assert.equal(f.slot.style.height,'75px');assert.equal(f.slot.dataset.promptOverflow,undefined);}
 f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.button}});
 f.setFloors(150,160);f.setWidth(300);f.change(60,75);assert.equal(f.slot.style.height,'75px');
 f.doc.handlers.get('pointerup')({type:'pointerup'});f.flush();assert.equal(f.slot.style.height,'160px');assert.equal(f.animations.length,0);
 f.setFloors(80,90);f.setWidth(400);f.change(60,160);assert.equal(f.slot.style.height,'90px');
 f.setFloors(85,95);f.fonts.handlers.get('loadingdone')();f.flush();assert.equal(f.slot.style.height,'95px');assert.equal(f.animations.length,0);
 f.observers[1].fn();assert.equal(f.frames.size,1);f.controller.destroy();assert.equal(f.frames.size,0);assert(f.observers.every(x=>x.closed));assert.equal(f.label.handlers.size,0);assert.equal(f.doc.handlers.size,0);assert.equal(f.win.handlers.size,0);assert.equal(f.fonts.handlers.size,0);assert.equal(f.motion.handlers.size,0);assert.equal(f.slot.dataset.heightManaged,undefined);
});

test('container-only width changes use measured replicas and retired presses cannot defer them forever',()=>{
 for(const retirement of ['blur','visibilitychange']){
  const f=fixture();f.change(60,75);assert.equal(f.animations.length,0);
  f.setFloors(180,190);f.setWidth(300);f.change(100,75);assert.equal(f.slot.style.height,'190px');assert.equal(f.animations.length,0);
  f.doc.handlers.get('keydown')({type:'keydown',key:'Enter',target:{closest:()=>f.button}});
  f.setFloors(200,210);f.setWidth(280);f.change(100,190);assert.equal(f.slot.style.height,'190px');
  (retirement==='blur'?f.win:f.doc).handlers.get(retirement)();f.flush();assert.equal(f.slot.style.height,'210px');assert.equal(f.animations.length,0);
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

test('native press preserves the rendered box while the finite grammar changes without animation',()=>{
 const f=fixture();f.setRendered(75);
 f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.button}});
 f.setFloors(140,160);f.setWidth(300);f.change(70,75);
 assert.equal(f.slot.style.height,'75px');assert.equal(f.animations.length,0);
 f.doc.handlers.get('pointerup')({type:'pointerup'});f.flush();
 assert.equal(f.slot.style.height,'160px');assert.equal(f.animations.length,0);f.controller.destroy();
});

test('outer paint guard covers finite grammar and unsupported overflow reflows without clipping',()=>{
 const f=fixture(4);assert.equal(f.slot.dataset.heightManaged,'true');
 assert.equal(f.slot.style.height,'83px');
 f.change(70,83);assert.equal(f.slot.style.height,'83px');
 f.change(160,83);assert.equal(f.slot.style.height,'168px');assert.equal(f.slot.dataset.promptOverflow,'true');
 f.change(40,168);assert.equal(f.slot.style.height,'83px');assert.equal(f.slot.dataset.promptOverflow,undefined);
 f.controller.destroy();assert.equal(f.slot.style.height,undefined);assert.equal(f.slot.dataset.heightManaged,undefined);
});

test('surviving focused action publishes synchronously inside a fixed measured grammar',()=>{
 const f=fixture(0,180);f.doc.activeElement=f.button;let publications=0;
 const publish=()=>{publications++;assert.equal(f.controller.deferContent('Longer Next',publish),false);f.setCurrent(180);f.setButtonTop(130);};
 assert.equal(f.controller.deferContent('Longer Next',publish),true);
 assert.equal(publications,1);assert.equal(f.slot.style.height,'180px');assert.equal(f.animations.length,0);assert.equal(f.doc.activeElement,f.button);
 f.setRendered(180);f.setButtonTop(10);
 assert.equal(f.controller.deferContent('Shorter Next',()=>{f.setCurrent(100);}),true);
 f.observers[0].fn();f.flush();assert.equal(f.slot.style.height,'180px');assert.equal(f.animations.length,0);assert.equal(f.slot.dataset.promptOverflow,undefined);
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

test('unsupported live content exposes a failed grammar condition while retaining the full focused target',()=>{
 const f=fixture();f.doc.activeElement=f.button;
 assert(f.controller.deferContent('Longer Next',()=>{f.setCurrent(180);f.setButtonTop(130);}));
 assert.equal(f.slot.dataset.promptOverflow,'true');assert.equal(f.slot.style.height,'180px');assert.equal(f.doc.activeElement,f.button);assert.equal(f.animations.length,0);f.controller.destroy();
});

test('context controls share focus and held-press containment with the managed guidance slot',()=>{
 const f=fixture();f.doc.activeElement=f.contextButton;f.setContextButtonTop(100);f.change(130,75);
 assert.equal(f.slot.style.height,'145px');
 f.setRendered(145);f.doc.handlers.get('pointerdown')({type:'pointerdown',target:{closest:()=>f.contextButton}});
 f.setFloors(170,180);f.setWidth(300);f.change(160,145);assert.equal(f.slot.style.height,'145px');
 f.doc.handlers.get('pointerup')({type:'pointerup'});f.flush();assert.equal(f.slot.style.height,'180px');
 f.controller.destroy();
});

const actualMetrics={
 '--board-message-prose-line-height':'1.5','--board-inline-action-font-scale':'.88',
 '--board-inline-action-line-height':'1.5','--board-inline-action-padding-block-em':'.2',
 '--board-inline-action-border-px':'1','--board-message-hit-half-px':'23.0625',
 '--board-message-hit-half-em':'.836','--board-message-action-extra-em':'.469','--board-message-action-extra-px':'4','--board-message-detached-gap-em':'.5',
};
test('cold primary font growth is admitted before first paint without moving the Board',()=>{
 const f=fixture(4,174.96875,{metrics:actualMetrics,fontSize:32,initialWidth:334.375,rowLines:6});
 const cold=f.slot.style.height;assert(parseFloat(cold)>=217.9375+8);
 f.setFloors(217.9375,174.96875);f.fonts.handlers.get('loadingdone')();f.flush();
 assert.equal(f.slot.style.height,cold);assert.equal(f.slot.dataset.promptOverflow,undefined);assert.equal(f.slot.dataset.promptReservationUnsupported,undefined);
 f.controller.destroy();
});
test('missing metrics and out-of-domain widths expose degraded reservation instead of fixed-height success',()=>{
 for(const options of [{},{metrics:actualMetrics,fontSize:32,initialWidth:270},{metrics:actualMetrics,fontSize:33}]){
  const f=fixture(0,75,options);assert.equal(f.slot.dataset.promptReservationUnsupported,'true');
  f.change(200,75);assert.equal(f.slot.style.height,'200px');assert.equal(f.slot.dataset.promptOverflow,'true');
  f.controller.destroy();assert.equal(f.slot.dataset.promptReservationUnsupported,undefined);
 }
});

test('a primary font beyond the static policy stays safe and exposes degraded fixed-height admission',()=>{
 const f=fixture(0,105,{metrics:actualMetrics,fontSize:16,initialWidth:400});
 f.setFloors(180,105);f.change(160,105);
 assert.equal(f.slot.style.height,'180px');assert.equal(f.slot.dataset.promptOverflow,undefined,'live content fits the full natural primary replica');
 assert.equal(f.slot.dataset.promptPrimaryUnderreserved,'true','natural sizing cannot hide an underreserved primary policy');
 f.setFloors(104,105);f.change(100,180);assert.equal(f.slot.dataset.promptPrimaryUnderreserved,undefined);
 f.controller.destroy();assert.equal(f.slot.dataset.promptPrimaryUnderreserved,undefined);
});
test('altered finite CSS metrics never receive fixed-height qualification',()=>{
 for(const change of [{...actualMetrics,'--board-inline-action-font-scale':'-.88'},{...actualMetrics,'--board-message-prose-line-height':'1.6'}]){
  const f=fixture(0,75,{metrics:change});assert.equal(f.slot.dataset.promptReservationUnsupported,'true');
  f.change(180,75);assert.equal(f.slot.style.height,'180px');f.controller.destroy();
 }
});

test('the first cold admission respects the original compact ceiling when fallback is already sufficient',()=>{
 const f=fixture(0,125.140625,{metrics:actualMetrics,fontSize:16,initialWidth:296.8125,rowLines:3});
 assert.equal(f.slot.style.height,'125.140625px');assert.equal(f.slot.dataset.promptPrimaryUnderreserved,undefined);
 f.fonts.handlers.get('loadingdone')();f.flush();assert.equal(f.slot.style.height,'125.140625px');f.controller.destroy();
});

// Authored private proposal owner controls; UNRUN.
test('tagged finite grammar reserves detached row before a cold primary loads and counts paint once',()=>{
 const f=fixture(4,126.96875,{metrics:actualMetrics,fontSize:32,initialWidth:616,rowLines:3,pattern:'required-retry'});
 const admitted=parseFloat(f.slot.style.height);assert(Math.abs(admitted-179.504)<1e-9);
 f.setFloors(167.484375,126.96875);f.fonts.handlers.get('loadingdone')();f.flush();
 assert.equal(parseFloat(f.slot.style.height),admitted);assert.equal(f.slot.dataset.promptPrimaryUnderreserved,undefined);
 f.setFloors(200,126.96875);f.fonts.handlers.get('loadingdone')();f.flush();
 assert.equal(f.slot.dataset.promptPrimaryUnderreserved,'true');assert.equal(f.slot.style.height,'208px','unqualified growth stays safe but explicitly degraded');
 f.controller.destroy();
});
test('unknown structural reservation pattern is safe but unsupported',()=>{
 const f=fixture(0,75,{metrics:actualMetrics,pattern:'unknown'});
 assert.equal(f.slot.dataset.promptReservationUnsupported,'true');assert.equal(f.slot.style.height,'75px');f.controller.destroy();
});

// Mixed grammar exercises the actual production group boundary, not a copy.
test('mixed tagged and ordinary replicas retain distinct fallback ownership and fixed grammar maximum',async()=>{
 const {promptPatternReservations}=await import('../board/message-height.js');
 const {readPromptMetrics}=await import('../board/prompt-reservation.js');
 const metrics=readPromptMetrics({getPropertyValue:name=>actualMetrics[name]??''});
 const replica=(font,height,pattern)=>({dataset:{sizingFont:font,...(pattern?{promptPattern:pattern}:{})},height,getBoundingClientRect(){return {height:this.height};}});
 const replicas=[replica('primary',140),replica('fallback',145),replica('primary',167.484375,'required-retry'),replica('fallback',126.96875,'required-retry')];
 const win={getComputedStyle:()=>({getPropertyValue:()=> '3'})};
 const measure=()=>promptPatternReservations({replicas,win,width:616,fontSize:32,metrics,outerPadding:8});
 let groups=measure();assert.equal(groups.length,2);
 assert.equal(groups[0].permanentFallback,145);assert(Math.abs(groups[0].reservation-155.008)<1e-9);
 assert.equal(groups[1].permanentFallback,126.96875);assert(Math.abs(groups[1].reservation-171.504)<1e-9);
 assert(Math.abs(Math.max(...groups.map(group=>group.reservation))+8-179.504)<1e-9);
 replicas[1].height=300;groups=measure();assert.equal(groups[0].reservation,300);
 assert(Math.abs(groups[1].reservation-171.504)<1e-9,'ordinary fallback cannot inflate the tagged group');
 replicas[3].height=350;groups=measure();assert.equal(groups[1].reservation,350);
 assert.equal(groups[0].reservation,300,'tagged fallback cannot inflate the ordinary group');
 assert.equal(Math.max(...groups.map(group=>group.reservation))+8,358);
});
