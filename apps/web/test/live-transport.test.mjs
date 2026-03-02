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
