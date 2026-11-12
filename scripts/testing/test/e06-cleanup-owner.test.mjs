import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFaultLifecycle,disposeFaultContexts} from '../../../e2e/support/fault-lifecycle.mjs';
function actualFixture(){
 const source=readFileSync(new URL('../../../e2e/workflows/sync-recovery-pressure.spec.mjs',import.meta.url),'utf8');
 const start=source.indexOf('const owned = new WeakMap();'),end=source.indexOf("import {createGameFromHome",start);
 assert.ok(start>=0&&end>start);
 let definitions;
 const context=vm.createContext({WeakMap,Map,Set,cleanup:disposeFaultContexts,base:{extend(value){definitions=value;return {info(){throw Error('manual cleanup must not run');}};}}});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.fixtureOwned=owned;',context);
 const [fixture,options]=definitions.faultCleanup;assert.equal(options.auto,true);
 return {fixture,owned:context.fixtureOwned};
}
function setup(resources,{unrouteFailure,closeFailure,alreadyClosed=false}={}){
 const calls=[],timers=new Map(),contexts=[],faults=[];let next=0;
 for(let i=0;i<3;i++){
  const context={closed:alreadyClosed&&i===0,async unrouteAll(options){calls.push(['unroute',i,options.behavior]);if(i===1&&unrouteFailure)throw unrouteFailure;},async close(){calls.push(['close',i]);this.closed=true;if(i===1&&closeFailure)throw closeFailure;}};
  contexts.push(context);resources.contexts.add(context);resources.faults.set(context,[]);
 }
 for(let i=0;i<4;i++){
  const context=contexts[i===3?0:i],lifecycle=createFaultLifecycle({setTimer(callback){const id=++next;timers.set(id,callback);return id;},clearTimer(id){timers.delete(id);}});
  const dispose=lifecycle.dispose;lifecycle.dispose=async()=>{calls.push(['dispose',i]);await dispose();};
  lifecycle.schedule(()=>{throw Error('stopped timer must not run');},1);
  resources.faults.get(context).push(lifecycle);faults.push(lifecycle);
 }
 return {calls,timers,contexts,faults};
}
function assertClean(state,resources){
 assert.equal(resources.faults.size,0);assert.equal(resources.contexts.size,0);assert.equal(state.timers.size,0);
 for(let i=0;i<3;i++){assert.equal(state.calls.filter(c=>c[0]==='unroute'&&c[1]===i).length,1);assert.equal(state.calls.filter(c=>c[0]==='close'&&c[1]===i).length,1);assert.equal(state.contexts[i].closed,true);}
 for(let i=0;i<4;i++){assert.equal(state.calls.filter(c=>c[0]==='dispose'&&c[1]===i).length,1);assert.equal(state.faults[i].disposed,true);}
 assert.ok(state.calls.filter(c=>c[0]==='unroute').every(c=>c[2]==='wait'));
}
test('actual automatic fixture alone disposes three contexts and four lifecycles including same-context twin',async()=>{
 const {fixture,owned}=actualFixture(),info={};let resources,state,bodyFinished=false;
 await fixture({context:{}},async()=>{
  resources=owned.get(info);state=setup(resources);assert.equal(resources.faults.get(state.contexts[0]).length,2);
  assert.equal(state.calls.length,0);bodyFinished=true;
 },info);
 assert.equal(bodyFinished,true);assertClean(state,resources);assert.equal(owned.has(info),false);
});
test('actual automatic fixture runs cleanup on body failure and preserves that error when cleanup succeeds',async()=>{
 const {fixture,owned}=actualFixture(),info={},primary=new Error('original body failure');let resources,state;
 await assert.rejects(fixture({context:{}},async()=>{resources=owned.get(info);state=setup(resources);throw primary;},info),error=>error===primary);
 assertClean(state,resources);assert.equal(owned.has(info),false);
});
for(const stage of ['unroute','close'])test(`${stage} failure propagates while every other owned context and lifecycle is still drained`,async()=>{
 const {fixture,owned}=actualFixture(),info={},failure=new Error(stage+' failure');let resources,state;
 await assert.rejects(fixture({context:{}},async()=>{resources=owned.get(info);state=setup(resources,{[stage+'Failure']:failure});},info),error=>error instanceof AggregateError&&error.message.includes(stage+' failure'));
 assertClean(state,resources);assert.equal(owned.has(info),false);
});
test('a real lifecycle asynchronous failure is retained through automatic fixture cleanup',async()=>{
 const {fixture,owned}=actualFixture(),info={};let resources,state;
 await assert.rejects(fixture({context:{}},async()=>{
  resources=owned.get(info);state=setup(resources);await state.faults[3].run(async()=>{throw new Error('twin route failure');});
 },info),error=>error instanceof AggregateError&&error.message.includes('twin route failure'));
 assertClean(state,resources);assert.equal(owned.has(info),false);
});
test('already-closed owned context does not skip other contexts or cause duplicate disposal',async()=>{
 const {fixture,owned}=actualFixture(),info={};let resources,state;
 await fixture({context:{}},async()=>{resources=owned.get(info);state=setup(resources,{alreadyClosed:true});},info);
 assertClean(state,resources);assert.equal(owned.has(info),false);
});
test('actual fixture awaits pending real lifecycle work before finishing the owned context close',async()=>{
 const {fixture,owned}=actualFixture(),info={},events=[];let resources,state;
 await fixture({context:{}},async()=>{
  resources=owned.get(info);state=setup(resources);
  void state.faults[3].run(async()=>{await state.faults[3].wait(1);events.push('pending-settled');});
  await Promise.resolve();events.push('body-finished');
  const close=state.contexts[0].close;state.contexts[0].close=async()=>{events.push('context-close');await close.call(state.contexts[0]);};
 },info);
 assert.deepEqual(events,['body-finished','pending-settled','context-close']);assertClean(state,resources);assert.equal(owned.has(info),false);
});
test('actual old E06 closes resources inside the body; current E06 leaves them to the real automatic fixture',async()=>{
 const current=readFileSync(new URL('../../../e2e/workflows/sync-recovery-pressure.spec.mjs',import.meta.url),'utf8');
 async function execute(source){
  const info={},events=[],semanticFaults=Array.from({length:4},()=>({commands:[],receive:false,loseReply:false}));let definition,resources,state;
  const makeTest=value=>{definition=value;return {info:()=>info};};
  const expect=value=>({toContainText:async wanted=>assert.ok(value.text.includes(wanted)),toHaveLength:wanted=>assert.equal(value.length,wanted),toBe:wanted=>assert.equal(value,wanted)});
  expect.poll=read=>({toBeGreaterThan:async wanted=>assert.ok((await read())>wanted),toBe:async wanted=>assert.equal(await read(),wanted)});
  const twin={async goto(){events.push('goto');},getByTestId(){return {text:'Guest 1'};},async reload(){events.push('reload');}};
  const context=vm.createContext({WeakMap,Map,Set,JSON,cleanup:disposeFaultContexts,base:{extend:makeTest},expect,
   party:async()=>{
    resources=context.fixtureOwned.get(info);state=setup(resources);
    // The controlled wire collaborator registers the real fourth lifecycle on
    // the original shared context when the actual E06 callback creates its twin.
    resources.faults.get(state.contexts[0]).pop();
    state.contexts[0].newPage=async()=>twin;
    return {contexts:state.contexts,pages:[{},{},{}],faults:semanticFaults.slice(0,3),gameId:'controlled-game',gameHash:'#/game/controlled-game'};
   },
   wire:async()=>{resources.faults.get(state.contexts[0]).push(state.faults[3]);return semanticFaults[3];},
   move:async()=>{semanticFaults[0].commands.push({clientCommandId:'same-command'});},
   converged:async()=>events.push('converged'),digest:async()=>({history:[{id:'same-move'}]}),
   evidence:async(_info,name,_start,faults)=>{assert.equal(name,'same-identity-tabs');assert.equal(faults.length,4);events.push('evidence');},
  });
  const fixtureStart=source.indexOf('const owned = new WeakMap();'),fixtureEnd=source.indexOf('import {createGameFromHome',fixtureStart);
  vm.runInContext(source.slice(fixtureStart,fixtureEnd)+'\nglobalThis.fixtureOwned=owned;',context);
  const anchor=source.indexOf("test('E06 same identity tabs reconcile one journal without duplicating a committed move'"),bodyStart=source.indexOf('async({browser,baseURL},info)=>{',anchor),bodyEnd=source.indexOf('\nfor(const phase',bodyStart);
  assert.ok(anchor>=0&&bodyStart>anchor&&bodyEnd>bodyStart);
  const callback=source.slice(bodyStart,bodyEnd).trim();assert.ok(callback.endsWith(');'));
  vm.runInContext('globalThis.actualE06=('+callback.slice(0,-2)+');',context);
  const [fixture,options]=definition.faultCleanup;assert.equal(options.auto,true);
  let primary;
  try{await fixture({context:{}},async()=>{
   await context.actualE06({browser:{},baseURL:'http://owned'},info);
   events.push('body-assertions-finished');
   assert.equal(resources.contexts.size,3,'E06 resources must remain owned until automatic teardown');
   assert.ok(state.contexts.every(c=>!c.closed),'E06 contexts must remain open until automatic teardown');
   assert.ok(state.faults.every(f=>!f.disposed),'E06 lifecycles must remain active until automatic teardown');
   events.push('body-return');
  },info);}catch(error){primary=error;}
  assertClean(state,resources);assert.equal(context.fixtureOwned.has(info),false);
  assert.deepEqual(events.slice(0,5),['goto','reload','converged','evidence','body-assertions-finished']);
  return {primary,events};
 }
 const after=await execute(current);assert.equal(after.primary,undefined);assert.equal(after.events.at(-1),'body-return');
 // Restore only the removed original ownership wrapper around the ACTUAL body.
 // The private full-file inverse artifact independently binds this to frozen3d.
 const anchor=current.indexOf("test('E06 same identity tabs reconcile one journal without duplicating a committed move'"),end=current.indexOf('\nfor(const phase',anchor);
 const originalBody=current.slice(anchor,end).replace('const p=await party(browser,baseURL);','const p=await party(browser,baseURL);try{').replace('\n});','\n }finally{await cleanupParty(p);}\n});');
 const original=current.slice(0,anchor)+originalBody+current.slice(end);
 const before=await execute(original);assert.ok(before.primary);assert.match(before.primary.message,/E06 resources must remain owned until automatic teardown/);assert.ok(!before.events.includes('body-return'));
});
