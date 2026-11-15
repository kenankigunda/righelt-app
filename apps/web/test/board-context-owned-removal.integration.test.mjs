import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=file=>readFileSync(new URL('../shell/'+file,import.meta.url),'utf8');
const ownerSource=read('board-context-owner.js');
function fixture({onRetire=()=>{},allowDeferredRemoval=false}={}){
 const q=[],reveals=[],events=new Map(),windowEvents=new Map();let scope={owner:{},key:'scope'},active;
 const listeners=(map)=>({addEventListener(k,f){if(!map.has(k))map.set(k,new Set());map.get(k).add(f);},removeEventListener(k,f){map.get(k)?.delete(f);}});
 const win=listeners(windowEvents),doc={...listeners(events),defaultView:win,hidden:false,get activeElement(){return active;}};
 const fire=(type,target)=>{for(const f of [...events.get(type)??[]])f({target,key:type==='keydown'?'Tab':undefined});};
 const node=(kind)=>({kind,isConnected:true,disabled:false,inert:false,style:{},closest(selector){return selector==='[inert]'&&this.inert?this:null;},setAttribute(){},addEventListener(){},appendChild(){},remove(){this.isConnected=false;},querySelectorAll(){return[];},focus(){active=this;fire('focusin',this);}});
 const body=node('body'),trigger=node('trigger'),stop=node('stop'),next=node('next'),other=node('outside');doc.body=body;active=trigger;doc.createElement=()=>node('layer');
 const c={queueMicrotask:f=>q.push(f)};runInNewContext(ownerSource.replaceAll('export function ','function ')+'\nglobalThis.factory={createBoardContextOwner,createBoardContextFocus};',c);
 const owner=c.factory.createBoardContextOwner({store:{clear(){}},getScope:()=>scope});owner.commit('intent');const focus=c.factory.createBoardContextFocus({doc,owner,enqueue:f=>q.push(f),reveal:target=>reveals.push(target)});
 const request=focus.begin(trigger,{allows:target=>['stop','next'].includes(target?.kind),allowDeferredRemoval,onRetire});
 return {q,reveals,doc,win,events,windowEvents,node,body,trigger,stop,next,other,owner,focus,request,fire,setActive:x=>active=x,remove:control=>{control.isConnected=false;if(active===control)active=body;},scopeChange(){scope={owner:{},key:'next'};},blur(){for(const f of [...windowEvents.get('blur')??[]])f();},async flush(){while(q.length)q.shift()();await Promise.resolve();},assertClean(){assert.equal([...events.values()].reduce((s,v)=>s+v.size,0),0);assert.equal([...windowEvents.values()].reduce((s,v)=>s+v.size,0),0);}};
}
test('exact synchronous owner refresh can return after removing the focused allowed control, once',()=>{const f=fixture();f.stop.focus();let calls=0;f.request.renderOwnedRemoval(()=>{calls++;f.remove(f.stop);});assert.equal(calls,1);assert.equal(f.request.restoreNow(()=>f.trigger),f.trigger);assert.equal(f.reveals.length,1);assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();});
test('explicit deferred-removal ownership returns after the focused replay step is removed by the queued render',()=>{const f=fixture({allowDeferredRemoval:true});f.next.focus();f.remove(f.next);assert.equal(f.request.restoreNow(()=>f.trigger),f.trigger);assert.deepEqual(f.reveals,[f.trigger]);f.assertClean();});
test('explicit deferred-removal ownership returns after the focused replay step is repurposed by the queued render',()=>{const f=fixture({allowDeferredRemoval:true});f.next.focus();f.next.kind='pass';f.setActive(f.body);assert.equal(f.request.restoreNow(()=>f.trigger),f.trigger);assert.deepEqual(f.reveals,[f.trigger]);f.assertClean();});
for(const state of ['initial-body','unknown-active','trigger','connected-control','removed-before-capture','reconnected-control','async-render','nonvoid-render'])test('no removal permission for '+state,async()=>{
 const f=fixture();f.stop.focus();
 if(state==='initial-body')f.setActive(f.body);
 if(state==='unknown-active')f.setActive(f.other);
 if(state==='trigger')f.setActive(f.trigger);
 if(state==='removed-before-capture')f.remove(f.stop);
 let pending;
 const callback=()=>{
  if(state==='connected-control'){f.setActive(f.body);return;}
  if(state==='async-render'){pending=Promise.resolve().then(()=>f.remove(f.stop));return pending;}
  if(state==='trigger'){f.remove(f.trigger);return;}
  f.remove(f.stop);
  if(state==='unknown-active')f.setActive(f.other);
  if(state==='nonvoid-render')return {};
 };
 f.request.renderOwnedRemoval(callback);if(pending)await pending;
 if(state==='reconnected-control')f.stop.isConnected=true;
 assert.equal(f.request.restoreNow(()=>f.trigger),null);assert.equal(f.reveals.length,0);f.assertClean();
});
for(const state of ['outside-focus','outside-pointer','Tab','blur','hidden','scope','intent','destroy','next-boundary'])test('captured removal retires on '+state,()=>{const f=fixture();f.stop.focus();f.request.renderOwnedRemoval(()=>f.remove(f.stop));
 if(state==='outside-focus')f.other.focus();if(state==='outside-pointer')f.fire('pointerdown',f.other);if(state==='Tab')f.fire('keydown',f.stop);if(state==='blur')f.blur();if(state==='hidden'){f.doc.hidden=true;f.fire('visibilitychange');}if(state==='scope')f.scopeChange();if(state==='intent')f.owner.commit('new');if(state==='destroy')f.focus.destroy();if(state==='next-boundary')f.request.renderOwnedRemoval(()=>{});
 assert.equal(f.request.restoreNow(()=>f.trigger),null);assert.equal(f.reveals.length,0);f.assertClean();});
test('outside intent during renderer cannot grant a body return',()=>{const f=fixture();f.stop.focus();f.request.renderOwnedRemoval(()=>{f.fire('pointerdown',f.other);f.remove(f.stop);});assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();});
test('renderer exception retains identity and releases captured continuation and listeners',()=>{const f=fixture(),primary=Error('original-render');f.stop.focus();assert.throws(()=>f.request.renderOwnedRemoval(()=>{f.remove(f.stop);throw primary;}),error=>error===primary);assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();});
test('disabled or inert capture cannot borrow a later removal',()=>{for(const flag of ['disabled','inert']){const f=fixture();f.stop.focus();f.stop[flag]=true;f.request.renderOwnedRemoval(()=>f.remove(f.stop));assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();}});
test('only exact captured control removal grants, not removal of another allowed control',()=>{const f=fixture();f.stop.focus();f.request.renderOwnedRemoval(()=>{f.next.isConnected=false;f.setActive(f.body);});assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();});
test('removed target still uses current resolver and rejects disabled/inert/disconnected replacements',()=>{for(const flag of [null,'disabled','inert','isConnected']){const f=fixture();f.stop.focus();f.request.renderOwnedRemoval(()=>{f.remove(f.stop);f.trigger.isConnected=false;});const target=f.node('replacement');if(flag)target[flag]=flag!=='isConnected';assert.equal(f.request.restoreNow(()=>target),flag?null:target);f.assertClean();}});
test('renderer primary survives a throwing retirement callback and every owned listener is removed',()=>{const primary=Error('render-primary'),secondary=Error('retire-secondary');let retired=0;const f=fixture({onRetire(){retired++;throw secondary;}});f.stop.focus();assert.throws(()=>f.request.renderOwnedRemoval(()=>{f.remove(f.stop);throw primary;}),error=>error===primary);assert.equal(retired,1);assert.equal(f.request.current(),false);f.assertClean();});
test('ordinary release still reports its retirement error after guaranteed owned listener cleanup',()=>{const secondary=Error('retire');const f=fixture({onRetire(){throw secondary;}});assert.throws(()=>f.request.release(),error=>error===secondary);f.assertClean();});
