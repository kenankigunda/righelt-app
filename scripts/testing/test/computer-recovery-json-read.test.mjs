import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cloneComputerRecoveryHandoff,createComputerRecoveryJSONRead,createComputerRecoveryHandoff,SOURCE_PRESS_MAX_BYTES} from '../../../e2e/support/board-admission-diagnostics.mjs';
import {EventEmitter} from 'node:events';
const expected={namespace:'namespace',readId:'read',gameId:'game',documentGeneration:1};
const packet=()=>({...expected,timeOrigin:123,documentNonce:'document',observation:{version:1,timeOrigin:123,documentNonce:'document',recoveryNamespace:'namespace',first:[],tail:[],activation:[],incomplete:false,rulesTimeouts:{rows:[{jobId:2,type:'previews',active:true,now:25956}],dropped:0,incomplete:false}}});
function originalCallback(){
 const source=readFileSync(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8');
 const marker='createComputerRecoveryJSONRead(',start=source.indexOf('page.evaluate('+marker)+('page.evaluate('+marker).length,end=source.indexOf('}),{measurementName:',start);
 assert.ok(start>0&&end>start);
 return new Function('return ('+source.slice(start,end+1)+');')();
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
