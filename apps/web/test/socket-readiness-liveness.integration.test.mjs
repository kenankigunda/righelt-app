import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore, createLiveSyncClient } from '../shell/sync-store.js';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import apiWorker from '../../api/index.js';
import { createFakeD1 } from '../../../packages/api-handler/test/support/fake-d1.mjs';
import { createFakeGameRooms } from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
import { socketEnvironment } from './support/socket-environment.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await turn(); }
  assert.fail('readiness fixture did not reach the required boundary');
};
const emptySnapshot = gameId => ({ protocolVersion: 2, gameId, type: 'state_sync', eventSeq: 1,
  game: { id: gameId, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    gameplayRevision: 0, board: { state: { sideToMove: 'P1', turnIndex: 0, pieces: [] } }, moves: [], turns: [] } });

const fixture = async (t, hooks = {}) => {
  const sockets = socketEnvironment(t), env = { DB: createFakeD1() };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  let transport, releaseProjection, projectHeld = false, lists = 0, writes = 0, activeReady = 0, maxActiveReady = 0;
  const readiness = [], requests = [];
  const rulesExecutor = { asynchronous: false, cancel() {}, cancelAll() {},
    project(scope, input) {
      if (hooks.holdProjection !== false && scope.startsWith('admit:') && !projectHeld) {
        projectHeld = true;
        return new Promise(resolve => { releaseProjection = () => resolve(projectOptimisticGame(input)); });
      }
      return projectOptimisticGame(input);
    },
  };
  const store = sockets.own(createSyncStore({ storage,
    commandJournal: { ...journal, list: async (...args) => { lists++; return journal.list(...args); },
      admit: async envelope => { writes++; return journal.admit(envelope); } },
    createTransportStore(options) {
      transport = createLiveTransportStore({ ...options, rulesExecutor });
      const finish = transport.finishSocketRecovery;
      transport.finishSocketRecovery = async (...args) => {
        activeReady++; maxActiveReady = Math.max(maxActiveReady, activeReady);
        const call = { done: false }; readiness.push(call);
        try { call.result = await finish(...args); return call.result; }
        finally { call.done = true; activeReady--; }
      };
      return transport;
    },
    createSyncClient: options => createLiveSyncClient({ ...options, heartbeatMs: 60_000, inboundTimeoutMs: 60_000 }),
    fetcher: (url, init = {}) => { requests.push(url); return hooks.fetcher ? hooks.fetcher(url, init, actual) : actual(url, init); },
  }));
  const creation = store.createGame({ selfPlayMode: true }); await creation.committed;
  const gameId = creation.gameId;
  const current = async () => (await actual(`/api/shell/games/${gameId}?identityId=${store.getIdentityId()}`)).json();
  const heartbeat = socket => socket.emit('message', { data: JSON.stringify({ protocolVersion: 2,
    type: 'heartbeat_ack', gameId, eventSeq: store.getLastEventSeq(gameId) }) });
  return { ...sockets, store, transport, journal, gameId, current, heartbeat, readiness, requests,
    releaseProjection: () => releaseProjection(), projectHeld: () => projectHeld,
    lists: () => lists, writes: () => writes, maxActiveReady: () => maxActiveReady };
};

test('a current heartbeat retries readiness after a replaced refused admission without another command or socket', async t => {
  const f = await fixture(t);
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find(value => value.type === 'move');
  assert.ok(action);
  const first = f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action })
    .then(() => assert.fail('the recovery fence must refuse the old admission'), error => error);
  await until(f.projectHeld);
  // A connection recovery can begin while the rules worker is calculating an admission.
  f.transport.setConnectionRecovering(f.gameId, true);
  f.store.setActiveGameId(f.gameId);
  const socket = f.sockets[0], body = await f.current();
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ ...body, protocolVersion: 2, type: 'state_sync', gameId: f.gameId }) });
  await until(() => f.lists() > 0 && f.readiness.length === 1);
  // Let real IndexedDB hydration finish so readiness is waiting on the captured admission.
  for (let i = 0; i < 10; i++) await turn();
  assert.equal(f.readiness[0].done, false);
  const second = f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action })
    .then(() => assert.fail('the queued admission must also respect recovery'), error => error);
  f.releaseProjection();
  const failures = await Promise.all([first, second]);
  assert.ok(failures.every(error => error.code === 'sync_recovering'));
  await until(() => f.readiness[0].done);
  assert.equal(f.readiness[0].result, false, 'replaced admission prevents the old readiness commit');
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  assert.equal(f.writes(), 0, 'neither refused action was durably admitted');
  f.heartbeat(socket); f.heartbeat(socket); f.heartbeat(socket);
  await until(() => !f.store.getGameViewModel(f.gameId).recovering);
  assert.equal(socket.readyState, 1, 'a valid current socket is retained');
  assert.equal(f.sockets.length, 1);
  assert.equal(f.maxActiveReady(), 1, 'heartbeat bursts cannot run overlapping readiness passes');
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, false);
  assert.equal(f.writes(), 0);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  assert.equal(f.requests.filter(url => /\/(apply|end-turn|shared)$/.test(url)).length, 0);
  assert.equal((await f.current()).game.gameplayRevision, 0);
});

test('heartbeat readiness bursts preserve a pending durable command and its sole sender', async t => {
  let releaseApply;
  const f = await fixture(t, { holdProjection: false, fetcher: async (url, init, actual) => {
    if (url.endsWith('/apply')) await new Promise(resolve => { releaseApply = resolve; });
    return actual(url, init);
  } });
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find(value => value.type === 'move');
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action });
  await until(() => Boolean(releaseApply));
  const [original] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  assert.ok(original?.clientCommandId);
  f.transport.setConnectionRecovering(f.gameId, true);
  f.store.setActiveGameId(f.gameId);
  const socket = f.sockets[0], body = await f.current();
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ ...body, protocolVersion: 2, type: 'state_sync', gameId: f.gameId }) });
  await until(() => f.readiness.length === 1);
  f.heartbeat(socket); f.heartbeat(socket); f.heartbeat(socket);
  for (let i = 0; i < 10; i++) await turn();
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 1);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [original]);
  assert.equal(f.requests.filter(url => url.endsWith('/apply')).length, 1);
  assert.equal(f.maxActiveReady(), 1, 'valid frames join one readiness owner while the original command remains uncertain');
  releaseApply(); await handle.committed;
  f.heartbeat(socket);
  await until(() => !f.store.getGameViewModel(f.gameId).recovering);
  assert.equal(f.requests.filter(url => url.endsWith('/apply')).length, 1);
  assert.equal((await f.current()).game.gameplayRevision, 1);
  assert.equal(socket.readyState, 1);
});

test('a replaced socket cannot complete or release its replacement readiness owner', async t => {
  const f = socketEnvironment(t), calls = [], metrics = [], errors = [];
  const client = f.own(createLiveSyncClient({ identityId: 'readiness-replacement', getLastEventSeq: () => 1,
    onEvent: () => true, onMetric: event => metrics.push(event), onError: error => errors.push(error),
    onReady: context => new Promise(resolve => { calls.push({ context, finish: () => resolve(context.retirePreviousRepair()) }); }),
  }));
  const receive = socket => { socket.emit('open'); socket.emit('message', { data: JSON.stringify(emptySnapshot('g')) }); };
  const heartbeat = socket => socket.emit('message', { data: JSON.stringify({ protocolVersion: 2,
    type: 'heartbeat_ack', gameId: 'g', eventSeq: 1 }) });
  client.connectGame('g'); const old = f.sockets[0]; receive(old);
  await until(() => calls.length === 1);
  client.disconnectGame('g'); client.connectGame('g');
  const current = f.sockets[1]; receive(current);
  await until(() => calls.length === 2);
  assert.equal(calls[0].context.isCurrent(), false);
  assert.equal(calls[1].context.isCurrent(), true);
  calls[0].finish();
  for (let i = 0; i < 10; i++) await turn();
  heartbeat(current); heartbeat(current);
  for (let i = 0; i < 10; i++) await turn();
  assert.equal(calls.length, 2, 'the old finally cannot clear the replacement pending pass');
  assert.equal(metrics.filter(event => event.type === 'socket_readiness_accepted').length, 0);
  calls[1].finish();
  await until(() => metrics.some(event => event.type === 'socket_readiness_accepted'));
  assert.deepEqual(metrics.filter(event => event.type === 'socket_readiness_accepted').map(event => event.socketGeneration), [calls[1].context.generation]);
  heartbeat(old); heartbeat(current);
  for (let i = 0; i < 10; i++) await turn();
  assert.equal(calls.length, 2);
  assert.equal(current.readyState, 1);
  assert.equal(errors.length, 0);
});

test('throwing metric consumers cannot interrupt socket establishment or readiness retries', async t => {
  const f = socketEnvironment(t);
  let ready = 0, metricAttempts = 0;
  const client = f.own(createLiveSyncClient({ identityId: 'throwing-metrics', getLastEventSeq: () => 1,
    onEvent: () => true,
    onMetric: () => { metricAttempts++; throw new Error('diagnostic consumer failed'); },
    onReady: () => ++ready > 1,
  }));
  assert.doesNotThrow(() => client.connectGame('g'));
  const socket = f.sockets[0];
  socket.emit('open'); socket.emit('message', { data: JSON.stringify(emptySnapshot('g')) });
  await until(() => ready === 1);
  for (let i = 0; i < 10; i++) await turn();
  socket.emit('message', { data: JSON.stringify({ protocolVersion: 2, gameId: 'g', type: 'heartbeat_ack', eventSeq: 1 }) });
  await until(() => ready === 2);
  assert.ok(metricAttempts > 0);
  assert.equal(socket.readyState, 1);
  assert.equal(f.sockets.length, 1);
});
