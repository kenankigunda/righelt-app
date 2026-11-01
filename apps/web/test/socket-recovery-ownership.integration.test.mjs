import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore, createLiveSyncClient } from '../shell/sync-store.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { issueDiagnostics } from '../shell/issue-diagnostics.js';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { ACTION_CONTRACT_VERSION, commandFingerprint } from '../generated/packages/shared-types/src/sync-protocol.js';
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
  releaseList();
  assert.equal(await oldReady, false); assert.equal(commits, 0);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  await until(() => Boolean(releaseRead));
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

const saveMove = async f => {
  const { game } = await f.current();
  const envelope = { protocolVersion: 2, actionContractVersion: ACTION_CONTRACT_VERSION,
    gameId: f.gameId, identityId: f.store.getIdentityId(), clientCommandId: `v2:${crypto.randomUUID()}`,
    submittedAt: Date.now(), kind: 'action',
    payload: { action: game.legalActions.find(action => action.type === 'move'), notation: 'saved move' },
    expectedState: structuredClone(game.board.state), expectedGameplayRevision: game.gameplayRevision };
  envelope.fingerprint = await commandFingerprint(envelope); await f.journal.admit(envelope); return envelope;
};

test('concurrent loading and socket readiness share the entire journal hydration and terminal cleanup', async t => {
  let releaseList, lists = 0, applies = 0;
  const removed = [];
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      const rows = await journal.list(...args);
      if (++lists === 1) await new Promise(resolve => { releaseList = resolve; });
      return rows;
    }, remove: async envelope => { removed.push(envelope.clientCommandId); return journal.remove(envelope); } }),
    fetcher: (url, init, actual) => { if (url.endsWith('/apply')) applies++; return actual(url, init); },
  });
  const original = await saveMove(f);
  const loading = f.transport.loadGame(f.gameId); await until(() => Boolean(releaseList));
  const readiness = f.transport.finishSocketRecovery(f.gameId);
  await sleep(5); assert.equal(lists, 1, 'two current readers must share validation, adoption, and removal, not just read the same saved row');
  releaseList(); await loading; await readiness;
  await until(() => removed.length > 0);
  assert.equal(applies, 1); assert.deepEqual(removed, [original.clientCommandId]);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  assert.equal((await f.current()).game.gameplayRevision, 1);
});

test('a current caller replaces stale hydration without adopting its late saved rows', async t => {
  let releaseOld, lists = 0, oldCurrent = true, applies = 0;
  const removed = [];
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      const rows = await journal.list(...args);
      if (++lists === 1) await new Promise(resolve => { releaseOld = resolve; });
      return rows;
    }, remove: async envelope => { removed.push(envelope.clientCommandId); return journal.remove(envelope); } }),
    fetcher: (url, init, actual) => { if (url.endsWith('/apply')) applies++; return actual(url, init); },
  });
  const original = await saveMove(f);
  const obsolete = f.transport.finishSocketRecovery(f.gameId, { isCurrent: () => oldCurrent });
  await until(() => Boolean(releaseOld)); oldCurrent = false;
  const readiness = f.transport.finishSocketRecovery(f.gameId);
  await until(() => lists >= 2); await readiness;
  releaseOld(); assert.equal(await obsolete, false);
  await until(() => removed.length > 0);
  assert.equal(applies, 1); assert.deepEqual(removed, [original.clientCommandId]);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  assert.equal((await f.current()).game.gameplayRevision, 1);
});

test('a joined current waiter rereads the journal when the first hydration owner becomes stale', async t => {
  let releaseOld, lists = 0, oldCurrent = true, applies = 0;
  const removed = [];
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      const rows = await journal.list(...args);
      if (++lists === 1) await new Promise(resolve => { releaseOld = resolve; });
      return rows;
    }, remove: async envelope => { removed.push(envelope.clientCommandId); return journal.remove(envelope); } }),
    fetcher: (url, init, actual) => { if (url.endsWith('/apply')) applies++; return actual(url, init); },
  });
  const original = await saveMove(f);
  const obsolete = f.transport.finishSocketRecovery(f.gameId, { isCurrent: () => oldCurrent });
  await until(() => Boolean(releaseOld));
  const waiting = f.transport.finishSocketRecovery(f.gameId);
  await sleep(5); assert.equal(lists, 1);
  oldCurrent = false; releaseOld(); assert.equal(await obsolete, false); await waiting;
  await until(() => removed.length > 0);
  assert.equal(lists, 2, 'a current waiter must establish its own fresh journal result');
  assert.equal(applies, 1); assert.deepEqual(removed, [original.clientCommandId]);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
});

for (const ineligible of ['signed-out session', 'legacy game in account mode']) {
  test(`${ineligible} returns without journal work and does not claim hydration`, { timeout: 1000 }, async t => {
    const f = await transportFixture(t), { game } = await f.current();
    let lists = 0, writes = 0, sends = 0;
    const auth = { enabled: true, session: { authenticated: ineligible !== 'signed-out session',
      account: { id: f.store.getIdentityId() }, contextId: 'a'.repeat(64) } };
    const transport = createLiveTransportStore({ auth,
      commandJournal: { list: async () => { lists++; return []; }, admit: async () => { writes++; }, remove: async () => { writes++; } },
      fetcher: async () => { sends++; throw new Error('ineligible hydration must not send'); },
    });
    t.after(() => transport.retire());
    transport.applyLiveGameUpdate({ game: { ...game, ownershipMode: ineligible === 'signed-out session' ? 'account_v1' : 'legacy_guest' }, eventSeq: 1 });
    await transport.finishSocketRecovery(game.id);
    assert.equal(lists, 0); assert.equal(writes, 0); assert.equal(sends, 0);
    // Becoming eligible must still perform the first real hydration pass.
    auth.session.authenticated = true;
    transport.applyLiveGameUpdate({ game: { ...game, ownershipMode: 'account_v1' }, eventSeq: 2 });
    assert.equal(await transport.finishSocketRecovery(game.id), true);
    assert.equal(lists, 1); assert.equal(writes, 0); assert.equal(sends, 0);
  });
}

test('account eligibility lost during a shared hydration pass prevents adoption for every waiter', { timeout: 1000 }, async t => {
  const f = await transportFixture(t), { game } = await f.current();
  let release, lists = 0, writes = 0, sends = 0;
  const auth = { enabled: true, session: { authenticated: true, account: { id: f.store.getIdentityId() }, contextId: 'a'.repeat(64) } };
  const transport = createLiveTransportStore({ auth,
    commandJournal: { list: async () => { if (++lists === 1) return new Promise(resolve => { release = resolve; }); return []; },
      admit: async () => { writes++; }, remove: async () => { writes++; } },
    fetcher: async () => { sends++; throw new Error('ineligible hydration must not send'); },
  });
  t.after(() => transport.retire());
  transport.applyLiveGameUpdate({ game: { ...game, ownershipMode: 'account_v1' }, eventSeq: 1 });
  const first = transport.finishSocketRecovery(game.id);
  await until(() => Boolean(release)); const second = transport.finishSocketRecovery(game.id);
  auth.session.authenticated = false; release([]);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(lists, 1); assert.equal(writes, 0); assert.equal(sends, 0);
  auth.session.authenticated = true;
  assert.equal(await transport.finishSocketRecovery(game.id), true);
  assert.equal(lists, 2, 'the ineligible shared pass must not mark the journal hydrated');
});

test('a receipt that cleans its journal row before a held hydration read returns is cleaned exactly once', async t => {
  let releaseApply, releaseList, applies = 0, lists = 0;
  const removed = [];
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      const rows = await journal.list(...args);
      if (++lists === 1) await new Promise(resolve => { releaseList = resolve; }); return rows;
    }, remove: async envelope => { removed.push(envelope.clientCommandId); return journal.remove(envelope); } }),
    fetcher: async (url, init, actual) => {
      if (!url.endsWith('/apply')) return actual(url, init);
      applies++; const response = await actual(url, init);
      await new Promise(resolve => { releaseApply = resolve; }); return response;
    },
  });
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find(action => action.type === 'move');
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action });
  await until(() => Boolean(releaseApply));
  const [original] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const readiness = f.transport.finishSocketRecovery(f.gameId);
  await until(() => Boolean(releaseList));
  releaseApply(); await handle.committed;
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  assert.deepEqual(removed, [original.clientCommandId]);
  releaseList(); assert.equal(await readiness, true);
  assert.equal(applies, 1); assert.equal((await f.current()).game.gameplayRevision, 1);
  assert.deepEqual(removed, [original.clientCommandId], 'a stale captured row must not schedule a second terminal removal');
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, false);
  assert.equal(f.store.getGameViewModel(f.gameId).recoveryIssue, null);
});

const receiptBeforeHydration = async (t, { failRemoval = false, holdReadback = false, reinsertAfterAdditionalRemoval = false } = {}) => {
  let releaseApply, releaseList, releaseReadback, applies = 0, lists = 0;
  const removed = [], owner = { current: true };
  const f = await transportFixture(t, {
    journal: journal => ({ ...journal, list: async (...args) => {
      const rows = await journal.list(...args); lists++;
      if (lists === 1) await new Promise(resolve => { releaseList = resolve; });
      if (lists === 2 && holdReadback) await new Promise(resolve => { releaseReadback = resolve; });
      return rows;
    }, remove: async envelope => {
      removed.push(envelope.clientCommandId);
      if (failRemoval) throw Object.assign(new Error('held cleanup storage failure'), { code: 'journal_timeout' });
      const result = await journal.remove(envelope);
      if (reinsertAfterAdditionalRemoval && removed.length > 1) await journal.admit(envelope);
      return result;
    } }),
    fetcher: async (url, init, actual) => {
      if (!url.endsWith('/apply')) return actual(url, init);
      applies++; const response = await actual(url, init);
      await new Promise(resolve => { releaseApply = resolve; }); return response;
    },
  });
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find(action => action.type === 'move');
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action });
  await until(() => Boolean(releaseApply));
  const [original] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const readiness = f.transport.finishSocketRecovery(f.gameId, { isCurrent: () => owner.current });
  void readiness.catch(() => {}); // Each negative case observes the exact outcome below.
  await until(() => Boolean(releaseList)); releaseApply(); await handle.committed;
  if (failRemoval) await until(() => f.store.getGameViewModel(f.gameId).storageBlocked);
  else assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
  return { ...f, original, readiness, removed, owner, applies: () => applies,
    resumeHydration: () => releaseList(), readbackHeld: () => Boolean(releaseReadback), resumeReadback: () => releaseReadback() };
};

test('hydration joins a failed terminal cleanup without deleting again or clearing its storage fence', async t => {
  const f = await receiptBeforeHydration(t, { failRemoval: true });
  f.resumeHydration(); assert.equal(await f.readiness, false);
  assert.deepEqual(f.removed, [f.original.clientCommandId]); assert.equal(f.applies(), 1);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [f.original]);
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
});

test('a changed durable row cannot be removed using an earlier terminal receipt', async t => {
  const f = await receiptBeforeHydration(t);
  const altered = structuredClone(f.original); altered.payload.notation = 'different saved intent';
  altered.fingerprint = await commandFingerprint(altered); await f.journal.admit(altered);
  const rejected = assert.rejects(f.readiness, { code: 'invalid_saved_command' });
  f.resumeHydration(); await rejected;
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [altered]);
  assert.deepEqual(f.removed, [f.original.clientCommandId]); assert.equal(f.applies(), 1);
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, true);
});

test('stale cleanup readback cannot release a newer recovery context', async t => {
  const f = await receiptBeforeHydration(t, { holdReadback: true });
  f.resumeHydration(); await until(f.readbackHeld);
  f.owner.current = false; f.transport.setConnectionRecovering(f.gameId, true);
  f.resumeReadback(); assert.equal(await f.readiness, false);
  assert.equal(f.store.getGameViewModel(f.gameId).recovering, true);
  assert.deepEqual(f.removed, [f.original.clientCommandId]); assert.equal(f.applies(), 1);
  assert.equal(await f.transport.finishSocketRecovery(f.gameId), true);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), []);
});

test('a row recreated after successful removal fails closed after one new cleanup attempt', { timeout: 1000 }, async t => {
  const f = await receiptBeforeHydration(t, { reinsertAfterAdditionalRemoval: true });
  await f.journal.admit(f.original);
  const rejected = assert.rejects(f.readiness, { code: 'cleanup_unverified' });
  f.resumeHydration(); await rejected;
  assert.deepEqual(f.removed, [f.original.clientCommandId, f.original.clientCommandId],
    'the original receipt cleanup may be followed by only one fresh-row cleanup attempt');
  assert.equal(f.applies(), 1); assert.equal((await f.current()).game.gameplayRevision, 1);
  assert.deepEqual(await f.journal.list(f.store.getIdentityId(), f.gameId), [f.original]);
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
});
