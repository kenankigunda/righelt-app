import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore } from '../shell/sync-store.js';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { createRecoveryTelemetry, createRecoveryTimeline } from '../shell/recovery-telemetry.js';
import apiWorker from '../../api/index.js';
import { createFakeD1 } from '../../../packages/api-handler/test/support/fake-d1.mjs';
import { createFakeGameRooms } from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
import { RECOVERY_DIAGNOSTICS, validateRecoveryDiagnosticBatch } from '../../../packages/shared-types/src/recovery-diagnostics.js';
import { SYNC_TIMING } from '../generated/packages/shared-types/src/sync-protocol.js';

const origin = 'https://test';
const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await turn(); }
  assert.fail('telemetry integration did not reach the required boundary');
};

async function fixture(t, { diagnosticSink, mutateUpload, holdReconcile = false } = {}) {
  const logs = [], uploads = [], gameplayRequests = [], timers = new Map();
  let timerId = 0, transport, releaseReconcile;
  t.mock.method(console, 'info', value => { try { logs.push(JSON.parse(value)); } catch {} });
  const env = { DB: createFakeD1() };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`${origin}${url}`, init), env);
  const timeline = createRecoveryTimeline();
  const telemetry = createRecoveryTelemetry({
    timeline,
    schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    cancel: id => timers.delete(id),
    environment: () => ({ online: true, visibility: 'visible', loadedBuild: 'unavailable', observedDeploymentSha: 'a'.repeat(40) }),
    fetcher: async (url, init) => {
      assert.equal(url, RECOVERY_DIAGNOSTICS.path);
      assert.equal(init.credentials, 'omit');
      assert.deepEqual(init.headers, { 'content-type': 'application/json' });
      const payload = JSON.parse(init.body);
      assert.equal(validateRecoveryDiagnosticBatch(payload), true, 'actual transport callbacks must cross the shared client projection');
      const body = mutateUpload ? mutateUpload(payload) : payload;
      // A browser adds Origin to this same-origin POST; the production sender
      // does not copy account headers/cookies or use the gameplay fetcher.
      const response = await actual(url, { ...init, headers: { ...init.headers, Origin: origin }, body: JSON.stringify(body) });
      uploads.push({ payload, status: response.status });
      return response;
    },
  });
  const data = new Map();
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  const store = createSyncStore({
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) },
    commandJournal: journal,
    diagnostics: diagnosticSink ?? telemetry,
    createTransportStore: options => (transport = createLiveTransportStore(options)),
    fetcher: async (url, init = {}) => {
      assert.notEqual(url, RECOVERY_DIAGNOSTICS.path, 'diagnostic upload must not enter account/gameplay transport');
      gameplayRequests.push(url);
      if (holdReconcile && url.endsWith('/reconcile')) await new Promise(resolve => { releaseReconcile = resolve; });
      return actual(url, init);
    },
  });
  t.after(() => { releaseReconcile?.(); store.retire(); telemetry.retire(); });
  const creation = store.createGame({ selfPlayMode: true });
  await creation.committed;
  const gameId = creation.gameId;
  const current = async () => (await actual(`/api/shell/games/${gameId}?identityId=${store.getIdentityId()}`)).json();
  return { store, transport, telemetry, timeline, logs, uploads, gameplayRequests, journal, gameId, current,
    hasReconcile: () => Boolean(releaseReconcile), releaseReconcile: () => releaseReconcile(), timers };
}

test('a silent recovery episode crosses the real transport, uploader and API without exporting private report data', async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.transport.setConnectionRecovering(f.gameId, true, { reason: 'socket_closed', advertisedEventSeq: 2,
    socketGeneration: 3, identityId: 'private-identity', authContextId: 'private-context',
    authoritativeState: { private: 'private-state' }, browser: 'private-agent', gameLink: 'https://private-link' });
  t.mock.timers.tick(SYNC_TIMING.confirmationBudgetMs);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  await f.telemetry.flush();
  const reports = f.logs.filter(row => row.event === 'client_recovery_diagnostics');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].source, 'untrusted_client');
  const events = reports[0].events;
  assert.ok(events.some(row => row.type === 'recovery_started' && row.reason === 'socket_closed'));
  const stalled = events.find(row => row.type === 'recovery_blocked' && row.stage === 'actionable_recovery');
  assert.ok(stalled, 'a stalled episode with no failed HTTP request still reaches the server');
  assert.equal(stalled.gameId, f.gameId);
  assert.equal(stalled.pendingCount, 0);
  assert.equal(stalled.connectionRecovering, true);
  assert.equal(stalled.advertisedEventSeq, 2);
  assert.equal(stalled.socketGeneration, 3);
  assert.equal(stalled.loadedBuild, 'unavailable');
  assert.equal(stalled.observedDeploymentSha, 'a'.repeat(40));
  const localStart = f.timeline.snapshot().find(row => row.type === 'recovery_started');
  assert.equal(localStart.closeCode, 1006);
  assert.equal(localStart.closeClean, false);
  assert.equal(localStart.socketGeneration, 3);
  assert.equal(localStart.owner, 'recovery');
  assert.equal(localStart.ownerAction, 'acquired');
  assert.equal(localStart.result, 'started');
  assert.equal(localStart.activeEpisodeRelation, 'active');
  assert.ok(Number.isSafeInteger(localStart.connectionGeneration));
  assert.equal(JSON.stringify(reports).includes('private-'), false);
  assert.equal(f.uploads[0].status, 202);
  assert.equal(f.gameplayRequests.length, 1, 'diagnostic promotion must not trigger recovery or gameplay requests');
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  t.mock.timers.reset();
});

test('completed recovery evidence describes the settled ready state rather than the preceding confirming state', async t => {
  const f = await fixture(t, { holdReconcile: true });
  f.transport.setConnectionRecovering(f.gameId, true, { reason: 'invalid_socket_event' });
  // Exercise the real invalid-frame -> confirming -> HTTP recovery path.
  assert.equal(f.transport.applyLiveGameUpdate({ game: { id: f.gameId }, eventSeq: f.store.getLastEventSeq(f.gameId) }), null);
  await until(f.hasReconcile);
  assert.equal(f.store.getGameViewModel(f.gameId).syncStatus, 'confirming');
  f.releaseReconcile();
  await until(() => f.store.getGameViewModel(f.gameId).syncStatus === 'ready' && !f.store.getGameViewModel(f.gameId).recovering);
  await f.telemetry.flush();
  const events = f.logs.filter(row => row.event === 'client_recovery_diagnostics').flatMap(row => row.events);
  const completed = events.find(row => row.type === 'recovery_completed');
  assert.ok(completed);
  assert.equal(completed.syncStatus, 'ready');
  assert.equal(completed.recovering, false);
  assert.equal(completed.sharedMutationsBlocked, false);
  assert.equal(completed.connectionRecovering, false);
  assert.equal(completed.pendingCount, 0);
  assert.equal((await f.current()).game.gameplayRevision, 0, 'recovery diagnostics cannot commit gameplay');
});

test('throwing diagnostic consumers cannot bypass recovery admission or prevent a later accepted move', async t => {
  let records = 0;
  const f = await fixture(t, { diagnosticSink: { record() { records++; throw Error('sink failure'); }, retire() { throw Error('retire failure'); } } });
  const view = f.store.getGameViewModel(f.gameId), action = view.legalActions.find(value => value.type === 'move');
  assert.ok(action);
  assert.doesNotThrow(() => f.transport.setConnectionRecovering(f.gameId, true));
  await assert.rejects(f.store.applyGameAction({ gameId: f.gameId, state: view.currentSnapshot, action }), error => error.code === 'sync_recovering');
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  assert.equal(f.gameplayRequests.filter(url => url.endsWith('/apply')).length, 0);
  assert.doesNotThrow(() => f.transport.setConnectionRecovering(f.gameId, false));
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: view.currentSnapshot, action });
  await handle.committed;
  assert.equal((await f.current()).game.gameplayRevision, 1);
  assert.equal(f.gameplayRequests.filter(url => url.endsWith('/apply')).length, 1);
  assert.ok(records >= 3);
  assert.doesNotThrow(() => f.store.retire());
});

test('the real API rejects a malformed uploaded field without changing client recovery or recursively reporting failure', async t => {
  const f = await fixture(t, { mutateUpload: body => ({ ...body, events: body.events.map(row => ({ ...row, identityId: 'private-injected' })) }) });
  f.transport.setConnectionRecovering(f.gameId, true, { reason: 'socket_closed' });
  await f.telemetry.flush();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].status, 400);
  assert.equal(f.logs.filter(row => row.event === 'client_recovery_diagnostics').length, 0);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  await f.telemetry.flush();
  assert.equal(f.uploads.length, 1, 'a rejected report is dropped and never reports itself');
  assert.equal(f.timers.size, 0);
  assert.equal(f.gameplayRequests.length, 1);
  assert.equal((await f.current()).game.gameplayRevision, 0);
});
