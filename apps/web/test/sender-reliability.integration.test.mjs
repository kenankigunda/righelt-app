import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createSyncStore } from "../shell/sync-store.js";
import { createCommandJournal } from "../shell/command-journal.js";
import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";
import apiWorker from "../../api/index.js";
import { createFakeD1 } from "../../../packages/api-handler/test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../../../packages/api-handler/test/support/fake-game-rooms.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate) => { for (let i = 0; i < 300; i++) { if (predicate()) return; await sleep(5); } assert.fail("condition did not converge"); };
const memoryStorage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; };
const setup = async ({ journal: override, fault = (url, init, call) => call() } = {}) => {
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const storage = memoryStorage(), indexedDB = new IDBFactory();
  const journal = override ?? createCommandJournal({ indexedDB });
  const requests = [];
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const create = () => createSyncStore({ storage, commandJournal: journal, timing: { ...SYNC_TIMING, requestTimeoutMs: 30, confirmationBudgetMs: 65, retryDelaysMs: [10], retryJitter: 0 },
    fetcher: (url, init) => { if (init?.body) requests.push(JSON.parse(init.body)); return fault(url, init, () => actual(url, init)); },
    createSyncClient: () => ({ connectGame() {}, disconnectGame() {}, disconnectAll() {}, getDesiredGameIds: () => [] }),
  });
  const store = create(); const created = store.createGame({ selfPlayMode: true }); await created.committed;
  const gameId = created.gameId;
  const move = async (target = store) => { const game = target.getGameViewModel(gameId); const action = game.legalActions.find((entry) => entry.type === "move") ?? game.legalActions[0]; return target.applyGameAction({ gameId, state: game.currentSnapshot, action }); };
  return { store, create, gameId, move, journal, requests, env, actual };
};

test("hung request and hung body independently cross the confirmation budget without failing unknown handles", async () => {
  for (const hungBody of [false, true]) {
    let broken = true;
    const f = await setup({ fault: (url, init, call) => {
      if (broken && (url.endsWith("/apply") || url.endsWith("/reconcile"))) return hungBody ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {});
      return call();
    } });
    const handle = await f.move();
    await until(() => f.store.getGameViewModel(f.gameId).confirmationOverdue);
    assert.equal(handle.status, "pending"); assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 1);
    await assert.rejects(f.move(), /sync_recovering/);
    broken = false;
    await until(() => handle.status === "committed");
    assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  }
});

test("empty, corrupt, unrelated and invalid-revision HTTP 200 never falsely confirm; lost commit is recovered by receipt", async () => {
  for (const corrupt of [() => ({}), () => ({ protocolVersion: 2 }), (body) => ({ ...body, commandOutcomes: body.commandOutcomes.map((outcome) => ({ ...outcome, clientCommandId: "v2:unrelated" })) }), (body) => ({ ...body, eventSeq: -1 })]) {
    let holdReconcile = true;
    const f = await setup({ fault: async (url, init, call) => {
      if (url.endsWith("/apply")) { const body = await (await call()).json(); return Response.json(corrupt(body)); }
      if (url.endsWith("/reconcile") && holdReconcile) return new Promise(() => {});
      return call();
    } });
    const handle = await f.move(); await until(() => f.store.getGameViewModel(f.gameId).recovering);
    assert.equal(handle.status, "pending"); assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
    holdReconcile = false; await until(() => handle.status === "committed");
    assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  }
});

test("late HTTP failure cannot reverse WebSocket acceptance or clear a newer queued command", async () => {
  let completeFirst, firstBody, secondBody, completeSecond;
  const f = await setup({ fault: async (url, init, call) => {
    if (!url.endsWith("/apply")) return call();
    const response = await call(); const body = await response.json();
    if (!firstBody) { firstBody = body; return new Promise((resolve) => { completeFirst = resolve; }); }
    secondBody = body; return new Promise((resolve) => { completeSecond = resolve; });
  } });
  const first = await f.move(); await until(() => firstBody);
  f.store.applyLiveGameUpdate({ game: firstBody.game, eventSeq: firstBody.eventSeq, commandOutcome: firstBody.commandOutcomes[0] });
  assert.equal(first.status, "committed");
  const second = await f.move(); await until(() => secondBody);
  completeFirst(Response.json({ ok: false, error: "late_failure" }, { status: 500 })); await sleep(5);
  assert.equal(first.status, "committed"); assert.equal(second.status, "pending");
  completeSecond(Response.json(secondBody)); await until(() => second.status === "committed");
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 2);
});

test("reload reconciles immutable original IDs after a committed response is lost", async () => {
  let lose = true;
  const f = await setup({ fault: async (url, init, call) => {
    if (lose && url.endsWith("/apply")) { await call(); return new Promise(() => {}); }
    if (lose && url.endsWith("/reconcile")) return new Promise(() => {});
    return call();
  } });
  const original = await f.move(); await until(() => f.env.DB.getGameState(f.gameId).moves.length === 1);
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  assert.equal(saved[0].clientCommandId, original.id);
  lose = false; const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  await until(() => reloaded.getPendingOperations(f.gameId).length === 0);
  await until(() => original.status === "committed");
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  assert.equal((await f.journal.list(f.store.getIdentityId(), f.gameId)).length, 0);
});

test("journal failure publishes and sends nothing; recovery gate survives dismissal", async () => {
  let fail = true;
  const actualJournal = createCommandJournal({ indexedDB: new IDBFactory() });
  const journal = { ...actualJournal, admit: (command) => fail ? Promise.reject(new Error("quota")) : actualJournal.admit(command) };
  const f = await setup({ journal }); const before = f.store.getGameViewModel(f.gameId).currentSnapshot;
  await assert.rejects(f.move(), /quota/);
  assert.deepEqual(f.store.getGameViewModel(f.gameId).currentSnapshot, before);
  assert.equal(f.requests.filter((body) => body.kind === "action").length, 0);
  f.store.dismissOperation("missing"); await assert.rejects(f.move(), /sync_recovering/);
  fail = false; await f.store.retrySaving(f.gameId);
  await until(() => f.env.DB.getGameState(f.gameId).moves.length === 1);
});

test("an out-of-order descendant receipt cannot reset the predecessor confirmation budget", async () => {
  let firstBody, releaseFirst;
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    if (url.endsWith("/apply")) { firstBody = await (await call()).json(); return new Promise((resolve) => { releaseFirst = resolve; }); }
    return call();
  } });
  const first = await f.move(); const second = await f.move(); await until(() => firstBody);
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const descendant = saved.find((entry) => entry.clientCommandId === second.id);
  assert.equal(descendant.predecessor.clientCommandId, first.id);
  const body = await (await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(descendant) })).json();
  assert.equal(body.commandOutcomes[0].outcome, "accepted");
  f.store.applyLiveGameUpdate({ game: body.game, eventSeq: body.eventSeq, commandOutcome: body.commandOutcomes[0] });
  assert.equal(second.status, "committed"); assert.equal(first.status, "pending");
  await until(() => f.store.getGameViewModel(f.gameId).confirmationOverdue);
  f.store.applyLiveGameUpdate({ game: firstBody.game, eventSeq: firstBody.eventSeq, commandOutcome: firstBody.commandOutcomes[0] });
  assert.equal(first.status, "committed"); assert.equal(f.store.getGameViewModel(f.gameId).moves.length, 2);
  releaseFirst(Response.json({}));
});

test("reload never resends a saved command whose original prerequisites changed", async () => {
  let stop = true;
  const f = await setup({ fault: (url, init, call) => stop && (url.endsWith("/apply") || url.endsWith("/reconcile")) ? new Promise(() => {}) : call() });
  const handle = await f.move();
  const [saved] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const competing = { ...saved, clientCommandId: "v2:competing" };
  const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
  competing.fingerprint = await commandFingerprint(competing);
  await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(competing) });
  const sentBefore = f.requests.filter((entry) => entry.clientCommandId === handle.id).length;
  stop = false; const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  await until(() => reloaded.getPendingOperations(f.gameId).length === 0);
  await until(() => handle.status === "failed");
  assert.equal(f.requests.filter((entry) => entry.clientCommandId === handle.id).length, sentBefore);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
});

test("older servers and malformed authoritative snapshots are rejected before saved commands replay", async () => {
  for (const corrupt of [(body) => ({ ...body, protocolVersion: undefined }), (body) => ({ ...body, game: { ...body.game, board: { state: true } } }), (body) => ({ ...body, game: { ...body.game, gameplayRevision: -1 } })]) {
    const f = await setup({ fault: async (url, init, call) => {
      const response = await call();
      return init.method === "GET" ? Response.json(corrupt(await response.json())) : response;
    } });
    await assert.rejects(f.create().loadGame(f.gameId), /upgrade_required|invalid_snapshot/);
  }
});

test("malformed socket snapshots cannot confirm a command before recovery", async () => {
  let committed, release;
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/apply")) { committed = await (await call()).json(); return new Promise((resolve) => { release = resolve; }); }
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    return call();
  } });
  const handle = await f.move(); await until(() => committed);
  for (const update of [
    { game: { ...committed.game, board: { state: true } }, eventSeq: committed.eventSeq, commandOutcome: committed.commandOutcomes[0] },
    { game: committed.game, eventSeq: committed.eventSeq, commandOutcome: { ...committed.commandOutcomes[0], eventSeq: committed.eventSeq + 1 } },
  ]) {
    f.store.applyLiveGameUpdate(update); assert.equal(handle.status, "pending");
  }
  f.store.applyLiveGameUpdate({ game: committed.game, eventSeq: committed.eventSeq, commandOutcome: committed.commandOutcomes[0] });
  assert.equal(handle.status, "committed"); release(Response.json({}));
});

test("rejected predecessors settle all queued descendants through durable server outcomes", async () => {
  let release, waiting = true;
  const f = await setup({ fault: (url, init, call) => {
    if (waiting && url.endsWith("/apply")) return new Promise((resolve) => { release = () => { waiting = false; resolve(call()); }; });
    return call();
  } });
  const first = await f.move(); const second = await f.move();
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const root = saved.find((entry) => entry.clientCommandId === first.id);
  const competitor = { ...root, clientCommandId: "v2:other-tab" };
  const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
  competitor.fingerprint = await commandFingerprint(competitor);
  await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(competitor) });
  release();
  await until(() => first.status === "failed" && second.status === "failed");
  assert.equal(f.store.getPendingOperations(f.gameId).length, 0);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  await until(() => f.store.getGameViewModel(f.gameId).pendingCommandCount === 0);
});

test("tampered restored journal records block replay without evicting unresolved data", async () => {
  const f = await setup({ journal: { list: async () => [{ clientCommandId: "v2:broken" }], admit: async () => {}, remove: async () => assert.fail("must not evict") } });
  const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  assert.equal(reloaded.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal(f.requests.filter((entry) => entry.kind).length, 0);
});
