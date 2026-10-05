import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAutosave } from '../shell/account-autosave.js';
function setup() {
  let current = true, tick = 0;
  const timers = new Map(), writes = [], states = [];
  const saver = createAccountAutosave({ initial: 'Alice', validate: value => ({ok: value.length <= 32, value: value.trim() || 'Alice'}),
    isCurrent: () => current, report: state => states.push(state),
    save: value => new Promise((resolve,reject) => writes.push({value,resolve,reject})),
    timers: {setTimeout(fn) {timers.set(++tick,fn);return tick;},clearTimeout(id){timers.delete(id);}} });
  return {saver,writes,states, expire(){current=false;}, debounce(){for(const [id,fn] of timers){timers.delete(id);fn();}}};
}
const settle = async () => {for(let i=0;i<8;i++) await Promise.resolve();};
test('debounces edits and serializes latest value without reporting old value saved', async()=>{
 const f=setup();f.saver.change('B');f.saver.change('Bob');assert.equal(f.writes.length,0);f.debounce();assert.equal(f.writes[0].value,'Bob');
 f.saver.change('Carol');f.debounce();assert.equal(f.writes.length,1);f.writes[0].resolve();await settle();assert.equal(f.writes[1].value,'Carol');assert.ok(!f.states.includes('saved'));f.writes[1].resolve();await settle();assert.equal(f.states.at(-1),'saved');
});
test('reverting while a save is in flight writes the original value back',async()=>{
 const f=setup();f.saver.change('Bob');const done=f.saver.flush();f.saver.change('Alice');f.writes[0].resolve();await settle();assert.equal(f.writes[1].value,'Alice');f.writes[1].resolve();assert.equal(await done,true);
});
test('invalid and failed saves remain dirty, retry submits latest draft',async()=>{
 const f=setup();f.saver.change('x'.repeat(33));assert.equal(await f.saver.flush(),false);assert.equal(f.writes.length,0);
 f.saver.change('Bob');const failed=f.saver.flush();f.writes[0].reject(new Error('offline'));assert.equal(await failed,false);assert.equal(f.saver.dirty(),true);assert.equal(f.states.at(-1),'error');
 const retry=f.saver.flush();f.writes[1].resolve();assert.equal(await retry,true);assert.equal(f.saver.dirty(),false);
});
test('retired authority cannot start queued writes or publish stale completion',async()=>{
 const f=setup();f.saver.change('Bob');const done=f.saver.flush();f.saver.change('Carol');f.expire();f.writes[0].resolve();assert.equal(await done,false);f.debounce();assert.equal(f.writes.length,1);assert.ok(!f.states.includes('saved'));
 const g=setup();g.saver.change('Bob');g.saver.cancel();g.debounce();assert.equal(g.writes.length,0);
});
