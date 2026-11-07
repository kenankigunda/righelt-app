import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardContextLayout} from '../shell/board-context-layout.js';

const events=()=>{const listeners=new Map();return{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type,event={}){for(const fn of [...listeners.get(type)??[]])fn(event);},count(){return [...listeners.values()].reduce((n,set)=>n+set.size,0);}};};
function fixture(t){
 const observers=[],frames=[],fonts=events(),win={...events(),ResizeObserver:class{
  constructor(callback){this.callback=callback;this.nodes=new Set();this.disconnected=false;observers.push(this);}
  observe(node){this.nodes.add(node);}unobserve(node){this.nodes.delete(node);}disconnect(){this.nodes.clear();this.disconnected=true;}
 },requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){}};
 let bodies=[],focusCalls=0,scrollCalls=0;
 const doc={...events(),defaultView:win,fonts,getElementById:()=>null,querySelectorAll:()=>bodies,activeElement:null};
 const body=(clientHeight=48,scrollHeight=48)=>{
  const notice={attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
  const content={kind:'natural-content'};
  return {clientHeight,scrollHeight,tabIndex:-1,firstElementChild:content,closest:()=>notice,notice,focus(){focusCalls++;},scrollIntoView(){scrollCalls++;}};
 };
 const layout=createBoardContextLayout(doc);
 t.after(()=>{layout.destroy();assert(observers.every(observer=>observer.disconnected));assert.equal(doc.count()+win.count()+fonts.count(),0);assert.equal(focusCalls+scrollCalls,0);});
 return {layout,doc,win,fonts,observers,frames,body,setBodies:next=>{bodies=next;},sample:()=>observers[0].callback(),flush:()=>{while(frames.length)frames.shift()();}};
}
test('natural-content resize updates overflow without changing capped scrollport or moving focus',t=>{
 const f=fixture(t),body=f.body();f.setBodies([body]);f.layout.sync();f.doc.activeElement=body;
 assert.equal(body.tabIndex,-1);assert.equal(body.notice.attributes['data-context-overflow'],'false');assert(f.observers[0].nodes.has(body.firstElementChild));
 body.scrollHeight=192;f.sample();assert.equal(body.clientHeight,48);assert.equal(body.tabIndex,0);assert.equal(body.notice.attributes['data-context-overflow'],'true');assert.equal(f.doc.activeElement,body);
 body.scrollHeight=48;f.sample();assert.equal(body.tabIndex,-1);assert.equal(body.notice.attributes['data-context-overflow'],'false');assert.equal(f.doc.activeElement,body);
});
for(const event of ['font','viewport'])test(`${event} metrics refresh scroll-height state even with unchanged body border box`,t=>{
 const f=fixture(t),body=f.body();f.setBodies([body]);f.layout.sync();body.scrollHeight=144;
 if(event==='font')f.fonts.fire('loadingdone');else f.win.fire('resize');
 assert.equal(body.clientHeight,48);assert.equal(body.tabIndex,0);assert.equal(body.notice.attributes['data-context-overflow'],'true');f.flush();
});
test('context replacement prunes body and natural-content observation owners and destruction retires callbacks',t=>{
 const f=fixture(t),a=f.body(),b=f.body(48,96);f.setBodies([a,b]);f.layout.sync();assert.equal(f.observers[0].nodes.size,4);
 f.setBodies([b]);f.layout.sync();assert(!f.observers[0].nodes.has(a));assert(!f.observers[0].nodes.has(a.firstElementChild));assert.equal(f.observers[0].nodes.size,2);
 f.layout.destroy();b.scrollHeight=0;f.sample();assert.equal(b.tabIndex,0);assert.equal(f.observers[0].nodes.size,0);
});

function mountedFixture(t){
 const f=fixture(t);let top=58;
 const makeFrame=()=>{
  const values=new Map();const style={getPropertyValue:key=>values.get(key)??'',setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)};
  return {style,querySelector:()=>({getBoundingClientRect:()=>({top:90+(parseFloat(style.getPropertyValue('--board-context-reserve'))||0)})})};
 };
 let frame=makeFrame();
 const anchor={getBoundingClientRect:()=>({top,width:366})};
 const app={dataset:{shellLayoutMode:'narrow'},querySelector:selector=>selector==='[data-game-shell-root]'?frame:anchor};
 f.win.innerWidth=390;f.win.innerHeight=740;f.win.getComputedStyle=()=>({fontSize:'16px',fontFamily:'Manrope'});
 f.doc.getElementById=()=>app;f.doc.body={append(){}};
 f.doc.createElement=()=>({style:{},setAttribute(){},getBoundingClientRect:()=>({height:180}),remove(){}});
 return {...f,app,current:()=>frame,moveAnchor:value=>{top=value;},replace:()=>{frame=makeFrame();return frame;}};
}
for(const input of ['pointer','Enter',' '])test(`a replacement frame admits reserve during held ${JSON.stringify(input)} without moving the existing frame`,t=>{
 const f=mountedFixture(t);f.layout.sync();const previous=f.current();
 assert.equal(previous.style.getPropertyValue('--board-context-reserve'),'160px');
 if(input==='pointer')f.doc.fire('pointerdown');else f.doc.fire('keydown',{key:input});
 f.moveAnchor(90);f.layout.sync();
 assert.equal(previous.style.getPropertyValue('--board-context-reserve'),'160px','the existing native press keeps its admitted geometry');
 const next=f.replace();f.layout.sync();
 assert.equal(next.style.getPropertyValue('--board-context-reserve'),'192px','the unpainted replacement cannot wait for release to admit its reserve');
 if(input==='pointer')f.doc.fire('pointerup');else f.doc.fire('keyup',{key:input});
 f.flush();assert.equal(next.style.getPropertyValue('--board-context-reserve'),'192px');
});
test('new loading and live frames share reserve and desktop clears the current owner',t=>{
 const f=mountedFixture(t);f.layout.sync();const first=f.current().style.getPropertyValue('--board-context-reserve');
 const live=f.replace();f.layout.sync();assert.equal(live.style.getPropertyValue('--board-context-reserve'),first);
 f.app.dataset.shellLayoutMode='wide';f.layout.sync();assert.equal(live.style.getPropertyValue('--board-context-reserve'),'');
});

function revealFixture(t){
 const win={...events(),innerHeight:600,requestAnimationFrame(){return 1;},cancelAnimationFrame(){}};
 let calls=0;
 const notice={getBoundingClientRect:()=>({bottom:333.734375})},nav={getBoundingClientRect:()=>({top:540,height:60})};
 let frame={dataset:{gameId:'g'}};
 const app={dataset:{shellLayoutMode:'narrow'},querySelector:selector=>selector==='[data-game-shell-root]'?frame:selector.includes('is-active')?notice:nav};
 const doc={...events(),defaultView:win,fonts:events(),getElementById:()=>app,querySelectorAll:()=>[],activeElement:null};
 const target={isConnected:true,style:{},matches:()=>true,getBoundingClientRect:()=>({top:271.640625,bottom:327.125}),scrollIntoView(options){assert.deepEqual(options,{block:'nearest',inline:'nearest',behavior:'instant'});calls++;}};
 const layout=createBoardContextLayout(doc);t.after(()=>layout.destroy());
 const focus=()=>{doc.activeElement=target;doc.fire('focusin',{target});};
 return {win,doc,target,layout,focus,calls:()=>calls,frame:()=>frame,replaceFrame(){frame={dataset:{gameId:'g'}};}};
}
test('native Tab reveals its still-focused action even when a background page does not run animation frames',async t=>{
 const f=revealFixture(t);f.doc.fire('keydown',{key:'Tab'});f.focus();assert.equal(f.calls(),0,'wait until native focus finishes');
 await Promise.resolve();assert.equal(f.calls(),1);assert.equal(f.target.style.scrollMarginBlockStart,'342.640625px');assert.equal(f.target.style.scrollMarginBlockEnd,'68.875px');
});
for(const interruption of ['other-focus','pointer','disconnect','destroy','blur','hidden','new-key','new-frame','new-game'])test(`queued native focus reveal yields to ${interruption}`,async t=>{
 const f=revealFixture(t);f.doc.fire('keydown',{key:'Tab'});f.focus();
 if(interruption==='other-focus')f.doc.activeElement={};
 if(interruption==='pointer')f.doc.fire('pointerdown');
 if(interruption==='disconnect')f.target.isConnected=false;
 if(interruption==='destroy')f.layout.destroy();
 if(interruption==='blur')f.win.fire('blur');
 if(interruption==='hidden')f.doc.hidden=true;
 if(interruption==='new-key')f.doc.fire('keydown',{key:'Escape'});
 if(interruption==='new-frame')f.replaceFrame();
 if(interruption==='new-game')f.frame().dataset.gameId='other';
 await Promise.resolve();assert.equal(f.calls(),0);
});
test('programmatic focus and passive metrics never initiate a focus reveal',async t=>{
 const f=revealFixture(t);f.focus();f.doc.fonts.fire('loadingdone');f.win.fire('resize');await Promise.resolve();assert.equal(f.calls(),0);
});

for(const sample of [
 {name:'fractional bottom overrun',top:476.640625,bottom:532.125,scroll:158,expected:159},
 {name:'fractional top overrun',top:271.640625,bottom:327.125,scroll:158,expected:87},
 {name:'exact bottom boundary',top:476.515625,bottom:532,scroll:158,expected:158},
 {name:'exact top boundary',top:341.734375,bottom:397.21875,scroll:158,expected:158},
 {name:'whole-pixel bottom overrun',top:477.515625,bottom:533,scroll:158,expected:159},
 {name:'clamped upper scroll boundary',top:271.640625,bottom:327.125,scroll:0,expected:0},
 {name:'clamped lower scroll boundary',top:476.640625,bottom:532.125,scroll:1000,expected:1000},
])test(`actual native reveal rounds outward once: ${sample.name}`,async t=>{
 const f=revealFixture(t);let scroll=sample.scroll,nativeCalls=0;
 f.target.getBoundingClientRect=()=>({top:sample.top+sample.scroll-scroll,bottom:sample.bottom+sample.scroll-scroll});
 f.target.scrollIntoView=()=>{
  nativeCalls++;const rect=f.target.getBoundingClientRect();
  const upper=parseFloat(f.target.style.scrollMarginBlockStart),lower=f.win.innerHeight-parseFloat(f.target.style.scrollMarginBlockEnd);
  const delta=rect.top<upper?rect.top-upper:rect.bottom>lower?rect.bottom-lower:0;
  // Model native whole-pixel scroll quantization and document bounds.
  scroll=Math.max(0,Math.min(1000,Math.round(scroll+delta)));
 };
 f.doc.fire('keydown',{key:'Tab'});f.focus();await Promise.resolve();
 assert.equal(scroll,sample.expected);assert(nativeCalls<=1,'clamping cannot cause a retry loop');
 const rect=f.target.getBoundingClientRect();
 if(!sample.name.startsWith('clamped')){assert(rect.top>=341.734375);assert(rect.bottom<=532);}
 else assert(rect.top<341.734375||rect.bottom>532,'a document clamp remains an unmet clearance, never a claimed repair');
});
