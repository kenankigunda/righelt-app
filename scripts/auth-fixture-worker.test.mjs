import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixtureWorkerSource } from './auth-fixture-worker.mjs';
const token = 'private-local-fixture-token-123456789';
const api = 'data:text/javascript,' + encodeURIComponent('export const GameRoomDO = class {}; export default {fetch:()=>new Response("app"),scheduled:()=>"scheduled"};');
const module = await import('data:text/javascript,' + encodeURIComponent(authFixtureWorkerSource(api, token)));
const worker = module.default;

test('fixture reuses live D1 binding and completes the fixed operation before acknowledging', async () => {
  let release, statement;
  const pending = new Promise(resolve => {release = resolve;});
  const result = worker.fetch(new Request('http://127.0.0.1/__righelt_fixture', {method:'POST',headers:{'x-righelt-fixture':token},body:'DELETE FROM account_rate_limits'}), {DB:{prepare(sql){statement=sql;return {run:()=>pending};}}});
  let completed = false; result.then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(statement,'DELETE FROM account_rate_limits');assert.equal(completed,false);
  release();assert.equal((await result).status,200);
});

test('fixture rejects origins, public hosts, wrong tokens, query strings and arbitrary SQL', async () => {
  const env = {DB:{prepare(){assert.fail('must not access DB');}}};
  for (const [url, headers, body, method] of [
    ['http://127.0.0.1/__righelt_fixture',{},'DELETE FROM account_rate_limits','POST'],
    ['http://127.0.0.1/__righelt_fixture',{'x-righelt-fixture':token,origin:'http://localhost'},'DELETE FROM account_rate_limits','POST'],
    ['https://public.example/__righelt_fixture',{'x-righelt-fixture':token},'DELETE FROM account_rate_limits','POST'],
    ['http://127.0.0.1/__righelt_fixture?sql=1',{'x-righelt-fixture':token},'DELETE FROM account_rate_limits','POST'],
    ['http://127.0.0.1/__righelt_fixture',{'x-righelt-fixture':token},'DROP TABLE accounts','POST'],
    ['http://127.0.0.1/__righelt_fixture',{'x-righelt-fixture':token},undefined,'GET'],
  ]) assert.equal((await worker.fetch(new Request(url,{method,headers,body}),env)).status,404);
});

test('regular requests and worker exports retain production behavior', async () => {
  assert.equal(await (await worker.fetch(new Request('http://127.0.0.1/api/health'),{})).text(),'app');
  assert.equal(worker.scheduled(),'scheduled');assert.equal(typeof module.GameRoomDO,'function');
});

test('weak fixture token fails before generating a wrapper',()=>assert.throws(()=>authFixtureWorkerSource(api,''),/private fixture token/));
