import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createComputerReplay} from '../shell/computer-replay.js';
const read=file=>readFileSync(new URL('../shell/'+file,import.meta.url),'utf8');
const ownerSource=read('board-context-owner.js'),starterSource=read('displayed-replay-starter.js');
function fixture({onRetire=()=>{}}={}){
 const q=[],reveals=[],events=new Map(),windowEvents=new Map();let scope={owner:{},key:'scope'},active;
 const listeners=(map)=>({addEventListener(k,f){if(!map.has(k))map.set(k,new Set());map.get(k).add(f);},removeEventListener(k,f){map.get(k)?.delete(f);}});
 const win=listeners(windowEvents),doc={...listeners(events),defaultView:win,hidden:false,get activeElement(){return active;}};
 const fire=(type,target)=>{for(const f of [...events.get(type)??[]])f({target,key:type==='keydown'?'Tab':undefined});};
 const node=(kind)=>({kind,isConnected:true,disabled:false,inert:false,style:{},closest(selector){return selector==='[inert]'&&this.inert?this:null;},setAttribute(){},addEventListener(){},appendChild(){},remove(){this.isConnected=false;},querySelectorAll(){return[];},focus(){active=this;fire('focusin',this);}});
 const body=node('body'),trigger=node('trigger'),stop=node('stop'),next=node('next'),other=node('outside');doc.body=body;active=trigger;doc.createElement=()=>node('layer');
 const c={queueMicrotask:f=>q.push(f)};runInNewContext(ownerSource.replaceAll('export function ','function ')+'\nglobalThis.factory={createBoardContextOwner,createBoardContextFocus};',c);
 const owner=c.factory.createBoardContextOwner({store:{clear(){}},getScope:()=>scope});owner.commit('intent');const focus=c.factory.createBoardContextFocus({doc,owner,enqueue:f=>q.push(f),reveal:target=>reveals.push(target)});
 const request=focus.begin(trigger,{allows:target=>target===stop||target===next,onRetire});
 return {q,reveals,doc,win,events,windowEvents,node,body,trigger,stop,next,other,owner,focus,request,fire,setActive:x=>active=x,remove:control=>{control.isConnected=false;if(active===control)active=body;},scopeChange(){scope={owner:{},key:'next'};},blur(){for(const f of [...windowEvents.get('blur')??[]])f();},async flush(){while(q.length)q.shift()();await Promise.resolve();},assertClean(){assert.equal([...events.values()].reduce((s,v)=>s+v.size,0),0);assert.equal([...windowEvents.values()].reduce((s,v)=>s+v.size,0),0);}};
}
test('exact synchronous owner refresh can return after removing the focused allowed control, once',()=>{const f=fixture();f.stop.focus();let calls=0;f.request.renderOwnedRemoval(()=>{calls++;f.remove(f.stop);});assert.equal(calls,1);assert.equal(f.request.restoreNow(()=>f.trigger),f.trigger);assert.equal(f.reveals.length,1);assert.equal(f.request.restoreNow(()=>f.trigger),null);f.assertClean();});
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
function actualCallbacks(f,{removeInPreview=false}={}){
 const source=starterSource;
 const anchor=source.indexOf('const controller=createReplay({rootEl');const start=source.indexOf('onChange:',anchor)+9,end=source.indexOf(',onFinish:finish',start),onChange=source.slice(start,end);
 const finishStart=source.indexOf('  const refresh=playing=>'),finishEnd=source.indexOf('\n  const controller=createReplay',finishStart);let playing=false,controller;
 const runtime={setInteractionBlocked(value){playing=value;},refreshStatus(){if(!playing)f.remove(f.stop);}};
 const state={activeDisplayedReplay:{},activeReplayFocusCleanup:f.request.release},p={queue(){f.q.push(()=>{f.trigger.disabled=playing;});},canReplayDisplayed:()=>true,boardFocusTarget:()=>f.trigger};
 const d={boardRuntime:runtime,forcedFollowWorking:()=>false,confirmedPlayback:null,CSS:{escape:x=>x},appEl:{querySelector:()=>f.trigger}};
 const c={gameId:'g',focusReturn:f.request,trigger:f.trigger,state,p,d,getDependencies:()=>d,descriptor:{key:'context'},host:'context'};
 runInNewContext(source.slice(finishStart,finishEnd)+'\nglobalThis.finish=finish;\nglobalThis.change=('+onChange+');',c);
 controller=createComputerReplay({rootEl:{ownerDocument:f.doc,appendChild(){}},createAdapter:()=>({}),createPreview:()=>({update(){},destroy(){if(removeInPreview)f.remove(f.stop);}}),onChange:c.change,onFinish:c.finish,reducedMotion:()=>true});
 return {controller,finish:c.finish};
}
for(const early of [false,true])test('actual replay stop→onChange→finish ordering '+(early?'refuses already removed preview control':'returns only control removed by status refresh'),async()=>{const f=fixture(),a=actualCallbacks(f,{removeInPreview:early});await a.controller.play({gameId:'game',revision:1,lineageHead:'head',frames:[{action:{type:'pass'},before:{pieces:[]},after:{pieces:[]}}]});await f.flush();f.stop.focus();a.controller.stop();await f.flush();assert.equal(f.doc.activeElement,early?f.body:f.trigger);assert.equal(f.reveals.length,early?0:1);a.controller.destroy();f.focus.destroy();f.assertClean();});
test('actual app callback reads playing once and calls original refresh once with the correct runtime receiver',()=>{const f=fixture();const anchor=starterSource.indexOf('const controller=createReplay({rootEl');const start=starterSource.indexOf('onChange:',anchor)+9,end=starterSource.indexOf(',onFinish:finish',start),refreshStart=starterSource.indexOf('  const refresh=playing=>'),refreshEnd=starterSource.indexOf('\n  const finish=',refreshStart);let reads=0,calls=0,blocked=0;const runtime={setInteractionBlocked(value){assert.equal(this,runtime);assert.equal(value,true);blocked++;},refreshStatus(){assert.equal(this,runtime);calls++;}};const d={boardRuntime:runtime,forcedFollowWorking:()=>false,confirmedPlayback:null};const c={gameId:'g',p:{queue(){}},d,getDependencies:()=>d};runInNewContext(starterSource.slice(refreshStart,refreshEnd)+'\nglobalThis.change=('+starterSource.slice(start,end)+');',c);c.change({get playing(){reads++;return true;}});assert.equal(reads,1);assert.equal(calls,1);assert.equal(blocked,1);f.focus.destroy();f.assertClean();});

test('renderer primary survives a throwing retirement callback and every owned listener is removed',()=>{const primary=Error('render-primary'),secondary=Error('retire-secondary');let retired=0;const f=fixture({onRetire(){retired++;throw secondary;}});f.stop.focus();assert.throws(()=>f.request.renderOwnedRemoval(()=>{f.remove(f.stop);throw primary;}),error=>error===primary);assert.equal(retired,1);assert.equal(f.request.current(),false);f.assertClean();});
test('ordinary release still reports its retirement error after guaranteed owned listener cleanup',()=>{const secondary=Error('retire');const f=fixture({onRetire(){throw secondary;}});assert.throws(()=>f.request.release(),error=>error===secondary);f.assertClean();});
