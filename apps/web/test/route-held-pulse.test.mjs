import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteHeldPulse} from '../shell/route-held-pulse.js';
const clock=()=>{let now=1000,id=0;const timers=new Map();return {timers,set(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clear:id=>timers.delete(id),advance(ms){const end=now+ms;let count=0;for(;;){const next=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert(++count<100);now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};};
const fixture=()=>{const time=clock(),changes=[],state={owner:{},scope:'1:2:game:g:0',pendingScope:'1:2:game:g:0',current:true,phase:'covered',pending:true,ready:false,failure:null,visible:true,reducedMotion:false};let reads=0;const pulse=createRouteHeldPulse({getState:()=>{reads++;return state;},onChange:value=>changes.push(value),setTimer:time.set,clearTimer:time.clear});return {time,changes,state,pulse,reads:()=>reads};};

test('construction is lazy and a covered current pending destination pulses after 200ms only',()=>{
 const f=fixture();assert.equal(f.reads(),0);assert.equal(f.time.timers.size,0);f.pulse.update();f.time.advance(199);assert.deepEqual(f.changes,[]);f.time.advance(1);assert.deepEqual(f.changes,[true]);assert.equal(f.time.timers.size,0);f.pulse.destroy();
});
test('ready before threshold never pulses and adds no completion barrier',()=>{
 const f=fixture();f.pulse.update();f.time.advance(199);f.state.ready=true;f.pulse.update();assert.equal(f.time.timers.size,0);f.time.advance(10000);assert.deepEqual(f.changes,[]);f.pulse.destroy();
});
test('readiness retires an active pulse synchronously without waiting for a cycle',()=>{
 const f=fixture();f.pulse.update();f.time.advance(200);f.state.ready=true;f.state.phase='revealing';f.pulse.update();assert.deepEqual(f.changes,[true,false]);assert.equal(f.time.timers.size,0);f.pulse.destroy();
});
test('passive re-renders do not restart the covered delay',()=>{
 const f=fixture();f.pulse.update();f.time.advance(100);for(let index=0;index<10;index++)f.pulse.update();assert.equal(f.time.timers.size,1);f.time.advance(100);assert.deepEqual(f.changes,[true]);f.pulse.destroy();
});
for(const [name,patch] of Object.entries({covering:{phase:'covering'},revealing:{phase:'revealing'},idle:{phase:'idle'},noPending:{pending:false},terminalFailure:{failure:'missing'},retryBackoff:{failure:'retry',pending:false},foreignScope:{pendingScope:'other'},replacedRoute:{current:false},noOwner:{owner:null},hidden:{visible:false},reduced:{reducedMotion:true}}))test(name+' is static and owns no pulse timer',()=>{
 const f=fixture();Object.assign(f.state,patch);f.pulse.update();f.time.advance(1000);assert.deepEqual(f.changes,[]);assert.equal(f.time.timers.size,0);f.pulse.destroy();
});
test('the timer callback revalidates live ownership without a render update',()=>{
 const f=fixture();f.pulse.update();f.state.current=false;f.time.advance(200);assert.deepEqual(f.changes,[]);assert.equal(f.time.timers.size,0);f.pulse.destroy();
});
test('a replaced owner cannot activate or retire a newer timer through a late callback',()=>{
 const f=fixture();f.pulse.update();const old=[...f.time.timers.values()][0].fn;f.time.advance(100);f.state.owner={};f.pulse.update();old();f.time.advance(199);assert.deepEqual(f.changes,[]);f.time.advance(1);assert.deepEqual(f.changes,[true]);f.pulse.destroy();
});
test('scope replacement cancels synchronously and waits for the exact pending owner',()=>{
 const f=fixture();f.pulse.update();f.time.advance(200);f.state.scope='2:3:home:4';f.pulse.update();assert.deepEqual(f.changes,[true,false]);assert.equal(f.time.timers.size,0);f.state.pendingScope=f.state.scope;f.pulse.update();f.time.advance(199);assert.deepEqual(f.changes,[true,false]);f.time.advance(1);assert.deepEqual(f.changes,[true,false,true]);f.pulse.destroy();
});
test('destroy clears an active pulse and rejects every later update and callback',()=>{
 const f=fixture();f.pulse.update();const old=[...f.time.timers.values()][0].fn;f.time.advance(200);f.pulse.destroy();f.pulse.destroy();old();f.pulse.update();f.time.advance(1000);assert.deepEqual(f.changes,[true,false]);assert.equal(f.time.timers.size,0);
});
