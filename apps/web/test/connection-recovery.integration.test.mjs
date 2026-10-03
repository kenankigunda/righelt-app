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
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(3); } assert.fail("no convergence"); };
const setup = async (t, { loseApply = false, timeout = 100 } = {}) => {
  const originals = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket };
  const sockets = [], wire = [], reconciles = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; sockets.push(this); }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    emit(type, event = {}) { if (type === "open") this.readyState = 1; for (const cb of this.listeners[type] ?? []) cb(event); }
    send() {}
    close() { this.readyState = 3; this.emit("close"); }
    receive(payload) { wire.push(payload); this.emit("message", { data: JSON.stringify(payload) }); }
  }
  globalThis.WebSocket = Socket;
  globalThis.window = { location: { protocol: "https:", hostname: "test", host: "test", port: "", origin: "https://test" }, addEventListener() {} };
  globalThis.document = { hidden: false, visibilityState: "visible", addEventListener() {} };
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const data = new Map(), storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  let releaseApply;
  const store = createSyncStore({ storage, commandJournal: createCommandJournal({ indexedDB: new IDBFactory() }),
    timing: { ...SYNC_TIMING, requestTimeoutMs: timeout },
    fetcher: async (url, init) => {
      if (url.endsWith("/reconcile")) reconciles.push(JSON.parse(init.body));
      const response = await actual(url, init);
      if (loseApply && url.endsWith("/apply")) return new Promise((resolve) => { releaseApply = () => resolve(Response.json({})); });
      wire.push(await response.clone().json()); return response;
    },
  });
  const created = store.createGame({ selfPlayMode: true }); await created.committed;
  const gameId = created.gameId;
  wire.length = 0;
  t.after(() => { store.setActiveGameId(null); for (const key of Object.keys(originals)) globalThis[key] = originals[key]; });
  const current = async () => (await actual(`/api/shell/games/${gameId}?identityId=${store.getIdentityId()}`)).json();
  return { store, gameId, sockets, wire, reconciles, current, applyCommitted: () => Boolean(releaseApply), release: () => releaseApply?.() };
};

test("WS-first recovery coalesces concurrent HTTP triggers and sends the unchanged snapshot exactly once", async (t) => {
  const f = await setup(t, { loseApply: true, timeout: 1000 });
  const game = f.store.getGameViewModel(f.gameId), action = game.legalActions.find((action) => action.type === "move");
  const handle = await f.store.applyGameAction({ gameId: f.gameId, state: game.currentSnapshot, action });
  f.store.setActiveGameId(f.gameId); const socket = f.sockets[0]; socket.emit("open");
  const recoveries = [f.store.reconcileGame(f.gameId), f.store.reconcileGame(f.gameId), f.store.reconcileGame(f.gameId)];
  await until(f.applyCommitted); assert.equal(f.reconciles.length, 0);
  const snapshot = await f.current();
  socket.receive({ ...snapshot, protocolVersion: 2, gameId: f.gameId, type: "state_sync" });
  f.release(); await Promise.all(recoveries); await until(() => handle.status === "committed");
  assert.equal(f.reconciles.length, 1);
  assert.equal(f.reconciles[0].knownSnapshotEventSeq, snapshot.eventSeq);
  assert.equal(f.wire.filter((payload) => payload.game).length, 1);
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
});

test("fallback retires the initial socket before HTTP and a cursor-matched reopen needs no second snapshot", async (t) => {
  const f = await setup(t, { timeout: 20 });
  f.store.setActiveGameId(f.gameId); const old = f.sockets[0]; old.emit("open");
  await until(() => f.sockets.length === 2);
  assert.equal(old.readyState, 3); assert.equal(f.reconciles.length, 1);
  const snapshot = await f.current(); const next = f.sockets[1];
  assert.equal(new URL(next.url).searchParams.get("lastEventSeq"), String(snapshot.eventSeq));
  next.emit("open"); next.receive({ type: "heartbeat_ack", protocolVersion: 2, gameId: f.gameId, eventSeq: snapshot.eventSeq });
  await until(() => f.store.getGameViewModel(f.gameId).recovering === false);
  assert.equal(f.wire.filter((payload) => payload.game).length, 1);
  old.receive({ ...snapshot, type: "state_sync", gameId: f.gameId, eventSeq: snapshot.eventSeq + 99 });
  assert.equal(f.store.getLastEventSeq(f.gameId), snapshot.eventSeq);
});
