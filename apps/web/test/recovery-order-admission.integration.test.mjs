import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRecoverySpace,syncRecoverySpace} from '../shell/recovery-space.js';
import {createBoardContextLayout} from '../shell/board-context-layout.js';
const events=()=>{const map=new Map();return {addEventListener(k,f){if(!map.has(k))map.set(k,new Set());map.get(k).add(f);},removeEventListener(k,f){map.get(k)?.delete(f);},emit(k){for(const f of map.get(k)??[])f();},count(){return [...map.values()].reduce((n,s)=>n+s.size,0);}};};
function fixture(){
 const jobs=new Map(),observers=[];let serial=0,writes=0,anchorReads=0,bottom=68;
 class ResizeObserver{constructor(fn){this.fn=fn;this.nodes=new Set();observers.push(this);}observe(n){this.nodes.add(n);}unobserve(n){this.nodes.delete(n);}disconnect(){this.nodes.clear();}}
 class MutationObserver{constructor(fn){this.fn=fn;}observe(){}disconnect(){this.closed=true;}}
 const viewport={...events(),offsetTop:0,height:844},fonts=events();
 const win={...events(),ResizeObserver,MutationObserver,visualViewport:viewport,innerHeight:844,innerWidth:390,requestAnimationFrame(fn){jobs.set(++serial,fn);return serial;},cancelAnimationFrame(id){jobs.delete(id);},getComputedStyle:()=>({fontSize:'16px',fontFamily:'Manrope'})};
 const values=new Map(),reserve=new Map();
 let header={getBoundingClientRect:()=>({bottom})};
 const wrap={style:{getPropertyValue:k=>reserve.get(k)||'',setProperty:(k,v)=>reserve.set(k,v),removeProperty:k=>reserve.delete(k)},closest:()=>null,querySelector:()=>({getBoundingClientRect:()=>({top:120+(parseFloat(reserve.get('--board-center-clearance'))||0),height:320})})};
 const frame={querySelector:key=>key==='[data-testid="game-board-wrap"]'?wrap:{getBoundingClientRect:()=>({bottom:500+(parseFloat(reserve.get('--board-center-clearance'))||0)})}};
 const anchor={getBoundingClientRect(){anchorReads++;return {top:parseFloat(values.get('--recovery-space-top'))||58,width:366};}};
 const app={dataset:{shellLayoutMode:'narrow'},style:{getPropertyValue:k=>values.get(k)||'',setProperty(k,v){writes++;values.set(k,v);},removeProperty:k=>values.delete(k)},querySelector:k=>k==='.shell-header'?header:k==='[data-game-shell-root]'?frame:anchor};
 const doc={...events(),defaultView:win,fonts,getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],body:{append(){}},createElement:()=>({style:{},setAttribute(){},getBoundingClientRect:()=>({height:180}),remove(){}})};
 const dispose=mountRecoverySpace(app,{window:win,document:doc}),layout=createBoardContextLayout(doc);
 const flush=()=>{const batch=[...jobs.values()];jobs.clear();for(const fn of batch)fn();};
 return {win,doc,app,viewport,fonts,layout,dispose,jobs,observers,values,frame,anchorReads:()=>anchorReads,writes:()=>writes,flush,setBottom:n=>{bottom=n;},replaceHeader(){header={getBoundingClientRect:()=>({bottom})};return header;},reserve:()=>reserve.get('--board-center-clearance'),close(){layout.destroy();dispose();}};
}
test('cold first admission uses actual header before any frame and later frame is idempotent',()=>{
 const f=fixture();assert.equal(f.values.has('--recovery-space-top'),false);assert.equal(f.jobs.size,1);
 syncRecoverySpace(f.app);f.layout.sync();assert.equal(f.values.get('--recovery-space-top'),'76px');assert.equal(f.reserve(),'142px');
 assert.equal(f.anchorReads(),0,'overlay notice anchor cannot reserve Board space');const writes=f.writes();f.flush();f.layout.sync();assert.equal(f.reserve(),'142px');assert.equal(f.writes(),writes);f.close();
});
test('overlay recovery header changes never consume Board clearance',()=>{
 const f=fixture();syncRecoverySpace(f.app);f.layout.sync();assert.equal(f.reserve(),'142px');
 f.setBottom(120);syncRecoverySpace(f.app);f.layout.sync();assert.equal(f.values.get('--recovery-space-top'),'128px');assert.equal(f.reserve(),'142px');
 f.close();
});
test('single existing recovery owner follows replacement header and coalesces font/viewport updates',()=>{
 const f=fixture();assert.equal(mountRecoverySpace(f.app,{window:f.win,document:f.doc}),f.dispose);
 syncRecoverySpace(f.app);f.layout.sync();const oldCount=f.observers.length;f.setBottom(120);const next=f.replaceHeader();syncRecoverySpace(f.app);f.layout.sync();assert.equal(f.values.get('--recovery-space-top'),'128px');assert.equal(f.reserve(),'142px');assert.equal(f.observers.length,oldCount);assert(f.observers.some(o=>o.nodes.has(next)));
 f.fonts.emit('loadingdone');f.win.emit('resize');f.viewport.emit('resize');assert(f.jobs.size<=2,'one pending task per existing owner');
 f.viewport.offsetTop=24;f.viewport.height=400;f.setBottom(-40);syncRecoverySpace(f.app);f.layout.sync();assert.equal(f.values.get('--recovery-space-top'),'32px');assert.equal(f.values.get('--recovery-viewport-bottom'),'424px');f.flush();f.close();
});
test('disposed recovery owner cannot be revived by synchronous admission',()=>{
 const f=fixture();syncRecoverySpace(f.app);f.win.emit('scroll');f.close();assert.equal(f.jobs.size,0);const writes=f.writes();syncRecoverySpace(f.app);f.flush();assert.equal(f.writes(),writes);assert.equal(f.values.size,0);assert(f.observers.every(o=>o.nodes.size===0));assert.equal(f.win.count()+f.viewport.count()+f.fonts.count()+f.doc.count(),0);
});
// Actual queued app-owner ordering is executed in board-context-owner.integration:
// 'actual queued context refresh invokes the real recovery helper before layout'.
// Snapshot/native wiring remains a final-composition acceptance question.
