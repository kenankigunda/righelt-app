import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkersPlan, preflight } from './t108-cloudflare-preflight.mjs';

test('free classification requires a readable complete subscription list', () => {
  assert.equal(classifyWorkersPlan(undefined), 'unknown');
  assert.equal(classifyWorkersPlan([{}]), 'unknown');
  assert.equal(classifyWorkersPlan([]), 'free');
  assert.equal(classifyWorkersPlan([{ rate_plan: { id: 'WORKERS_FREE' } }]), 'free');
  assert.equal(classifyWorkersPlan([{ rate_plan: { id: 'WORKERS_BASIC' } }]), 'not_verified_free');
  assert.equal(classifyWorkersPlan([{ rate_plan: { id: 'new', public_name: 'Workers something' } }]), 'not_verified_free');
});
test('denied subscription access blocks without disclosing credential or response text', async () => {
  const result = await preflight({ token: 'DO-NOT-PRINT', accountId: 'a'.repeat(32), fetchImpl: async () => Response.json({ success: false, errors: [{ code: 9109, message: 'DO-NOT-PRINT' }] }, { status: 403 }) });
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'subscriptions_read_unavailable');
  assert.equal(JSON.stringify(result).includes('DO-NOT-PRINT'), false);
});
test('analytics access is required after Free-plan verification', async () => {
  let calls = 0;
  const result = await preflight({ token: 'test', accountId: 'a'.repeat(32), fetchImpl: async () => ++calls === 1 ? Response.json({ success: true, result: [] }) : Response.json({ errors: [{}] }) });
  assert.equal(result.reason, 'analytics_schema_unavailable');
});
test('later subscription pages cannot conceal a paid Workers plan', async () => {
  let calls = 0;
  const result = await preflight({ token: 'test', accountId: 'a'.repeat(32), fetchImpl: async () => Response.json({ success: true, result: ++calls === 1 ? [] : [{ rate_plan: { id: 'WORKERS_BASIC' } }], result_info: { total_pages: 2 } }) });
  assert.equal(calls, 2);
  assert.equal(result.passed, false);
});
