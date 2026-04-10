import test from "node:test";
import assert from "node:assert/strict";

import { createSyncStore } from "../shell/sync-store.js";
import { buildComputerPlayerDerivedTurnKey } from "../shell/computer-player-runtime.js";
import { LIVE_TRANSPORT_STATE_KEY } from "../shell/persistence.js";
import { buildHistoryBranchSeedFromGame } from "../shell/scenarios.js";
import apiWorker from "../../api/index.js";
import { createFakeD1 } from "../../../packages/api-handler/test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../../../packages/api-handler/test/support/fake-game-rooms.mjs";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const createApiEnv = () => {
  const env = {
    DB: createFakeD1(),
    GAME_ROOMS: null,
  };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  return env;
};

const toAbsoluteUrl = (url) => (String(url).startsWith("http") ? String(url) : `https://example.test${String(url)}`);

const createFakeClock = ({ startMs = Date.parse("2026-04-03T00:00:00.000Z") } = {}) => {
  let currentMs = startMs;
  let nextTimerId = 1;
  const timers = new Map();

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const runDueTimers = async () => {
    while (true) {
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.at <= currentMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (dueTimers.length === 0) {
        break;
      }
      const [timerId, timer] = dueTimers[0];
      timers.delete(timerId);
      timer.callback();
      await flushMicrotasks();
    }
  };

  return {
    now: () => currentMs,
    setTimeout: (callback, delay = 0) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        at: currentMs + Math.max(0, Number(delay) || 0),
      });
      return timerId;
    },
    clearTimeout: (timerId) => {
      timers.delete(timerId);
    },
    advanceBy: async (delayMs) => {
      currentMs += Math.max(0, Number(delayMs) || 0);
      await runDueTimers();
    },
  };
};

const createTrackedSyncStore = ({
  env = createApiEnv(),
  storage = createMemoryStorage(),
  createComputerPlayerRuntime,
  now,
  setTimeout,
  clearTimeout,
} = {}) => {
  const requests = [];
  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
      requests.push({
        url: String(url),
        method: init.method || "GET",
        body: parsedBody,
      });
      return apiWorker.fetch(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    ...(now ? { now } : {}),
    ...(setTimeout ? { setTimeout } : {}),
    ...(clearTimeout ? { clearTimeout } : {}),
    ...(createComputerPlayerRuntime ? { createComputerPlayerRuntime } : {}),
  });
  return { env, storage, requests, store };
};

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for integration condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

test("integration sync store keeps the optimistic game id when creating and immediately moving against the real API", async () => {
  const { requests, store } = createTrackedSyncStore();

  const createHandle = store.createGame({ selfPlayMode: false });
  const requestedGameId = createHandle.result.id;

  const createdGame = await Promise.race([
    createHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("create commit timed out")), 2_000)),
  ]);

  assert.equal(createdGame.id, requestedGameId);
  const createRequest = requests.find((entry) => entry.url === "/api/shell/games" && entry.method === "POST");
  assert.equal(createRequest?.body?.gameId, requestedGameId);

  const action = createdGame.legalActions.find((entry) => entry.type !== "pass") ?? createdGame.legalActions[0];
  const moveHandle = await store.applyGameAction({
    gameId: requestedGameId,
    state: createdGame.currentSnapshot,
    action,
  });
  const committedMove = await Promise.race([
    moveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("move commit timed out")), 2_000)),
  ]);

  const applyRequest = requests.find((entry) => entry.url === `/api/shell/games/${requestedGameId}/apply` && entry.method === "POST");
  assert.ok(applyRequest);
  assert.equal(committedMove.accepted, true);
  assert.equal(store.getGameViewModel(requestedGameId)?.moves.length, 1);
});

test("integration sync store keeps the optimistic game id stable across history branch creation and immediate moves", async () => {
  const { requests, store } = createTrackedSyncStore();

  const sourceHandle = store.createGame({ selfPlayMode: false });
  const sourceGame = await Promise.race([
    sourceHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source create commit timed out")), 2_000)),
  ]);

  const sourceAction = sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? sourceGame.legalActions[0];
  const sourceMoveHandle = await store.applyGameAction({
    gameId: sourceGame.id,
    state: sourceGame.currentSnapshot,
    action: sourceAction,
  });
  await Promise.race([
    sourceMoveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source move commit timed out")), 2_000)),
  ]);

  const sourceView = store.getGameViewModel(sourceGame.id);
  const branchSeed = buildHistoryBranchSeedFromGame(sourceView, 0);
  const branchHandle = store.launchHistoryBranch({
    sourceGameId: sourceGame.id,
    sourceMoveIndex: 0,
    scenario: branchSeed.scenario,
    initialSelectionAction: branchSeed.initialSelectionAction,
    participantCopyMode: branchSeed.participantCopyMode,
  });
  const requestedBranchId = branchHandle.result.game.id;

  const branchGame = await Promise.race([
    branchHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("branch create commit timed out")), 2_000)),
  ]);

  assert.equal(branchGame.game.id, requestedBranchId);
  const branchRequest = requests.find((entry) => entry.url === "/api/shell/history/branch" && entry.method === "POST");
  assert.equal(branchRequest?.body?.gameId, requestedBranchId);

  const branchAction = branchGame.game.legalActions.find((entry) => entry.type !== "pass") ?? branchGame.game.legalActions[0];
  const branchMoveHandle = await store.applyGameAction({
    gameId: requestedBranchId,
    state: branchGame.game.currentSnapshot,
    action: branchAction,
  });
  const committedBranchMove = await Promise.race([
    branchMoveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("branch move commit timed out")), 2_000)),
  ]);

  const branchApplyRequest = requests.find(
    (entry) => entry.url === `/api/shell/games/${requestedBranchId}/apply` && entry.method === "POST",
  );
  assert.ok(branchApplyRequest);
  assert.equal(committedBranchMove.accepted, true);
  assert.equal(store.getGameViewModel(requestedBranchId)?.moves.length, branchGame.game.moves.length + 1);
});

test("integration sync store hydrates a pending history branch from shared storage before the server commit lands", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/history/branch" && (init.method || "GET") === "POST") {
      await branchReady;
    }
    return apiWorker.fetch(
      new Request(toAbsoluteUrl(url), {
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
      }),
      env,
    );
  };
  const createSyncClient = () => ({
    connectGame() {},
    disconnectGame() {},
    disconnectAll() {},
    getDesiredGameIds: () => [],
  });
  const sourceStore = createSyncStore({ storage, fetcher, createSyncClient });

  const sourceHandle = sourceStore.createGame({ selfPlayMode: false });
  const sourceGame = await Promise.race([
    sourceHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source create commit timed out")), 2_000)),
  ]);

  const sourceAction = sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? sourceGame.legalActions[0];
  const sourceMoveHandle = await sourceStore.applyGameAction({
    gameId: sourceGame.id,
    state: sourceGame.currentSnapshot,
    action: sourceAction,
  });
  await Promise.race([
    sourceMoveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source move commit timed out")), 2_000)),
  ]);

  const sourceView = sourceStore.getGameViewModel(sourceGame.id);
  const branchSeed = buildHistoryBranchSeedFromGame(sourceView, 0);
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: sourceGame.id,
    sourceMoveIndex: 0,
    scenario: branchSeed.scenario,
    initialSelectionAction: branchSeed.initialSelectionAction,
    participantCopyMode: branchSeed.participantCopyMode,
  });
  const popupStore = createSyncStore({ storage, fetcher, createSyncClient });

  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);
  assert.equal(pendingBranch.notifications[0], "History branch pending sync");
  assert.equal(pendingBranch.initialSelectionAction?.type, branchSeed.initialSelectionAction?.type ?? null);

  releaseBranch?.();
  const committedBranch = await Promise.race([
    branchHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("branch create commit timed out")), 2_000)),
  ]);

  assert.equal(committedBranch.game.id, branchHandle.result.game.id);
});

test("integration sync store exposes a pending game handle until optimistic creation commits", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  let releaseCreate = null;
  const createReleased = new Promise((resolve) => {
    releaseCreate = resolve;
  });

  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      if (String(url) === "/api/shell/games" && (init.method || "GET") === "POST") {
        await createReleased;
      }
      return apiWorker.fetch(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.createGame({ selfPlayMode: false });
  assert.equal(store.getGameHandle(handle.result.id), handle);

  releaseCreate?.();
  const committedGame = await handle.committed;
  assert.equal(store.getGameHandle(committedGame.id)?.status, "committed");
  assert.equal(store.getGameHandle(committedGame.id)?.result?.id, committedGame.id);
});

test("integration sync store enters and exits history locally before delayed server history sync resolves", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  let releaseHistory = null;
  let releaseLive = null;
  const historyReady = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  const liveReady = new Promise((resolve) => {
    releaseLive = resolve;
  });

  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      if (String(url).includes("/history") && (init.method || "GET") === "POST") {
        await historyReady;
      }
      if (String(url).includes("/live") && (init.method || "GET") === "POST") {
        await liveReady;
      }
      return apiWorker.fetch(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  const game = await Promise.race([
    createHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("create commit timed out")), 2_000)),
  ]);

  const action = game.legalActions.find((entry) => entry.type !== "pass") ?? game.legalActions[0];
  const moveHandle = await store.applyGameAction({
    gameId: game.id,
    state: game.currentSnapshot,
    action,
  });
  await Promise.race([
    moveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("move commit timed out")), 2_000)),
  ]);

  const historyHandle = store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  assert.equal(historyHandle.status, "committed");
  assert.equal(historyHandle.result.inHistoryMode, true);
  assert.equal(store.getGameViewModel(game.id)?.inHistoryMode, true);

  releaseHistory?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const liveHandle = store.returnToLive({ gameId: game.id });
  assert.equal(liveHandle.status, "committed");
  assert.equal(liveHandle.result.inHistoryMode, false);
  assert.equal(store.getGameViewModel(game.id)?.inHistoryMode, false);

  releaseLive?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("integration sync store lets an already-created second store discover a pending history branch", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/history/branch" && (init.method || "GET") === "POST") {
      await branchReady;
    }
    return apiWorker.fetch(
      new Request(toAbsoluteUrl(url), {
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
      }),
      env,
    );
  };
  const createSyncClient = () => ({
    connectGame() {},
    disconnectGame() {},
    disconnectAll() {},
    getDesiredGameIds: () => [],
  });
  const popupStore = createSyncStore({ storage, fetcher, createSyncClient });
  const sourceStore = createSyncStore({ storage, fetcher, createSyncClient });

  const sourceHandle = sourceStore.createGame({ selfPlayMode: false });
  const sourceGame = await Promise.race([
    sourceHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source create commit timed out")), 2_000)),
  ]);

  const sourceAction = sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? sourceGame.legalActions[0];
  const sourceMoveHandle = await sourceStore.applyGameAction({
    gameId: sourceGame.id,
    state: sourceGame.currentSnapshot,
    action: sourceAction,
  });
  await Promise.race([
    sourceMoveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source move commit timed out")), 2_000)),
  ]);

  const sourceView = sourceStore.getGameViewModel(sourceGame.id);
  const branchSeed = buildHistoryBranchSeedFromGame(sourceView, 0);
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: sourceGame.id,
    sourceMoveIndex: 0,
    scenario: branchSeed.scenario,
    initialSelectionAction: branchSeed.initialSelectionAction,
    participantCopyMode: branchSeed.participantCopyMode,
  });

  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);
  assert.equal(pendingBranch.notifications[0], "History branch pending sync");

  releaseBranch?.();
  const committedBranch = await Promise.race([
    branchHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("branch create commit timed out")), 2_000)),
  ]);

  assert.equal(committedBranch.game.id, branchHandle.result.game.id);
});

test("integration sync store keeps a failed shared-storage branch stub hydratable with a failure banner", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/history/branch" && (init.method || "GET") === "POST") {
      await branchReady;
      return new Response(JSON.stringify({ ok: false, error: "forced_branch_failure" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return apiWorker.fetch(
      new Request(toAbsoluteUrl(url), {
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
      }),
      env,
    );
  };
  const createSyncClient = () => ({
    connectGame() {},
    disconnectGame() {},
    disconnectAll() {},
    getDesiredGameIds: () => [],
  });
  const sourceStore = createSyncStore({ storage, fetcher, createSyncClient });

  const sourceHandle = sourceStore.createGame({ selfPlayMode: false });
  const sourceGame = await Promise.race([
    sourceHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source create commit timed out")), 2_000)),
  ]);

  const sourceAction = sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? sourceGame.legalActions[0];
  const sourceMoveHandle = await sourceStore.applyGameAction({
    gameId: sourceGame.id,
    state: sourceGame.currentSnapshot,
    action: sourceAction,
  });
  await Promise.race([
    sourceMoveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("source move commit timed out")), 2_000)),
  ]);

  const sourceView = sourceStore.getGameViewModel(sourceGame.id);
  const branchSeed = buildHistoryBranchSeedFromGame(sourceView, 0);
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: sourceGame.id,
    sourceMoveIndex: 0,
    scenario: branchSeed.scenario,
    initialSelectionAction: branchSeed.initialSelectionAction,
    participantCopyMode: branchSeed.participantCopyMode,
  });
  const popupStore = createSyncStore({ storage, fetcher, createSyncClient });

  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);

  releaseBranch?.();
  await assert.rejects(
    Promise.race([
      branchHandle.committed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("branch failure timed out")), 2_000)),
    ]),
    /forced_branch_failure/,
  );
  const failedBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(failedBranch.id, branchHandle.result.game.id);
  assert.equal(failedBranch.notifications[0], "History branch creation failed");
  assert.equal(popupStore.getFailedOperations(branchHandle.result.game.id)[0]?.error?.message, "forced_branch_failure");
});

test("integration sync store keeps a failed create-game stub locally hydratable with an alert banner", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  const syncClientCalls = [];
  const desiredGameIds = [];
  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      if (String(url) === "/api/shell/games" && (init.method || "GET") === "POST") {
        return new Response(JSON.stringify({ ok: false, error: "forced_create_failure" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return apiWorker.fetch(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame: (gameId) => {
        if (!desiredGameIds.includes(gameId)) {
          desiredGameIds.push(gameId);
        }
        syncClientCalls.push(["connect", gameId]);
      },
      disconnectGame: (gameId) => {
        const index = desiredGameIds.indexOf(gameId);
        if (index >= 0) {
          desiredGameIds.splice(index, 1);
        }
        syncClientCalls.push(["disconnect", gameId]);
      },
      disconnectAll: () => {
        desiredGameIds.length = 0;
        syncClientCalls.push(["disconnectAll"]);
      },
      getDesiredGameIds: () => [...desiredGameIds],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  store.setActiveGameId(createHandle.result.id);

  await assert.rejects(
    Promise.race([
      createHandle.committed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("create failure timed out")), 2_000)),
    ]),
    /forced_create_failure/,
  );

  const failedGame = await store.loadGame(createHandle.result.id, { openAsViewer: false });
  assert.equal(failedGame.id, createHandle.result.id);
  assert.equal(
    store.getFailedOperations(createHandle.result.id)[0]?.error?.message,
    "Game creation failed. The server could not create this game. Return home and try again.",
  );
  assert.equal(failedGame.notifications[0], "Game creation failed");
  assert.deepEqual(syncClientCalls, [
    ["connect", createHandle.result.id],
    ["disconnect", createHandle.result.id],
  ]);
});

test("integration sync store keeps optimistic revert request ids aligned through auto-approved server commits", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  const requests = [];
  let releaseRevertRequest = null;
  const revertRequestReleased = new Promise((resolve) => {
    releaseRevertRequest = resolve;
  });

  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
      requests.push({
        url: String(url),
        method: init.method || "GET",
        body: parsedBody,
      });
      if (String(url).includes("/revert-request") && (init.method || "GET") === "POST") {
        await revertRequestReleased;
      }
      return apiWorker.fetch(
        new Request(toAbsoluteUrl(url), {
          method: init.method || "GET",
          headers: init.headers,
          body: init.body,
        }),
        env,
      );
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  const createdGame = await createHandle.committed;
  const action = createdGame.legalActions.find((entry) => entry.type !== "pass") ?? createdGame.legalActions[0];
  const moveHandle = await store.applyGameAction({
    gameId: createdGame.id,
    state: createdGame.currentSnapshot,
    action,
  });
  await moveHandle.committed;

  const revertHandle = store.requestRevertToMove({
    gameId: createdGame.id,
    targetMoveId: store.getGameViewModel(createdGame.id).latestActiveMoveId,
  });

  const optimisticRequestId = revertHandle.id.replace(/^revert-request:/, "");
  assert.match(optimisticRequestId, /^revert-/);
  assert.equal(store.getGameViewModel(createdGame.id).pendingRevertRequest, null);
  assert.equal(store.getGameViewModel(createdGame.id).moves.at(-1)?.undone, true);

  releaseRevertRequest();
  const committedGame = await revertHandle.committed;
  const request = requests.find((entry) => entry.url.endsWith("/revert-request") && entry.method === "POST");
  assert.equal(request?.body?.requestId, optimisticRequestId);
  assert.equal(committedGame.pendingRevertRequest, null);
  assert.equal(committedGame.moves.at(-1)?.undone, true);
  assert.equal(store.getGameViewModel(createdGame.id).pendingRevertRequest, null);
  assert.equal(store.getGameViewModel(createdGame.id).moves.at(-1)?.undone, true);
});

test("integration sync store keeps optimistic revert request ids aligned when approval is required", async () => {
  const env = createApiEnv();
  const ownerStorage = createMemoryStorage();
  const guestStorage = createMemoryStorage();
  const requests = [];
  let releaseRevertRequest = null;
  const revertRequestReleased = new Promise((resolve) => {
    releaseRevertRequest = resolve;
  });

  const createStore = (storage) =>
    createSyncStore({
      storage,
      fetcher: async (url, init = {}) => {
        const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
        requests.push({
          url: String(url),
          method: init.method || "GET",
          body: parsedBody,
          identityId: storage.getItem("righelt.identity.id.v1"),
        });
        if (String(url).includes("/revert-request") && (init.method || "GET") === "POST") {
          await revertRequestReleased;
        }
        return apiWorker.fetch(
          new Request(toAbsoluteUrl(url), {
            method: init.method || "GET",
            headers: init.headers,
            body: init.body,
          }),
          env,
        );
      },
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });

  const ownerStore = createStore(ownerStorage);
  const guestStore = createStore(guestStorage);

  const createHandle = ownerStore.createGame({ selfPlayMode: false });
  const createdGame = await createHandle.committed;
  const guestJoin = await guestStore.joinGame({ gameId: createdGame.id, mode: "player", inviteFromRole: null });
  assert.equal(guestJoin.pendingApproval, true);

  const ownerGameWithJoinRequest = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const pendingRequester = ownerGameWithJoinRequest.pendingJoinRequests?.[0]?.identityId ?? null;
  assert.ok(pendingRequester);
  const approvedJoin = await ownerStore.approvePendingRequest({ gameId: createdGame.id, requesterIdentityId: pendingRequester });
  assert.equal(approvedJoin.ok, true);

  const refreshedOwnerGame = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const action = refreshedOwnerGame.legalActions.find((entry) => entry.type !== "pass") ?? refreshedOwnerGame.legalActions[0];
  const moveHandle = await ownerStore.applyGameAction({
    gameId: refreshedOwnerGame.id,
    state: refreshedOwnerGame.currentSnapshot,
    action,
  });
  await moveHandle.committed;

  const revertHandle = ownerStore.requestRevertToMove({
    gameId: refreshedOwnerGame.id,
    targetMoveId: ownerStore.getGameViewModel(refreshedOwnerGame.id).latestActiveMoveId,
  });

  const optimisticRequestId = revertHandle.result.pendingRevertRequest.requestId;
  assert.match(optimisticRequestId, /^revert-/);
  assert.equal(ownerStore.getGameViewModel(refreshedOwnerGame.id).pendingRevertRequest.requestId, optimisticRequestId);
  assert.equal(ownerStore.getGameViewModel(refreshedOwnerGame.id).myPendingRevertRequest.requestId, optimisticRequestId);

  releaseRevertRequest();
  const committedGame = await revertHandle.committed;
  const request = requests.find(
    (entry) =>
      entry.url.endsWith(`/games/${createdGame.id}/revert-request`) &&
      entry.method === "POST" &&
      entry.identityId === ownerStore.getIdentityId(),
  );
  assert.equal(request?.body?.requestId, optimisticRequestId);
  assert.equal(committedGame.pendingRevertRequest?.requestId, optimisticRequestId);
  assert.equal(committedGame.myPendingRevertRequest?.requestId, optimisticRequestId);
  assert.equal(committedGame.moves.at(-1)?.undone, undefined);
});

test("integration sync store exits history mode when the approver accepts an undo request", async () => {
  const env = createApiEnv();
  const ownerStorage = createMemoryStorage();
  const guestStorage = createMemoryStorage();

  const createStore = (storage) =>
    createSyncStore({
      storage,
      fetcher: async (url, init = {}) =>
        apiWorker.fetch(
          new Request(toAbsoluteUrl(url), {
            method: init.method || "GET",
            headers: init.headers,
            body: init.body,
          }),
          env,
        ),
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });

  const ownerStore = createStore(ownerStorage);
  const guestStore = createStore(guestStorage);

  const createdGame = await ownerStore.createGame({ selfPlayMode: false }).committed;
  const guestJoin = await guestStore.joinGame({ gameId: createdGame.id, mode: "player", inviteFromRole: null });
  assert.equal(guestJoin.pendingApproval, true);

  const ownerGameWithJoinRequest = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const pendingRequester = ownerGameWithJoinRequest.pendingJoinRequests?.[0]?.identityId ?? null;
  assert.ok(pendingRequester);
  const approvedJoin = await ownerStore.approvePendingRequest({ gameId: createdGame.id, requesterIdentityId: pendingRequester });
  assert.equal(approvedJoin.ok, true);

  const refreshedOwnerGame = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const action = refreshedOwnerGame.legalActions.find((entry) => entry.type !== "pass") ?? refreshedOwnerGame.legalActions[0];
  const moveHandle = await ownerStore.applyGameAction({
    gameId: refreshedOwnerGame.id,
    state: refreshedOwnerGame.currentSnapshot,
    action,
  });
  await moveHandle.committed;

  const targetMoveId = ownerStore.getGameViewModel(createdGame.id).latestActiveMoveId;
  const revertHandle = ownerStore.requestRevertToMove({
    gameId: createdGame.id,
    targetMoveId,
  });
  const requestedGame = await revertHandle.committed;
  const requestId = requestedGame.pendingRevertRequest?.requestId ?? null;
  assert.ok(requestId);

  await guestStore.loadGame(createdGame.id, { openAsViewer: false });
  const historyHandle = guestStore.selectHistoryMove({ gameId: createdGame.id, moveIndex: 0 });
  assert.equal(historyHandle.result.inHistoryMode, true);
  assert.equal(guestStore.getGameViewModel(createdGame.id)?.inHistoryMode, true);

  const approved = await guestStore.approveRevertRequest({ gameId: createdGame.id, requestId }).committed;
  assert.equal(approved.inHistoryMode, false);
  assert.equal(approved.historyIndex, null);
  assert.equal(guestStore.getGameViewModel(createdGame.id)?.inHistoryMode, false);
  assert.equal(guestStore.getGameViewModel(createdGame.id)?.historyIndex, null);
});

test("integration sync store keeps the approver in history mode when an undo request is rejected", async () => {
  const env = createApiEnv();
  const ownerStorage = createMemoryStorage();
  const guestStorage = createMemoryStorage();

  const createStore = (storage) =>
    createSyncStore({
      storage,
      fetcher: async (url, init = {}) =>
        apiWorker.fetch(
          new Request(toAbsoluteUrl(url), {
            method: init.method || "GET",
            headers: init.headers,
            body: init.body,
          }),
          env,
        ),
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });

  const ownerStore = createStore(ownerStorage);
  const guestStore = createStore(guestStorage);

  const createdGame = await ownerStore.createGame({ selfPlayMode: false }).committed;
  const guestJoin = await guestStore.joinGame({ gameId: createdGame.id, mode: "player", inviteFromRole: null });
  assert.equal(guestJoin.pendingApproval, true);

  const ownerGameWithJoinRequest = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const pendingRequester = ownerGameWithJoinRequest.pendingJoinRequests?.[0]?.identityId ?? null;
  assert.ok(pendingRequester);
  const approvedJoin = await ownerStore.approvePendingRequest({ gameId: createdGame.id, requesterIdentityId: pendingRequester });
  assert.equal(approvedJoin.ok, true);

  const refreshedOwnerGame = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const action = refreshedOwnerGame.legalActions.find((entry) => entry.type !== "pass") ?? refreshedOwnerGame.legalActions[0];
  const moveHandle = await ownerStore.applyGameAction({
    gameId: refreshedOwnerGame.id,
    state: refreshedOwnerGame.currentSnapshot,
    action,
  });
  await moveHandle.committed;

  const targetMoveId = ownerStore.getGameViewModel(createdGame.id).latestActiveMoveId;
  const revertHandle = ownerStore.requestRevertToMove({
    gameId: createdGame.id,
    targetMoveId,
  });
  const requestedGame = await revertHandle.committed;
  const requestId = requestedGame.pendingRevertRequest?.requestId ?? null;
  assert.ok(requestId);

  await guestStore.loadGame(createdGame.id, { openAsViewer: false });
  const historyHandle = guestStore.selectHistoryMove({ gameId: createdGame.id, moveIndex: 0 });
  assert.equal(historyHandle.result.inHistoryMode, true);

  const rejected = await guestStore.rejectRevertRequest({ gameId: createdGame.id, requestId }).committed;
  assert.equal(rejected.inHistoryMode, true);
  assert.equal(rejected.historyIndex, 0);
  assert.equal(rejected.pendingRevertRequest, null);
  assert.equal(guestStore.getGameViewModel(createdGame.id)?.inHistoryMode, true);
  assert.equal(guestStore.getGameViewModel(createdGame.id)?.historyIndex, 0);
});

test("integration sync store keeps the requester in history mode when an undo request is rescinded", async () => {
  const env = createApiEnv();
  const ownerStorage = createMemoryStorage();
  const guestStorage = createMemoryStorage();

  const createStore = (storage) =>
    createSyncStore({
      storage,
      fetcher: async (url, init = {}) =>
        apiWorker.fetch(
          new Request(toAbsoluteUrl(url), {
            method: init.method || "GET",
            headers: init.headers,
            body: init.body,
          }),
          env,
        ),
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });

  const ownerStore = createStore(ownerStorage);
  const guestStore = createStore(guestStorage);

  const createdGame = await ownerStore.createGame({ selfPlayMode: false }).committed;
  const guestJoin = await guestStore.joinGame({ gameId: createdGame.id, mode: "player", inviteFromRole: null });
  assert.equal(guestJoin.pendingApproval, true);

  const ownerGameWithJoinRequest = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const pendingRequester = ownerGameWithJoinRequest.pendingJoinRequests?.[0]?.identityId ?? null;
  assert.ok(pendingRequester);
  const approvedJoin = await ownerStore.approvePendingRequest({ gameId: createdGame.id, requesterIdentityId: pendingRequester });
  assert.equal(approvedJoin.ok, true);

  const refreshedOwnerGame = await ownerStore.loadGame(createdGame.id, { openAsViewer: false });
  const action = refreshedOwnerGame.legalActions.find((entry) => entry.type !== "pass") ?? refreshedOwnerGame.legalActions[0];
  const moveHandle = await ownerStore.applyGameAction({
    gameId: refreshedOwnerGame.id,
    state: refreshedOwnerGame.currentSnapshot,
    action,
  });
  await moveHandle.committed;

  const targetMoveId = ownerStore.getGameViewModel(createdGame.id).latestActiveMoveId;
  const revertHandle = ownerStore.requestRevertToMove({
    gameId: createdGame.id,
    targetMoveId,
  });
  const requestedGame = await revertHandle.committed;
  const requestId = requestedGame.pendingRevertRequest?.requestId ?? null;
  assert.ok(requestId);

  const historyHandle = ownerStore.selectHistoryMove({ gameId: createdGame.id, moveIndex: 0 });
  assert.equal(historyHandle.result.inHistoryMode, true);

  const rescinded = await ownerStore.rescindRevertRequest({ gameId: createdGame.id, requestId }).committed;
  assert.equal(rescinded.inHistoryMode, true);
  assert.equal(rescinded.historyIndex, 0);
  assert.equal(rescinded.pendingRevertRequest, null);
  assert.equal(ownerStore.getGameViewModel(createdGame.id)?.inHistoryMode, true);
  assert.equal(ownerStore.getGameViewModel(createdGame.id)?.historyIndex, 0);
});

test("integration sync store auto-runs the opening computer-player turn for Player 2 starts", async () => {
  const clock = createFakeClock();
  const runtimeRequests = [];
  const { requests, store } = createTrackedSyncStore({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createComputerPlayerRuntime: () => ({
      async selectMove(request) {
        runtimeRequests.push(request);
        return {
          action: { type: "pass" },
          diagnostics: {
            selectedAction: { key: "pass" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  const createHandle = store.createGame({
    computerPlayer: {
      botId: "babs",
      botSchemaVersion: 1,
      displayName: "Babs the Beginner",
      animal: "bunny",
      skillLabel: "Beginner",
      styleLabel: "Balanced",
      humanSeat: "Player 2",
      botSeat: "Player 1",
    },
  });
  const createdGame = await createHandle.committed;

  store.setActiveGameId(createdGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "thinking");
  assert.equal(
    requests.some((entry) => entry.url === `/api/shell/games/${createdGame.id}/apply` && entry.method === "POST"),
    false,
  );

  await clock.advanceBy(599);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "thinking");
  assert.equal(
    requests.some((entry) => entry.url === `/api/shell/games/${createdGame.id}/apply` && entry.method === "POST"),
    false,
  );

  await clock.advanceBy(1);
  await waitFor(() => (store.getGameViewModel(createdGame.id)?.moves.length ?? 0) === 1);

  const game = store.getGameViewModel(createdGame.id);
  assert.equal(runtimeRequests.length, 1);
  assert.equal(game.currentTurn.playerSeat, "Player 2");
  const applyRequest = requests.find((entry) => entry.url === `/api/shell/games/${createdGame.id}/apply` && entry.method === "POST");
  assert.ok(applyRequest);
  assert.match(applyRequest.body.clientCommandId, /^bot:/);
});

test("integration sync store keeps computer-player failures recoverable and retries inline", async () => {
  const clock = createFakeClock();
  let attempts = 0;
  const { requests, store } = createTrackedSyncStore({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("Worker unavailable");
          error.code = "computer_player_worker_unavailable";
          throw error;
        }
        return {
          action: { type: "pass" },
          diagnostics: {
            selectedAction: { key: "pass" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  const createHandle = store.createGame({
    computerPlayer: {
      botId: "tau",
      botSchemaVersion: 1,
      displayName: "Tau the Tenacious",
      animal: "tortoise",
      skillLabel: "Medium",
      styleLabel: "Defensive",
      humanSeat: "Player 2",
      botSeat: "Player 1",
    },
  });
  const createdGame = await createHandle.committed;

  store.setActiveGameId(createdGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "thinking");
  await clock.advanceBy(799);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "thinking");
  await clock.advanceBy(1);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "failed");

  assert.equal(
    requests.some((entry) => entry.url === `/api/shell/games/${createdGame.id}/apply` && entry.method === "POST"),
    false,
  );
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.error?.message, "Worker unavailable");

  store.retryComputerPlayerTurn({ gameId: createdGame.id });
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.status, "thinking");
  await clock.advanceBy(799);
  assert.equal((store.getGameViewModel(createdGame.id)?.moves.length ?? 0), 0);
  await clock.advanceBy(1);
  await waitFor(() => (store.getGameViewModel(createdGame.id)?.moves.length ?? 0) === 1);

  assert.equal(attempts, 2);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id), null);
});

test("integration sync store resumes a persisted computer-player think deadline after reload", async () => {
  const env = createApiEnv();
  const storage = createMemoryStorage();
  const firstStore = createTrackedSyncStore({ env, storage }).store;
  const createHandle = firstStore.createGame({
    computerPlayer: {
      botId: "babs",
      botSchemaVersion: 1,
      displayName: "Babs the Beginner",
      animal: "bunny",
      skillLabel: "Beginner",
      styleLabel: "Balanced",
      humanSeat: "Player 2",
      botSeat: "Player 1",
    },
  });
  const createdGame = await createHandle.committed;
  const thinkingStartedAt = "2026-04-03T00:00:00.000Z";
  const minimumVisibleUntil = "2026-04-03T00:00:00.600Z";
  storage.setItem(
    LIVE_TRANSPORT_STATE_KEY,
    JSON.stringify({
      games: [],
      warningCode: null,
      pendingMutationsByGameId: {},
      computerPlayerRuntimeByGameId: {
        [createdGame.id]: {
          activeTurnKey: buildComputerPlayerDerivedTurnKey(createdGame),
          status: "thinking",
          error: null,
          retryCount: 0,
          updatedAt: thinkingStartedAt,
          thinkingStartedAt,
          minimumVisibleUntil,
        },
      },
    }),
  );

  const clock = createFakeClock({ startMs: Date.parse("2026-04-03T00:00:00.200Z") });
  const runtimeRequests = [];
  const { requests, store } = createTrackedSyncStore({
    env,
    storage,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createComputerPlayerRuntime: () => ({
      async selectMove(request) {
        runtimeRequests.push(request);
        return {
          action: { type: "pass" },
          diagnostics: {
            selectedAction: { key: "pass" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  await store.loadGame(createdGame.id);
  store.setActiveGameId(createdGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(createdGame.id)?.minimumVisibleUntil, minimumVisibleUntil);

  await clock.advanceBy(399);
  assert.equal(
    requests.some((entry) => entry.url === `/api/shell/games/${createdGame.id}/apply` && entry.method === "POST"),
    false,
  );

  await clock.advanceBy(1);
  await waitFor(() => (store.getGameViewModel(createdGame.id)?.moves.length ?? 0) === 1);
  assert.equal(runtimeRequests.length, 1);
});
