import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRuntime } from './local-runtime.mjs';
import { derive } from './core.mjs';

test('real workerd service/DO boundary: vectors, no arbitrary credentials, overload', {timeout:60000}, async () => {
  const mf=await localRuntime();
  const send = body => mf.dispatchFetch('https://probe.invalid/probe',{method:'POST',body:JSON.stringify(body)});
  try {
    for(const fixture of ['ascii','unicode','long']) {
      const response=await send({fixture});
      assert.equal(response.status,200);
      const result=await response.json();
      assert.equal(result.hash,derive(fixture).toString('hex'));
      assert.equal(result.incorrectRejected,true);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
    }
    for(const body of [{fixture:'arbitrary'}, {fixture:'ascii',password:'secret'}, {fixture:'__proto__'},null]) assert.equal((await send(body)).status,400);
    assert.equal((await mf.dispatchFetch('https://probe.invalid/probe')).status,404);
    const burst=await Promise.all(Array.from({length:20},()=>send({fixture:'ascii'})));
    assert.ok(burst.some(r=>r.status===200));
    assert.ok(burst.some(r=>r.status===429));
    assert.ok(burst.every(r=>r.status===200 || r.status===429));
    for(const r of burst.filter(r=>r.status===429)) assert.equal(r.headers.get('Retry-After'),'1');
    assert.equal((await send({fixture:'ascii'})).status,200);
  } finally {await mf.dispose();}
});
