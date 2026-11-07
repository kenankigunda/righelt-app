import test from 'node:test';
import assert from 'node:assert/strict';
import { isLogOnlyDiagnosticWrite, assertOnlyDiagnosticWrites } from '../../../e2e/support/diagnostic-write-contract.mjs';
import { assertReplayIntegrity } from '../../../e2e/support/replay-write-contract.mjs';
import { RECOVERY_DIAGNOSTICS, RECOVERY_DIAGNOSTIC_FLAGS, RECOVERY_DIAGNOSTIC_COUNTERS, validateRecoveryDiagnosticBatch } from '../../../packages/shared-types/src/recovery-diagnostics.js';
import { handleApiRequest } from '../../../packages/api-handler/src/index.ts';

const before = { id: `game-${'a'.repeat(36)}`, gameplayRevision: 44,
  board: { state: { sideToMove: 'P1', turnIndex: 26 } }, moves: [{ moveId: 'm', undone: false }],
  computer: { ownerId: 'owner', generation: 6, seats: { p1: null, p2: 'horus' }, paused: false,
    manual: false, takeoverTurn: null, lease: { deviceId: 'existing-device', authContextId: '', expiresAt: 10000 } } };
const validWrite = () => {
  const body = { schemaVersion: 1, events: [{ eventId: crypto.randomUUID(), type: 'recovery_blocked',
    at: 1793775600000, gameId: before.id, pendingCount: 0, reason: 'socket_closed' }] };
  return { method: 'POST', path: RECOVERY_DIAGNOSTICS.path, body, rawBody: JSON.stringify(body), contentType: 'application/json' };
};

test('read-only inspection and replay permit one exact bounded log-only report', async () => {
  const write = validWrite();
  assert.equal(isLogOnlyDiagnosticWrite(write), true);
  assert.doesNotThrow(() => assertOnlyDiagnosticWrites([write]));
  assert.doesNotThrow(() => assertOnlyDiagnosticWrites([]));
  await assertReplayIntegrity({ writes: [write], before, after: structuredClone(before) });
  assert.equal(isLogOnlyDiagnosticWrite({ ...write, contentType: 'Application/JSON; charset=utf-8' }), true);
});

const malformed = [
  ['wrong method', write => { write.method = 'PUT'; }],
  ['other endpoint', write => { write.path = '/api/diagnostics/other'; }],
  ['endpoint suffix', write => { write.path += '/extra'; }],
  ['endpoint prefix', write => { write.path = '/api/diagnostics/recovery-extra'; }],
  ['query in captured path', write => { write.path += '?other=1'; }],
  ['missing content type', write => { delete write.contentType; }],
  ['wrong content type', write => { write.contentType = 'text/plain'; }],
  ['near-match content type', write => { write.contentType = 'application/json-seq'; }],
  ['missing parsed body', write => { delete write.body; }],
  ['empty batch', write => { write.body.events = []; }],
  ['too many events', write => { write.body.events = Array.from({ length: 17 }, () => ({ ...write.body.events[0], eventId: crypto.randomUUID() })); }],
  ['schema version', write => { write.body.schemaVersion = 2; }],
  ['raw identity', write => { write.body.events[0].identityId = 'private-identity'; }],
  ['raw action', write => { write.body.events[0].action = { type: 'rush' }; }],
  ['raw state', write => { write.body.events[0].authoritativeState = { private: true }; }],
  ['request envelope', write => { write.body.payload = { operation: 'computer-control' }; }],
  ['non-generated command ID', write => { write.body.events[0].commandId = 'create:private-operation'; }],
  ['free-form error', write => { write.body.events[0].reason = 'private-error'; }],
];
for (const [name, mutate] of malformed) test(`read-only diagnostic qualification rejects ${name}`, async () => {
  const write = validWrite(); mutate(write);
  write.rawBody = JSON.stringify(write.body);
  assert.equal(isLogOnlyDiagnosticWrite(write), false);
  assert.throws(() => assertOnlyDiagnosticWrites([write]));
  await assert.rejects(assertReplayIntegrity({ writes: [write], before, after: structuredClone(before) }));
});

test('raw request capture rejects oversized padding, invalid JSON and mismatched parsed evidence', async () => {
  for (const mutate of [
    write => { delete write.rawBody; },
    write => { write.rawBody = null; },
    write => { write.rawBody += ' '.repeat(RECOVERY_DIAGNOSTICS.maximumBytes); },
    write => { write.rawBody = 'not JSON'; },
    write => { write.rawBody = JSON.stringify({ ...write.body, schemaVersion: 2 }); },
  ]) {
    const write = validWrite(); mutate(write);
    assert.equal(isLogOnlyDiagnosticWrite(write), false);
    assert.throws(() => assertOnlyDiagnosticWrites([write]));
    await assert.rejects(assertReplayIntegrity({ writes: [write], before, after: structuredClone(before) }));
  }
  const write = validWrite();
  write.rawBody = `${write.rawBody}${' '.repeat(RECOVERY_DIAGNOSTICS.maximumBytes - Buffer.byteLength(write.rawBody))}`;
  assert.equal(Buffer.byteLength(write.rawBody), RECOVERY_DIAGNOSTICS.maximumBytes);
  assert.equal(isLogOnlyDiagnosticWrite(write), true, 'the existing public limit is inclusive');
});

test('valid individual fields do not waive the encoded batch byte ceiling', async () => {
  const write = validWrite();
  write.body.events = Array.from({ length: 16 }, () => ({
    ...write.body.events[0], eventId: crypto.randomUUID(), episodeId: crypto.randomUUID(), requestId: crypto.randomUUID(),
    commandId: `v2:${crypto.randomUUID()}`, observedDeploymentSha: 'a'.repeat(40), loadedBuild: 'b'.repeat(40),
    serverBuild: crypto.randomUUID(), requestRelationship: 'latest_observed', gate: 'admission_changed',
    requestKind: 'computer-control', requestPhase: 'complete', stage: 'confirmation_overdue',
    syncStatus: 'applying-update', visibility: 'visible', mode: 'multiplayer', status: 599,
    ageMs: 86400000, durationMs: 86400000,
    ...Object.fromEntries(RECOVERY_DIAGNOSTIC_FLAGS.map(key => [key, false])),
    ...Object.fromEntries(RECOVERY_DIAGNOSTIC_COUNTERS.map(key => [key, Number.MAX_SAFE_INTEGER])),
  }));
  assert.equal(validateRecoveryDiagnosticBatch(write.body), true);
  write.rawBody = JSON.stringify(write.body);
  assert.ok(Buffer.byteLength(JSON.stringify(write.body)) > 16 * 1024);
  assert.equal(isLogOnlyDiagnosticWrite(write), false);
  assert.throws(() => assertOnlyDiagnosticWrites([write]));
  await assert.rejects(assertReplayIntegrity({ writes: [write], before, after: structuredClone(before) }));
});

for (const endpoint of ['apply', 'end-turn', 'shared', 'decision-attempt', 'decision-notes', 'computer-control', 'join']) {
  test(`diagnostic qualification does not permit ${endpoint} writes with a valid diagnostic-looking body`, async () => {
    const write = validWrite(); write.path = `/api/shell/games/${before.id}/${endpoint}`;
    assert.equal(isLogOnlyDiagnosticWrite(write), false);
    assert.throws(() => assertOnlyDiagnosticWrites([validWrite(), write]));
    await assert.rejects(assertReplayIntegrity({ writes: [validWrite(), write], before, after: structuredClone(before) }));
  });
}

test('valid diagnostics never waive authoritative board, history, revision or control invariants', async () => {
  for (const mutate of [
    game => { game.gameplayRevision++; }, game => { game.board.state.sideToMove = 'P2'; },
    game => { game.moves[0].undone = true; }, game => { game.moves.push({ moveId: 'new', undone: false }); },
    game => { game.computer.generation++; }, game => { game.computer.ownerId = 'other'; },
    game => { game.computer.lease.deviceId = 'other'; }, game => { game.computer.paused = true; },
  ]) {
    const after = structuredClone(before); mutate(after);
    await assert.rejects(assertReplayIntegrity({ writes: [validWrite()], before, after }));
  }
});

test('a qualified report is accepted by the real log-only API without accessing or changing authority', async context => {
  const write = validWrite(), logs = [], state = structuredClone(before);
  context.mock.method(console, 'info', value => logs.push(JSON.parse(value)));
  const forbidden = new Proxy({}, { get() { assert.fail('log ingestion must not read or mutate DB, room, account or lease authority'); } });
  const response = await handleApiRequest(new Request(`https://righelt.pages.dev${write.path}`, {
    method: write.method, headers: { Origin: 'https://righelt.pages.dev', 'content-type': 'application/json' }, body: write.rawBody,
  }), { DB: forbidden, GAME_ROOMS: forbidden, AUTH_ENABLED: 'true', STORAGE_GENERATION: 'current' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.equal(logs.filter(row => row.event === 'client_recovery_diagnostics').length, 1);
  assert.deepEqual(state, before);
  await assertReplayIntegrity({ writes: [write], before, after: state });
});
