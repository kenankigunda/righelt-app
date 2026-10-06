import test from 'node:test';
import assert from 'node:assert/strict';
import { pressureState, advancePressure } from '../policy.mjs';
import { memorySample, sameProcess } from '../system.mjs';
import { cleanupRecord } from '../registry.mjs';
test('pressure defers launches, cancels only sustained critical and recovers after four normal samples', () => {
  let s = advancePressure(pressureState(), { level: 'warning' }, 0);
  assert.equal(s.blocked, true); assert.equal(s.cancel, false);
  s = advancePressure(s, { level: 'warning' }, 60_000);
  assert.equal(s.releaseIdle, true); assert.equal(s.cancel, false);
  s = advancePressure(s, { level: 'critical' }, 70_000); assert.equal(s.cancel, false);
  s = advancePressure(s, { level: 'critical' }, 130_000); assert.equal(s.cancel, true);
  for (let n = 0; n < 3; n++) { s = advancePressure(s, { level: 'normal' }, 140_000+n); assert.equal(s.blocked, true); }
  s = advancePressure(s, { level: 'normal' }, 140_004); assert.equal(s.blocked, false); assert.equal(s.recovered, true);
});
test('unknown samples cannot count toward recovery or sustained critical', () => {
  let s = advancePressure(pressureState(), { level: 'critical' }, 0);
  s = advancePressure(s, { level: 'unknown' }, 60_000); assert.equal(s.blocked, true); assert.equal(s.cancel, false);
  s = advancePressure(s, { level: 'critical' }, 90_000); assert.equal(s.cancel, false);
});
test('macOS read-only probes map pressure and record swap without treating swap as pressure', async () => {
  const calls = [];
  const sample = await memorySample({ platform: 'darwin', run: async (cmd, args) => { calls.push([cmd,args]); return { stdout: args[0]==='-n'?'2\n':'vm.swapusage: total = 2048.00M used = 123.00M free = 1925.00M' }; } });
  assert.equal(sample.level,'warning'); assert.equal(sample.swapBytes,123*1024**2);
  assert.deepEqual(calls[0][1],['-n','kern.memorystatus_vm_pressure_level']);
  const missing = await memorySample({ platform: 'darwin', run: async () => { throw Error('denied'); } }); assert.equal(missing.level,'unknown');
  assert.equal((await memorySample({ platform:'linux' })).level,'unknown');
});
test('stale records and reused PIDs never authorize signals', async () => {
  const row = { pid: 100, start: 'new', pgid: 100, state: 'S' }, signals=[];
  const record={supervisor:{pid:100,start:'old'},pgid:100,members:[{pid:100,start:'old'}]};
  assert.equal(sameProcess(row,record.supervisor),false);
  assert.equal(await cleanupRecord(record,{table:async()=>[row],signal:(...args)=>signals.push(args)}),'stale'); assert.deepEqual(signals,[]);
});
test('cleanup signals the exact supervisor, or only matching recorded orphan members', async () => {
  const owner={pid:100,start:'owner',state:'S'}, member={pid:101,start:'member',pgid:101,state:'S'}, stranger={pid:102,start:'unrelated',pgid:101,state:'S'}, signals=[];
  const record={supervisor:owner,pgid:101,members:[member]};
  assert.equal(await cleanupRecord(record,{table:async()=>signals.length?[stranger]:[owner,member,stranger],signal:(...a)=>signals.push(a)}),'verified'); assert.deepEqual(signals,[[100,'SIGTERM']]);
  signals.length=0;
  assert.equal(await cleanupRecord(record,{table:async()=>signals.length?[stranger]:[member,stranger],signal:(...a)=>signals.push(a)}),'verified');assert.deepEqual(signals,[[101,'SIGTERM']]);
});
