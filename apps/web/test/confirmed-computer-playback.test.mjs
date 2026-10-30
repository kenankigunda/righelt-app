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
