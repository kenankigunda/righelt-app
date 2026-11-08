import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../../e2e/workflows/destruction-lifecycle.spec.mjs',import.meta.url),'utf8');
const start=source.indexOf('function armDestructionWitness('),end=source.indexOf('const observedCount=',start);
assert(start>=0&&end>start);
function harness(count=2,motion=true){
 let nodes=[],at=0,observer,disconnected=false,next=0;const frames=new Map();
 const context={window:{},performance:{now:()=>at},document:{querySelector:()=>({}),querySelectorAll:()=>nodes},
  MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){disconnected=true;}},
  requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.armDestructionWitness({key:'proof',count,signatures:motion?['6,4:Red unit','7,4:Red unit']:null});
 const entry=context.window.destructionWitnesses.proof;
 const make=(row,col,id)=>{const animation={currentTime:0,playState:'running',delay:0,duration:2400,effect:{getComputedTiming(){return {activeDuration:animation.duration,delay:animation.delay};}}};
  return {animation,node:{getAnimations:()=>[animation],closest:()=>({dataset:{row:String(row),col:String(col)}}),getAttribute:name=>name==='aria-label'?'Red unit':id}};};
 return {entry,make,add(values,time=0){at=time;nodes=values.map(v=>v.node);observer();},frame(time){at=time;const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn();},get clean(){return disconnected&&frames.size===0;}};
}
const pair=h=>[h.make(6,4,'U1-2'),h.make(7,4,'U1-3')];
test('actual early DOM sample proves native advancement on first1112ms RAF before next1641ms expiry gap',async()=>{
 const h=harness(),values=pair(h);h.add(values,14);values.forEach(v=>v.animation.currentTime=1112);h.frame(1126);
 const result=await h.entry.promise;assert.equal(result.first[0].nativeTime,0);assert.equal(result.next[0].nativeTime,1112);assert(h.clean);
 h.add([],2767);assert.equal(h.entry.witness.outcome,'advanced');
});
test('legal replacement re-primes and requires later SAME native animation advancement',async()=>{
 const h=harness(),first=pair(h);h.add(first);first.forEach(v=>v.animation.currentTime=50);
 const replacement=pair(h);replacement.forEach(v=>v.animation.delay=-100);h.add(replacement,100);
 assert.equal(h.entry.witness.outcome,'pending');assert.equal(h.entry.witness.replacements,1);
 replacement.forEach(v=>v.animation.currentTime=16);h.frame(116);const result=await h.entry.promise;
 assert(result.next.every((s,i)=>s.nodeId===result.first[i].nodeId&&s.animationId===result.first[i].animationId));assert(h.clean);
});
test('replacement and elapsed retiming alone never qualify as native movement',async()=>{
 const h=harness(),first=pair(h);h.add(first);const replacement=pair(h);replacement.forEach(v=>v.animation.delay=-100);h.add(replacement,100);h.frame(110);
 replacement.forEach(v=>v.animation.delay=-150);h.add(replacement,150);h.frame(160);
 assert.equal(h.entry.witness.outcome,'pending');h.entry.dispose();await assert.rejects(h.entry.promise,/disposed/);assert(h.clean);
});
test('logical phase reset across replacement refuses',async()=>{
 const h=harness(),first=pair(h);first.forEach(v=>v.animation.delay=-200);h.add(first);h.add(pair(h),10);
 await assert.rejects(h.entry.promise,/logical timeline reset/);assert(h.clean);
});
test('same-object native clock reset refuses',async()=>{
 const h=harness(),values=pair(h);values.forEach(v=>v.animation.currentTime=100);h.add(values);values.forEach(v=>v.animation.currentTime=99);h.frame(1);
 await assert.rejects(h.entry.promise,/timeline reset/);assert(h.clean);
});
for(const kind of ['paused','missing','wrong duration','wrong piece'])test('actual witness refuses '+kind,async()=>{
 const h=harness(),values=pair(h);h.add(values);
 if(kind==='paused')values[0].animation.playState='paused';
 if(kind==='wrong duration')values[0].animation.duration=2300;
 if(kind==='wrong piece')values[0].node.getAttribute=name=>name==='aria-label'?'Red unit':'FOREIGN';
 if(kind==='missing')h.add([],20);else h.frame(20);
 await assert.rejects(h.entry.promise);assert(h.clean);
});
test('null currentTime waits for a qualified native interval; unchanged running clock stays pending',async()=>{
 const h=harness(),values=pair(h);values.forEach(v=>v.animation.currentTime=null);h.add(values);assert.equal(h.entry.witness.outcome,'pending');
 values.forEach(v=>v.animation.currentTime=0);h.frame(1);h.frame(2);assert.equal(h.entry.witness.outcome,'pending');
 values.forEach(v=>v.animation.currentTime=1);h.frame(3);await h.entry.promise;assert(h.clean);
});
test('count-only observer records first complete delivery without hidden-client animation frames',async()=>{
 for(const count of [2,5]){const h=harness(count,false),values=Array.from({length:count},(_,i)=>h.make(i,0,String(i)));h.add(values.slice(1));assert.equal(h.entry.witness.outcome,'pending');h.add(values);assert.equal((await h.entry.promise).count,count);assert(h.clean);}
});
test('owned pending observers and frames detach on disposal, with an immediate rejection owner',async()=>{
 const h=harness();h.entry.dispose();await assert.rejects(h.entry.promise,/disposed/);assert(h.clean);
});
test('integer adapter replacement preserves fractional phase, but a prior integer phase refuses',async()=>{
 for(const replacementPhase of [102,101]){
  const h=harness(),first=pair(h);first.forEach(v=>v.animation.currentTime=102.8);h.add(first);
  const replacement=pair(h);replacement.forEach(v=>v.animation.delay=-replacementPhase);h.add(replacement,103);
  if(replacementPhase===101){await assert.rejects(h.entry.promise,/logical timeline reset/);assert(h.clean);continue;}
  assert.equal(h.entry.witness.outcome,'pending');replacement.forEach(v=>v.animation.currentTime=0.5);h.frame(104);
  const result=await h.entry.promise;assert.equal(result.first[0].elapsed,102);assert.equal(result.next[0].nativeTime,0.5);assert(h.clean);
 }
});
test('mixed replacement keeps strict fractional reset detection on retained native objects',async()=>{
 const h=harness(),first=pair(h);first.forEach(v=>v.animation.currentTime=102.8);h.add(first);
 const replacement=h.make(6,4,'U1-2');replacement.animation.delay=-102;
 first[1].animation.currentTime=102.5;h.add([replacement,first[1]],103);
 await assert.rejects(h.entry.promise,/logical timeline reset/);assert(h.clean);
});
