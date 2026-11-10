import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cloneComputerRecoveryHandoff,createComputerRecoveryJSONRead,createComputerRecoveryHandoff,SOURCE_PRESS_MAX_BYTES,COMPUTER_RECOVERY_FINAL_PREFIX,COMPUTER_RECOVERY_FINAL_MAX_BYTES,readComputerRecoverySnapshot,installComputerRecoveryBindingOwner} from '../../../e2e/support/board-admission-diagnostics.mjs';
import {EventEmitter} from 'node:events';
import {recoveryBindingHarness} from './support/recovery-binding-harness.mjs';
const expected={namespace:'namespace',readId:'read',gameId:'game',documentGeneration:1};
const packet=()=>({...expected,timeOrigin:123,documentNonce:'document',observation:{version:1,timeOrigin:123,documentNonce:'document',recoveryNamespace:'namespace',first:[],tail:[],activation:[],incomplete:false,rulesTimeouts:{rows:[{jobId:2,type:'previews',active:true,now:25956}],dropped:0,incomplete:false}}});
function originalCallback(){
 // The former inline callback is now the authoritative named producer shared
 // by generic reads and the source-pinned binding. Execute that actual export.
 const source=readFileSync(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('createComputerRecoveryJSONRead(readComputerRecoverySnapshot)'));
 return readComputerRecoverySnapshot;
}
function originalRead(snapshot){
 const b=snapshot.boardRecovery;
 const context={window:{retreatJournalObservations:{records:snapshot.records,dropped:snapshot.dropped,eventLoopTicks:snapshot.eventLoopTicks}},globalThis:{__righeltReadinessFreeze:()=>snapshot.readinessPage,__boardAdmissionRecoveryDocument:b.documentNonce,__boardAdmissionObservation:b.observation},location:{hash:'#/game/'+encodeURIComponent(b.gameId)},performance:{timeOrigin:b.timeOrigin,getEntriesByName:()=>snapshot.presentation?[{detail:snapshot.presentation}]:[]},TextEncoder};
 const callback=createComputerRecoveryJSONRead(originalCallback());
 return vm.runInNewContext('('+callback.toString()+')',context)({measurementName:'original',recoveryRead:{namespace:b.namespace,readId:b.readId,gameId:b.gameId,documentGeneration:b.documentGeneration}});
}
test('actual original callback retains the persisted JSON domain and actual timeout rows',()=>{
 const snapshot={records:[{event:'open',optional:undefined}],dropped:0,eventLoopTicks:5,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}};
 assert.deepEqual(JSON.parse(originalRead(snapshot)),JSON.parse(JSON.stringify(snapshot)));
 assert.equal(JSON.parse(originalRead(snapshot)).boardRecovery.observation.rulesTimeouts.rows[0].active,true);
});
test('Node receiver and generated callback both reject non-finite and undefined authority data',()=>{
 for(const value of [NaN,Infinity,-Infinity,undefined]){
  const p=packet();p.observation.bad=value;
  assert.throws(()=>cloneComputerRecoveryHandoff(p,expected,SOURCE_PRESS_MAX_BYTES));
  const callback=createComputerRecoveryJSONRead(value=>value);
  assert.throws(()=>callback({recoveryRead:expected,boardRecovery:p}));
 }
});
for(const [name,change]of[
 ['foreign namespace',p=>p.namespace='foreign'],['foreign read',p=>p.readId='foreign'],['foreign game',p=>p.gameId='foreign'],['foreign generation',p=>p.documentGeneration=2],
 ['foreign nonce',p=>p.observation.documentNonce='foreign'],['invalid epoch',p=>p.timeOrigin=Infinity],
 ['cycle',p=>p.observation.self=p],
])test(name+' fails before JSON encoding',()=>{
 const p=packet();change(p);const callback=createComputerRecoveryJSONRead(value=>value);
 assert.throws(()=>callback({recoveryRead:expected,boardRecovery:p}));
});
test('accessors and inherited toJSON cannot launder recovery authority',()=>{
 let calls=0;const p=packet();Object.defineProperty(p.observation,'bad',{get(){calls++;return 1;},enumerable:true});
 assert.throws(()=>cloneComputerRecoveryHandoff(p,expected,SOURCE_PRESS_MAX_BYTES));assert.equal(calls,0);
 const q=packet();Object.setPrototypeOf(q.observation,{toJSON(){calls++;return null;}});
 const callback=createComputerRecoveryJSONRead(value=>value),decoded=JSON.parse(callback({recoveryRead:expected,boardRecovery:q}));
 assert.equal(calls,0);assert.equal(decoded.boardRecovery.observation.documentNonce,'document');
});
test('UTF8 cap refuses actual multibyte overflow before transport',()=>{
 const p=packet();p.observation.word='é'.repeat(100);
 const characters=JSON.stringify(p).length;
 assert.throws(()=>cloneComputerRecoveryHandoff(p,expected,characters+1));
});
test('callback errors stay rejected rather than turning into absent journal data',()=>{
 const callback=createComputerRecoveryJSONRead(()=>{throw Error('original read failed');});
 assert.throws(()=>callback({recoveryRead:expected}),/original read failed/);
});
test('validated JSON reaches the actual Node handoff unchanged',async()=>{
 const page=new EventEmitter();page.mainFrame=()=>page;const h=createComputerRecoveryHandoff(page,'namespace');h.bindGame('game');const ticket=h.begin(page),p={...packet(),...ticket};
 const callback=createComputerRecoveryJSONRead(value=>value);h.retain(page,Promise.resolve(JSON.parse(callback({recoveryRead:ticket,boardRecovery:p}))));
 await h.awaitDelivery({remainingMs:()=>5000});const result=h.consume();assert.equal(result.incomplete,false);assert.deepEqual(JSON.parse(JSON.stringify(result.observation)),p.observation);h.end();assert.equal(page.listenerCount('framenavigated'),0);
});
export {originalRead};

test('generated actual callback cannot invoke realm Array.prototype.toJSON on authority arrays',()=>{
 const snapshot={records:[],dropped:0,eventLoopTicks:0,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}},b=snapshot.boardRecovery;
 const context={window:{retreatJournalObservations:{records:[],dropped:0,eventLoopTicks:0}},globalThis:{__righeltReadinessFreeze:()=>snapshot.readinessPage,__boardAdmissionRecoveryDocument:b.documentNonce,__boardAdmissionObservation:b.observation},location:{hash:'#/game/game'},performance:{timeOrigin:123,getEntriesByName:()=>[]},TextEncoder};
 const realm=vm.createContext(context);vm.runInContext('Array.prototype.toJSON=function(){throw Error("array toJSON invoked");};',realm);
 const callback=createComputerRecoveryJSONRead(originalCallback());
 const actual=vm.runInContext('('+callback.toString()+')',realm)({measurementName:'original',recoveryRead:expected});
 assert.deepEqual(JSON.parse(actual).boardRecovery,JSON.parse(JSON.stringify(b)));
});
test('an arbitrary thrown error accessor cannot escape Node handoff failure ownership',()=>{
 const page=new EventEmitter();page.mainFrame=()=>page;const h=createComputerRecoveryHandoff(page,'namespace');h.bindGame('game');h.begin(page);
 let calls=0;const error={get recoveryReason(){calls++;throw Error('must not invoke');}},value=new Proxy({},{ownKeys(){throw error;}});
 assert.doesNotThrow(()=>h.capture(page,value));assert.equal(h.consume().reason,'handoff-invalid');assert.equal(calls,0);h.end();
});

test('signed zero keeps the original persisted domain; sparse authority is explicitly rejected',()=>{
 const p=packet();p.observation.zero=-0;const callback=createComputerRecoveryJSONRead(value=>value),input={recoveryRead:expected,boardRecovery:p};
 assert.deepEqual(JSON.parse(callback(input)),JSON.parse(JSON.stringify(input)));
 p.observation.rows=new Array(1);assert.throws(()=>callback({...input,boardRecovery:p}));
});
test('journal-only holes, undefined and nonfinite values retain their original persisted JSON domain',()=>{
 const records=[{event:'open',optional:undefined,number:NaN},undefined,new Array(1)];records[2].extra='original ignored array field';
 const snapshot={records,dropped:0,eventLoopTicks:5,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}};
 assert.deepEqual(JSON.parse(originalRead(snapshot)),JSON.parse(JSON.stringify(snapshot)));
});
test('exact opaque document nonce preserves the original positive clock jitter contract',()=>{
 const p=packet();p.timeOrigin=124;const callback=createComputerRecoveryJSONRead(value=>value);
 const result=JSON.parse(callback({recoveryRead:expected,boardRecovery:p}));assert.equal(result.boardRecovery.timeOrigin,124);assert.equal(result.boardRecovery.observation.timeOrigin,123);
});

test('actual generated callback ignores outer Object.prototype.toJSON spoofing and nested journal hooks',()=>{
 const snapshot={records:[{event:'original-journal'}],dropped:0,eventLoopTicks:0,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}},b=snapshot.boardRecovery;
 let nestedCalls=0;Object.setPrototypeOf(snapshot.records[0],{toJSON(){nestedCalls++;return {event:'spoof'};}});
 const context={window:{retreatJournalObservations:{records:snapshot.records,dropped:0,eventLoopTicks:0}},globalThis:{__righeltReadinessFreeze:()=>snapshot.readinessPage,__boardAdmissionRecoveryDocument:b.documentNonce,__boardAdmissionObservation:b.observation},location:{hash:'#/game/game'},performance:{timeOrigin:123,getEntriesByName:()=>[]},TextEncoder,hookCalls:0};
 const realm=vm.createContext(context);vm.runInContext(`Object.prototype.toJSON=function(){hookCalls++;if(this.boardRecovery)return {...this,boardRecovery:{...this.boardRecovery,observation:{...this.boardRecovery.observation,rulesTimeouts:{rows:[],incomplete:false,dropped:0}}}};return this;};`,realm);
 const callback=createComputerRecoveryJSONRead(originalCallback()),encoded=vm.runInContext('('+callback.toString()+')',realm)({measurementName:'original',recoveryRead:expected}),decoded=JSON.parse(encoded);
 assert.equal(context.hookCalls,0);assert.equal(nestedCalls,0);assert.equal(decoded.records[0].event,'original-journal');assert.equal(decoded.boardRecovery.observation.rulesTimeouts.rows[0].jobId,2);assert.equal(decoded.boardRecovery.observation.rulesTimeouts.rows[0].active,true);
});

test('actual callback omits non-enumerable journal data and getters without invoking them',()=>{
 let calls=0;const records=[{event:'original'}];Object.defineProperty(records[0],'hidden',{value:'not persisted',enumerable:false});Object.defineProperty(records[0],'getter',{get(){calls++;throw Error('must not read');},enumerable:false});
 const snapshot={records,dropped:0,eventLoopTicks:0,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}};
 assert.deepEqual(JSON.parse(originalRead(snapshot)),JSON.parse(JSON.stringify(snapshot)));assert.equal(calls,0);
});
for(const [name,value]of[['Date',new Date(0)],['Map',new Map([['key','value']])]])test(name+' journal values fail instead of silently becoming empty objects',()=>{
 const snapshot={records:[{event:'original',unsupported:value}],dropped:0,eventLoopTicks:0,boardRecovery:packet(),presentation:null,readinessPage:{incomplete:false}};
 assert.throws(()=>originalRead(snapshot),/Unsupported final recovery DTO object/);
});

function consoleRead(){
 const page=new EventEmitter(),frame={};page.mainFrame=()=>frame;
 const owner=createComputerRecoveryHandoff(page,'namespace');owner.bindGame('game');
 const ticket=owner.begin(page,{consoleDelivery:true});
 const dto={records:[{event:'original-journal'}],dropped:0,eventLoopTicks:1,boardRecovery:{...packet(),...ticket},presentation:null,readinessPage:{incomplete:false}};
 let resolve,reject;const original=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const delivered=owner.retainConsoleRead(page,original);
 const emit=(raw=JSON.stringify(dto),overrides={})=>page.emit('console',{text:()=>COMPUTER_RECOVERY_FINAL_PREFIX+raw,page:()=>page,worker:()=>null,type:()=> 'debug',...overrides});
 return{page,frame,owner,ticket,dto,resolve,reject,delivered,emit};
}

test('computer callback emits the exact full DTO once and returns identical bytes; ordinary reads do not emit',()=>{
 const calls=[],context={console:{debug:text=>calls.push(text)},TextEncoder};
 const input={recoveryRead:expected,records:[{event:'original'}],boardRecovery:packet()};
 const ordinary=createComputerRecoveryJSONRead(value=>value),published=createComputerRecoveryJSONRead(value=>value,true);
 const before=vm.runInNewContext('('+ordinary.toString()+')(input)',{...context,input});assert.equal(calls.length,0);
 const after=vm.runInNewContext('('+published.toString()+')(input)',{...context,input});
 assert.equal(after,before);assert.deepEqual(calls,[COMPUTER_RECOVERY_FINAL_PREFIX+after]);
});

test('full DTO transport has its own generous byte cap and never truncates journal data',()=>{
 const callback=createComputerRecoveryJSONRead(value=>value,true),sent=[];
 const input={recoveryRead:expected,boardRecovery:packet(),records:[{value:'x'.repeat(SOURCE_PRESS_MAX_BYTES+1)}]};
 const run=value=>vm.runInNewContext('('+callback.toString()+')(input)',{input:value,console:{debug:text=>sent.push(text)},TextEncoder});
 const raw=run(input);assert.equal(JSON.parse(raw).records[0].value,input.records[0].value);assert.equal(sent[0],COMPUTER_RECOVERY_FINAL_PREFIX+raw);
 input.records[0].value='é'.repeat(COMPUTER_RECOVERY_FINAL_MAX_BYTES/2);sent.length=0;
 assert.throws(()=>run(input),/snapshot too large/);assert.equal(sent.length,0);
});

test('early console delivery keeps guards live until exact original acknowledgement, then consumes once',async()=>{
 const f=consoleRead(),raw=JSON.stringify(f.dto);f.emit(raw);
 const value=await f.delivered;assert.deepEqual(JSON.parse(JSON.stringify(value)),f.dto);
 assert.equal(f.page.listenerCount('console'),1);assert.equal(f.page.listenerCount('framenavigated'),1);
 let finished=false;const completion=f.owner.completeOriginalRead().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);
 f.resolve(raw);await completion;assert.equal(finished,true);assert.equal(f.owner.consume().incomplete,false);
 assert.equal(f.page.listenerCount('console'),0);assert.equal(f.page.listenerCount('framenavigated'),0);f.owner.end();
});

test('an early packet cannot hide the same original evaluate rejection',async()=>{
 const f=consoleRead(),primary=Error('original evaluate rejected');f.emit();await f.delivered;f.reject(primary);
 await assert.rejects(f.owner.completeOriginalRead(),error=>error===primary);
 assert.equal(f.owner.consume().incomplete,true);f.owner.end();
});

test('pending original acknowledgement cannot be consumed as successful evidence',async()=>{
 const f=consoleRead();f.emit();await f.delivered;
 assert.equal(f.owner.consume().incomplete,true);f.reject(Error('owned late rejection'));await Promise.resolve();f.owner.end();
 assert.equal(f.page.listenerCount('console'),0);
});

for(const phase of ['before packet','after packet'])test('main-document navigation '+phase+' stays fatal through original settlement',async()=>{
 const f=consoleRead(),raw=JSON.stringify(f.dto);
 if(phase==='before packet')f.page.emit('framenavigated',f.frame);
 f.emit(raw);await f.delivered;
 if(phase==='after packet')f.page.emit('framenavigated',f.frame);
 f.resolve(raw);await assert.rejects(f.owner.completeOriginalRead(),/foreign-document/);
 assert.equal(f.owner.consume().incomplete,true);f.owner.end();
});

test('the full returned packet must equal console bytes, including journal fields',async()=>{
 const f=consoleRead();f.emit();await f.delivered;f.resolve(JSON.stringify({...f.dto,records:[]}));
 await assert.rejects(f.owner.completeOriginalRead(),/handoff-conflict/);assert.equal(f.owner.consume().incomplete,true);f.owner.end();
});

for(const conflict of [false,true])test('duplicate console packet is fatal even when byte-identical: '+conflict,async()=>{
 const f=consoleRead(),raw=JSON.stringify(f.dto);f.emit(raw);await f.delivered;f.emit(conflict?JSON.stringify({...f.dto,records:[]}):raw);f.resolve(raw);
 await assert.rejects(f.owner.completeOriginalRead(),/handoff-reused/);assert.equal(f.owner.consume().incomplete,true);f.owner.end();
});

for(const kind of ['foreign page','worker','wrong type','namespace','readId','gameId','generation','document nonce','malformed','oversize'])test('console final packet refuses '+kind,async()=>{
 const f=consoleRead();let raw=JSON.stringify(f.dto),overrides={};
 if(kind==='foreign page')overrides.page=()=>({});if(kind==='worker')overrides.worker=()=>({});if(kind==='wrong type')overrides.type=()=> 'log';
 if(['namespace','readId','gameId'].includes(kind))f.dto.boardRecovery[kind]='foreign';
 if(kind==='generation')f.dto.boardRecovery.documentGeneration++;
 if(kind==='document nonce')f.dto.boardRecovery.observation.documentNonce='foreign';
 if(kind==='malformed')raw='{';else if(kind==='oversize')raw='x'.repeat(COMPUTER_RECOVERY_FINAL_MAX_BYTES+1);else raw=JSON.stringify(f.dto);
 f.emit(raw,overrides);await f.delivered;f.resolve(raw);await assert.rejects(f.owner.completeOriginalRead());assert.equal(f.owner.consume().incomplete,true);f.owner.end();
});

test('2s journal timeout is fatal even when the exact original packet and acknowledgement arrive later',async()=>{
 const f=consoleRead(),raw=JSON.stringify(f.dto);f.owner.journalTimedOut();f.emit(raw);f.resolve(raw);
 await assert.rejects(f.owner.completeOriginalRead(),/read-timed-out/);const value=f.owner.consume();assert.equal(value.incomplete,true);assert.equal(value.journalReadTimedOut,true);f.owner.end();
});

test('console listener removal failure remains failed evidence',async()=>{
 const f=consoleRead(),raw=JSON.stringify(f.dto);f.emit(raw);await f.delivered;f.resolve(raw);await f.owner.completeOriginalRead();
 const off=f.page.off;f.page.off=function(type,...args){if(type==='console')throw Error('console off failed');return off.call(this,type,...args);};
 const result=f.owner.consume();assert.equal(result.incomplete,true);assert.equal(result.cleanupIncomplete,true);f.owner.end();
});

async function actualBindingHook({lateReject=false,navigate=false,timeout=false,autoAck=true,beginFailure=false}={}){
 let acknowledge,rejectOriginal,releaseProducer,journalWritten,afterEach,expireBinding,timeoutReached,reads=0;
 const configuration=new Promise((yes,no)=>{acknowledge=yes;rejectOriginal=no;}),producer=new Promise(yes=>{releaseProducer=yes;}),written=new Promise(yes=>{journalWritten=yes;});
 const primary=Error('original configuration rejected after delivery'),journals=[],timers=[];
 const h=recoveryBindingHarness({gameId:'game',namespace:'namespace',configGate:configuration,onRead:()=>{reads++;},beforeSignal:async()=>{if(timeout){queueMicrotask(()=>{expireBinding();releaseProducer();timeoutReached();if(autoAck)acknowledge();});await producer;}}});
 const {page}=h;page.evaluate=()=>assert.fail('binding recovery must not issue Page.evaluate');
 const base=createComputerRecoveryHandoff(page,'namespace');if(!beginFailure)base.bindGame('game');
 const timedOut=new Promise(resolve=>{timeoutReached=resolve;});
 const owner=await installComputerRecoveryBindingOwner(page,'namespace',base,{verifyInstaller:async()=>{},setTimer(fn,ms){timers.push(ms);expireBinding=fn;return 1;},clearTimer(){}});
 const source=readFileSync(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8'),start=source.indexOf('test.afterEach('),end=source.indexOf('\nasync function request(',start);
 const info={title:'the real computer defender leaves a completion-preserving native Follow',status:'passed',expectedStatus:'passed',outputPath:name=>'/controlled/'+name,async attach(){}};
 vm.runInNewContext(source.slice(start,end),{
  test:{afterEach:fn=>{afterEach=fn;}},COMPUTER_UI_FRAME_MEASURE:'same-measure',computerFollowWorkflow:info.title,computerRetreatWorkflow:'other',createComputerRecoveryJSONRead,readComputerRecoverySnapshot,
  writeFile:async(_path,body)=>{journals.push(JSON.parse(body));journalWritten();if(navigate)page.emit('framenavigated',h.frame);if(lateReject)rejectOriginal(primary);else if(autoAck)acknowledge();},
  attachNodeReadiness:value=>value,console:{warn(){}},
  setTimeout(fn,ms){timers.push(ms);if(timeout)queueMicrotask(()=>{fn();releaseProducer();});return 1;},clearTimeout(){},
 });

 const pending=afterEach({page,computerRecoveryAdmission:{finalRecoveryHandoff:owner}},info);pending.catch(()=>{});
 return{...h,owner,primary,journals,timers,pending,written,timedOut,acknowledge,rejectOriginal,reads:()=>reads};
}

test('actual afterEach writes the same packet but stays live until original configuration acknowledgement',async()=>{
 const f=await actualBindingHook({autoAck:false});let done=false;f.pending.then(()=>{done=true;});
 try{
  await f.written;assert.equal(f.journals[0].records[0].event,'same-original');assert.equal(done,false);
  assert.equal(f.page.listenerCount('console'),1);assert.ok(f.page.listenerCount('framenavigated')>=1);
 }finally{f.acknowledge();await f.pending;}
 assert.equal(f.reads(),1);assert.equal(f.timers.length,2);assert(f.timers[0]>4900&&f.timers[0]<=5000);assert(f.timers[1]>1900&&f.timers[1]<=2000);assert.equal(f.owner.consume().incomplete,false);f.owner.end();
});

test('actual afterEach poisons an early delivered packet when original configuration later rejects',async()=>{
 const f=await actualBindingHook({lateReject:true});
 await assert.rejects(f.pending,error=>error===f.primary);
 assert.equal(f.journals[0].records[0].event,'same-original','same packet was delivered before original configuration failed');
 assert.equal(f.owner.consume().incomplete,true);assert.equal(f.reads(),1);f.owner.end();
});

test('actual afterEach rejects navigation after journal delivery and before configuration acknowledgement',async()=>{
 const f=await actualBindingHook({navigate:true});await assert.rejects(f.pending,/foreign-document/);
 assert.equal(f.owner.consume().incomplete,true);assert.equal(f.reads(),1);f.owner.end();
});

test('actual afterEach preserves binding timeout without a fallback snapshot after configuration settles',async()=>{
 const f=await actualBindingHook({timeout:true});await assert.rejects(f.pending,/read-timed-out/);
 assert.equal(f.journals.length,0);assert.equal(f.timers.length,1);assert(f.timers[0]>4900&&f.timers[0]<=5000);
 const value=f.owner.consume();assert.equal(value.incomplete,true);assert.equal(value.journalReadTimedOut,false,'binding deadline is separate from the legacy journal race');
 assert.equal(f.reads(),0,'timeout before ticket acceptance must not trigger a fallback or later state read');f.owner.end();
});

test('actual afterEach issues no signal or state read after required begin fails',async()=>{
 const f=await actualBindingHook({beginFailure:true});await assert.rejects(f.pending,/final read scope unavailable/);
 assert.equal(f.reads(),0);assert.deepEqual(f.timers,[]);assert.equal(f.events.includes('signal-install'),false);
 await f.owner.disposeBindingDelivery();f.owner.end();
 assert.equal(f.page.listenerCount('console'),0);assert.equal(f.page.listenerCount('framenavigated'),0);
});

test('actual afterEach still awaits original configuration when its delivery failed',async()=>{
 const f=await actualBindingHook({timeout:true,autoAck:false});let finished=false;
 f.pending.then(()=>{finished=true;},()=>{finished=true;});await f.timedOut;
 assert.equal(finished,false,'rejected delivery cannot skip original configuration settlement');
 f.rejectOriginal(f.primary);
 await assert.rejects(f.pending,error=>error.name==='AggregateError'&&Array.isArray(error.errors)&&error.errors.includes(f.primary));
 assert.equal(f.owner.consume().incomplete,true);assert.equal(f.page.listenerCount('console'),0);f.owner.end();
});

for(const status of ['failed','timedOut','interrupted'])test('actual '+status+' body retains legacy diagnostics and its original failure without console transport',async()=>{
 const source=readFileSync(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8');
 const readStart=source.indexOf('async function readRetreatDiagnostics('),readEnd=source.indexOf('\n// Capture identity',readStart);
 const read=vm.runInNewContext('('+source.slice(readStart,readEnd)+')');
 const page=new EventEmitter(),frame={};page.mainFrame=()=>frame;let closedChecks=0,reads=0,afterEach;
 page.isClosed=()=>++closedChecks>1;
 page.evaluate=async(fn,input)=>{reads++;assert.equal(fn,read);assert.equal(page.listenerCount('console'),0);return {available:true,gameId:'game',boardRecovery:{...packet(),...input.recoveryRead},journal:{records:[{event:'original-failed-body'}]}};};
 const owner=createComputerRecoveryHandoff(page,'namespace');owner.bindGame('game');
 const original=Error('original body failure'),info={title:'the real computer defender leaves a completion-preserving native Follow',status,expectedStatus:'passed',error:original,outputPath:name=>'/controlled/'+name,async attach(){}};
 const start=source.indexOf('test.afterEach('),end=source.indexOf('\nasync function request(',start),saved=[];
 vm.runInNewContext(source.slice(start,end),{test:{afterEach:fn=>{afterEach=fn;}},COMPUTER_UI_FRAME_MEASURE:'original',computerFollowWorkflow:info.title,computerRetreatWorkflow:'other',readRetreatDiagnostics:read,createComputerRecoveryJSONRead,writeFile:async(_path,body)=>saved.push(JSON.parse(body)),attachNodeReadiness:value=>value,console:{warn(){}},setTimeout:()=>1,clearTimeout(){}});
 await afterEach({page,computerRecoveryAdmission:{finalRecoveryHandoff:owner}},info);
 assert.equal(reads,1);assert.equal(info.error,original);assert.equal(info.status,status);assert.equal(saved[0].journal.records[0].event,'original-failed-body');
 const handoff=owner.consume();assert.equal(handoff.incomplete,false);assert.deepEqual(JSON.parse(JSON.stringify(handoff.observation.rulesTimeouts.rows)),packet().observation.rulesTimeouts.rows);
 owner.end();assert.equal(page.listenerCount('console'),0);assert.equal(page.listenerCount('framenavigated'),0);
});
