import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createCommandJournal } from "../shell/command-journal.js";
import { createLiveTransportStore } from "../shell/live-transport.js";
import {
  createInitialState,
  resolveToStability,
  listLegalActions,
} from "../generated/packages/game-engine/src/index.js";
const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
const auth = (id, context) => ({
  enabled: true,
  session: {
    authenticated: true,
    account: { id },
    contextId: context.repeat(64),
    recoveryAcknowledgmentRequired: false,
  },
});
const game = () => {
  const state = resolveToStability(createInitialState(), {
      artifactMode: "full",
    }),
    turn = {
      index: 0,
      playerSeat: "Player 1",
      status: "active",
      moveIndexes: [],
    };
  return {
    id: "g",
    ownershipMode: "account_v1",
    gameplayRevision: 0,
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
    board: { state },
    currentSnapshot: state,
    currentTurn: turn,
    turns: [turn],
    moves: [],
    player1: { identityId: "alice" },
    player2: { identityId: "alice" },
    viewers: [],
    pendingJoinRequests: [],
    selfPlayMode: true,
    myRole: "Player 1",
    myRoles: ["Player 1", "Player 2"],
    canRecordMove: true,
    canEndTurn: true,
    legalActions: listLegalActions(state),
  };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
test("offline A queue is context-bound and cannot be replayed by B or a later A session", async () => {
  globalThis.indexedDB = new IDBFactory();
  const calls = [],
    store = storage(),
    snapshot = game();
  const fetcher = async (url, init = {}) => {
    calls.push([url, init]);
    return Response.json({
      ok: true,
      protocolVersion: 2,
      eventSeq: 1,
      game: snapshot,
    });
  };
  const a = createLiveTransportStore({
    storage: store,
    fetcher,
    auth: auth("alice", "a"),
    shouldDeferCommandSend: () => true,
  });
  await a.loadGame("g");
  const result = await a.applyGameAction({
    gameId: "g",
    state: snapshot.board.state,
    action: snapshot.legalActions[0],
  });
  assert.equal(result.accepted, true);
  assert.equal(a.getGameViewModel("g").pendingCommandCount, 1);
  const journal = createCommandJournal({
    databaseName: `righelt.online-commands.account-v1.${"a".repeat(64)}`,
  });
  const saved = await journal.list("alice", "g");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].authContextId, "a".repeat(64));
  a.retire();
  const b = createLiveTransportStore({
    storage: store,
    fetcher,
    auth: auth("bobby", "b"),
  });
  await b.loadGame("g");
  b.retire();
  const again = createLiveTransportStore({
    storage: store,
    fetcher,
    auth: auth("alice", "c"),
  });
  await again.loadGame("g");
  await tick();
  assert.equal(again.getGameViewModel("g").pendingCommandCount, 0);
  assert.equal(calls.filter(([, init]) => init.method === "POST").length, 0);
  again.retire();
  await journal.close();
});
test("late IndexedDB admission callback after retirement cannot submit or restore a preview", async () => {
  globalThis.indexedDB = new IDBFactory();
  const snapshot = game(),
    calls = [];
  let release, entered;
  const waiting = new Promise((r) => (entered = r)),
    hold = new Promise((r) => (release = r));
  const journal = {
    list: async () => [],
    admit: async () => {
      entered();
      await hold;
    },
    close: async () => {},
    remove: async () => {},
  };
  const store = createLiveTransportStore({
    storage: storage(),
    auth: auth("alice", "a"),
    commandJournal: journal,
    fetcher: async (url, init) => {
      calls.push([url, init]);
      return Response.json({
        ok: true,
        protocolVersion: 2,
        eventSeq: 1,
        game: snapshot,
      });
    },
  });
  await store.loadGame("g");
  const pending = store.applyGameAction({
    gameId: "g",
    state: snapshot.board.state,
    action: snapshot.legalActions[0],
  });
  await waiting;
  store.retire();
  release();
  await assert.rejects(pending, /session_changed/);
  await tick();
  assert.equal(calls.filter(([, i]) => i.method === "POST").length, 0);
  assert.equal(store.getGameViewModel("g").pendingCommandCount, 0);
});
test("already transmitted response from retired account cannot publish state or start retries", async () => {
  globalThis.indexedDB = new IDBFactory();
  const snapshot = game();
  let release, posted;
  const sent = new Promise((r) => (posted = r)),
    response = new Promise((r) => (release = r)),
    changes = [];
  const store = createLiveTransportStore({
    storage: storage(),
    auth: auth("alice", "a"),
    fetcher: async (url, init) => {
      if (init.method === "POST") {
        posted();
        return response;
      }
      return Response.json({
        ok: true,
        protocolVersion: 2,
        eventSeq: 1,
        game: snapshot,
      });
    },
  });
  await store.loadGame("g");
  store.subscribe((c) => changes.push(c));
  await store.applyGameAction({
    gameId: "g",
    state: snapshot.board.state,
    action: snapshot.legalActions[0],
  });
  await sent;
  store.retire();
  const count = changes.length;
  release(
    Response.json({
      ok: true,
      protocolVersion: 2,
      eventSeq: 99,
      game: { ...snapshot, gameplayRevision: 99 },
    }),
  );
  await tick();
  await tick();
  assert.equal(changes.length, count);
  assert.notEqual(store.getLastEventSeq("g"), 99);
});

import { createLiveSyncClient } from "../shell/sync-store.js";
import { commandFingerprint } from "../generated/packages/shared-types/src/sync-protocol.js";
test("superseded socket close cannot retire a replacement account connection", () => {
  const previous = {
      window: globalThis.window,
      document: globalThis.document,
      WebSocket: globalThis.WebSocket,
    },
    sockets = [];
  let lost = 0;
  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.handlers = {};
      sockets.push(this);
    }
    addEventListener(name, fn) {
      (this.handlers[name] ??= []).push(fn);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
    emit(name, event) {
      for (const fn of this.handlers[name] || []) fn(event);
    }
  }
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "localhost",
      host: "localhost:9988",
      port: "9988",
    },
    addEventListener() {},
  };
  globalThis.document = {
    hidden: false,
    visibilityState: "visible",
    addEventListener() {},
  };
  globalThis.WebSocket = Socket;
  const client = createLiveSyncClient({
    identityId: "alice",
    auth: auth("alice", "a"),
    onEvent() {},
    onAuthLost: () => lost++,
  });
  try {
    client.connectGame("g");
    const old = sockets[0];
    client.disconnectGame("g");
    client.connectGame("g");
    assert.equal(new URL(sockets[1].url).host, "localhost:9988");
    assert.equal(
      new URL(sockets[1].url).searchParams.get("sessionContext"),
      "a".repeat(64),
    );
    old.emit("close", { code: 4001 });
    assert.equal(lost, 0);
    sockets[1].emit("close", { code: 4001 });
    assert.equal(lost, 1);
  } finally {
    client.retire();
    Object.assign(globalThis, previous);
  }
});
test("IndexedDB request completed after generation retirement aborts the write transaction", async () => {
  const factory = new IDBFactory();
  let active = true;
  const indexedDB = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener("success", () => {
        const db = request.result,
          transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args),
            objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (name) => {
            const store = objectStore(name),
              getAll = store.getAll.bind(store);
            store.getAll = () => {
              const result = getAll();
              result.addEventListener("success", () => {
                active = false;
              });
              return result;
            };
            return store;
          };
          return tx;
        };
      });
      return request;
    },
  };
  const journal = createCommandJournal({ indexedDB, isCurrent: () => active }),
    command = {
      protocolVersion: 2,
      identityId: "alice",
      authContextId: "a".repeat(64),
      gameId: "g",
      clientCommandId: "v2:late-idb",
      kind: "action",
      payload: { action: {} },
      expectedState: {},
      expectedGameplayRevision: 0,
    };
  command.fingerprint = await commandFingerprint(command);
  await assert.rejects(journal.admit(command), /session_changed/);
  const fresh = createCommandJournal({ indexedDB: factory });
  assert.deepEqual(await fresh.list("alice"), []);
  await journal.close();
  await fresh.close();
});

test("pending logout keeps route sockets disconnected until fresh anonymous transport", async () => {
  const { createSyncStore } = await import("../shell/sync-store.js");
  let connects = 0;
  const make = (pendingLogout) =>
    createSyncStore({
      storage: storage(),
      auth: { enabled: true, pendingLogout, session: { authenticated: false } },
      fetcher: async () => {
        throw Error("unexpected fetch");
      },
      createSyncClient: () => ({
        connectGame() {
          connects++;
        },
        disconnectAll() {},
        disconnectGame() {},
        retire() {},
        getDesiredGameIds: () => [],
        getConnectedGameIds: () => [],
      }),
    });
  const pending = make(true);
  pending.setActiveGameId("g");
  assert.equal(connects, 0);
  pending.retire();
  const finished = make(false);
  finished.setActiveGameId("g");
  assert.equal(connects, 1);
  finished.retire();
});
