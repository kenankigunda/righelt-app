import test from 'node:test';
import assert from 'node:assert/strict';
import { RulesRuntime } from '../board/rules-runtime.js';

const fixture = () => {
  const workers = [];
  const runtime = new RulesRuntime({ workerFactory() {
    const worker = { postMessage(message) { this.message = message; }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  } });
  return { runtime, workers, reply(worker, result) { worker.onmessage({ data: { ...worker.message, result } }); } };
};
test('rules results cross the worker boundary completely, including Maps', async () => {
  const f = fixture();
  const result = { ok: true, commandResults: new Map([['end', { legalActions: [{ type: 'pass' }] }]]) };
  const pending = f.runtime.project('g:51', { board: 'frozen input' });
  assert.equal(f.workers.length, 1);
  f.reply(f.workers[0], result);
  assert.deepEqual(await pending, result);
  assert.equal(f.workers[0].terminated, true);
});
test('identical pending preview inputs share one worker and cancellation fences reuse',async()=>{
 const f=fixture(),input={state:{turnIndex:1},legalActions:[],pieceId:'A'};
 const first=f.runtime.previews('piece',input);first.catch(()=>{});
 const repeated=f.runtime.previews('piece',structuredClone(input));repeated.catch(()=>{});
 assert.equal(f.workers.length,1);assert.equal(repeated,first);
 f.runtime.cancelAll();await assert.rejects(first,{code:'rules_cancelled'});
 const next=f.runtime.previews('piece',input);assert.equal(f.workers.length,2);
 f.reply(f.workers[1],{actions:[]});assert.deepEqual(await next,{actions:[]});
});
test('replacing a scope terminates blocked rules and ignores its late reply', async () => {
  const f = fixture(), first = f.runtime.previews('piece', { pieceId: 'A' });
  const rejected = assert.rejects(first, { code: 'rules_cancelled' });
  const second = f.runtime.previews('piece', { pieceId: 'B' });
  assert.equal(f.workers[0].terminated, true);
  f.reply(f.workers[0], { pieceId: 'A' });
  f.reply(f.workers[1], { pieceId: 'B' });
  assert.deepEqual(await second, { pieceId: 'B' }); await rejected;
});
test('one running rules worker and scoped queue are canceled without launching queued work', async () => {
  const f = fixture();
  const first = f.runtime.project('first', {}), second = f.runtime.project('second', {});
  const rejected = Promise.all([assert.rejects(first, { code: 'rules_cancelled' }), assert.rejects(second, { code: 'rules_cancelled' })]);
  assert.equal(f.workers.length, 1); f.runtime.cancelAll(); await rejected;
  assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, true);
});
test('worker faults and invalid replies reject without running rules on the caller thread', async () => {
  for (const fault of ['onerror', 'onmessageerror', 'identity', 'reported']) {
    const f = fixture(), pending = f.runtime.project('game', {});
    const rejected = assert.rejects(pending);
    const worker = f.workers[0];
    if (fault === 'identity') worker.onmessage({ data: { ...worker.message, id: -1 } });
    else if (fault === 'reported') worker.onmessage({ data: { ...worker.message, error: { message: 'failed rule', code: 'RULE_ERROR' } } });
    else worker[fault]();
    await rejected; assert.equal(worker.terminated, true);
  }
});
