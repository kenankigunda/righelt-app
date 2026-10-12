import assert from 'node:assert/strict';
import test from 'node:test';
import { localApiFailure } from '../local-api-diagnostics.js';

test('local forwarding diagnostics exclude arbitrary request and exception values', () => {
  const secret = 'private-password-cookie-and-query';
  const request = new Request(`http://localhost:8788/api/shell/games?token=${secret}`, {
    method: 'POST', headers: { Cookie: secret, 'X-Righelt-Request-Id': secret }, body: secret,
  });
  const report = localApiFailure({ name: secret, message: `Network connection lost. ${secret}`,
    code: secret, cause: { code: 'ECONNRESET', message: secret } }, request, 'fetch');
  assert.deepEqual(report, { stage: 'fetch', requestId: null, method: 'POST', name: 'other',
    code: 'other', causeCode: 'ECONNRESET', message: 'network_connection_lost' });
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('hostile exception getters cannot replace the original failure', () => {
  const error = new Proxy({}, { get() { throw new Error('private'); } });
  const report = localApiFailure(error, new Request('http://localhost/'), 'request');
  assert.equal(report.stage, 'request');
  assert.equal(report.name, 'other');
  assert.equal(report.message, 'other');
});
