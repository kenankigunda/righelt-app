import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncStore } from '../shell/sync-store.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { legacyClientFixture } from './support/legacy-client.mjs';
import apiWorker from '../../api/index.js';
import { createFakeD1 } from '../../../packages/api-handler/test/support/fake-d1.mjs';
import { createFakeGameRooms } from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';

const until = async predicate => {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('mixed-client recovery did not converge');
};
const cases = [
  { fault: 'uncommitted', delayedSetup: false },
  { fault: 'delayed-cleanup', delayedSetup: false },
  { fault: 'uncommitted', delayedSetup: true },
];
for (const {fault, delayedSetup} of cases) test(`actual150 preserves a newer shared journal during ${fault} and158 resumes it${delayedSetup ? ' with delayed setup response' : ''}`, async t => {
  const fixture = await legacyClientFixture(); const stores = [];
  t.diagnostic(`legacy=${fixture.revision} transportSha256=${fixture.transportHash}`);
  const legacy = await fixture.load('shell/sync-store.js');
  const legacyProtocol = await fixture.load('generated/packages/shared-types/src/sync-protocol.js');
  const savedWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(async () => { for (const store of stores) store.retire(); globalThis.window = savedWindow; await fixture.close(); });
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const indexedDB = new IDBFactory(), journal = createCommandJournal({ indexedDB });
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  let held = true, envelope, delayedResponse = false, setupReconciles = 0, successfulSetupReconciles = 0; const legacySends = [], sharedSends = [], setupSends = [];
  const delayTimers = new Set();t.after(() => { for (const timer of delayTimers) clearTimeout(timer); });
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const noSockets = () => ({ connectGame() {}, disconnectGame() {}, disconnectAll() {}, getDesiredGameIds: () => [] });
  const make = (factory, old = false) => {
    const ownJournal = createCommandJournal({ indexedDB });
    const remove = ownJournal.remove;
    if (!old) ownJournal.remove = command => held && fault === 'delayed-cleanup' && command.kind === 'shared'
      ? Promise.reject(Object.assign(Error('journal_transaction_failed'), { code: 'journal_transaction_failed' })) : remove(command);
    const store = factory({ storage, commandJournal: ownJournal, createSyncClient: noSockets, onError() {},
      timing: { requestTimeoutMs: 20, recoveryPassMs: 60, confirmationBudgetMs: 100, retryDelaysMs: [10], retryJitter: 0 },
      fetcher: async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        if (old && body) legacySends.push({ url, body });
        if (!old && !envelope && url.endsWith('/reconcile')) setupReconciles++;
        if (!old && url.endsWith('/shared')) { envelope ??= structuredClone(body); sharedSends.push(structuredClone(body)); }
        if (!old && envelope && held && fault === 'uncommitted' && (url.endsWith('/shared') || url.endsWith('/reconcile'))) return new Promise(() => {});
        const response = await actual(url, init);
        if (!old && !envelope && url.endsWith('/reconcile') && response.ok) successfulSetupReconciles++;
        if (!old && url.endsWith('/apply')) {
          setupSends.push(structuredClone(body));
          if (delayedSetup && !delayedResponse) {
            delayedResponse = true;
            // Preserve the real accepted API response but deliver it after the
            // unchanged20ms request budget. This synthetic latency timer is
            // unref'd so it cannot accidentally supply the test's liveness.
            await new Promise(resolve => { const timer = setTimeout(() => { delayTimers.delete(timer);resolve(); }, 40);delayTimers.add(timer);timer.unref?.(); });
          }
        }
        return response;
      } });
    stores.push(store); return store;
  };
  const current = make(createSyncStore);
  const creation = current.createGame({ selfPlayMode: true }); await creation.committed;
  const gameId = creation.gameId, initial = current.getGameViewModel(gameId);
  const action = initial.legalActions.find(action => action.type === 'move');
  await (await current.applyGameAction({ gameId, state: initial.board.state, action })).committed;
  assert.equal(delayedResponse,delayedSetup);
  const setupState=env.DB.getGameState(gameId);assert.equal(setupState.gameplayRevision,1);assert.equal(setupState.moves.length,1);
  assert.ok(setupSends.length>=1);assert.equal(new Set(setupSends.map(command=>command.clientCommandId)).size,1);
  for(const sent of setupSends)assert.deepEqual(sent,setupSends[0]);
  assert.equal(env.DB.getReceipt(gameId,setupSends[0].clientCommandId).outcome,'accepted');
  if(delayedSetup){
    assert.ok(setupReconciles>=1,'A timed-out setup action must reconcile before arming the shared-command fault');
    assert.ok(successfulSetupReconciles>=1,'Timed-out setup must receive successful actual reconciliation before the shared-command fault');
  }
  const oldOpen = make(legacy.createSyncStore, true); await oldOpen.loadGame(gameId); oldOpen.setActiveGameId(gameId);
  const targetMoveId = current.getGameViewModel(gameId).moves[0].moveId;
  const handle = current.requestRevertToMove({ gameId, targetMoveId });
  await until(() => envelope);
  if (fault === 'delayed-cleanup') { await handle.committed; await until(() => current.getGameViewModel(gameId).storageBlocked); }
  const original = await journal.list(current.getIdentityId(), gameId);
  assert.equal(original.length, 1); assert.equal(original[0].kind, 'shared');
  assert.equal(legacyProtocol.isSyncCommand(original[0]), false);
  const event = new Event('storage'); Object.assign(event, { key: 'righelt.pendingLocalGames',
    oldValue: JSON.stringify({ [gameId]: { id: gameId } }), newValue: '{}' });
  globalThis.window.dispatchEvent(event);
  await oldOpen.loadGame(gameId);
  assert.deepEqual(oldOpen.getGameViewModel(gameId).board.state, env.DB.getGameState(gameId).board.state);
  const receipt = env.DB.getReceipt(gameId, envelope.clientCommandId);
  if (receipt) oldOpen.applyLiveGameUpdate({ game: env.DB.getGameState(gameId), eventSeq: receipt.event_seq,
    commandOutcome: { gameId, identityId: envelope.identityId, clientCommandId: envelope.clientCommandId,
      fingerprint: envelope.fingerprint, outcome: 'accepted', reason: null,
      gameplayRevision: receipt.gameplay_revision, eventSeq: receipt.event_seq } });
  assert.equal(oldOpen.getCommandOutcome(gameId, envelope.clientCommandId), null);
  const oldReloaded = make(legacy.createSyncStore, true);
  // Old clients retain access to the board while refusing unsupported mutations.
  await oldReloaded.loadGame(gameId);
  assert.equal(oldReloaded.getGameViewModel(gameId).storageBlocked, true);
  oldReloaded.discardPendingCommands(gameId);
  await assert.rejects(oldReloaded.reconcileGame(gameId), /invalid_saved_command/);
  assert.deepEqual(await journal.list(current.getIdentityId(), gameId), original);
  assert.equal(legacySends.some(({ body }) => body.kind === 'shared' || body.commands?.some(command => command.kind === 'shared')), false);
  current.retire(); oldOpen.retire(); oldReloaded.retire(); held = false;
  const resumed = make(createSyncStore); await resumed.loadGame(gameId);
  await until(async () => (await journal.list(resumed.getIdentityId(), gameId)).length === 0);
  assert.equal(resumed.getGameViewModel(gameId).sharedMutationsBlocked, false);
  assert.equal(env.DB.getReceipt(gameId, envelope.clientCommandId).outcome, 'accepted');
  assert.equal(env.DB.getGameState(gameId).gameplayRevision, 2);
  if (fault === 'delayed-cleanup') assert.equal(sharedSends.length, 1);
  else assert.ok(sharedSends.length >= 2);
  for (const sent of sharedSends) assert.deepEqual(sent, envelope);
  await journal.close();
});


test('actual150 browser fixture contains a complete historical board module graph', async t => {
  const fixture = await legacyClientFixture(); t.after(() => fixture.close());
  assert.ok(fixture.assetPaths.has('/board/runtime/board-runtime.js'));
  assert.ok(fixture.assetPaths.has('/board-adapters/engine-board-adapter.js'));
  assert.equal(typeof (await fixture.load('board/runtime/board-runtime.js')).createBoardRuntime, 'function');
  assert.equal(typeof (await fixture.load('board-adapters/engine-board-adapter.js')).createEngineBoardAdapter, 'function');
  assert.equal((await fixture.load('generated/packages/game-engine/src/continuation.js')).getRushUnsuppliedPieceIds, undefined,
    'the legacy fixture must retain its real old engine API');
});
