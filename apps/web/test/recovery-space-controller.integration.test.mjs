import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRecoverySpace} from '../shell/recovery-space.js';
const events=()=>{const listeners=new Map();return {listeners,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),emit:name=>listeners.get(name)?.()};};
test('recovery measurements coalesce, follow replacement headers and dispose every observer/listener',async()=>{
 const frames=new Map(),styles=new Map();let id=0,writes=0,header={getBoundingClientRect:()=>({bottom:68})};
 const resize=[],mutations=[];
 class ResizeObserver{constructor(callback){this.callback=callback;this.observed=new Set();resize.push(this);}observe(node){this.observed.add(node);}unobserve(node){this.observed.delete(node);}disconnect(){this.observed.clear();}}
 class MutationObserver{constructor(callback){this.callback=callback;mutations.push(this);}observe(node,options){this.options=options;}disconnect(){this.disconnected=true;}}
 const viewport={...events(),offsetTop:0,height:844},fonts=events();let fontReady;fonts.ready=new Promise(resolve=>fontReady=resolve);
 const win={...events(),ResizeObserver,MutationObserver,visualViewport:viewport,innerHeight:844,requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key)};
 const app={querySelector:()=>header,style:{getPropertyValue:name=>styles.get(name)||'',setProperty:(name,value)=>{writes++;styles.set(name,value);},removeProperty:name=>styles.delete(name)}};
 const flush=()=>{const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());};
 const dispose=mountRecoverySpace(app,{window:win,document:{fonts}});
 assert.equal(mountRecoverySpace(app,{window:win,document:{fonts}}),dispose);assert.equal(resize.length,1);flush();
 assert.equal(styles.get('--recovery-space-top'),'76px');assert.equal(frames.size,0);assert.equal(writes,2);
 resize[0].callback();win.emit('scroll');win.emit('resize');fonts.emit('loadingdone');assert.equal(frames.size,1);flush();assert.equal(writes,2);assert.equal(frames.size,0);
 const old=header;header={getBoundingClientRect:()=>({bottom:120})};mutations[0].callback();flush();
 assert(!resize[0].observed.has(old));assert(resize[0].observed.has(header));assert.equal(styles.get('--recovery-space-top'),'128px');
 header.getBoundingClientRect=()=>({bottom:-40});viewport.offsetTop=24;viewport.height=400;viewport.emit('scroll');viewport.emit('resize');flush();
 assert.equal(styles.get('--recovery-space-top'),'32px');assert.equal(styles.get('--recovery-viewport-bottom'),'424px');
 win.emit('scroll');assert.equal(frames.size,1);dispose();assert.equal(frames.size,0);assert.equal(styles.size,0);assert.equal(resize[0].observed.size,0);assert(mutations[0].disconnected);
 assert.equal(win.listeners.size,0);assert.equal(viewport.listeners.size,0);assert.equal(fonts.listeners.size,0);
 fontReady();await Promise.resolve();assert.equal(frames.size,0);dispose();
});
