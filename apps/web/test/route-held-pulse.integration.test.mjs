import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRouteHeldPulse} from '../shell/route-held-pulse.js';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
const fakeClock=()=>{let now=1000,id=0;const timers=new Map();return {timers,clock:()=>now,setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),advance(ms){const end=now+ms;let count=0;for(;;){const next=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert(++count<100);now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};};
class Surface extends EventTarget{listeners=new Map();addEventListener(type,fn,...args){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);super.addEventListener(type,fn,...args);}removeEventListener(type,fn,...args){this.listeners.get(type)?.delete(fn);super.removeEventListener(type,fn,...args);}count(){return [...this.listeners.values()].reduce((total,set)=>total+set.size,0);}}
const surfaces=()=>{const time=fakeClock(),document=new Surface(),window=new Surface(),media=new Surface(),attributes=new Map();document.hidden=false;media.matches=false;Object.assign(window,{setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,matchMedia:()=>media});return {time,document,window,media,element:{setAttribute:(key,value)=>attributes.set(key,value)},active:()=>attributes.get('data-held-pulse'),attributeKeys:()=>[...attributes.keys()]};};
const pending=()=>({owner:{},scope:'1:2:game:g:0',pendingScope:'1:2:game:g:0',current:true,phase:'covered',pending:true,ready:false,failure:null});
test('actual DOM binding is lazy, cancels on hide and reduced motion, and disposes only its listeners',()=>{
 const f=surfaces();let state;const mount=mountRouteHeldPulse({...f,getState:()=>{assert(state,'late dependency must be ready before use');return state;}});assert.equal(f.active(),'false');assert(f.document.count()>0);assert(f.window.count()>0);assert(f.media.count()>0);
 state=pending();mount.update();f.time.advance(200);assert.equal(f.active(),'true');
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.active(),'false');assert.equal(f.time.timers.size,0);f.time.advance(1000);
 f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));f.time.advance(200);assert.equal(f.active(),'true');
 f.window.dispatchEvent(new Event('pagehide'));mount.update();f.time.advance(1000);assert.equal(f.active(),'false');assert.equal(f.time.timers.size,0);
 f.window.dispatchEvent(new Event('pageshow'));f.time.advance(200);assert.equal(f.active(),'true');
 f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.active(),'false');assert.equal(f.time.timers.size,0);
 const unrelated=()=>{};f.window.addEventListener('unrelated',unrelated);mount.destroy();assert.equal(f.active(),'false');assert.equal(f.time.timers.size,0);assert.equal(f.document.count(),0);assert.equal(f.media.count(),0);assert.equal(f.window.count(),1);f.window.removeEventListener('unrelated',unrelated);
 f.window.dispatchEvent(new Event('pageshow'));mount.update();f.time.advance(1000);assert.equal(f.active(),'false');assert.deepEqual(f.attributeKeys(),['data-held-pulse']);
});
test('destination recovery owns retry timing while the pulse only decorates its current pending episode',()=>{
 const f=surfaces(),state=pending();let presentation,retries=0,mount;
 const sync=()=>{presentation=recovery.update({scope:state.scope,visible:!f.document.hidden});state.pendingScope=presentation?.scope;state.pending=presentation?.pending===true;state.failure=presentation?.kind;mount?.update();};
 const recovery=createDestinationRecovery({clock:f.time.clock,setTimer:f.time.setTimeout,clearTimer:f.time.clearTimeout,onChange:sync,onRetry:()=>{retries++;recovery.begin(state.scope);sync();}});
 mount=mountRouteHeldPulse({...f,getState:()=>state});recovery.begin(state.scope);sync();f.time.advance(200);assert.equal(f.active(),'true');assert.equal(recovery.update({scope:state.scope,visible:true}).elapsed,200);
 recovery.fail(state.scope,{status:503,retryAfterMs:1000});sync();assert.equal(f.active(),'false');f.time.advance(999);assert.equal(retries,0);f.time.advance(1);assert.equal(retries,1);assert.equal(f.active(),'false');f.time.advance(200);assert.equal(f.active(),'true');
 state.ready=true;state.phase='revealing';recovery.reset();sync();assert.equal(f.active(),'false');assert.equal(f.time.timers.size,0);mount.destroy();
});
test('terminal failure and owner replacement stay static',()=>{
 const f=surfaces(),state=pending();const recovery=createDestinationRecovery({clock:f.time.clock,setTimer:f.time.setTimeout,clearTimer:f.time.clearTimeout});const mount=mountRouteHeldPulse({...f,getState:()=>state});
 recovery.begin(state.scope);let result=recovery.update({scope:state.scope,visible:true});Object.assign(state,{pendingScope:result.scope,pending:result.pending});mount.update();f.time.advance(200);assert.equal(f.active(),'true');
 recovery.fail(state.scope,{status:404});result=recovery.update({scope:state.scope,visible:true});Object.assign(state,{pending:result.pending,failure:result.kind});mount.update();assert.equal(f.active(),'false');state.scope='2:3:game:other:1';state.owner={};mount.update();f.time.advance(10000);assert.equal(f.active(),'false');recovery.reset();mount.destroy();assert.equal(f.time.timers.size,0);
});
