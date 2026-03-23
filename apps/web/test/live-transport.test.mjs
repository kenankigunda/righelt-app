import test from "node:test";
import assert from "node:assert/strict";
import { createLiveTransportStore } from "../shell/live-transport.js";
import {
  applyAction,
  createInitialState,
  listLegalActions,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";

const IMPORT_SCENARIO_UUID = "e5e48740-f8e2-4b32-bfbf-c46ec98b5962";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const clone = (value) => structuredClone(value);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const buildLiveGame = () => {
  const initial = resolveToStability(createInitialState(), { artifactMode: "full" });
  const firstAction = listLegalActions(initial).find((action) => action.type === "move") ?? listLegalActions(initial)[0];
  const firstApplied = applyAction(initial, firstAction);
  const currentState = resolveToStability(firstApplied.state, { artifactMode: "full" });
  currentState.sideToMove = "P1";
  currentState.turnIndex = 0;
  const currentTurn = {
    index: 0,
    startedAt: "2026-02-26T00:00:00.000Z",
    endedAt: null,
    playerSeat: "Player 1",
    status: "active",
    moveIndexes: [0],
    lastMoveAt: "2026-02-26T00:00:01.000Z",
  };
  return {
    id: "game-live-1",
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: "2026-02-26T00:00:01.000Z",
    updatedAt: "2026-02-26T00:00:01.000Z",
    offlineLocal: false,
    playgroundMode: false,
    player1: { identityId: "id-a", connected: true },
    player2: { identityId: "id-b", connected: true },
    viewers: [],
    pendingJoinRequests: [],
    turns: [clone(currentTurn)],
    moves: [
      {
        index: 0,
        turnIndex: 0,
        turnMoveIndex: 0,
        actorSide: "P1",
        at: "2026-02-26T00:00:01.000Z",
        notation: "MOVE 1",
        action: clone(firstAction),
        selectionSnapshot: clone(initial),
        snapshot: clone(currentState),
      },
    ],
    notifications: ["Move recorded in turn 1"],
    myRole: "Player 1",
    inHistoryMode: false,
    historyIndex: null,
    currentSnapshot: clone(currentState),
    board: { state: clone(currentState) },
    currentTurn: clone(currentTurn),
    legalActions: listLegalActions(currentState),
    canRecordMove: true,
    canEndTurn: true,
    showJoinActions: true,
    canInvite: true,
    showOfflineState: false,
  };
};

const buildAcknowledgedGame = (baseGame, action) => {
  const stable = resolveToStability(baseGame.board.state, { artifactMode: "full" });
  const applied = applyAction(stable, action);
  const nextState = resolveToStability(applied.state, { artifactMode: "full" });
  nextState.sideToMove = "P1";
  nextState.turnIndex = 0;

  return {
    ...clone(baseGame),
    lastMoveAt: "2026-02-26T00:00:02.000Z",
    updatedAt: "2026-02-26T00:00:02.000Z",
    moves: [
      ...clone(baseGame.moves),
      {
        index: 1,
        turnIndex: 0,
        turnMoveIndex: 1,
        actorSide: stable.sideToMove,
        at: "2026-02-26T00:00:02.000Z",
        notation: "MOVE 2",
        action: clone(action),
        selectionSnapshot: clone(stable),
        snapshot: clone(nextState),
      },
    ],
    turns: [
      {
        ...clone(baseGame.turns[0]),
        moveIndexes: [0, 1],
        lastMoveAt: "2026-02-26T00:00:02.000Z",
      },
    ],
    currentTurn: {
      ...clone(baseGame.currentTurn),
      moveIndexes: [0, 1],
      lastMoveAt: "2026-02-26T00:00:02.000Z",
    },
    currentSnapshot: clone(nextState),
    board: { state: clone(nextState) },
    legalActions: listLegalActions(nextState),
    canRecordMove: true,
    canEndTurn: true,
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

test("live transport store posts scenario imports through the shell scenarios endpoint", async () => {
  const storage = createMemoryStorage();
  storage.setItem("righelt.identity.id.v1", "id-scenario");
  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/scenarios/import?offline=0") {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.identityId, "id-scenario");
      assert.equal(body.scenario.id, IMPORT_SCENARIO_UUID);
      assert.equal(body.targetGameId, "game-apply-here");
      return Response.json({
        ok: true,
        game: {
          id: "game-apply-here",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:01.000Z",
          updatedAt: "2026-02-26T00:00:01.000Z",
          offlineLocal: false,
          playgroundMode: false,
          player1: { identityId: "id-scenario", connected: true },
          player2: null,
          viewers: [],
          pendingJoinRequests: [],
          moves: [],
          notifications: ["Scenario loaded"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } },
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } } },
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.1 });
  const result = await store.importScenario({
    scenario: {
      formatVersion: 2,
      id: IMPORT_SCENARIO_UUID,
      title: "Saved Scenario",
      initialState: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } },
      resultingState: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } },
      moves: [],
      expectedFinalStateHash: "abc",
      expectedOutcome: "ongoing",
    },
    targetGameId: "game-apply-here",
  });

  assert.equal(result.game.id, "game-apply-here");
});

test("live transport store posts history branch launches through the shell history endpoint", async () => {
  const storage = createMemoryStorage();
  storage.setItem("righelt.identity.id.v1", "id-branch");
  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/history/branch?offline=0") {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.identityId, "id-branch");
      assert.equal(body.sourceGameId, "game-source");
      assert.equal(body.sourceMoveIndex, 2);
      assert.equal(body.participantCopyMode, "viewer_as_player1");
      assert.equal(body.scenario.id, "history-branch:game-source:2");
      assert.equal(body.scenario.moves.length, 2);
      assert.deepEqual(body.initialSelectionAction.from, { row: 1, col: 1 });
      return Response.json({
        ok: true,
        game: {
          id: "game-branch",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          offlineLocal: false,
          playgroundMode: false,
          player1: { identityId: "id-branch", connected: true },
          player2: null,
          viewers: [],
          pendingJoinRequests: [],
          moves: [],
          notifications: ["History branch launched"],
          myRole: "Player 1",
          inHistoryMode: false,
          initialSelectionAction: {
            type: "move",
            actorId: "U1",
            from: { row: 1, col: 1 },
            to: { row: 2, col: 1 },
          },
          currentSnapshot: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
          board: { state: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } } },
          showJoinActions: true,
          canInvite: true,
          showOfflineState: false,
        },
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.2 });
  const result = await store.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      formatVersion: 2,
      id: "history-branch:game-source:2",
      title: "Branch from game-source move 3",
      description: "Replay branch",
      incorrect: false,
      initialState: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } },
      moves: [
        { turnIndex: 0, turnMoveIndex: 0, actorSide: "P1", notation: "M1", action: { type: "move", from: { row: 0, col: 0 }, to: { row: 0, col: 1 } } },
        { turnIndex: 0, turnMoveIndex: 1, actorSide: "P1", notation: "M2", action: { type: "move", from: { row: 0, col: 1 }, to: { row: 0, col: 2 } } },
      ],
      resultingState: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
      expectedFinalStateHash: "",
      expectedOutcome: "ongoing",
    },
    initialSelectionAction: {
      type: "move",
      actorId: "U1",
      from: { row: 1, col: 1 },
      to: { row: 2, col: 1 },
    },
    participantCopyMode: "viewer_as_player1",
  });

  assert.equal(result.game.id, "game-branch");
  assert.equal(store.getGameViewModel("game-branch").initialSelectionAction.to.row, 2);
});

test("live transport store loads paged home sections through section-aware query params", async () => {
  const storage = createMemoryStorage();
  storage.setItem("righelt.identity.id.v1", "id-page");
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return Response.json({
      ok: true,
      section: "my",
      page: 1,
      pageSize: 6,
      totalGames: 6,
      totalPages: 2,
      games: [{ ...buildLiveGame(), id: "game-000006", player1: { identityId: "id-page", connected: true }, myRole: "Player 1" }],
    });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.7 });
  const page = await store.loadGamesPage({ section: "my", page: 1, pageSize: 6, debug: true });

  assert.equal(calls[0], "/api/shell/games?identityId=id-page&section=my&page=1&pageSize=6&debug=1&offline=0");
  assert.equal(page.totalPages, 2);
  assert.equal(page.games.length, 1);
  assert.equal(page.games[0].id, "game-000006");
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

test("live transport store applies optimistic moves immediately and clears pending state on matching ack", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  let resolveApply = null;

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
      return new Promise((resolve) => {
        resolveApply = resolve;
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  await store.loadGame(baseGame.id);

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  assert.equal(pending.accepted, true);
  assert.equal(typeof pending.clientCommandId, "string");

  const optimisticView = store.getGameViewModel(baseGame.id);
  assert.equal(optimisticView.pendingMoves.length, 1);
  assert.equal(optimisticView.pendingCommandCount, 1);
  assert.equal(optimisticView.moves.length, 1);
  assert.notDeepEqual(optimisticView.currentSnapshot, baseGame.currentSnapshot);

  resolveApply?.(
    Response.json({
      ok: true,
      accepted: true,
      clientCommandId: pending.clientCommandId,
      eventSeq: 2,
      game: buildAcknowledgedGame(baseGame, nextAction),
    }),
  );
  await tick();

  const settledView = store.getGameViewModel(baseGame.id);
  assert.equal(settledView.pendingMoves.length, 0);
  assert.equal(settledView.pendingCommandCount, 0);
  assert.equal(settledView.moves.length, 2);
  assert.equal(settledView.syncStatus, "ready");
});

test("live transport store notifies subscribers for optimistic enqueue and authoritative ack", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const changes = [];
  let resolveApply = null;

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
      return new Promise((resolve) => {
        resolveApply = resolve;
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  store.subscribe((change) => {
    changes.push(change);
  });

  await store.loadGame(baseGame.id);
  changes.length = 0;

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  assert.equal(changes.some((change) => change.type === "optimistic_enqueue" && change.gameId === baseGame.id), true);

  resolveApply?.(
    Response.json({
      ok: true,
      accepted: true,
      clientCommandId: pending.clientCommandId,
      eventSeq: 2,
      game: buildAcknowledgedGame(baseGame, nextAction),
    }),
  );
  await tick();

  assert.equal(changes.some((change) => change.type === "authoritative_update" && change.gameId === baseGame.id), true);
});

test("live transport store notifies subscribers when optimistic sync rolls back or desyncs", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];

  {
    const rollbackChanges = [];
    let resolveApply = null;
    const fetcher = async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      }
      return Response.json({ ok: true, games: [] });
    };

    const rollbackStore = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
    rollbackStore.subscribe((change) => {
      rollbackChanges.push(change);
    });
    await rollbackStore.loadGame(baseGame.id);
    rollbackChanges.length = 0;

    await rollbackStore.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
    resolveApply?.(
      Response.json({
        ok: true,
        accepted: false,
        eventSeq: 2,
        game: clone(baseGame),
      }),
    );
    await tick();

    assert.equal(rollbackChanges.some((change) => change.type === "optimistic_rollback" && change.gameId === baseGame.id), true);
  }

  {
    const desyncChanges = [];
    const desyncStore = createLiveTransportStore({
      storage: createMemoryStorage(),
      fetcher: async (url, init = {}) => {
        if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
          return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
        }
        if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
          throw new Error("network_failed");
        }
        return Response.json({ ok: true, games: [] });
      },
      random: () => 0.12345,
    });
    desyncStore.subscribe((change) => {
      desyncChanges.push(change);
    });
    await desyncStore.loadGame(baseGame.id);
    desyncChanges.length = 0;

    await desyncStore.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
    await tick();

    assert.equal(desyncChanges.some((change) => change.type === "optimistic_desynced" && change.gameId === baseGame.id), true);
  }
});

test("live transport store keeps authoritative history selectable while pending moves exist", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const changes = [];

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
      return new Promise(() => {});
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/history?offline=0` && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 2,
        game: {
          ...clone(baseGame),
          inHistoryMode: true,
          historyIndex: 0,
          historySelectionAction: clone(baseGame.moves[0].action),
          currentSnapshot: clone(baseGame.moves[0].selectionSnapshot),
        },
      });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/live?offline=0` && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 3,
        game: {
          ...clone(baseGame),
          inHistoryMode: false,
          historyIndex: null,
          currentSnapshot: clone(baseGame.board.state),
        },
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  store.subscribe((change) => {
    changes.push(change);
  });
  await store.loadGame(baseGame.id);
  await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  changes.length = 0;

  const historyView = await store.selectHistoryMove({ gameId: baseGame.id, moveIndex: 0 });
  assert.equal(historyView.inHistoryMode, true);
  assert.equal(historyView.pendingMoves.length, 1);
  assert.deepEqual(historyView.currentSnapshot, baseGame.moves[0].selectionSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);

  changes.length = 0;
  const liveView = await store.returnToLive({ gameId: baseGame.id });
  assert.equal(liveView.inHistoryMode, false);
  assert.equal(liveView.pendingMoves.length, 1);
  assert.notDeepEqual(liveView.currentSnapshot, baseGame.currentSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);
});
