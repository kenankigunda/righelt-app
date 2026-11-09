import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {installComputerRecoveryBinding,RECOVERY_BINDING_ACK,requireRecoveryBindingInstaller} from '../../../e2e/support/computer-recovery-binding.mjs';
import {createComputerRecoveryJSONRead,readComputerRecoverySnapshot,cloneComputerRecoveryHandoff,SOURCE_PRESS_MAX_BYTES} from '../../../e2e/support/board-admission-diagnostics.mjs';
import {recoveryBindingHarness} from './support/recovery-binding-harness.mjs';
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
async function fixture({harness={},setupFailure,clock={value:0}}={}){
 let reads=0,packet;const failures=[],timers=[],h=recoveryBindingHarness({...harness,onRead(){reads++;harness.onRead?.();}}),ticket={namespace:'namespace',readId:'fresh',gameId:'game',documentGeneration:0};
 const transport=await installComputerRecoveryBinding(h.page,{namespace:'namespace',produce:createComputerRecoveryJSONRead(readComputerRecoverySnapshot),measurementName:'original',maxBytes:4*1024*1024,now:()=>clock.value,
  capture(value){cloneComputerRecoveryHandoff(value.boardRecovery,ticket,SOURCE_PRESS_MAX_BYTES);packet=value;},failed:reason=>failures.push(reason),verifyInstaller:async()=>{if(setupFailure)throw setupFailure;},setTimer(fn,ms){const timer={fn,ms,cleared:false};timers.push(timer);return timer;},clearTimer(timer){if(timer)timer.cleared=true;}});
 transport.begin(ticket,0);return{h,ticket,transport,clock,failures,timers,reads:()=>reads,packet:()=>packet};
}
test('one actual producer delivers inside2s, awaits publisher completion and configuration, then disposes all owned bindings/listeners',async()=>{
 const f=await fixture(),result=await f.transport.start();assert.equal(f.reads(),1);assert.deepEqual(result,f.packet());assert.equal(result.records[0].event,'same-original');await f.transport.complete();assert.equal(f.transport.healthy(),true);assert.equal(f.transport.report().ack,true);assert.equal(f.transport.report().ownedCallbackTasks,0);assert.deepEqual(f.h.events,['publisher-install','signal-install','signal-dispose','publisher-dispose','init-dispose']);assert.deepEqual(f.h.page.eventNames(),[]);assert(f.timers[0].cleared);
});
test('configuration callback registration race is not used for publishing; configuration remains owned after payload completion',async()=>{
 const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}}),value=await f.transport.start();assert(value.boardRecovery);let done=false;const finish=f.transport.complete().then(()=>{done=true;});await settle();assert.equal(done,false);assert.equal(f.h.bindings.size,1);gate.resolve();await finish;assert.equal(f.transport.healthy(),true);assert.equal(f.reads(),1);
});
test('same-hook configuration rejection is retained after an otherwise valid payload and publisher completion',async()=>{
 const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}}),primary=Error('configuration rejected');await f.transport.start();gate.reject(primary);await assert.rejects(f.transport.complete(),e=>e===primary);assert.equal(f.transport.healthy(),false);assert.equal(f.h.bindings.size,0);
});
for(const phase of ['payload','completion'])test('absolute2s refuses '+phase+' even when scheduled timeout callback has not run',async()=>{
 let f;f=await fixture({harness:{publisherGate(args){if(phase==='payload'&&args[0].kind==='payload')f.clock.value=2001;}}});
 if(phase==='completion'){
  const emit=f.h.page.emit.bind(f.h.page);f.h.page.emit=(type,message)=>{if(type==='console'&&message.text().startsWith(RECOVERY_BINDING_ACK))f.clock.value=2001;return emit(type,message);};
 }
 await assert.rejects(f.transport.start());await assert.rejects(f.transport.complete());assert(f.failures.includes('read-timed-out'));assert.equal(f.transport.healthy(),false);assert.equal(f.timers.length,1);
});
test('late signal configuration settlement does not invalidate an on-time payload AND completion',async()=>{
 const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}});await f.transport.start();assert.equal(f.timers[0].cleared,true);f.clock.value=2500;gate.resolve();await f.transport.complete();assert.equal(f.transport.healthy(),true);
});
test('missing setter/configuration success cannot manufacture a snapshot or completion',async()=>{
 const f=await fixture({harness:{beforeSignal(_page,realm){for(const name of Object.getOwnPropertyNames(realm))if(name.startsWith('__righeltFinalSignal_'))delete realm[name];}}});const read=f.transport.start();await settle();assert.equal(f.reads(),0);f.timers[0].fn();await assert.rejects(read);await assert.rejects(f.transport.complete());
});
test('early assignment poisons without reading state',async()=>{
 const f=await fixture();const name=Object.getOwnPropertyNames(f.h.realm()).find(x=>x.startsWith('__righeltFinalSignal_'));f.h.realm()[name]=()=>{};await settle();assert.equal(f.reads(),0);assert.throws(()=>f.transport.start(),/start unavailable/);
 // begin already ran in this fixture; assigning early relative to the one
 // original configuration still cannot be accepted as its normal call.
 await assert.rejects(f.transport.complete());
});
for(const kind of ['foreign page','foreign frame','foreign context','foreign namespace','extra field'])test('FIRST publisher request refuses '+kind+' before any normal request',async()=>{
 const entered=deferred(),release=deferred(),f=await fixture({harness:{beforeSignal:async()=>{entered.resolve();await release.promise;}}});const read=f.transport.start();read.catch(()=>{});await entered.promise;
 const name=[...f.h.bindings.keys()].find(x=>x.startsWith('__righeltFinalPublisher_')),fn=f.h.bindings.get(name),source={page:f.h.page,frame:f.h.frame,context:f.h.context},message={kind:'request',namespace:'namespace',armNonce:'first'};
 if(kind==='foreign page')source.page={};if(kind==='foreign frame')source.frame={};if(kind==='foreign context')source.context={};if(kind==='foreign namespace')message.namespace='foreign';if(kind==='extra field')message.extra=true;
 try{await assert.rejects(fn(source,message));assert.equal(f.reads(),0);}finally{release.resolve();await assert.rejects(f.transport.complete());}assert.equal(f.transport.healthy(),false);
});
test('a second request after the genuine request remains fatal separately',async()=>{
 const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}});await f.transport.start();const name=[...f.h.bindings.keys()].find(x=>x.startsWith('__righeltFinalPublisher_'));await assert.rejects(f.h.bindings.get(name)({page:f.h.page,frame:f.h.frame,context:f.h.context},{kind:'request',namespace:'namespace',armNonce:'second'}));gate.resolve();await assert.rejects(f.transport.complete());
});
for(const phase of ['request→payload','payload→completion','completion→configuration'])test('mainframe navigation at '+phase+' remains fatal',async()=>{
 let f;const gate=deferred();f=await fixture({harness:{configGate:gate.promise,publisherGate(args){if(phase==='request→payload'&&args[0].kind==='payload')f.h.page.emit('framenavigated',f.h.frame);}}});
 if(phase==='payload→completion'){const emit=f.h.page.emit.bind(f.h.page);f.h.page.emit=(type,message)=>{if(type==='console'&&message.text().startsWith(RECOVERY_BINDING_ACK))emit('framenavigated',f.h.frame);return emit(type,message);};}
 const read=f.transport.start();read.catch(()=>{});await settle();if(phase==='completion→configuration')f.h.page.emit('framenavigated',f.h.frame);gate.resolve();await assert.rejects(f.transport.complete());assert.equal(f.transport.healthy(),false);
});
for(const kind of ['duplicate completion','wrong type','worker','foreign page','missing completion'])test('primitive completion refuses '+kind,async()=>{
 const f=await fixture();let text;const emit=f.h.page.emit.bind(f.h.page);f.h.page.emit=(type,message)=>{if(type==='console'&&message.text().startsWith(RECOVERY_BINDING_ACK)){text=message.text();if(kind==='missing completion')return true;if(kind==='wrong type')message={...message,type:()=> 'log'};if(kind==='worker')message={...message,worker:()=>({})};if(kind==='foreign page')message={...message,page:()=>({})};}return emit(type,message);};
 const read=f.transport.start();read.catch(()=>{});await settle();if(kind==='duplicate completion')f.h.emit(text);if(kind==='missing completion')f.timers[0].fn();await assert.rejects(f.transport.complete());assert.equal(f.transport.healthy(),false);
});
test('producer error preserves failed evidence and does not read again or call new signal binding',async()=>{
 const f=await fixture({harness:{breakProducer:true}});await assert.rejects(f.transport.start());await assert.rejects(f.transport.complete());assert.equal(f.reads(),1);assert.equal(f.h.events.filter(x=>x==='signal-install').length,1);
});
test('close, crash and Page error all poison owned final work',async()=>{
 for(const name of ['close','crash','pageerror']){const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}});await f.transport.start();f.h.page.emit(name,Error('original'));gate.resolve();await assert.rejects(f.transport.complete());assert.equal(f.transport.healthy(),false);}
});
test('disposal errors independently attempt signal/publisher/init and listeners and never replace configuration primary',async()=>{
 const gate=deferred(),f=await fixture({harness:{configGate:gate.promise}}),primary=Error('original configuration'),off=f.h.page.off.bind(f.h.page);f.h.page.off=(name,fn)=>{off(name,fn);if(name==='console')throw Error('listener cleanup');};await f.transport.start();gate.reject(primary);await assert.rejects(f.transport.complete(),e=>e instanceof AggregateError&&e.errors[0]===primary);assert(f.h.events.includes('publisher-dispose'));assert(f.h.events.includes('init-dispose'));assert.equal(f.transport.report().cleanupIncomplete,true);
});
test('source guard refusal precedes any public binding or init-script installation',async()=>{
 const page=new EventEmitter();let calls=0;page.exposeBinding=()=>{calls++;};const original=Error('source changed');await assert.rejects(installComputerRecoveryBinding(page,{verifyInstaller:async()=>{throw original;}}),e=>e===original);assert.equal(calls,0);assert.equal(page.eventNames().length,0);
});
test('actual pinned source guard accepts actual bytes and refuses altered installer in an own strict package closure',async()=>{
 await requireRecoveryBindingInstaller();const root=await mkdtemp(path.join(os.tmpdir(),'righelt-binding-source-'));try{
  for(const[name,data]of[['package.json',{}],['node_modules/@playwright/test/package.json',{name:'@playwright/test'}],['node_modules/playwright/package.json',{name:'playwright'}],['node_modules/playwright-core/package.json',{name:'playwright-core',version:'1.59.1'}]]){const f=path.join(root,name);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify(data));}
  await mkdir(path.join(root,'node_modules/playwright-core/lib/utils/isomorphic'),{recursive:true});await writeFile(path.join(root,'node_modules/playwright-core/lib/utils/isomorphic/protocolMetainfo.js'),'changed');
  const module=new URL('../../../e2e/support/computer-recovery-binding.mjs',import.meta.url).href,q=spawnSync(process.execPath,['--input-type=module','-e',`import{requireRecoveryBindingInstaller as guard}from${JSON.stringify(module)};try{await guard();process.exitCode=7;}catch(error){if(!String(error.message).includes('installer source changed'))throw error;}`],{cwd:root,encoding:'utf8'});assert.equal(q.status,0,q.stderr);
 }finally{await rm(root,{recursive:true,force:true});}
});
