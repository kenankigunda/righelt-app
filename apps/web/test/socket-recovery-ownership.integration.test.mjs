import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore, createLiveSyncClient } from '../shell/sync-store.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { issueDiagnostics } from '../shell/issue-diagnostics.js';
import { createLiveTransportStore } from '../shell/live-transport.js';
import apiWorker from '../../api/index.js';
import { createFakeD1 } from '../../../packages/api-handler/test/support/fake-d1.mjs';
import { createFakeGameRooms } from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
import { socketEnvironment } from './support/socket-environment.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await sleep(3); }
  assert.fail('recovery fixture did not reach its required boundary');
};

test('socket authority retires an obsolete HTTP read without a new incident, retry, or command', async t => {
  const sockets = socketEnvironment(t), errors = [], requests = [];
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  let reads = 0, rejectOld, aborted = false;
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  const store = createSyncStore({ storage, commandJournal: journal, onError: error => errors.push(error),
    createSyncClient: options => createLiveSyncClient({ ...options, reconnectBaseMs: 1, reconnectMaxMs: 1, degradedPollMs: 10 }),
    fetcher: async (url, init = {}) => {
      requests.push({ url, body: init.body });
      if (url.endsWith('/reconcile') && ++reads === 2) return new Promise((_, reject) => {
        rejectOld = reject;
        init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('obsolete read aborted')); }, { once: true });
      });
      return actual(url, init);
    },
  });
  sockets.own(store);
  const created = store.createGame({ selfPlayMode: true }); await created.committed;
  const gameId = created.gameId;
  const current = async () => (await actual(`/api/shell/games/${gameId}?identityId=${store.getIdentityId()}`)).json();
  const receive = async socket => {
    const body = await current(); socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ ...body, protocolVersion: 2, gameId, type: 'state_sync' }) });
  };
  store.setActiveGameId(gameId); await receive(sockets.sockets[0]);
  await until(() => !store.getGameViewModel(gameId).recovering);
  sockets.sockets[0].close();
  await until(() => reads === 1 && !store.getGameViewModel(gameId).recovering && sockets.sockets.length >= 2);
  sockets.sockets[1].close();
  await until(() => reads === 2 && sockets.sockets.length >= 3);
  await receive(sockets.sockets.at(-1));
  await until(() => !store.getGameViewModel(gameId).recovering);
  rejectOld(new Error('old HTTP poll failed after the socket recovered'));
  await sleep(30);
  const game = store.getGameViewModel(gameId);
  assert.equal(game.recovering, false);
  assert.equal(game.recoveryIssue, null, 'obsolete errors must not poison a later renewal or recovery');
  assert.equal(game.incidentId, null);
  assert.equal(game.sharedMutationsBlocked, false);
  assert.equal(game.pendingCommandCount, 0);
  assert.equal(game.canRecordMove, true);
  assert.equal(aborted, true, 'only the obsolete read is cancelled');
  assert.equal(reads, 2, 'socket authority must not leave a stale HTTP retry');
  assert.equal(errors.length, 0);
  assert.equal(issueDiagnostics.list().filter(report => report.initial.gameId === gameId && !report.resolvedAt).length, 0);
  assert.deepEqual(await journal.list(store.getIdentityId(), gameId), []);
  assert.equal(requests.filter(request => /\/(apply|end-turn|shared)$/.test(request.url)).length, 0);
  assert.equal((await current()).game.gameplayRevision, 0);
});

const transportFixture = async (t, hooks = {}) => {
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  let transport;
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const store = createSyncStore({ storage, commandJournal: hooks.journal?.(journal) ?? journal,
    createTransportStore: options => { transport = createLiveTransportStore(options); return transport; },
    fetcher: (url, init = {}) => hooks.fetcher ? hooks.fetcher(url, init, actual) : actual(url, init),
  });
  t.after(() => store.retire());
  const created = store.createGame({ selfPlayMode: true }); await created.committed;
  return { store, transport, journal, gameId: created.gameId,
    current: async () => (await actual(`/api/shell/games/${created.gameId}?identityId=${store.getIdentityId()}`)).json() };
};

test('socket recovery awaits a saved gameplay command and preserves its exact journal identity', async t => {
  let releaseApply, applyCount = 0, commits = 0;
  const f = await transportFixture(t, { fetcher: async (url, init, actual) => {
    if (url.endsWith('/apply')) { applyCount++; await new Promise(resolve => { releaseApply = resolve; }); }
    return actual(url, init);
  } });
  const before = f.store.getGameViewModel(f.gameId);
  const action = before.legalActions.find(action => action.type === 'move');
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: before.currentSnapshot, action });
  await until(() => Boolean(releaseApply));
  const [envelope] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  assert.ok(envelope?.clientCommandId);
  const readiness = f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } });
  await sleep(5);
  assert.equal(commits, 0); assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 1);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [envelope]);
  releaseApply(); await handle.committed; await readiness;
  assert.equal(commits, 1); assert.equal(applyCount, 1);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  assert.equal((await f.current()).game.gameplayRevision, 1);
  await until(() => !f.store.getGameViewModel(f.gameId).storageBlocked);
});

test('socket recovery cannot commit before journal hydration completes or after its socket becomes stale', async t => {
  let releaseList, commits = 0, current = true;
  const f = await transportFixture(t, { journal: journal => ({ ...journal,
    list: async (...args) => { await new Promise(resolve => { releaseList = resolve; }); return journal.list(...args); },
  }) });
  const readiness = f.transport.finishSocketRecovery(f.gameId, { isCurrent: () => current, beforeRetire: () => { commits++; } });
  await until(() => Boolean(releaseList)); assert.equal(commits, 0);
  current = false; releaseList();
  assert.equal(await readiness, false); assert.equal(commits, 0);
});

test('failed journal hydration preserves recovery and never commits socket authority', async t => {
  let commits = 0;
  const f = await transportFixture(t, { journal: journal => ({ ...journal,
    list: async () => { throw Object.assign(new Error('journal unavailable'), { code: 'journal_timeout' }); },
  }) });
  f.transport.setConnectionRecovering(f.gameId, true);
  await assert.rejects(f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } }), /journal unavailable/);
  assert.equal(commits, 0);
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
});

test('a required authoritative snapshot is reconciled before socket readiness can retire recovery', async t => {
  let releaseRead, request, commits = 0;
  const f = await transportFixture(t, { fetcher: async (url, init, actual) => {
    if (url.endsWith('/reconcile')) { request = JSON.parse(init.body); await new Promise(resolve => { releaseRead = resolve; }); }
    return actual(url, init);
  } });
  f.transport.prepareSafeReconnect(f.gameId);
  const readiness = f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } });
  await until(() => Boolean(releaseRead));
  assert.equal(request.knownSnapshotEventSeq, 0); assert.equal(commits, 0);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
  releaseRead(); assert.equal(await readiness, true); assert.equal(commits, 1);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, false);
});

test('a refused readiness commit cannot clear recovery', async t => {
  const f = await transportFixture(t);
  f.transport.setConnectionRecovering(f.gameId, true);
  assert.equal(await f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => false }), false);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
});

test('a new snapshot fence established during readiness commit remains authoritative', async t => {
  const f = await transportFixture(t);
  f.transport.setConnectionRecovering(f.gameId, true);
  const ready = await f.transport.finishSocketRecovery(f.gameId, {
    beforeRetire: () => { f.transport.prepareSafeReconnect(f.gameId); return true; },
  });
  assert.equal(ready, false);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
});

test('readiness held in hydration cannot retire a newer HTTP owner on the same current socket', async t => {
  let releaseList, releaseRead, lists = 0, commits = 0;
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      if (++lists === 1) await new Promise(resolve => { releaseList = resolve; });
      return journal.list(...args);
    } }),
    fetcher: async (url, init, actual) => {
      if (url.endsWith('/reconcile')) await new Promise(resolve => { releaseRead = resolve; });
      return actual(url, init);
    },
  });
  f.transport.setConnectionRecovering(f.gameId, true);
  const oldReady = f.transport.finishSocketRecovery(f.gameId, { isCurrent: () => true, beforeRetire: () => { commits++; } });
  await until(() => Boolean(releaseList));
  const newerRead = f.transport.reconcileGame(f.gameId);
  await until(() => Boolean(releaseRead)); releaseList();
  assert.equal(await oldReady, false); assert.equal(commits, 0);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  releaseRead(); await newerRead;
  assert.equal(await f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } }), true);
  assert.equal(commits, 1, 'a settled newer owner must not leave readiness permanently fenced');
});

test('socket authority waits for an ongoing durable admission instead of treating it as an empty journal', async t => {
  let releaseAdmission, commits = 0, applied = 0;
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, admit: async envelope => {
      await new Promise(resolve => { releaseAdmission = resolve; }); return journal.admit(envelope);
    } }),
    fetcher: (url, init, actual) => { if (url.endsWith('/apply')) applied++; return actual(url, init); },
  });
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find(action => action.type === 'move');
  const admission = f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action });
  await until(() => Boolean(releaseAdmission));
  const readiness = f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } });
  await sleep(5); assert.equal(commits, 0);
  releaseAdmission(); const handle = await admission; await handle.committed; await readiness;
  assert.equal(commits, 1); assert.equal(applied, 1);
  assert.equal((await f.current()).game.gameplayRevision, 1);
});

test('socket readiness preserves an established protocol upgrade fence', async t => {
  let commits = 0;
  const f = await transportFixture(t);
  f.transport.markUpgradeRequired(f.gameId);
  assert.equal(await f.transport.finishSocketRecovery(f.gameId, { beforeRetire: () => { commits++; } }), false);
  assert.equal(commits, 0); assert.equal(f.store.getGameViewModel(f.gameId).upgradeRequired, true);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
});
