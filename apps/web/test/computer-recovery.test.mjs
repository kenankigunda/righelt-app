import test from 'node:test';
import assert from 'node:assert/strict';
import { computerRetryDisposition, fetchComputerResource } from '../shell/computer-recovery.js';
import { fetchVerifiedAsset, sha256 } from '../shell/verified-assets.js';

test('retry classification accepts only known transient failures and scoped admission cancellations', () => {
  for (const status of [408, 429, 500, 503, 599]) assert.equal(computerRetryDisposition({ status }), 'retry');
  for (const code of ['request_timeout', 'computer_network_error', 'computer_network_timeout', 'computer_transfer_incomplete']) assert.equal(computerRetryDisposition({ code }), 'retry');
  assert.equal(computerRetryDisposition({ diagnosticEvidence: { stage: 'request_failed', status: null } }), 'retry');
  for (const code of ['rules_cancelled', 'sync_recovering', 'stale_state']) assert.equal(computerRetryDisposition({ code }), 'discard');
  for (const code of ['invalid_credentials', 'session_changed', 'upgrade_required', 'storage_reset', 'invalid_response', 'attempt_id_conflict', 'invalid_attempt', 'no-progress', 'stale-result', 'worker-error']) assert.equal(computerRetryDisposition({ code }), 'terminal');
  for (const status of [400, 401, 403, 404, 409]) assert.equal(computerRetryDisposition({ status }), 'terminal');
  assert.equal(computerRetryDisposition(new TypeError('programming error')), 'terminal');
});

test('resource fetch preserves HTTP status and Retry-After and distinguishes network abort from cancellation', async () => {
  await assert.rejects(fetchComputerResource('/asset', { fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '10' } }) }), error => error.status === 429 && error.retryAfterMs === 10000);
  await assert.rejects(fetchComputerResource('/asset', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), error => error.code === 'computer_network_error');
  for (const [reason, code] of [['no-progress', 'computer_network_timeout'], ['left-game', 'computer_cancelled']]) {
    const controller = new AbortController(); controller.abort(reason);
    await assert.rejects(fetchComputerResource('/asset', { signal: controller.signal, fetchImpl: async () => { throw Error('aborted'); } }), error => error.code === code);
  }
});

test('partial downloads retry but oversized and checksum-corrupt assets remain terminal', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const expected = { bytes: 3, sha256: await sha256(bytes) };
  await assert.rejects(fetchVerifiedAsset('/asset', expected, { fetchImpl: async () => new Response(bytes.slice(0, 2)) }), error => computerRetryDisposition(error) === 'retry');
  for (const data of [new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 2, 1])]) {
    await assert.rejects(fetchVerifiedAsset('/asset', expected, { fetchImpl: async () => new Response(data) }), error => computerRetryDisposition(error) === 'terminal');
  }
});

test('a resource stream that stops making progress becomes an automatically retryable timeout', async () => {
  const expected = { bytes: 1, sha256: await sha256(new Uint8Array([1])) };
  await assert.rejects(fetchVerifiedAsset('/asset', expected, { noProgressMs: 1,
    fetchImpl: async (_, { signal }) => new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    } })),
  }), error => error.code === 'computer_network_timeout' && computerRetryDisposition(error) === 'retry');
});
