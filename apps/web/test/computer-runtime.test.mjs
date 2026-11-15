import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerRuntime, loadComputerModel } from '../shell/computer-runtime.js';
import { sha256 } from '../shell/verified-assets.js';
import {createInitialState} from '../generated/packages/game-engine/src/state.js';
import {CURRENT_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';

function fixture() {
  const timers = new Map(); let next = 0;
  const worker = { postMessage(message) { this.message = message; }, terminate() { this.terminated = true; } };
  const runtime = new ComputerRuntime({ timers: { setTimeout(fn, ms) { assert.equal(ms, 30000); timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } } });
  runtime.worker = worker;
  return { runtime, worker, timers, send: value => runtime.receive(worker, { ...worker.message, ...value }) };
}
test('only increased measured work refreshes the stall watchdog; empty heartbeats do not', async () => {
  const { runtime, worker, timers, send } = fixture();
  const promise = runtime.request({ type: 'compute', metadata: { gameId: 'g' } });
  const rejected = assert.rejects(promise, /no-progress/);
  const first = [...timers.keys()][0];
  send({ type: 'progress', phase: 'checking' }); assert.equal([...timers.keys()][0], first);
  send({ type: 'progress', work: 10 }); assert.notEqual([...timers.keys()][0], first);
  const second = [...timers.keys()][0];
  send({ type: 'progress', work: 10 }); send({ type: 'progress', work: 9 });
  assert.equal([...timers.keys()][0], second);
  [...timers.values()][0](); await rejected;
  assert.equal(worker.terminated, true);
});
test('cancel destroys the worker and a late response cannot complete its replacement', async () => {
  const { runtime, worker, send } = fixture();
  const old = runtime.request({ type: 'initialize' }); const rejected = assert.rejects(old, /cancelled/);
  runtime.cancel(); await rejected;
  const nextWorker = { postMessage(message) { this.message = message; }, terminate() {} }; runtime.worker = nextWorker;
  const next = runtime.request({ type: 'initialize' }); send({ type: 'initialized' });
  assert.ok(runtime.pending); assert.equal(worker.terminated, true);
  runtime.receive(nextWorker, { ...nextWorker.message, type: 'initialized' }); await next;
});
test('ordinary idle invalidation preserves one initialized worker but active work still terminates it', async () => {
  const {runtime,worker}=fixture();runtime.modelId='model';
  const generation=runtime.generation;
  runtime.cancel('position-changed',{preserveIdle:true});
  assert.equal(runtime.generation,generation+1);assert.equal(runtime.worker,worker);assert.equal(runtime.modelId,'model');assert.notEqual(worker.terminated,true);
  const work=runtime.request({type:'compute',metadata:{gameId:'g'}});const rejected=assert.rejects(work,/position-changed/);
  runtime.cancel('position-changed',{preserveIdle:true});await rejected;
  assert.equal(worker.terminated,true);assert.equal(runtime.worker,null);assert.equal(runtime.modelId,null);
});
test('an obsolete prepare continuation cannot post into or cancel a replacement compute',async()=>{
  const timers={setTimeout(){return 1;},clearTimeout(){}},runtime=new ComputerRuntime({timers});
  const oldWorker={postMessage(message){this.messages=(this.messages??[]).concat(message);},terminate(){this.terminated=true;}};
  const replacement={postMessage(message){this.messages=(this.messages??[]).concat(message);},terminate(){this.terminated=true;}};
  runtime.worker=oldWorker;runtime.modelId=CURRENT_COMPUTER_MODEL.id;let releaseOld,preparations=0;
  runtime.prepare=()=>{preparations++;if(preparations===1){runtime.generation++;return new Promise(resolve=>{releaseOld=resolve;});}return Promise.resolve();};
  const request={gameId:'g',gameplayRevision:1,state:createInitialState(),modelId:CURRENT_COMPUTER_MODEL.id,profile:'babs',seed:1,controlGeneration:1};
  const obsolete=runtime.compute(request);await Promise.resolve();
  runtime.cancel('position-changed');runtime.worker=replacement;runtime.modelId=CURRENT_COMPUTER_MODEL.id;
  const current=runtime.compute({...request,gameplayRevision:2,seed:2});await Promise.resolve();await Promise.resolve();
  assert.equal(replacement.messages.length,1);assert.equal(replacement.messages[0].type,'compute');
  releaseOld();await assert.rejects(obsolete,/cancelled/);
  assert.equal(replacement.messages.length,1);assert.notEqual(replacement.terminated,true);
  runtime.receive(replacement,{...replacement.messages[0],type:'computed',result:{status:'ready',action:{type:'pass'}}});
  await current;
});
test('a cold prepare that advances its generation synchronously still posts one legitimate compute',async()=>{
  const timers={setTimeout(){return 1;},clearTimeout(){}},runtime=new ComputerRuntime({timers});
  const worker={postMessage(message){this.messages=(this.messages??[]).concat(message);},terminate(){this.terminated=true;}};
  runtime.prepare=()=>{runtime.generation++;return Promise.resolve().then(()=>{runtime.worker=worker;runtime.modelId=CURRENT_COMPUTER_MODEL.id;});};
  const request={gameId:'g',gameplayRevision:1,state:createInitialState(),modelId:CURRENT_COMPUTER_MODEL.id,profile:'babs',seed:1,controlGeneration:1};
  const result=runtime.compute(request);await Promise.resolve();await Promise.resolve();
  assert.equal(worker.messages.length,1);assert.equal(worker.messages[0].type,'compute');
  runtime.receive(worker,{...worker.messages[0],type:'computed',result:{status:'ready',action:{type:'pass'}}});
  await result;
});
test('results are bound to the exact state metadata', async () => {
  const { runtime, worker, send } = fixture();
  const result = runtime.request({ type: 'compute', metadata: { fingerprint: 'expected', seed: 1 } });
  const rejected = assert.rejects(result, /stale-result/);
  send({ type: 'computed', metadata: { ...worker.message.metadata, fingerprint: 'other' } }); await rejected;
  assert.equal(worker.terminated, true);
});
test('corrupt cached models are replaced only with verified downloads; cache failure permits memory use', async () => {
  const bytes = new Uint8Array([1,2,3]), model = { id: 'one', url: '/model', bytes: 3, sha256: await sha256(bytes) };
  let removed = false;
  const cacheStorage = { open: async () => ({ match: async () => new Response([9]), delete: async () => { removed = true; }, put: async () => { throw Error('full'); } }) };
  const result = await loadComputerModel(model, { cacheStorage, fetchImpl: async () => new Response(bytes) });
  assert.equal(removed, true); assert.deepEqual(result.bytes, bytes); assert.equal(result.cached, false);
});
