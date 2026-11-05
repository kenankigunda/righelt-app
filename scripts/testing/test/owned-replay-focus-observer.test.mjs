import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformOwnedFocusModule,installOwnedFocusCollector,createOwnedFocusLedger,PREFIX,installOwnedFocusObservation} from '../../../e2e/support/owned-replay-focus-observer.mjs';
const recipes=JSON.parse(readFileSync(new URL('../../../e2e/support/owned-replay-focus-recipes.json',import.meta.url)));
const root=new URL('../../../',import.meta.url);
const source=r=>readFileSync(new URL(r.file,root),'utf8');
function fixture(transformed,{sinkThrows=false,initialFocus=true}={}){
 const recipe=recipes[0],rows=[],q=[],reads={active:0,scope:0,allows:0,focus:0,reveal:0,retire:0};
 const listeners=new Map(),winListeners=new Map(),body={},trigger={isConnected:true,disabled:false,closest(){return null;}},stop={isConnected:true};let active=initialFocus?trigger:body;
 const doc={body,hidden:false,defaultView:{addEventListener:(k,f)=>winListeners.set(k,f),removeEventListener:(k,f)=>{assert.equal(winListeners.get(k),f);winListeners.delete(k);}},get activeElement(){reads.active++;return active;},addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k,f)=>{assert.equal(listeners.get(k),f);listeners.delete(k);}};
 trigger.focus=function(options){assert.equal(this,trigger);assert.equal(options.preventScroll,true);reads.focus++;active=trigger;};
 let scope={owner:{},key:'secret-scope'};
 const c={__ownedFocusProbe:{record(...a){rows.push(a);if(sinkThrows)throw Error('sink');}},queueMicrotask:f=>q.push(f)};
 let code=source(recipe);if(transformed)code=transformOwnedFocusModule(code,recipe);
 runInNewContext(code.replaceAll('export function ','function ')+'\nglobalThis.factories={createBoardContextOwner,createBoardContextFocus};',c);
 const owner=c.factories.createBoardContextOwner({store:{clear(){}},getScope(){reads.scope++;return scope;}});owner.commit('secret-intent');
 const focus=c.factories.createBoardContextFocus({doc,owner,reveal(){reads.reveal++;},enqueue:f=>q.push(f)});
 const begin=()=>focus.begin(trigger,{allows:node=>{reads.allows++;return node===stop;},onRetire(){reads.retire++;}});
 return {rows,reads,trigger,stop,body,doc,owner,focus,begin,q,listeners,winListeners,setActive:x=>{active=x;},changeScope:()=>{scope={owner:{},key:'new-secret'};}};
}
for(const r of recipes)test('exact guarded transform '+r.file,()=>{assert.notEqual(transformOwnedFocusModule(source(r),r),source(r));assert.throws(()=>transformOwnedFocusModule(source(r)+' ',r),/source-binding/);assert.throws(()=>transformOwnedFocusModule(source(r),{...r,outputSha256:'0'.repeat(64)}),/output-binding/);assert.throws(()=>transformOwnedFocusModule(source(r),{...r,operations:[{...r.operations[0],start:-1}]}),/range-binding/);});
for(const scenario of ['owned','unfocused','removed','outside-focus','outside-pointer','tab','blur','hidden','scope','intent'])test('original authority, reads and cleanup preserved: '+scenario,async()=>{
 const results=[];
 for(const transformed of [false,true]){
  const f=fixture(transformed,{sinkThrows:true,initialFocus:scenario!=='unfocused'}),request=f.begin();
  if(scenario==='removed'){f.setActive(f.stop);f.stop.isConnected=false;f.setActive(f.body);}
  if(scenario==='outside-focus'){f.setActive(f.body);f.listeners.get('focusin')({target:f.body});}
  if(scenario==='outside-pointer')f.listeners.get('pointerdown')({target:f.body});
  if(scenario==='tab')f.listeners.get('keydown')({target:f.trigger,key:'Tab'});
  if(scenario==='blur')f.winListeners.get('blur')();
  if(scenario==='hidden'){f.doc.hidden=true;f.listeners.get('visibilitychange')();}
  if(scenario==='scope')f.changeScope();
  if(scenario==='intent')f.owner.commit('next-secret');
  const value=request.restoreNow(()=>f.trigger);results.push({returned:value===f.trigger,reads:f.reads});
  assert.equal(f.listeners.size,0);assert.equal(f.winListeners.size,0);
  if(transformed)assert(f.rows.some(r=>r[0]==='begin-live'));
 }
 assert.deepEqual(results[0],results[1]);assert.equal(results[0].returned,scenario==='owned');
});
test('queued restore preserves original enqueue count and target getter errors',async()=>{
 for(const transformed of [false,true]){const f=fixture(transformed),r=f.begin(),primary=Error('resolve');assert.throws(()=>r.restoreNow(()=>{throw primary;}),e=>e===primary);r.release();const next=f.begin(),promise=next.restore(()=>f.trigger);assert.equal(f.q.length,1);f.q[0]();assert.equal(await promise,f.trigger);assert.equal(f.reads.focus,1);}
});
test('collector emits opaque original values without invoking getters; ingress rejects raw IDs',()=>{
 const texts=[],c={console:{debug:s=>texts.push(s)}};runInNewContext('('+installOwnedFocusCollector.toString()+')()',c);let reads=0;const obj={get value(){reads++;throw Error('getter');}};c.__ownedFocusProbe.record('begin-active',obj);c.__ownedFocusProbe.record('capture-scope','SECRET_SCOPE');assert.equal(reads,0);assert(!texts.join('').includes('SECRET_SCOPE'));const ledger=createOwnedFocusLedger();for(const s of texts)ledger.accept(s,1);ledger.accept(PREFIX+JSON.stringify({schema:1,seq:3,kind:'begin-active',scope:0,value:'SECRET_SCOPE',present:true}),1);const result=ledger.freeze();assert.equal(result.received,2);assert.equal(result.incomplete,true);assert.equal(result.receivedWindowIncomplete,true);assert(!JSON.stringify(result).includes('SECRET_SCOPE'));
});
test('bounded emission and retained evidence explicitly remain incomplete without browser ACK',()=>{
 const texts=[],c={console:{debug:s=>texts.push(s)}};runInNewContext('('+installOwnedFocusCollector.toString()+')()',c);for(let i=0;i<2200;i++)c.__ownedFocusProbe.record('return-current',true);assert.equal(texts.length,2049);const ledger=createOwnedFocusLedger();for(const s of texts)ledger.accept(s,1);const r=ledger.freeze();assert.equal(r.received,2049);assert.equal(r.dropped,1665);assert.equal(r.incomplete,true);assert.equal(r.browserFinalAcknowledged,false);assert.equal(r.generationVerified,false);
});
test('unroute failures still drain all routes, remove exact listener, preserve primary error',async()=>{
 const pending=[],listeners=new Map(),routes=[];let unroutes=0,release,attached;
 const context={on:(k,f)=>listeners.set(k,f),off:(k,f)=>{assert.equal(listeners.get(k),f);listeners.delete(k);},addInitScript:async()=>{},route:async(m,f)=>routes.push([m,f]),unroute:async()=>{unroutes++;throw Error('unroute');}};
 const observation=await installOwnedFocusObservation(context,{baseURL:'http://127.0.0.1:9089',recipes});const held=new Promise(r=>release=r);
 const task=routes[0][1]({fetch:async()=>{await held;return {status:()=>200,text:async()=>source(recipes[0])};},request:()=>({method:()=> 'GET'}),fulfill:async()=>{}});
 let done=false;const finishing=observation.finish({attach:async(_n,{body})=>{attached=JSON.parse(body);}}).then(()=>done=true);await Promise.resolve();await Promise.resolve();assert.equal(done,false);release();await task;await finishing;assert.equal(unroutes,2);assert.equal(listeners.size,0);assert.equal(attached.metadata.cleanupIncomplete,true);assert.equal(attached.snapshot.incomplete,true);
});
