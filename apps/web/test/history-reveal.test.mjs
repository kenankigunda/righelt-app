import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRevealScrollDelta,scheduleHistoryReveal} from '../shell/history-reveal.js';

test('History reveal scrolls only the overflow needed to expose a selected preview',()=>{
 assert.equal(historyRevealScrollDelta({top:200,bottom:650,visibleBottom:500}),150);
 assert.equal(historyRevealScrollDelta({top:120,bottom:480,visibleBottom:500}),0);
 assert.equal(historyRevealScrollDelta({top:-20,bottom:300,visibleBottom:500}),-32);
});

test('queued History reveal cannot run after its transition generation becomes stale',()=>{
 const frames=[];let current=true,calls=0;
 assert.equal(scheduleHistoryReveal({requestFrame:callback=>frames.push(callback),isCurrent:()=>current,reveal:guard=>{assert.equal(guard(),true);calls+=1;}}),true);
 frames.shift()();
 current=false;
 frames.shift()();
 assert.equal(calls,0);
});

test('current queued History reveal receives the same guard before scrolling',()=>{
 const frames=[];let calls=0;
 scheduleHistoryReveal({requestFrame:callback=>frames.push(callback),reveal:guard=>{assert.equal(guard(),true);calls+=1;}});
 frames.shift()();frames.shift()();assert.equal(calls,1);
});
