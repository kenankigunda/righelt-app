import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayOrigin } from './runner.mjs';
test('probe credentials are restricted to the exact approved gateway origin', () => {
  assert.equal(gatewayOrigin('https://righelt-t108-gateway.kenankigunda.workers.dev').hostname, 'righelt-t108-gateway.kenankigunda.workers.dev');
  for (const url of ['https://righelt-t108-evil.com', 'https://righelt-t108-gateway.other.workers.dev', 'http://righelt-t108-gateway.kenankigunda.workers.dev', 'https://righelt-t108-gateway.kenankigunda.workers.dev:444', 'https://righelt-t108-gateway.kenankigunda.workers.dev/?target=foreign', 'https://user:secret@righelt-t108-gateway.kenankigunda.workers.dev']) assert.throws(() => gatewayOrigin(url));
});
