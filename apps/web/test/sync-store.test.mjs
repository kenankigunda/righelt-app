import test from "node:test";
import assert from "node:assert/strict";
import { createSyncStore } from "../shell/sync-store.js";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const createTransportHarness = () => {
  const listeners = new Set();
  const games = new Map();
  return {
    listeners,
    games,
    transport: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getIdentityId: () => "id-test",
      getLastEventSeq: () => 0,
      getGameViewModel: (gameId) => games.get(gameId) ?? null,
      applyLiveGameUpdate: ({ game }) => {
        games.set(game.id, game);
      },
    },
  };
};

test("sync store setActiveGameId manages live sync connections", () => {
  const calls = [];
  const desiredGameIds = [];
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      subscribe: () => () => {},
      getIdentityId: () => "id-test",
      getLastEventSeq: () => 0,
    }),
    createSyncClient: () => ({
      connectGame: (gameId) => {
        desiredGameIds.push(gameId);
        calls.push(["connect", gameId]);
      },
      disconnectGame: (gameId) => {
        const index = desiredGameIds.indexOf(gameId);
        if (index >= 0) {
          desiredGameIds.splice(index, 1);
        }
        calls.push(["disconnect", gameId]);
      },
      disconnectAll: () => {
        desiredGameIds.length = 0;
        calls.push(["disconnectAll"]);
      },
      getDesiredGameIds: () => [...desiredGameIds],
    }),
  });

  store.setActiveGameId("game-1");
  store.setActiveGameId("game-2");
  store.setActiveGameId(null);

  assert.deepEqual(calls, [
    ["connect", "game-1"],
    ["disconnect", "game-1"],
    ["connect", "game-2"],
    ["disconnectAll"],
  ]);
});

test("sync store applies authoritative live payloads before forwarding events", () => {
  const appliedPayloads = [];
  let forwardedPayload = null;
  let capturedOnEvent = null;

  createSyncStore({
    storage: createMemoryStorage(),
    onEvent: (payload) => {
      forwardedPayload = payload;
    },
    createTransportStore: () => ({
      subscribe: () => () => {},
      getIdentityId: () => "id-test",
      getLastEventSeq: () => 7,
      applyLiveGameUpdate: (payload) => {
        appliedPayloads.push(payload);
      },
    }),
    createSyncClient: (options) => {
      capturedOnEvent = options.onEvent;
      return {
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      };
    },
  });

  capturedOnEvent(
    {
      type: "event_appended",
      game: { id: "game-1" },
      eventSeq: 8,
      clientCommandId: "cmd-1",
    },
    { gameId: "game-1" },
  );

  assert.deepEqual(appliedPayloads, [
    { game: { id: "game-1" }, eventSeq: 8, clientCommandId: "cmd-1" },
  ]);
  assert.deepEqual(forwardedPayload, {
    type: "event_appended",
    game: { id: "game-1" },
    eventSeq: 8,
    clientCommandId: "cmd-1",
  });
});

test("sync store wraps optimistic transport responses in operation handles", async () => {
  const listeners = new Set();
  let currentGame = {
    id: "game-1",
    currentSnapshot: { sideToMove: "P1" },
    legalActions: [{ type: "move" }],
    currentTurn: { index: 0 },
  };

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getIdentityId: () => "id-test",
      getLastEventSeq: () => 0,
      getGameViewModel: () => currentGame,
      applyGameAction: async () => ({
        ok: true,
        accepted: true,
        clientCommandId: "cmd-apply",
        state: { sideToMove: "P1" },
        legalActions: [{ type: "move" }],
        game: currentGame,
      }),
      endTurn: async () => ({
        ok: true,
        clientCommandId: "cmd-turn",
        turn: { index: 0 },
        game: currentGame,
      }),
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const actionHandle = await store.applyGameAction({ gameId: "game-1", state: {}, action: { type: "pass" } });
  assert.equal(actionHandle.status, "pending");
  assert.equal(store.getPendingOperations("game-1").length, 1);

  currentGame = {
    ...currentGame,
    currentSnapshot: { sideToMove: "P2" },
    legalActions: [{ type: "end-turn" }],
  };
  listeners.forEach((listener) =>
    listener({ type: "authoritative_update", gameId: "game-1", clientCommandId: "cmd-apply" }),
  );

  const committedAction = await actionHandle.committed;
  assert.equal(actionHandle.status, "committed");
  assert.deepEqual(committedAction.state, { sideToMove: "P2" });

  const endTurnHandle = await store.endTurn({ gameId: "game-1" });
  listeners.forEach((listener) =>
    listener({ type: "optimistic_desynced", gameId: "game-1", clientCommandId: "cmd-turn" }),
  );
  await assert.rejects(endTurnHandle.committed, /Sync failed/);
  assert.equal(endTurnHandle.status, "failed");
});

test("sync store creates local game stubs immediately and commits them in the background", async () => {
  const { transport, games } = createTransportHarness();
  let createRequest = null;
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      createGame: async (payload) => {
        createRequest = payload;
        return {
          ...(games.get(payload.gameId) ?? {}),
          id: payload.gameId,
          notifications: ["Game created"],
        };
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.createGame({ selfPlayMode: false });
  assert.equal(handle.status, "pending");
  assert.match(handle.result.id, /^game-[0-9a-f]+$/);
  assert.equal(store.getGameViewModel(handle.result.id)?.id, handle.result.id);

  const localLoad = await store.loadGame(handle.result.id, { openAsViewer: false });
  assert.equal(localLoad.id, handle.result.id);
  assert.equal(createRequest.gameId, handle.result.id);
  assert.equal(createRequest.selfPlayMode, false);

  const committed = await handle.committed;
  assert.equal(committed.id, handle.result.id);
  assert.equal(committed.notifications.at(-1), "Game created");
});

test("sync store launches history branches with immediate local stubs", async () => {
  const { transport, games } = createTransportHarness();
  games.set("game-source", {
    id: "game-source",
    myRole: "Player 2",
    player1: null,
    player2: { identityId: "id-test", connected: true },
    viewers: [],
  });
  let branchRequest = null;
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      launchHistoryBranch: async (payload) => {
        branchRequest = payload;
        return {
          game: {
            ...(games.get(payload.gameId) ?? {}),
            id: payload.gameId,
            notifications: ["History branch launched"],
          },
        };
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      resultingState: { sideToMove: "P2", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
    initialSelectionAction: { type: "move", actorId: "U1", from: { row: 1, col: 1 }, to: { row: 2, col: 1 } },
    participantCopyMode: "viewer_as_side_to_move",
  });

  assert.equal(handle.status, "pending");
  assert.match(handle.result.game.id, /^game-[0-9a-f]+$/);
  assert.equal(store.getGameViewModel(handle.result.game.id)?.initialSelectionAction?.actorId, "U1");
  assert.equal(branchRequest.gameId, handle.result.game.id);

  const committed = await handle.committed;
  assert.equal(committed.game.id, handle.result.game.id);
  assert.equal(committed.game.notifications.at(-1), "History branch launched");
});

test("sync store defers move confirmation until optimistic game creation commits", async () => {
  const { transport, games } = createTransportHarness();
  let resolveCreate = null;
  let resolveApply = null;
  const calls = [];

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: ({ shouldDeferCommandSend }) => ({
      ...transport,
      createGame: async ({ gameId }) => {
        calls.push(`create:${gameId}`);
        return new Promise((resolve) => {
          resolveCreate = () => {
            const game = {
              ...(games.get(gameId) ?? {}),
              id: gameId,
              notifications: ["Game created"],
            };
            resolve(game);
          };
        });
      },
      applyGameAction: async ({ gameId }) => {
        const shouldDefer = shouldDeferCommandSend(gameId, { kind: "apply" });
        calls.push(shouldDefer ? `apply-deferred:${gameId}` : `apply-sent:${gameId}`);
        if (shouldDefer) {
          transport.applyLiveGameUpdate({
            game: {
              ...(games.get(gameId) ?? {}),
              pendingMoves: [{ notation: "MOVE 1" }],
              pendingCommandCount: 1,
            },
          });
          return {
            ok: true,
            accepted: true,
            clientCommandId: "cmd-move",
            state: games.get(gameId)?.currentSnapshot ?? null,
            legalActions: games.get(gameId)?.legalActions ?? [],
            game: games.get(gameId),
          };
        }
        return new Promise((resolve) => {
          resolveApply = () => {
            resolve({
              ok: true,
              accepted: true,
              clientCommandId: "cmd-move",
              state: games.get(gameId)?.currentSnapshot ?? null,
              legalActions: games.get(gameId)?.legalActions ?? [],
              game: games.get(gameId),
            });
          };
        });
      },
      flushPendingCommands: (gameId) => {
        calls.push(`flush:${gameId}`);
        resolveApply?.();
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  const moveHandle = await store.applyGameAction({
    gameId: createHandle.result.id,
    state: createHandle.result.currentSnapshot,
    action: { type: "pass" },
  });

  assert.equal(createHandle.status, "pending");
  assert.equal(moveHandle.status, "pending");
  assert.deepEqual(calls, [`create:${createHandle.result.id}`, `apply-deferred:${createHandle.result.id}`]);

  resolveCreate?.();
  await createHandle.committed;
  await moveHandle.committed;

  assert.deepEqual(calls, [
    `create:${createHandle.result.id}`,
    `apply-deferred:${createHandle.result.id}`,
    `flush:${createHandle.result.id}`,
  ]);
});

test("sync store fails create and queued optimistic commands when the server responds with a mismatched game id", async () => {
  const { transport, games } = createTransportHarness();
  const calls = [];

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: ({ shouldDeferCommandSend }) => ({
      ...transport,
      createGame: async ({ gameId }) => {
        calls.push(`create:${gameId}`);
        return {
          ...(games.get(`server-${gameId}`) ?? {}),
          id: `server-${gameId}`,
          notifications: ["Game created on wrong id"],
        };
      },
      applyGameAction: async ({ gameId }) => {
        const shouldDefer = shouldDeferCommandSend(gameId, { kind: "apply" });
        calls.push(shouldDefer ? `apply-deferred:${gameId}` : `apply-sent:${gameId}`);
        return {
          ok: true,
          accepted: true,
          clientCommandId: "cmd-move",
          state: games.get(gameId)?.currentSnapshot ?? null,
          legalActions: games.get(gameId)?.legalActions ?? [],
          game: games.get(gameId),
        };
      },
      discardPendingCommands: (gameId) => {
        calls.push(`discard:${gameId}`);
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  const moveHandle = await store.applyGameAction({
    gameId: createHandle.result.id,
    state: createHandle.result.currentSnapshot,
    action: { type: "pass" },
  });

  await assert.rejects(createHandle.committed, (error) => error?.code === "game_id_mismatch");
  await assert.rejects(moveHandle.committed, (error) => error?.code === "game_id_mismatch");
  assert.equal(createHandle.status, "failed");
  assert.equal(moveHandle.status, "failed");
  assert.deepEqual(calls, [
    `create:${createHandle.result.id}`,
    `apply-deferred:${createHandle.result.id}`,
    `discard:${createHandle.result.id}`,
  ]);
});

test("sync store fails history branch and queued optimistic commands when the server responds with a mismatched game id", async () => {
  const { transport, games } = createTransportHarness();
  const calls = [];
  games.set("game-source", {
    id: "game-source",
    myRole: "Player 1",
    player1: { identityId: "id-test", connected: true },
    player2: null,
    viewers: [],
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: ({ shouldDeferCommandSend }) => ({
      ...transport,
      launchHistoryBranch: async ({ gameId }) => {
        calls.push(`branch:${gameId}`);
        return {
          game: {
            ...(games.get(`server-${gameId}`) ?? {}),
            id: `server-${gameId}`,
            notifications: ["Branch created on wrong id"],
          },
        };
      },
      applyGameAction: async ({ gameId }) => {
        const shouldDefer = shouldDeferCommandSend(gameId, { kind: "apply" });
        calls.push(shouldDefer ? `apply-deferred:${gameId}` : `apply-sent:${gameId}`);
        return {
          ok: true,
          accepted: true,
          clientCommandId: "cmd-branch-move",
          state: games.get(gameId)?.currentSnapshot ?? null,
          legalActions: games.get(gameId)?.legalActions ?? [],
          game: games.get(gameId),
        };
      },
      discardPendingCommands: (gameId) => {
        calls.push(`discard:${gameId}`);
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const branchHandle = store.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      resultingState: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
    initialSelectionAction: { type: "move", actorId: "U1", from: { row: 1, col: 1 }, to: { row: 2, col: 1 } },
    participantCopyMode: "copy_source_participants",
  });
  const moveHandle = await store.applyGameAction({
    gameId: branchHandle.result.game.id,
    state: branchHandle.result.game.currentSnapshot,
    action: { type: "pass" },
  });

  await assert.rejects(branchHandle.committed, (error) => error?.code === "game_id_mismatch");
  await assert.rejects(moveHandle.committed, (error) => error?.code === "game_id_mismatch");
  assert.equal(branchHandle.status, "failed");
  assert.equal(moveHandle.status, "failed");
  assert.deepEqual(calls, [
    `branch:${branchHandle.result.game.id}`,
    `apply-deferred:${branchHandle.result.game.id}`,
    `discard:${branchHandle.result.game.id}`,
  ]);
});
