import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Admission, derive, equal, evaluate, percentile95 } from './core.mjs';

const vectors = {
  ascii: 'cf90bf6713f093b174b6b4645ad5b5af0798f5166c92767cb859bcb0ea469a77',
  unicode: '1f7ea2aced71e25de577ba4d40fa920aac9173bdfa6108019e257eb7c616451e',
  long: '8072c57aea5b05f3f21f410a12d74bed21606f7020bdb670328101a9f02d017a',
};
test('known answers, NFC Unicode, long input and incorrect passwords', () => {
  for (const [fixture, expected] of Object.entries(vectors)) {
    const actual = derive(fixture);
    assert.equal(actual.toString('hex'), expected);
    assert.equal(equal(actual, derive(fixture, undefined, true)), false);
    assert.equal(equal(actual, actual), true);
    assert.equal(equal(actual, Buffer.alloc(1)), false);
  }
  assert.throws(() => derive('__proto__'));
});

test('one active plus four waiting, FIFO; rejection does not start work', async () => {
  const releases = [], started = [];
  const admission = new Admission(async id => { started.push(id); await new Promise(resolve => releases.push(resolve)); return id; });
  const jobs = Array.from({length:20}, (_,i) => admission.submit(i));
  assert.deepEqual(started, [0]);
  const rejected = await Promise.all(jobs.slice(5));
  assert.ok(rejected.every(r => r.rejected));
  for(let i=0;i<5;i++) { releases.shift()(); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual(started,[0,1,2,3,4]);
  assert.deepEqual((await Promise.all(jobs.slice(0,5))).map(r => r.value),[0,1,2,3,4]);
});

test('a failed hash releases admission and preserves the next waiter', async () => {
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const admission = new Admission(async n => {await gate; if(n===0) throw new Error('runtime failure'); return n;});
  const first = admission.submit(0), second = admission.submit(1);
  release();
  await assert.rejects(first,/runtime failure/);
  assert.equal((await second).value,1);
  assert.equal((await admission.submit(2)).value,2);
});

function validEvidence() {
  const ok = {fixture:'ascii',status:200,correct:true,incorrectRejected:true,elapsedMs:10};
  return {
    report:{schemaVersion:1,runtime:'deployed',runId:'test',startedAt:'2026-10-03T12:00:00.000Z',finishedAt:'2026-10-03T12:02:00.000Z',vectors:['ascii','unicode','long'].map(fixture => ({...ok,fixture})),sequential:Array(100).fill(ok),burst:[...Array(5).fill(ok),...Array(15).fill({fixture:'ascii',status:429,retryAfter:'1',elapsedMs:1})]},
    provider:{runId:'test',source:'provider-export.json',plan:'free',hashCpuP95Ms:200,memoryBytes:32000000,memoryStatistic:'p999',memorySource:'durableObjectsPeriodicGroups.memoryUsageBytesP999',cpuSource:'invocation export',cpuSamples:103,startedAt:'2026-10-03T12:00:00.000Z',finishedAt:'2026-10-03T12:02:00.000Z',resourceNames:['righelt-t108-hash-engine','righelt-t108-hash-feasibility'],resourceLimitFailures:0,coldStartMeasured:true,requestsConsumed:123,durationGbSeconds:1,withinFreeAllowance:true},
  };
}
test('gate fails closed for absent measurements, invalid thresholds, local results and wrong run', () => {
  const {report,provider}=validEvidence();
  assert.equal(evaluate(report,provider).passed,true);
  assert.equal(evaluate(report).passed,false);
  for(const field of Object.keys(provider)) {
    const missing={...provider}; delete missing[field];
    assert.equal(evaluate(report,missing).passed,false,field);
  }
  for(const override of [{plan:'paid'},{runId:'other'},{hashCpuP95Ms:1000},{hashCpuP95Ms:NaN},{memoryBytes:128*1024*1024},{resourceLimitFailures:1}]) assert.equal(evaluate(report,{...provider,...override}).passed,false);
  assert.equal(evaluate({...report,runtime:'local'},provider).passed,false);
  assert.equal(evaluate({...report,sequential:report.sequential.slice(1)},provider).passed,false);
  assert.equal(evaluate({...report,sequential:Array(100).fill({status:200,correct:true,elapsedMs:5000})},provider).passed,false);
  assert.equal(evaluate({...report,burst:Array(20).fill({status:200,correct:true})},provider).passed,false);
});
test('nearest rank p95 and invalid data', () => {
  assert.equal(percentile95(Array.from({length:100},(_,i)=>i+1)),95);
  assert.equal(percentile95([]),null);
  assert.equal(percentile95([NaN]),null);
});

test('each required vector must be unique, successful and explicitly verify incorrect passwords', () => {
  const {report,provider}=validEvidence();
  for (const override of [
    {fixture:'ascii'}, {fixture:'unknown'}, {status:500}, {status:'200'},
    {correct:false}, {correct:'true'}, {incorrectRejected:false}, {incorrectRejected:1},
    {elapsedMs:NaN}, {elapsedMs:-1},
  ]) {
    const changed=structuredClone(report);
    Object.assign(changed.vectors[1],override);
    assert.equal(evaluate(changed,provider).passed,false,JSON.stringify(override));
  }
});

test('every repeated or burst success checks the wrong password too', () => {
  const {report,provider}=validEvidence();
  for (const field of ['sequential','burst']) {
    for (const override of [
      {incorrectRejected:false},{incorrectRejected:undefined},{incorrectRejected:'true'},
      {correct:'true'},{status:500},{fixture:'unicode'},{elapsedMs:Infinity},
    ]) {
      const changed=structuredClone(report);
      Object.assign(changed[field][2],override);
      assert.equal(evaluate(changed,provider).passed,false,`${field}: ${JSON.stringify(override)}`);
    }
  }
  for(const override of [{retryAfter:1},{retryAfter:undefined},{fixture:'long'},{elapsedMs:-1}]) {
    const changed=structuredClone(report);
    Object.assign(changed.burst[6],override);
    assert.equal(evaluate(changed,provider).passed,false);
  }
});

test('malformed report, provider, arrays, null rows and sparse rows fail without throwing', () => {
  const {report,provider}=validEvidence();
  for(const value of [undefined,null,false,3,'report',[]]) {
    assert.equal(evaluate(value,provider).passed,false);
    assert.equal(evaluate(report,value).passed,false);
  }
  for(const field of ['vectors','sequential','burst']) {
    for(const value of [null,{},'rows',{length:report[field].length},Array(report[field].length)]) {
      assert.equal(evaluate({...report,[field]:value},provider).passed,false,field);
    }
    for(const value of [null,undefined,false,1,'row',[]]) {
      const changed=structuredClone(report);
      changed[field][1]=value;
      assert.equal(evaluate(changed,provider).passed,false,field);
    }
  }
  for(const value of [null,undefined,{},'12',Array(3)]) assert.equal(percentile95(value),null);
});

test('report identity and interval cannot be missing even if provider repeats them', () => {
  const {report,provider}=validEvidence();
  for(const override of [
    {schemaVersion:undefined},{schemaVersion:2},{runId:undefined},{runId:' '},
    {startedAt:undefined},{startedAt:'invalid'},{finishedAt:'2026-10-02T12:00:00.000Z'},
  ]) assert.equal(evaluate({...report,...override},{...provider,...override}).passed,false);
});
