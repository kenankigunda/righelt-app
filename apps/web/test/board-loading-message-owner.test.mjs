import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardLoadingMessageOwner} from '../shell/board-loading-message-owner.js';

function fixture(){
 let current=null;const calls=[];
 const root={querySelector:()=>current};
 const owner=createBoardLoadingMessageOwner(root,{createController:label=>{calls.push(['admit',label]);label.managed=true;return {destroy(){calls.push(['release',label]);label.managed=false;}};}});
 return {owner,calls,set:label=>{current=label;},label:()=>({isConnected:true,managed:false})};
}
test('loading admission publishes synchronously and repeated sync retains its one owner',()=>{
 const f=fixture(),label=f.label();f.set(label);f.owner.sync();assert(label.managed);f.owner.sync();assert.equal(f.calls.length,1);f.owner.destroy();assert(!label.managed);
});
test('replacement releases the exact predecessor before admitting the new label',()=>{
 const f=fixture(),a=f.label(),b=f.label();f.set(a);f.owner.sync();f.set(b);f.owner.sync();assert.deepEqual(f.calls,[['admit',a],['release',a],['admit',b]]);assert(!a.managed&&b.managed);f.owner.destroy();
});
test('route removal releases loading measurements and permits a later loading frame',()=>{
 const f=fixture(),a=f.label(),b=f.label();f.set(a);f.owner.sync();f.set(null);f.owner.sync();assert(!a.managed);f.set(b);f.owner.sync();assert(b.managed);f.owner.destroy();
});
test('a disconnected candidate cannot acquire a loading controller',()=>{
 const f=fixture(),label=f.label();label.isConnected=false;f.set(label);f.owner.sync();assert.equal(f.calls.length,0);f.owner.destroy();
});
test('a detached owned subtree releases its observers even if the root still returns that label',()=>{
 const f=fixture(),label=f.label();f.set(label);f.owner.sync();label.isConnected=false;f.owner.sync();assert(!label.managed);assert.equal(f.calls.length,2);f.owner.destroy();
});
test('explicit live handoff cannot later erase a reused label owned by the runtime',()=>{
 const f=fixture(),label=f.label();f.set(label);f.owner.sync();f.owner.release();label.managed='live';f.set(null);f.owner.sync();f.owner.destroy();assert.equal(label.managed,'live');assert.equal(f.calls.filter(([kind])=>kind==='release').length,1);
});
test('destruction is idempotent and late synchronization cannot resurrect ownership',()=>{
 const f=fixture(),label=f.label();f.set(label);f.owner.sync();f.owner.destroy();f.owner.destroy();f.owner.sync();assert.equal(f.calls.length,2);assert(!label.managed);
});
