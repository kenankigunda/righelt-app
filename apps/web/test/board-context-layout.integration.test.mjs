import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardContextLayout} from '../shell/board-context-layout.js';

const events=()=>{const listeners=new Map();return{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type){for(const fn of [...listeners.get(type)??[]])fn({});},count(){return [...listeners.values()].reduce((n,set)=>n+set.size,0);}};};
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
