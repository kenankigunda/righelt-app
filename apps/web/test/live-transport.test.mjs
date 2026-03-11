import test from "node:test";
import assert from "node:assert/strict";
import { createLiveTransportStore } from "../shell/live-transport.js";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

test("live transport store uses backend responses for create/load/join flows", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });

    if (String(url).startsWith("/api/shell/games?") && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, games: [] });
    }

    if (String(url).includes("/join")) {
      return Response.json({
        ok: true,
        pendingApproval: true,
        game: {
          id: "game-000001",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          offlineLocal: false,
          player1: { identityId: "id-a", connected: true },
          player2: null,
          viewers: [{ identityId: "id-a", connected: true }],
          pendingJoinRequests: [{ identityId: "id-a", requestedSeat: "Player 2" }],
          moves: [],
          notifications: ["Player seat request pending approval"],
          myRole: "Viewer",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }

    if (String(url).startsWith("/api/shell/games") && init.method === "POST") {
      return Response.json({
        ok: true,
        game: {
          id: "game-000001",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          offlineLocal: false,
          player1: { identityId: "id-a", connected: true },
          player2: null,
          viewers: [],
          pendingJoinRequests: [],
          moves: [],
          notifications: ["Game created"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }

    return Response.json({ ok: true, game: null });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  await store.refreshGames();
  const created = await store.createGame();
  assert.equal(created.id, "game-000001");

  const joined = await store.joinGame({ gameId: "game-000001", mode: "player", inviteFromRole: null });
  assert.equal(joined.pendingApproval, true);

  assert.equal(calls.some((entry) => String(entry.url).includes("/api/shell/games")), true);
  assert.equal(calls.some((entry) => String(entry.url).includes("/join")), true);
});

test("live transport store can promote player 1 to both seats when player 2 is open", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });

    if (String(url).startsWith("/api/shell/games/game-000001/play-as-both") && init.method === "POST") {
      return Response.json({
        ok: true,
        game: {
          id: "game-000001",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          offlineLocal: false,
          playgroundMode: true,
          player1: { identityId: "id-a", connected: true },
          player2: { identityId: "id-a", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          moves: [],
          notifications: ["Play as both players enabled"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          canPlayAsBothPlayers: false,
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }

    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  const result = await store.playAsBothPlayers({ gameId: "game-000001" });

  assert.equal(result.game.playgroundMode, true);
  assert.equal(result.game.player2?.identityId, "id-a");
  assert.equal(calls.some((entry) => entry.url.startsWith("/api/shell/games/game-000001/play-as-both")), true);
});

test("live transport store keeps offline moves local until reconnect", async () => {
  const calls = [];
  const gameId = "game-offline-1";
  const baseGame = {
    id: gameId,
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: null,
    updatedAt: "2026-02-26T00:00:00.000Z",
    offlineLocal: false,
    player1: { identityId: "id-a", connected: true },
    player2: null,
    viewers: [],
    pendingJoinRequests: [],
    turns: [{ index: 0, startedAt: "2026-02-26T00:00:00.000Z", endedAt: null, playerSeat: "Player 1", status: "active", moveIndexes: [], lastMoveAt: null }],
    moves: [],
    notifications: ["Game created"],
    myRole: "Player 1",
    inHistoryMode: false,
    currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
    board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
    canRecordMove: true,
    canEndTurn: false,
    canJoinAsPlayer: false,
    canJoinAsViewer: false,
    showJoinActions: true,
    canInvite: true,
  };

  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });

    if (String(url).startsWith("/api/shell/games?") && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, games: [baseGame] });
    }
    if (String(url) === `/api/shell/games/${gameId}?identityId=id-a` && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame });
    }
    if (String(url) === "/api/engine/playground/legal") {
      return Response.json({ ok: true, state: { sideToMove: "P1", turnIndex: 0, pieces: [] }, legalActions: [{ type: "pass" }] });
    }
    if (String(url) === "/api/engine/playground/apply") {
      return Response.json({ ok: true, accepted: true, state: { sideToMove: "P1", turnIndex: 0, pieces: [] } });
    }
    if (String(url) === `/api/shell/games/${gameId}/moves`) {
      return Response.json({
        ok: true,
        move: { index: 0, notation: "PASS" },
        game: {
          ...baseGame,
          moves: [{ index: 0, turnIndex: 0, turnMoveIndex: 0, at: "2026-02-26T00:00:01.000Z", notation: "PASS", snapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] } }],
          turns: [{ ...baseGame.turns[0], moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:01.000Z" }],
          lastMoveAt: "2026-02-26T00:00:01.000Z",
          updatedAt: "2026-02-26T00:00:01.000Z",
        },
      });
    }
    return Response.json({ ok: true, game: baseGame });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  await store.refreshGames();
  await store.loadGame(gameId);
  await store.setOffline(true);
  const localMove = await store.addMove({ gameId });
  assert.equal(localMove.game.moves.length, 1);
  assert.equal(calls.some((entry) => entry.url === `/api/shell/games/${gameId}/moves`), false);

  await store.setOffline(false);
  assert.equal(calls.some((entry) => entry.url === `/api/shell/games/${gameId}/moves`), true);
});

test("live transport store overlays offline view state onto cached games", async () => {
  const gameId = "game-offline-ui";
  const baseGame = {
    id: gameId,
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: null,
    updatedAt: "2026-02-26T00:00:00.000Z",
    offlineLocal: false,
    player1: { identityId: "id-a", connected: true },
    player2: null,
    viewers: [],
    pendingJoinRequests: [],
    turns: [{ index: 0, startedAt: "2026-02-26T00:00:00.000Z", endedAt: null, playerSeat: "Player 1", status: "active", moveIndexes: [], lastMoveAt: null }],
    moves: [],
    notifications: ["Game created"],
    myRole: "Player 1",
    inHistoryMode: false,
    currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
    canInvite: true,
    showJoinActions: true,
    showOfflineState: false,
  };
  const fetcher = async (url) => {
    if (String(url).startsWith("/api/shell/games?")) {
      return Response.json({ ok: true, games: [baseGame] });
    }
    if (String(url).startsWith(`/api/shell/games/${gameId}?`)) {
      return Response.json({ ok: true, game: baseGame });
    }
    return Response.json({ ok: true, game: baseGame });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  await store.refreshGames();
  await store.loadGame(gameId);
  await store.setOffline(true);

  const vm = store.getGameViewModel(gameId);
  assert.equal(vm.showOfflineState, true);
  assert.equal(vm.canInvite, false);
  assert.equal(vm.showJoinActions, false);
});

test("live transport store allows offline end-turn only for dual-seat offline playground", async () => {
  const gameId = "game-offline-playground";
  const storage = createMemoryStorage();
  storage.setItem("righelt.identity.id.v1", "id-a");
  const baseGame = {
    id: gameId,
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: "2026-02-26T00:00:01.000Z",
    updatedAt: "2026-02-26T00:00:01.000Z",
    offlineLocal: true,
    playgroundMode: true,
    player1: { identityId: "id-a", connected: true },
    player2: { identityId: "id-a", connected: true },
    viewers: [],
    pendingJoinRequests: [],
    turns: [{ index: 0, startedAt: "2026-02-26T00:00:00.000Z", endedAt: null, playerSeat: "Player 1", status: "active", moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:01.000Z" }],
    moves: [{ index: 0, turnIndex: 0, turnMoveIndex: 0, at: "2026-02-26T00:00:01.000Z", notation: "PASS", snapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] } }],
    notifications: ["Offline move recorded"],
    myRole: "Player 1",
    inHistoryMode: false,
    currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
    board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
    canInvite: false,
    canEndTurn: false,
    showJoinActions: false,
    showOfflineState: false,
  };
  const fetcher = async (url) => {
    if (String(url).startsWith("/api/shell/games?")) {
      return Response.json({ ok: true, games: [] });
    }
    if (String(url).startsWith(`/api/shell/games/${gameId}?`)) {
      return Response.json({ ok: true, game: baseGame });
    }
    return Response.json({ ok: true, game: baseGame });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.12345 });
  await store.loadGame(gameId);
  await store.setOffline(true);

  const vm = store.getGameViewModel(gameId);
  assert.equal(vm.canEndTurn, true);
});

test("live transport store ignores stale game snapshots once a newer eventSeq is cached", async () => {
  const gameId = "game-seq-1";
  const storage = createMemoryStorage();
  storage.setItem("righelt.identity.id.v1", "id-a");

  const fetcher = async (url, init = {}) => {
    if (String(url) === `/api/shell/games/${gameId}/piece-moves` && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 4,
        state: { sideToMove: "P1", turnIndex: 0, pieces: [] },
        pieceId: "A1",
        actions: [],
        previewActions: [],
        game: {
          id: gameId,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:10.000Z",
          updatedAt: "2026-02-26T00:00:10.000Z",
          offlineLocal: false,
          player1: { identityId: "id-a", connected: true },
          player2: { identityId: "id-b", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          turns: [{ index: 0, playerSeat: "Player 1", status: "active", moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:10.000Z" }],
          moves: [{ index: 0, turnIndex: 0, turnMoveIndex: 0, notation: "M1", at: "2026-02-26T00:00:10.000Z" }],
          notifications: ["Move recorded in turn 1"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          currentTurn: { index: 0, playerSeat: "Player 1", status: "active", moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:10.000Z" },
          canRecordMove: true,
          canEndTurn: true,
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.12345 });
  store.applyLiveGameUpdate({
    eventSeq: 5,
    game: {
      id: gameId,
      createdAt: "2026-02-26T00:00:00.000Z",
      lastMoveAt: "2026-02-26T00:00:11.000Z",
      updatedAt: "2026-02-26T00:00:11.000Z",
      offlineLocal: false,
      player1: { identityId: "id-a", connected: true },
      player2: { identityId: "id-b", connected: true },
      viewers: [],
      pendingJoinRequests: [],
      turns: [
        { index: 0, playerSeat: "Player 1", status: "complete", moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:10.000Z" },
        { index: 1, playerSeat: "Player 2", status: "active", moveIndexes: [], lastMoveAt: null },
      ],
      moves: [{ index: 0, turnIndex: 0, turnMoveIndex: 0, notation: "M1", at: "2026-02-26T00:00:10.000Z" }],
      notifications: ["Turn 1 ended. Player 2 to play"],
      myRole: "Player 1",
      inHistoryMode: false,
      currentSnapshot: { sideToMove: "P2", turnIndex: 1, pieces: [] },
      currentTurn: { index: 1, playerSeat: "Player 2", status: "active", moveIndexes: [], lastMoveAt: null },
      canRecordMove: false,
      canEndTurn: false,
      showJoinActions: true,
      canInvite: true,
      showOfflineState: false,
    },
  });

  await store.loadGamePieceMoves({ gameId, state: { sideToMove: "P2", turnIndex: 1, pieces: [] }, pieceId: "A1" });

  const vm = store.getGameViewModel(gameId);
  assert.equal(vm.currentSnapshot.sideToMove, "P2");
  assert.equal(vm.currentTurn.playerSeat, "Player 2");
  assert.equal(store.getLastEventSeq(gameId), 5);
});
