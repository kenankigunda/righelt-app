import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerPreparation } from '../shell/computer-preparation.js';

function fixture() {
  let now = 10, settle, progress, cancellations = 0;
  const timers = new Set();
  const runtime = { prepare: (_, observe) => { progress = observe; return new Promise((resolve, reject) => { settle = { resolve, reject }; }); }, cancel: () => { cancellations++; } };
  const preparation = createComputerPreparation({ runtime, clock: () => now, timers: { setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn) } });
  return { preparation, setTime: value => { now = value; }, settle: () => settle, progress: value => progress(value), timers, cancellations: () => cancellations };
}
test('readiness waits for verified initialization and detailed progress waits five seconds', async () => {
  const f = fixture(), work = f.preparation.start('intro');
  assert.equal(f.preparation.snapshot('intro').state, 'preparing');
  assert.equal(f.preparation.start('intro'), work);
  f.progress({ received: 50, total: 100 }); f.setTime(5009);
  assert.equal(f.preparation.snapshot('intro').detailed, false);
  f.setTime(5010); assert.equal(f.preparation.snapshot('intro').detailed, true);
  assert.match(f.preparation.snapshot('intro').message, /50 of 100 bytes/);
  f.settle().resolve(); await work;
  assert.equal(f.preparation.snapshot('intro').state, 'ready');
  assert.equal(f.timers.size, 0);
  f.preparation.cancel('intro'); assert.equal(f.cancellations(), 1);
});
test('dismissed or superseded preparation cannot enable a later entry surface', async () => {
  const f = fixture(), first = f.preparation.start('intro'), old = f.settle();
  const second = f.preparation.start('branch'), next = f.settle();
  f.preparation.cancel('intro'); old.resolve(); await first;
  assert.equal(f.preparation.snapshot('branch').state, 'preparing');
  assert.equal(f.preparation.snapshot('intro').state, 'idle');
  next.resolve(); await second; assert.equal(f.preparation.snapshot('branch').state, 'ready');
  f.preparation.cancel(); assert.equal(f.timers.size, 0);
});
test('failed preparation stays unavailable until an explicit successful retry', async () => {
  const f = fixture(), first = f.preparation.start('intro');
  f.settle().reject(Error('model-checksum')); await first;
  assert.equal(f.preparation.snapshot('intro').state, 'error');
  const retry = f.preparation.start('intro');
  assert.equal(f.preparation.snapshot('intro').state, 'preparing');
  f.settle().resolve(); await retry;
  assert.equal(f.preparation.snapshot('intro').state, 'ready'); f.preparation.cancel();
});

test('readiness names the exact prepared model and a different version retires it', async () => {
 const f=fixture();const first=f.preparation.start('intro','initial-1554');f.settle().resolve();await first;
 assert.equal(f.preparation.snapshot('intro').modelId,'initial-1554');
 const next=f.preparation.start('intro','test-next-model');assert.equal(f.preparation.snapshot('intro').state,'preparing');assert.equal(f.preparation.snapshot('intro').modelId,'test-next-model');
 f.settle().resolve();await next;assert.equal(f.preparation.snapshot('intro').state,'ready');f.preparation.cancel();
});
