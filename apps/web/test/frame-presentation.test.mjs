import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePresentation} from '../shell/frame-presentation.js';

function fixture(render = () => {}) {
  let next = 0, hidden = false, time = 0;
  const callbacks = new Map(), cancelled = [], measures = [];
  const view = createFramePresentation({render,requestFrame:callback=>{const id=next++;callbacks.set(id,callback);return id;},cancelFrame:id=>cancelled.push(id),visible:()=>!hidden,
    performanceImpl:{now:()=>time,clearMeasures:name=>{for(let i=measures.length-1;i>=0;i--)if(measures[i].name===name)measures.splice(i,1);},measure:(name,value)=>measures.push({name,...value})},measurementName:'fixture-presentation'});
  return {view,callbacks,cancelled,measures,setHidden:value=>{hidden=value;},advance:ms=>{time+=ms;},run:id=>{const callback=callbacks.get(id);callbacks.delete(id);callback();}};
}

test('a burst keeps one frame and renders the latest route/account state',()=>{
  let state={route:'old',account:'a'},renders=[];const h=fixture(()=>renders.push({...state}));
  for(let i=0;i<1000;i++)h.view.schedule();
  assert.equal(h.callbacks.size,1);assert.deepEqual(renders,[]);
  state={route:'new',account:'b'};h.run(0);assert.deepEqual(renders,[state]);
  assert.deepEqual(h.view.snapshot(),{requests:1000,renders:1,coalesced:999,hidden:0,lastDurationMs:0,maxDurationMs:0,pending:false});
});

test('hiding cancels frame zero and a late callback cannot render the old request',()=>{
  let renders=0;const h=fixture(()=>renders++);h.view.schedule();const old=h.callbacks.get(0);
  h.setHidden(true);h.view.cancel();assert.deepEqual(h.cancelled,[0]);old();h.view.schedule();assert.equal(renders,0);
  h.setHidden(false);h.view.schedule();h.run(1);assert.equal(renders,1);
});

test('a page hidden between scheduling and drawing waits for a visible request',()=>{
  let renders=0;const h=fixture(()=>renders++);h.view.schedule();h.setHidden(true);h.run(0);assert.equal(renders,0);
  h.setHidden(false);h.view.schedule();h.run(1);assert.equal(renders,1);
});

test('a notification during rendering schedules one later frame without losing it',()=>{
  let renders=0;const h=fixture(()=>{if(++renders===1){h.view.schedule();h.view.schedule();}});
  h.view.schedule();h.run(0);assert.equal(h.callbacks.size,1);h.run(1);assert.equal(renders,2);assert.equal(h.view.snapshot().pending,false);
});

test('timing retains one bounded record and does not swallow a rendering failure',()=>{
  let fail=false;const h=fixture(()=>{h.advance(7);if(fail)throw Error('render failed');});
  h.view.schedule();h.run(0);fail=true;h.view.schedule();assert.throws(()=>h.run(1),/render failed/);
  assert.equal(h.measures.length,1);assert.equal(h.measures[0].detail.renders,2);assert.equal(h.measures[0].detail.maxDurationMs,7);assert.equal(h.view.snapshot().pending,false);
});
