import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import { GameRoomDO } from "../src/game-room-do.ts";
import { handleApiRequest } from "../src/index.ts";
import { createFakeD1 } from "../test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../test/support/fake-game-rooms.mjs";
import { createCommandJournal } from "../../../apps/web/shell/command-journal.js";
import { createSyncStore, createLiveSyncClient } from "../../../apps/web/shell/sync-store.js";
import { IDENTITY_KEY } from "../../../apps/web/shell/persistence.js";
import { commandFingerprint } from "../../shared-types/src/sync-protocol.ts";

// Fixed PRNG and complete ordered trace make CI failures replayable by T114_SEED.
const randomFor = (seed) => { let n = seed; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 2 ** 32; }; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const eventually = async (predicate) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await tick(); } assert.fail("schedule did not drain"); };
const room = async (gameId) => {
  const DB = createFakeD1(); let instance;
  const restart = () => { instance = new GameRoomDO({ id: { name: gameId } }, { DB }); };
  restart();
  const call = async (route, body = {}) => {
    const response = await instance.fetch(new Request(`https://test/${route}`, { method: "POST", headers: { "x-game-id": gameId }, body: JSON.stringify({ protocolVersion: 2, identityId: "actor", ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  await call("create", { gameId, selfPlayMode: true });
  return { DB, call, restart, game: () => DB.getGameState(gameId) };
};
const signed = async (value) => ({ ...value, fingerprint: await commandFingerprint(value) });

async function serverSchedule(seed, random, trace) {
  const actual = await room("g"), oracle = await room("g");
  const ledger = new Map(), commands = [], unresolved = new Set();
  let revision = 0, previousSeq = 1, serial = 0;
  const make = async (patch = {}) => signed({ protocolVersion: 2, gameId: "g", identityId: "actor", clientCommandId: `v2:${seed}-${serial++}`, kind: "move", payload: {}, expectedState: structuredClone(oracle.game().board.state), expectedGameplayRevision: revision, ...patch });
  const predict = (command) => {
    if (ledger.has(command.clientCommandId)) return ledger.get(command.clientCommandId);
    const predecessor = command.predecessor && ledger.get(command.predecessor.clientCommandId);
    if (command.predecessor && !predecessor) return "unknown";
    if (predecessor === "rejected") return "rejected";
    if (command.expectedGameplayRevision !== revision) return "rejected";
    return "accepted";
  };
  const deliver = async (command, fault = "healthy") => {
    const expected = predict(command), existing = ledger.has(command.clientCommandId);
    if (fault === "drop") return;
    if (fault === "fail" && !existing && expected !== "unknown") actual.DB.failNextBatchAt(5);
    if (fault === "lost" && !existing && expected !== "unknown") actual.DB.loseNextBatchResponse();
    let response;
    try { response = await actual.call("moves", command); }
    catch (error) { assert.match(error.message, /Injected|Lost batch/); }
    if (fault === "fail" && !existing && expected !== "unknown") {
      assert.equal(response, undefined); assert.equal(actual.DB.getReceipt("g", command.clientCommandId), null); return;
    }
    if (!existing && expected !== "unknown") {
      ledger.set(command.clientCommandId, expected); unresolved.delete(command.clientCommandId);
      if (expected === "accepted") {
        // Board oracle executes only the independently predicted successful intents, with no faults.
        const clean = await signed({ ...command, expectedState: oracle.game().board.state, expectedGameplayRevision: oracle.game().gameplayRevision, predecessor: undefined });
        assert.equal((await oracle.call("moves", clean)).commandOutcomes[0].outcome, "accepted");
        revision++;
      }
    }
    if (response) assert.equal(response.commandOutcomes[0].outcome, expected);
  };
  const check = () => {
    assert.equal(actual.game().gameplayRevision, revision);
    assert.deepEqual(actual.game().board.state, oracle.game().board.state, "faulted execution differs from clean intent execution");
    const events = actual.DB.getEvents("g");
    const seq = events.at(-1).event_seq;
    assert.ok(seq >= previousSeq); previousSeq = seq;
    assert.deepEqual(events.map((event) => event.event_seq), Array.from({ length: seq }, (_, i) => i + 1));
    for (const [id, outcome] of ledger) assert.equal(actual.DB.getReceipt("g", id)?.outcome, outcome, `durable receipt ${id}`);
    const ids = actual.game().moves.map((move) => move.clientCommandId);
    assert.equal(new Set(ids).size, ids.length, "duplicate gameplay effect");
  };
  for (let step = 0; step < 200; step++) {
    const choice = Math.floor(random() * 10);
    if (choice < 4 || commands.length === 0) {
      let patch = {};
      if (choice === 1 && commands.length) { const prior = commands[Math.floor(random() * commands.length)]; patch = { predecessor: { clientCommandId: prior.clientCommandId, fingerprint: prior.fingerprint } }; }
      if (choice === 2) patch.expectedGameplayRevision = Math.max(0, revision - 1);
      const command = await make(patch); commands.push(command); unresolved.add(command.clientCommandId);
      const fault = ["healthy", "drop", "fail", "lost"][Math.floor(random() * 4)];
      trace.push({ lane: "server", step, kind: "submit", command, fault }); await deliver(command, fault);
    } else if (choice === 4) {
      const command = commands[Math.floor(random() * commands.length)];
      trace.push({ lane: "server", step, kind: "duplicate", id: command.clientCommandId }); await deliver(command);
    } else if (choice === 5) {
      trace.push({ lane: "server", step, kind: "restart" }); actual.restart();
    } else if (choice === 6) {
      const command = commands[Math.floor(random() * commands.length)];
      const before = ledger.get(command.clientCommandId);
      const response = await actual.call("reconcile", { commands: [command], knownSnapshotEventSeq: previousSeq });
      trace.push({ lane: "server", step, kind: "reconcile", id: command.clientCommandId });
      // Reconciliation may persist definitive stale/dependency cancellation, but never executes an unknown valid command.
      const predicted = predict(command);
      const expected = before ?? (predicted === "rejected" ? "rejected" : "unknown");
      assert.equal(response.commandOutcomes[0].outcome, expected);
      if (expected === "rejected") { ledger.set(command.clientCommandId, expected); unresolved.delete(command.clientCommandId); }
      if (response.eventSeq === previousSeq) assert.equal(response.game, undefined);
    } else if (choice === 7) {
      const candidate = actual.game().moves.filter((move) => !move.undone).at(-1);
      trace.push({ lane: "server", step, kind: "undo", id: candidate?.clientCommandId });
      if (candidate) {
        const clean = oracle.game().moves.find((move) => move.clientCommandId === candidate.clientCommandId);
        assert.equal((await actual.call("revert-request", { targetMoveId: candidate.moveId })).autoApproved, true);
        assert.equal((await oracle.call("revert-request", { targetMoveId: clean.moveId })).autoApproved, true);
        revision++;
      }
    } else if (choice === 8) {
      trace.push({ lane: "server", step, kind: "presence-history" });
      await Promise.all([actual.call("join", { identityId: `viewer-${step}`, mode: "viewer" }), actual.call("live")]);
    } else {
      const accepted = commands.find((command) => ledger.has(command.clientCommandId));
      trace.push({ lane: "server", step, kind: "conflicting-id", id: accepted?.clientCommandId });
      if (accepted) {
        const conflict = await signed({ ...accepted, payload: { notation: "conflicting reuse" } });
        assert.equal((await actual.call("moves", conflict)).commandOutcomes[0].reason, "command_id_conflict");
      }
    }
    check();
  }
  // Deliver parents before children, including work whose original request was dropped.
  for (const command of commands) await deliver(command);
  check(); assert.equal(unresolved.size, 0, "all DAG roots and descendants must resolve after healthy drain");
}

async function admissionRace(seed, random) {
  const factory = new IDBFactory();
  const tabs = [createCommandJournal({ indexedDB: factory }), createCommandJournal({ indexedDB: factory })];
  const identityLimit = seed % 2 === 0;
  const prefix = identityLimit ? 124 : 12;
  const make = (index) => signed({ protocolVersion: 2, gameId: identityLimit ? `cap-${Math.floor(index / 16)}` : "cap", identityId: "cap-actor", clientCommandId: `v2:cap-${index}`, kind: "move", payload: {}, expectedState: {}, expectedGameplayRevision: 0 });
  try {
    for (let index = 0; index < prefix; index++) await tabs[index % 2].admit(await make(index));
    const values = await Promise.all(Array.from({ length: 8 }, (_, index) => make(index + prefix)));
    const pending = values.map((value) => tabs[random() < 0.5 ? 0 : 1].admit(value));
    const results = await Promise.allSettled(pending);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 4);
    const records = await tabs[0].list("cap-actor");
    assert.equal(records.length, identityLimit ? 128 : 16);
    assert.equal(new Set(records.map((record) => record.clientCommandId)).size, records.length);
    for (let index = 0; index < prefix; index++) assert.ok(records.some((record) => record.clientCommandId === `v2:cap-${index}`), "unresolved commands cannot be evicted at capacity");
    const saved = records.at(-1);
    await assert.rejects(tabs[1].remove({ ...saved, fingerprint: "0".repeat(64) }), /command_id_conflict/);
    assert.equal((await tabs[0].list("cap-actor")).length, records.length, "stale tab cannot delete different content");
  } finally { for (const tab of tabs) await tab.close(); }
}

async function clientSchedule(seed, random, trace) {
  const env = { DB: createFakeD1(), GAME_ROOMS: null }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const indexedDB = new IDBFactory(), baseJournal = createCommandJournal({ indexedDB });
  const records = new Map(); const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key) };
  storage.setItem(IDENTITY_KEY, "actor");
  let fault = "healthy", journalFails = false, captured = [], requests = 0, hold = false;
  const held = [];
  const journal = { ...baseJournal, admit: async (command) => { if (journalFails) throw new Error("journal_transaction_failed"); return baseJournal.admit(command); } };
  const fetcher = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const command = body?.fingerprint ? body : null;
    const mode = command ? fault : "healthy";
    if (command) {
      requests++; captured.push(command); fault = "healthy";
      assert.ok((await baseJournal.list("actor", command.gameId)).some((saved) => saved.clientCommandId === command.clientCommandId), "every submission must already be durably admitted");

      if (mode === "fail") env.DB.failNextBatchAt(5);
      if (mode === "lost") env.DB.loseNextBatchResponse();
    }
    let response, error;
    try { if (mode === "drop") throw new Error("request lost"); response = await handleApiRequest(new Request(`https://test${url}`, init), env); } catch (caught) { error = caught; }
    if (command && hold) await new Promise((resolve) => held.push({ id: command.clientCommandId, release: resolve }));
    if (error) throw error;
    if (mode === "malformed") return Response.json({ ok: true });
    if (mode === "delay") { await tick(); await tick(); }
    return response;
  };
  const options = { storage, fetcher, commandJournal: journal, random: () => 0.5,
    timing: { requestTimeoutMs: 1000, confirmationBudgetMs: 3000, retryDelaysMs: [1], retryJitter: 0 },
    createSyncClient: () => ({ connectGame() {}, disconnectGame() {}, disconnectAll() {}, getDesiredGameIds: () => [] }) };
  let store = createSyncStore(options);
  const games = [];
  for (let i = 0; i < 2; i++) games.push((await store.createGame({ selfPlayMode: true }).committed).id);
  const handles = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    const gameId = games[cycle % 2];
    await store.loadGame(gameId, { openAsViewer: false });
    const game = store.getGameViewModel(gameId);
    let action = game.legalActions.find((entry) => entry.type !== "pass") ?? game.legalActions[0];
    const mode = ["healthy", "drop", "fail", "lost", "malformed", "delay"][Math.floor(random() * 6)];
    // Five explicitly recorded scheduling events per cycle (50), in addition to the 200 server events.
    trace.push({ lane: "client", cycle, kind: "switch-game", gameId });
    const before = requests;
    journalFails = cycle === seed % 10;
    trace.push({ lane: "client", cycle, kind: "journal", failed: journalFails });
    if (journalFails) {
      await assert.rejects(store.applyGameAction({ gameId, state: game.currentSnapshot, action }), /journal_transaction_failed/);
      assert.equal(requests, before); assert.equal(store.getGameViewModel(gameId).sharedMutationsBlocked, true);
      journalFails = false; await store.retrySaving(gameId);
      await eventually(() => !store.getGameViewModel(gameId).sharedMutationsBlocked);
      const recovered = store.getGameViewModel(gameId); action = recovered.legalActions.find((entry) => entry.type !== "pass") ?? recovered.legalActions[0];
    }
    const otherTab = createSyncStore(options);
    await otherTab.loadGame(gameId, { openAsViewer: false });
    fault = mode; hold = true;
    trace.push({ lane: "client", cycle, kind: "concurrent-submit", fault: mode });
    const submissions = await Promise.all([store, otherTab].map((tab) => tab.applyGameAction({ gameId, state: tab.getGameViewModel(gameId).currentSnapshot, action })));
    for (const handle of submissions) { assert.ok(handle.id, JSON.stringify(handle)); handles.push(handle); }
    await eventually(() => held.length >= 2);
    for (const handle of submissions) assert.equal(handle.status, "pending", "held responses must not fabricate confirmation");
    const unresolvedRecords = await baseJournal.list("actor", gameId);
    for (const handle of submissions) assert.ok(unresolvedRecords.some((record) => record.clientCommandId === handle.id), "no unrelated journal loss");
    trace.push({ lane: "client", cycle, kind: "restart-reload-while-pending", ids: submissions.map((h) => h.id) });
    env.GAME_ROOMS.restart(gameId);
    hold = false;
    // A third tab reloads with unresolved records while the original tabs still await their responses.
    store = createSyncStore(options); await store.loadGame(gameId, { openAsViewer: false });
    await store.reconcileGame(gameId);
    const deliveries = held.splice(0);
    if (random() < 0.5) deliveries.reverse();
    for (const delivery of deliveries) delivery.release();
    trace.push({ lane: "client", cycle, kind: "reordered-delivery-and-drain", ids: deliveries.map((delivery) => delivery.id) });
    await eventually(() => submissions.every((handle) => handle.status !== "pending"));
    await eventually(async () => (await baseJournal.list("actor", gameId)).length === 0);
    for (const handle of submissions) {
      const receipt = env.DB.getReceipt(gameId, handle.id);
      assert.ok(receipt, "settlement requires durable evidence");
      assert.equal(handle.status, receipt.outcome === "accepted" ? "committed" : "failed");
      assert.equal(env.DB.getGameState(gameId).moves.filter((move) => move.clientCommandId === handle.id).length, receipt.outcome === "accepted" ? 1 : 0);
    }
    assert.equal(store.getPendingOperations(gameId).length, 0);
    await store.reconcileGame(gameId);
    assert.deepEqual(store.getGameViewModel(gameId).board.state, env.DB.getGameState(gameId).board.state);
    for (const handle of handles) assert.notEqual(handle.status, "pending", "no orphaned handle after healthy drain");
  }
  await baseJournal.close();
}

async function socketSchedule(random, trace) {
  const original = Object.fromEntries(["WebSocket", "window", "document", "navigator", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sockets = [], observed = [], cursors = new Map();
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
    emit(name, event = {}) { if (name === "open") this.readyState = 1; if (name === "close") this.readyState = 3; for (const listener of this.listeners[name] ?? []) listener(event); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; } // Intentionally delay the close callback past replacement.
  }
  const surface = { hidden: false, visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: Socket });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { ...surface, location: { protocol: "https:", hostname: "test", host: "test", origin: "https://test" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: surface });
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { onLine: true } });
  globalThis.fetch = async () => Response.json({ ok: true });
  const client = createLiveSyncClient({ identityId: "actor", heartbeatMs: 5, inboundTimeoutMs: 1000, initialSnapshotTimeoutMs: 1000,
    getLastEventSeq: (id) => cursors.get(id) ?? 0,
    onEvent: (event) => { observed.push(event); cursors.set(event.gameId, event.eventSeq); return true; } });
  const snapshot = (gameId, eventSeq) => ({ type: "state_sync", protocolVersion: 2, gameId, eventSeq, game: { id: gameId, createdAt: "2026-10-03", updatedAt: "2026-10-03", gameplayRevision: 0, board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } }, moves: [], turns: [] } });
  try {
    let gameId = "socket-a", current;
    const replace = () => { client.disconnectAll(); client.connectGame(gameId); current = sockets.at(-1); current.emit("open"); current.emit("message", { data: JSON.stringify(snapshot(gameId, (cursors.get(gameId) ?? 0) + 1)) }); };
    replace();
    for (let step = 0; step < 50; step++) {
      const choice = Math.floor(random() * 5);
      trace.push({ lane: "socket", step, choice, gameId });
      if (choice === 0 || sockets.length < 2) { gameId = gameId === "socket-a" ? "socket-b" : "socket-a"; replace(); }
      else {
        const old = sockets[Math.floor(random() * (sockets.length - 1))];
        const before = observed.length;
        const event = ["open", "close", "error", "message"][choice - 1];
        old.emit(event, { data: JSON.stringify(snapshot(gameId, 999999)) });
        assert.equal(observed.length, before, "obsolete connection cannot apply state or leak another game's callback");
        assert.equal(sockets.at(-1), current, "obsolete callbacks cannot replace current connection");
      }
    }
    const sent = current.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.ok(current.sent.length > sent, "old close cannot stop replacement heartbeat");
    assert.ok(observed.every((event) => event.eventSeq < 999999));
  } finally {
    client.disconnectAll();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}

const seeds = process.env.T114_SEED ? [Number(process.env.T114_SEED)] : Array.from({ length: 100 }, (_, i) => i + 1);
for (const seed of seeds) test(`S-01 fixed seed ${seed}: 300 command/storage/network/restart/socket events`, { timeout: 120000 }, async () => {
  const trace = [], random = randomFor(seed);
  try { await serverSchedule(seed, random, trace); await admissionRace(seed, random); await clientSchedule(seed, random, trace); await socketSchedule(random, trace); assert.equal(trace.length, 300); }
  catch (error) {
    await mkdir("test-results/sync-stress/traces", { recursive: true });
    await writeFile(`test-results/sync-stress/traces/seed-${seed}.json`, JSON.stringify({ seed, error: error.stack, trace }, null, 2));
    throw error;
  }
});
