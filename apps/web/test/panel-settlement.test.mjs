import test from 'node:test';
import assert from 'node:assert/strict';
import {panelGeometrySettledAcrossFrame} from '../../../e2e/support/panel-settlement.mjs';
const fixture=(t,{positions=[11.6875],heights=[366.9375],animations=[],active=true,inert=!active,hidden=!active,wrapLeft=11.6875}={})=>{
 const original=globalThis.requestAnimationFrame;let frames=0,reads=0;
 globalThis.requestAnimationFrame=callback=>{frames++;queueMicrotask(()=>callback(frames));};
 t.after(()=>{if(original===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=original;});
 const wrap={getBoundingClientRect:()=>({left:wrapLeft})};
 const track={getAnimations:()=>animations};
 const panel={dataset:{active:String(active)},inert,getAttribute:name=>name==='aria-hidden'?String(hidden):null,closest:selector=>selector==='.game-shell-track'?track:wrap,getBoundingClientRect:()=>{
  const index=reads++,x=positions[Math.min(index,positions.length-1)];return {left:x,x,y:230.296875,width:366.8125,height:heights[Math.min(index,heights.length-1)]};
 }};
 return {panel,get frames(){return frames;},get reads(){return reads;}};
};

test('old inactive and within-one-pixel gate admits residual that exact frame barrier rejects',async t=>{
 const residual=11.692108154296875;assert.ok(Math.abs(residual-11.6875)<=1);
 const f=fixture(t,{positions:[residual,residual,11.6875]});
 assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);assert.equal(f.frames,2);
});

test('full-precision fractional endpoint requires the browser to finish the transition',async t=>{
 let release;const animation={playState:'running',pending:false,finished:new Promise(resolve=>{release=resolve;})};
 const f=fixture(t,{animations:[animation]});
 assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);assert.equal(f.frames,0);
 animation.playState='finished';release();assert.equal(await panelGeometrySettledAcrossFrame(f.panel),true);assert.equal(f.frames,2);
});

test('stable wrong panel remains inadmissible',async t=>{
 const f=fixture(t,{positions:[12,12,12],active:false,inert:false,hidden:false});assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);
});

test('geometry changing after a rendered frame remains inadmissible even at the aligned edge',async t=>{
 const f=fixture(t,{heights:[366.9375,366.9375,367]});assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);
});

test('cancelled transition is a retryable not-settled sample',async t=>{
 const cancelled=Object.assign(Error('cancelled'),{name:'AbortError'});
 const animation={playState:'finished',pending:false,finished:Promise.reject(cancelled)};
 const f=fixture(t,{animations:[animation]});assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);assert.equal(f.frames,0);
});

test('unexpected transition failure retains its original error',async t=>{
 const original=Error('unexpected transition failure');
 const animation={playState:'finished',pending:false,finished:Promise.reject(original)};
 const f=fixture(t,{animations:[animation]});await assert.rejects(panelGeometrySettledAcrossFrame(f.panel),error=>error===original);assert.equal(f.frames,0);
});

test('actual stable Board offset is accepted without requiring impossible wrap-edge equality',async t=>{
 assert.equal(5.296875-5.203125,0.09375);
 const f=fixture(t,{positions:[5.296875],wrapLeft:5.203125});
 assert.equal(await panelGeometrySettledAcrossFrame(f.panel),true);assert.equal(f.frames,2);
});

test('an inert panel is not admitted even when its other selection markers look current',async t=>{
 const f=fixture(t,{inert:true,active:true,hidden:false});assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);
});

test('an aria-hidden panel is not admitted even when active and non-inert',async t=>{
 const f=fixture(t,{hidden:true,active:true,inert:false});assert.equal(await panelGeometrySettledAcrossFrame(f.panel),false);
});
