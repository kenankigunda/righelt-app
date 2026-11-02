import test from 'node:test';
import assert from 'node:assert/strict';
import { createRushSupplyGuidanceClient } from '../board/rush-supply-guidance.js';
import { RulesRuntime } from '../board/rules-runtime.js';

const fixture = timeoutMs => {
  const workers = [];
  const executor = new RulesRuntime({workerFactory: () => {
    const worker = {postMessage(data) {this.data=data;},terminate() {this.terminated=true;}};
    workers.push(worker);return worker;
  }});
  return {client:createRushSupplyGuidanceClient({executor,timeoutMs}), workers,
    reply(worker,result) {worker.onmessage({data:{...worker.data,result}});}};
};

test('guidance caches complete exact-snapshot results and cancels obsolete workers', async t => {
  const f=fixture(1000);t.after(()=>f.client.destroy());
  const first=f.client.analyze({turnIndex:1}), rejected=assert.rejects(first,{code:'rules_cancelled'});
  const second=f.client.analyze({turnIndex:2});
  assert.equal(f.workers[0].terminated,true);
  f.reply(f.workers[0],{obsolete:true});
  const result={obligationPieceIds:['A'],actions:[{action:{actorId:'B'},immediate:true}]};
  f.reply(f.workers[1],result);
  assert.deepEqual(await second,result);await rejected;
  assert.deepEqual(await f.client.analyze({turnIndex:2}),result);
  assert.equal(f.workers.length,2);
  const changed=f.client.analyze({turnIndex:2,pieces:[]});
  assert.equal(f.workers.length,3);f.reply(f.workers[2],result);await changed;
});

test('deadline terminates analysis and never exposes a partial result', async t => {
  const f=fixture(5);t.after(()=>f.client.destroy());
  await assert.rejects(f.client.analyze({turnIndex:1}),{code:'rules_cancelled'});
  assert.equal(f.workers[0].terminated,true);
});

test('settlement of a canceled job cannot remove the replacement deadline', async t => {
  const f=fixture(10);t.after(()=>f.client.destroy());
  const first=f.client.analyze({turnIndex:1});const rejected=assert.rejects(first);
  const second=f.client.analyze({turnIndex:2});const secondRejected=assert.rejects(second);
  await rejected;await secondRejected;
  assert.equal(f.workers[1].terminated,true);
});

test('destroy terminates a pending worker and clears cached results', async () => {
  const f=fixture(1000), pending=f.client.analyze({turnIndex:1}), rejected=assert.rejects(pending);
  f.client.destroy();await rejected;assert.equal(f.workers[0].terminated,true);
});
