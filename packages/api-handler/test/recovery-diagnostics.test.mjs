import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRequest } from '../src/index.ts';
import { createRecoveryDiagnosticsHandler, diagnosticRoute } from '../src/recovery-diagnostics.ts';
import { createFakeD1 } from './support/fake-d1.mjs';
import { RECOVERY_DIAGNOSTICS, sanitizeRecoveryDiagnosticEvent, validateRecoveryDiagnosticBatch, validateRecoveryDiagnosticEvent } from '../../shared-types/src/recovery-diagnostics.js';

const origin = 'https://righelt.pages.dev';
const event = () => ({ eventId: crypto.randomUUID(), type: 'recovery_blocked', at: 1793775600000,
  gameId: 'game-e046421de8696356d058dcc7a685042e8b88', episodeId: crypto.randomUUID(),
  requestId: crypto.randomUUID(), commandId: `v2:${crypto.randomUUID()}`, requestRelationship: 'latest_observed',
  observedDeploymentSha: '5a7d6c716c0bf06ef8af2549da21acb20023a79c',
  loadedBuild: 'unavailable', serverBuild: crypto.randomUUID(), pendingCount: 0,
  appliedEventSeq: 194, advertisedEventSeq: 194, gameplayRevision: 44, visibility: 'visible', online: true,
  rulesChecking: false, storageBlocked: false, connectionRecovering: true, sharedPending: false,
  syncStatus: 'confirming', ageMs: 16000, reason: 'socket_closed', gate: 'admission_changed' });
const batch = () => ({ schemaVersion: 1, events: [event()] });
const request = (body = batch(), overrides = {}) => new Request(`${origin}${RECOVERY_DIAGNOSTICS.path}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body), ...overrides,
});

test('remote projection excludes local reports, arbitrary strings and sensitive values', () => {
  const source = { ...event(), identityId: 'secret-identity', authContextId: 'secret-context',
    authoritativeState: { pieces: [{ id: 'secret-state' }] }, action: { type: 'secret-action' },
    browser: 'secret-agent', timezone: 'secret-location', gameLink: 'https://secret-link',
    headers: { authorization: 'secret-token' }, reason: 'secret-error-message' };
  const clean = sanitizeRecoveryDiagnosticEvent(source);
  assert.equal(clean.reason, 'unknown');
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  assert.equal(validateRecoveryDiagnosticEvent(clean), true);
  assert.equal(validateRecoveryDiagnosticEvent(source), false, 'server must not trust sender sanitization');
});

test('remote contract rejects malformed required fields and contains optional values', () => {
  for (const invalid of [null, [], {}, { ...event(), eventId: 'not-a-uuid' }, { ...event(), type: 'custom-secret' }, { ...event(), at: -1 }]) {
    assert.equal(sanitizeRecoveryDiagnosticEvent(invalid), null);
    assert.equal(validateRecoveryDiagnosticEvent(invalid), false);
  }
  for (const patch of [{ pendingCount: -1 }, { retry: Infinity }, { ageMs: 86400001 }, { status: 99 },
    { gameId: 'game-1234' }, { loadedBuild: 'arbitrary-string' }, { gate: 'unbounded-secret' }, { rulesChecking: 'yes' }]) {
    const value = { ...event(), ...patch };
    assert.equal(validateRecoveryDiagnosticEvent(value), false);
    assert.equal(validateRecoveryDiagnosticEvent(sanitizeRecoveryDiagnosticEvent(value)), true);
  }
  assert.equal(sanitizeRecoveryDiagnosticEvent({ ...event(), get reason() { throw Error('unreadable'); } }), null);
  assert.equal(validateRecoveryDiagnosticEvent({ ...event(), type: 'readiness', gate: 'ready' }), true);
});

test('batch envelope and event count are strict', () => {
  assert.equal(validateRecoveryDiagnosticBatch(batch()), true);
  for (const value of [{ ...batch(), schemaVersion: 2 }, { ...batch(), identityId: 'private' },
    { schemaVersion: 1, events: [] }, { schemaVersion: 1, events: Array.from({ length: 17 }, event) },
    { schemaVersion: 1, events: [{ ...event(), code: 'private error' }] }]) {
    assert.equal(validateRecoveryDiagnosticBatch(value), false);
  }
});

test('remote command correlation admits only generated v2 UUIDs and explicitly labels request relationship', async () => {
  const logs = [], handler = createRecoveryDiagnosticsHandler({ log: value => logs.push(value) });
  for (const relationship of ['latest_observed', 'failure', 'unknown']) {
    const body = { schemaVersion: 1, events: [{ ...event(), requestRelationship: relationship }] };
    assert.equal((await handler(request(body))).status, 202);
    assert.equal(logs.at(-1).events[0].requestRelationship, relationship);
    assert.equal(logs.at(-1).events[0].commandId, body.events[0].commandId);
  }
  for (const commandId of ['create:secret-game', 'shared:secret-operation', 'private-command',
    'v2:not-a-uuid', `v2:${crypto.randomUUID()}\n`, `v2:${crypto.randomUUID()}:private-suffix`]) {
    const body = { schemaVersion: 1, events: [{ ...event(), commandId }] };
    assert.equal((await handler(request(body))).status, 400);
    assert.equal(sanitizeRecoveryDiagnosticEvent(body.events[0]).commandId, undefined);
  }
  const invalid = { ...event(), requestRelationship: 'secret-request-description' };
  assert.equal(validateRecoveryDiagnosticEvent(invalid), false);
  assert.equal(sanitizeRecoveryDiagnosticEvent(invalid).requestRelationship, 'unknown');
  assert.equal(logs.length, 3, 'malformed IDs and arbitrary relationship text never reach the log');
  for (const patch of [{ eventId: `${crypto.randomUUID()}\n` }, { gameId: `${event().gameId}\n` },
    { observedDeploymentSha: `${'a'.repeat(40)}\n` }]) assert.equal(validateRecoveryDiagnosticEvent({ ...event(), ...patch }), false);
});

test('ingestion writes one bounded untrusted log and returns a payload-free acceptance', async () => {
  const logs = [];
  const handler = createRecoveryDiagnosticsHandler({ now: () => 1234, log: record => logs.push(record) });
  const body = batch();
  const response = await handler(request(body));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(logs, [{ event: 'client_recovery_diagnostics', source: 'untrusted_client', schemaVersion: 1, receivedAt: 1234, events: body.events }]);
  assert.equal(await handler(new Request(`${origin}/api/other`)), null);
});

test('ingestion rejects wrong method, missing/cross origin and content type before logging', async () => {
  const logs = [];
  const handler = createRecoveryDiagnosticsHandler({ log: value => logs.push(value) });
  const cases = [
    [new Request(`${origin}${RECOVERY_DIAGNOSTICS.path}`), 405],
    [request(batch(), { headers: { 'content-type': 'application/json' } }), 403],
    [request(batch(), { headers: { origin: 'null', 'content-type': 'application/json' } }), 403],
    [request(batch(), { headers: { origin: 'https://attacker.example', 'content-type': 'application/json' } }), 403],
    [request(batch(), { headers: { origin, 'content-type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request(batch(), { headers: { origin, 'content-type': 'text/plain' } }), 415],
  ];
  for (const [input, status] of cases) assert.equal((await handler(input)).status, status);
  assert.deepEqual(logs, []);
});

test('server rejects extra fields and malformed event values rather than logging them', async () => {
  const logs = [];
  const handler = createRecoveryDiagnosticsHandler({ log: value => logs.push(value) });
  for (const value of [{ ...batch(), session: 'secret' }, { schemaVersion: 1, events: [{ ...event(), reason: 'custom-secret' }] },
    { schemaVersion: 1, events: [{ ...event(), gate: 'custom-secret' }] }, { schemaVersion: 1, events: [{ ...event(), pendingCount: 1.5 }] }]) {
    assert.equal((await handler(request(value))).status, 400);
  }
  assert.deepEqual(logs, []);
});

test('only explicit configuration permits the local Pages to API origin hop', async () => {
  const handler = createRecoveryDiagnosticsHandler({ log() {} });
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const browserOrigin = `http://${host}:9888`, apiOrigin = `http://${host}:9887`;
    const forwarded = () => new Request(`${apiOrigin}${RECOVERY_DIAGNOSTICS.path}`, {
      method: 'POST', headers: { Origin: browserOrigin, 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(batch()),
    });
    assert.equal((await handler(forwarded())).status, 403, 'different local ports need explicit configuration');
    assert.equal((await handler(forwarded(), { allowedOrigins: `http://${host}:9999` })).status, 403);
    assert.equal((await handler(forwarded(), { allowedOrigins: `${browserOrigin}/,*` })).status, 403, 'no wildcard or noncanonical origin');
    assert.equal((await handler(forwarded(), { allowedOrigins: browserOrigin })).status, 202);
  }
  assert.equal((await handler(request(batch(), { headers: { Origin: 'https://attacker.example', 'content-type': 'application/json' } }), { allowedOrigins: 'https://attacker.example' })).status, 403, 'configured alternatives never broaden production ingestion');
});

test('actual streamed body cap applies without a trustworthy content length', async () => {
  const logs = [];
  const handler = createRecoveryDiagnosticsHandler({ log: value => logs.push(value) });
  const prefix = new TextEncoder().encode(JSON.stringify(batch()));
  let cancelled = false;
  const input = request(undefined, { body: new ReadableStream({ start(controller) {
    controller.enqueue(prefix);
    controller.enqueue(new Uint8Array(RECOVERY_DIAGNOSTICS.maximumBytes).fill(32));
  }, cancel() { cancelled = true; } }), duplex: 'half' });
  assert.equal(input.headers.has('content-length'), false);
  assert.equal((await handler(input)).status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(logs, []);
});

test('stalled upload body is cancelled at the existing bounded read deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const handler = createRecoveryDiagnosticsHandler({ log: () => assert.fail('incomplete body cannot be logged') });
  const input = request(undefined, { body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' });
  const pending = handler(input);
  context.mock.timers.tick(5000);
  assert.equal((await pending).status, 408);
  assert.equal(cancelled, true);
});

test('per-isolate global intake budget applies across different invented episode IDs and resets', async () => {
  let now = 1000, logs = 0;
  const handler = createRecoveryDiagnosticsHandler({ now: () => now, log: () => logs++ });
  for (let i = 0; i < 120; i++) assert.equal((await handler(request())).status, 202);
  const throttled = await handler(request());
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get('retry-after'), '60');
  assert.equal(logs, 120);
  now += 60000;
  assert.equal((await handler(request())).status, 202);
  assert.equal(logs, 121);
});

test('a broken log sink returns an isolated diagnostic failure without throwing', async () => {
  const handler = createRecoveryDiagnosticsHandler({ log() { throw Error('sink failed'); } });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'diagnostics_unavailable' });
});

test('outer API admits reports during auth/storage failures without reading any service', async context => {
  const logs = [];
  context.mock.method(console, 'info', value => logs.push(JSON.parse(value)));
  const forbidden = new Proxy({}, { get() { assert.fail('diagnostic intake must not access database or game authority'); } });
  const env = { DB: forbidden, GAME_ROOMS: forbidden, STORAGE_GENERATION: 'current', AUTH_ENABLED: 'true', AUTH_REQUIRED: 'true' };
  const input = request(batch(), { headers: { origin, 'content-type': 'application/json',
    'X-Righelt-Storage-Generation': 'obsolete', cookie: 'session=private-cookie' } });
  const response = await handleApiRequest(input, env);
  assert.equal(response.status, 202);
  assert.ok(response.headers.get('X-Righelt-Request-Id'));
  assert.equal(response.headers.get('X-Righelt-Storage-Generation'), 'current');
  assert.equal(logs.filter(row => row.event === 'client_recovery_diagnostics').length, 1);
  assert.equal(JSON.stringify(logs).includes('private-cookie'), false);
});

test('API completion logs redact invitation, game and unknown dynamic path segments', async context => {
  const logs = [];
  context.mock.method(console, 'info', value => logs.push(JSON.parse(value)));
  const env = { DB: { prepare() { throw Error('database unavailable'); } } };
  for (const path of ['/api/shell/invites/private-invite-token', '/api/shell/games/private-game/unknown-secret', '/api/private-unknown-secret']) {
    await handleApiRequest(new Request(`${origin}${path}?token=private-query-token`), env);
  }
  assert.deepEqual(logs.map(row => row.path), ['/api/shell/invites/:token', '/api/shell/games/:gameId/:unknown', 'unknown']);
  assert.equal(JSON.stringify(logs).includes('private-'), false);
  assert.equal(diagnosticRoute('/api/shell/games/secret/reconcile'), '/api/shell/games/:gameId/reconcile');
});

test('completion log failure cannot replace a successful application response', async context => {
  context.mock.method(console, 'info', () => { throw Error('logging unavailable'); });
  const response = await handleApiRequest(new Request(`${origin}/api/health`), {
    DB: createFakeD1(), GAME_ROOMS: { idFromName: name => name, get: () => ({ fetch() { assert.fail('health must not call a room'); } }) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'righelt', bindings: { db: true, gameRooms: true } });
});
