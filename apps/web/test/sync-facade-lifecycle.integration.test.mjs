import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore, createLiveSyncClient } from '../shell/sync-store.js';
import { createCommandJournal } from '../shell/command-journal.js';
import apiWorker from '../../api/index.js';
import { createFakeD1 } from '../../../packages/api-handler/test/support/fake-d1.mjs';
import { createFakeGameRooms } from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
import { socketEnvironment } from './support/socket-environment.mjs';

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const until = async predicate => {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 3));
  }
  assert.fail('facade lifecycle fixture did not reach its required boundary');
};

const fixture = async (t, hooks = {}) => {
  const browser = socketEnvironment(t);
  const env = { DB: createFakeD1() };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  const requests = [], errors = [];
  let client;
  const store = browser.own(createSyncStore({ storage, commandJournal: journal,
    auth: hooks.auth,
    onError: error => { errors.push(error); hooks.onError?.(error); },
    createSyncClient: options => {
      client = createLiveSyncClient({ ...options, reconnectBaseMs: 1, reconnectMaxMs: 1 });
      return client;
    },
    fetcher: async (url, init = {}) => {
      requests.push({ url, body: init.body });
      return hooks.fetcher ? hooks.fetcher(url, init, actual) : actual(url, init);
    },
  }));
  const created = store.createGame({ selfPlayMode: true });
  await created.committed;
  const gameId = created.gameId;
  const current = async () => (await actual(`/api/shell/games/${gameId}?identityId=${store.getIdentityId()}`)).json();
  const receive = async socket => {
    const body = await current();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ ...body, protocolVersion: 2, gameId, type: 'state_sync' }) });
    await until(() => !store.getGameViewModel(gameId).recovering);
  };
  const activate = async () => {
    store.setActiveGameId(gameId);
    assert.ok(browser.sockets.length, 'the active game must attempt a socket even under a false offline hint');
    await receive(browser.sockets.at(-1));
    return browser.sockets.at(-1);
  };
  return { ...browser, store, client, gameId, journal, requests, errors, current, receive, activate };
};

test('the facade preserves a healthy desired game after a false offline event', async t => {
  const f = await fixture(t), socket = await f.activate();
  navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  await settle();
  assert.equal(socket.readyState, 1, 'offline is a hint and must not close a proven healthy socket');
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId], 'the route remains desired without an online event');
  assert.equal(f.store.getGameViewModel(f.gameId).canRecordMove, true);
  assert.equal(f.requests.filter(r => /\/(apply|end-turn|shared)$/.test(r.url)).length, 0);
});

test('the facade probes the active game when the initial offline hint is false', async t => {
  const f = await fixture(t);
  navigator.onLine = false;
  await f.activate();
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId]);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, false);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
});

test('pageshow and safe reconnect retain the active game under a stale offline hint', async t => {
  const f = await fixture(t);
  await f.activate();
  navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  f.window.dispatchEvent(new Event('pagehide'));
  f.window.dispatchEvent(new Event('pageshow'));
  await settle();
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId], 'page restoration cannot lose the active route');
  await until(() => f.requests.some(r => r.url.endsWith('/reconcile')));
  const reads = f.requests.filter(r => r.url.endsWith('/reconcile')).length;
  await f.store.reconnectSafely(f.gameId);
  assert.ok(f.requests.filter(r => r.url.endsWith('/reconcile')).length > reads,
    'the advertised safe-reconnect action must perform recovery rather than resolve as a no-op');
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, false);
  assert.equal((await f.current()).game.gameplayRevision, 0);
  assert.equal(f.requests.filter(r => /\/(apply|end-turn|shared)$/.test(r.url)).length, 0);
});

test('an actual socket failure still reconciles while the offline hint remains false', async t => {
  const f = await fixture(t), socket = await f.activate();
  navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  socket.close();
  await settle();
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId]);
  await until(() => f.requests.some(r => r.url.endsWith('/reconcile')));
  await until(() => !f.store.getGameViewModel(f.gameId).recovering);
  assert.equal(f.store.getGameViewModel(f.gameId).canRecordMove, true);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
});

test('a false offline event preserves uncertain gameplay identity and exactly one commit', async t => {
  let releaseReply;
  t.after(() => releaseReply?.());
  const f = await fixture(t, { fetcher: async (url, init, actual) => {
    const response = await actual(url, init);
    if (url.endsWith('/apply')) await new Promise(resolve => { releaseReply = resolve; });
    return response;
  } });
  const socket = await f.activate();
  const before = f.store.getGameViewModel(f.gameId);
  const action = before.legalActions.find(action => action.type === 'move');
  assert.ok(action);
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: before.currentSnapshot, action });
  await until(() => Boolean(releaseReply));
  const [envelope] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  assert.ok(envelope?.clientCommandId);
  assert.equal((await f.current()).game.gameplayRevision, 1, 'the server already committed before its reply is released');
  navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  await settle();
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [envelope],
    'an offline hint cannot erase or replace an uncertain durable command');
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 1);
  assert.equal(socket.readyState, 1, 'a false hint must not replace the receipt delivery owner');
  releaseReply();
  await handle.committed;
  await until(async () => (await f.journal.list(f.store.getIdentityId(), f.gameId)).length === 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/apply')).length, 1);
  assert.equal((await f.current()).game.gameplayRevision, 1);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
});

test('a real online event restores a closed socket without issuing gameplay', async t => {
  const f = await fixture(t);
  const socket = await f.activate();
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(socket.readyState, 3);
  const oldCount = f.sockets.length;
  navigator.onLine = true;
  f.window.dispatchEvent(new Event('online'));
  await until(() => f.sockets.length > oldCount);
  await f.receive(f.sockets.at(-1));
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId]);
  assert.equal((await f.current()).game.gameplayRevision, 0);
  assert.equal(f.requests.filter(r => /\/(apply|end-turn|shared)$/.test(r.url)).length, 0);
});

test('a throwing WebSocket constructor falls back to HTTP and a bounded reconnect', async t => {
  const f = await fixture(t, { onError: () => { throw Error('diagnostic consumer failed'); } });
  const OriginalSocket = globalThis.WebSocket;
  let constructions = 0;
  globalThis.WebSocket = class {
    constructor(url) {
      if (++constructions === 1) throw Object.assign(new Error('constructor blocked'), { name: 'SecurityError' });
      return new OriginalSocket(url);
    }
  };
  assert.doesNotThrow(() => f.store.setActiveGameId(f.gameId),
    'a synchronous constructor failure must reach the recovery owner instead of escaping route activation');
  assert.deepEqual(f.client.getDesiredGameIds(), [f.gameId]);
  await until(() => f.requests.some(r => r.url.endsWith('/reconcile')));
  await until(() => !f.store.getGameViewModel(f.gameId).recovering);
  await until(() => f.sockets.length === 1);
  await f.receive(f.sockets[0]);
  assert.equal(constructions, 2);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, false);
  assert.equal((await f.current()).game.gameplayRevision, 0);
  assert.equal(f.requests.filter(r => /\/(apply|end-turn|shared)$/.test(r.url)).length, 0);
});

test('pending logout and retirement still prevent lifecycle callbacks reconnecting', async t => {
  const auth = { enabled: false, pendingLogout: false };
  const f = await fixture(t, { auth });
  await f.activate();
  // This transition exercises the facade eligibility boundary only. It does
  // not claim an authenticated server journey from the legacy guest fixture.
  auth.enabled = true;
  auth.pendingLogout = true;
  f.store.setActiveGameId(f.gameId);
  assert.deepEqual(f.client.getDesiredGameIds(), []);
  const oldCount = f.sockets.length;
  f.window.dispatchEvent(new Event('online'));
  f.window.dispatchEvent(new Event('pageshow'));
  await settle();
  assert.equal(f.sockets.length, oldCount);
  f.store.retire();
  f.window.dispatchEvent(new Event('online'));
  f.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.sockets.length, oldCount);
});
