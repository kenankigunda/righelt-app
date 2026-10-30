import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedComputerPlayback} from '../shell/confirmed-computer-playback.js';
const state=n=>({pieces:[],turnIndex:n,sideToMove:n%2?'P2':'P1',outcome:{status:'ongoing'}});
const move=n=>({moveId:`m${n}`,computerProof:{attemptId:`a${n}`},action:{type:'pass'},selectionSnapshot:state(n-1),snapshot:state(n)});
const game=n=>({id:'g',board:{state:state(n)},moves:Array.from({length:n},(_,i)=>move(i+1)),turns:Array.from({length:n+1},(_,index)=>({index})),gameplayRevision:n});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('confirmed bursts display each step in order and keep final control behind presentation completion',async()=>{
 const frames=[],sounds=[],waiters=[];const queue=createConfirmedComputerPlayback({present:(frame,{onDisplayed})=>{frames.push(frame.decisionId);onDisplayed();return new Promise(resolve=>waiters.push(resolve));},onMove:entry=>sounds.push(entry.moveId)});
 queue.observe(game(0),{scope:'owner'});queue.observe(game(2),{scope:'owner'});await flush();assert.deepEqual(frames,['m1']);assert.equal(queue.snapshot().displayed.board.state.turnIndex,0);assert.equal(queue.snapshot().playing,true);
 queue.observe(game(3),{scope:'owner'});queue.observe(game(3),{scope:'owner'});waiters.shift()();await flush();assert.deepEqual(frames,['m1','m2']);assert.equal(queue.snapshot().displayed.board.state.turnIndex,1);
 waiters.shift()();await flush();waiters.shift()();await flush();assert.deepEqual(frames,['m1','m2','m3']);assert.deepEqual(sounds,frames);assert.equal(queue.snapshot().playing,false);assert.equal(queue.snapshot().displayed.board.state.turnIndex,3);
});
test('initial history and hidden return establish silent baselines and cancel obsolete playback',async()=>{
 let calls=0,signal;const queue=createConfirmedComputerPlayback({present:(_frame,context)=>{calls++;signal=context.signal;return new Promise(()=>{});}});
 queue.observe(game(2),{scope:'owner'});assert.equal(calls,0);queue.observe(game(3),{scope:'owner'});await flush();assert.equal(calls,1);queue.observe(game(4),{scope:'owner',visible:false});assert.equal(signal.aborted,true);assert.equal(queue.snapshot().playing,false);
 queue.observe(game(4),{scope:'owner'});assert.equal(calls,1);assert.equal(queue.snapshot().displayed.board.state.turnIndex,4);
});
test('scope replacement cancels hydration and discards its late completion',async()=>{
 let finish,presented=0;const queue=createConfirmedComputerPlayback({loadMove:entry=>new Promise(resolve=>{finish=()=>resolve(entry);}),present:()=>{presented++;}});
 queue.observe(game(0),{scope:'one'});queue.observe(game(1),{scope:'one'});queue.observe(game(2),{scope:'two'});finish();await flush();assert.equal(presented,0);assert.equal(queue.snapshot().displayed.gameplayRevision,2);
});
test('failed immutable frame hydration retains position and can retry the same decision',async()=>{
 let fails=true,calls=0;const queue=createConfirmedComputerPlayback({loadMove:async entry=>{calls++;if(fails)throw Error('offline');return entry;}});
 queue.observe(game(0),{scope:'owner'});queue.observe(game(1),{scope:'owner'});await flush();assert.equal(queue.snapshot().displayed.gameplayRevision,0);assert.equal(queue.snapshot().current.move.moveId,'m1');assert.ok(queue.snapshot().error);
 fails=false;queue.retry();await flush();assert.equal(calls,2);assert.equal(queue.snapshot().playing,false);assert.equal(queue.snapshot().displayed.gameplayRevision,1);
});

test('failed presenter callbacks are revoked before retry and retain their immutable game',async()=>{
 const callbacks=[],sounds=[];let count=0,finish;const queue=createConfirmedComputerPlayback({present:async(_frame,context)=>{callbacks.push(context);if(!count++)throw Error('presentation_failed');await new Promise(resolve=>finish=resolve);},onMove:(entry,game)=>sounds.push([entry.moveId,game.gameplayRevision])});
 queue.observe(game(0),{scope:'owner'});queue.observe(game(1),{scope:'owner'});await flush();assert.equal(callbacks[0].signal.aborted,true);queue.retry();await flush();callbacks[0].onDisplayed();assert.deepEqual(sounds,[]);callbacks[1].onDisplayed();finish();await flush();callbacks[0].onDisplayed();assert.deepEqual(sounds,[['m1',1]]);
});

test('transient frame reads retry in order with capped policy and honor server Retry-After',async()=>{
 const timers=new Map(),frames=[];let calls=0,next=0;const queue=createConfirmedComputerPlayback({setTimer:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimer:id=>timers.delete(id),loadMove:async entry=>{calls++;if(calls===1)throw Object.assign(Error('unavailable'),{status:503,retryAfterMs:7000});return entry;},present:async frame=>frames.push(frame.decisionId)});
 queue.observe(game(0),{scope:'owner'});queue.observe(game(1),{scope:'owner'});await flush();assert.equal(queue.snapshot().retrying,true);assert.equal(queue.snapshot().error,null);assert.equal(queue.snapshot().playing,true);queue.observe(game(2),{scope:'owner'});await flush();assert.equal(calls,1);
 const timer=[...timers.values()][0];assert.equal(timer.ms,7000);timers.clear();timer.fn();await flush();assert.deepEqual(frames,['m1','m2']);assert.equal(queue.snapshot().playing,false);assert.equal(queue.snapshot().retrying,false);
});
test('leaving during a transient frame retry clears its owned timer and stale callback',async()=>{
 let retry,cleared=0,calls=0;const queue=createConfirmedComputerPlayback({setTimer:fn=>(retry=fn,1),clearTimer:()=>cleared++,loadMove:async()=>{calls++;throw Object.assign(Error('request_timeout'),{code:'request_timeout'});}});queue.observe(game(0),{scope:'owner'});queue.observe(game(1),{scope:'owner'});await flush();queue.observe(game(2),{scope:'owner',visible:false});assert.equal(cleared,1);retry();await flush();assert.equal(calls,1);assert.equal(queue.snapshot().playing,false);
});

test('bounded history trimming and older-history hydration never skip or replay a new confirmed step',async()=>{
 const frames=[],queue=createConfirmedComputerPlayback({present:async frame=>frames.push(frame.decisionId)});queue.observe(game(2),{scope:'owner'});const trimmed=game(3);trimmed.moves=trimmed.moves.slice(1);queue.observe(trimmed,{scope:'owner'});await flush();assert.deepEqual(frames,['m3']);
 queue.observe(game(3),{scope:'owner'});await flush();assert.deepEqual(frames,['m3'],'prepending older decisions is not a new turn');queue.observe(game(4),{scope:'owner'});await flush();assert.deepEqual(frames,['m3','m4']);
});
