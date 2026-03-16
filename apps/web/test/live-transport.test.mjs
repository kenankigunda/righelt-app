import test from "node:test";
import assert from "node:assert/strict";
import { createLiveTransportStore } from "../shell/live-transport.js";
import {
  applyAction,
  createInitialState,
  listLegalActions,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";

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
  const history = {
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
    turns: [clone(currentTurn)],
    validatedMoveCount: 1,
    validatedTurnCount: 1,
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
    notifications: ["Move recorded in turn 1"],
    myRole: "Player 1",
    currentSnapshot: clone(currentState),
    board: { state: clone(currentState) },
    currentTurn: clone(currentTurn),
    validatedMoveCount: history.validatedMoveCount,
    validatedTurnCount: history.validatedTurnCount,
    legalActions: listLegalActions(currentState),
    canRecordMove: true,
    canEndTurn: true,
    showJoinActions: true,
    canInvite: true,
    showOfflineState: false,
    _history: history,
  };
};

const buildHistoryPayload = (game) => clone(game._history);

const buildAcknowledgedGame = (baseGame, action) => {
  const stable = resolveToStability(baseGame.board.state, { artifactMode: "full" });
  const applied = applyAction(stable, action);
  const nextState = resolveToStability(applied.state, { artifactMode: "full" });
  nextState.sideToMove = "P1";
  nextState.turnIndex = 0;

  const history = {
    moves: [
      ...clone(baseGame._history.moves),
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
        ...clone(baseGame.currentTurn),
        moveIndexes: [0, 1],
        lastMoveAt: "2026-02-26T00:00:02.000Z",
      },
    ],
    validatedMoveCount: 2,
    validatedTurnCount: 1,
  };

  return {
    ...clone(baseGame),
    lastMoveAt: "2026-02-26T00:00:02.000Z",
    updatedAt: "2026-02-26T00:00:02.000Z",
    currentTurn: {
      ...clone(baseGame.currentTurn),
      moveIndexes: [0, 1],
      lastMoveAt: "2026-02-26T00:00:02.000Z",
    },
    currentSnapshot: clone(nextState),
    board: { state: clone(nextState) },
    validatedMoveCount: history.validatedMoveCount,
    validatedTurnCount: history.validatedTurnCount,
    legalActions: listLegalActions(nextState),
    canRecordMove: true,
    canEndTurn: true,
    _history: history,
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
  assert.equal(vm.turns.some((turn) => turn.index === 1 && turn.playerSeat === "Player 2"), true);
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
    if (String(url) === `/api/shell/games/${baseGame.id}/history?identityId=id-4fzolfdn&offline=0` && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 1 });
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
  assert.equal(optimisticView.validatedMoveCount, 1);
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

test("live transport store keeps an acknowledged move in history until validated history reload completes", async () => {
  const baseGame = buildLiveGame();
  const acknowledgedGame = buildAcknowledgedGame(
    baseGame,
    baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0],
  );
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  let resolveApply = null;
  let resolveReloadHistory = null;
  let historyRequestCount = 0;

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/history?identityId=id-4fzolfdn&offline=0` && (!init.method || init.method === "GET")) {
      historyRequestCount += 1;
      if (historyRequestCount === 1) {
        return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 1 });
      }
      return new Promise((resolve) => {
        resolveReloadHistory = resolve;
      });
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
  await tick();

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  resolveApply?.(
    Response.json({
      ok: true,
      accepted: true,
      clientCommandId: pending.clientCommandId,
      eventSeq: 2,
      game: acknowledgedGame,
    }),
  );
  await tick();

  const bridgedView = store.getGameViewModel(baseGame.id);
  assert.equal(bridgedView.pendingMoves.length, 0);
  assert.equal(bridgedView.historyStatus, "loading");
  assert.equal(bridgedView.moves.length, 2);
  assert.equal(bridgedView.moves.some((move) => move.clientCommandId === pending.clientCommandId), true);

  resolveReloadHistory?.(Response.json({ ok: true, ...buildHistoryPayload(acknowledgedGame), eventSeq: 2 }));
  await tick();

  const settledView = store.getGameViewModel(baseGame.id);
  assert.equal(settledView.moves.length, 2);
  assert.equal(settledView.historyStatus, "ready");
  assert.equal(settledView.moves.some((move) => move.clientCommandId === pending.clientCommandId), true);
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
    if (String(url) === `/api/shell/games/${baseGame.id}/history?identityId=id-4fzolfdn&offline=0` && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 1 });
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
      if (String(url) === `/api/shell/games/${baseGame.id}/history?identityId=id-4fzolfdn&offline=0` && (!init.method || init.method === "GET")) {
        return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 1 });
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
        if (String(url) === `/api/shell/games/${baseGame.id}/history?identityId=id-4fzolfdn&offline=0` && (!init.method || init.method === "GET")) {
          return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 1 });
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

test("live transport store keeps validated and pending history selectable while pending moves exist", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const changes = [];

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url).includes(`/api/shell/games/${baseGame.id}/history?`) && (!init.method || init.method === "GET")) {
      return Response.json({ ok: true, ...buildHistoryPayload(baseGame), eventSeq: 2 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply?offline=0` && init.method === "POST") {
      return new Promise(() => {});
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  store.subscribe((change) => {
    changes.push(change);
  });
  await store.loadGame(baseGame.id);
  await tick();
  await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  changes.length = 0;

  const historyView = await store.selectHistoryMove({ gameId: baseGame.id, moveIndex: 0 });
  assert.equal(historyView.inHistoryMode, true);
  assert.equal(historyView.pendingMoves.length, 1);
  assert.deepEqual(historyView.currentSnapshot, buildHistoryPayload(baseGame).moves[0].selectionSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);

  changes.length = 0;
  const pendingView = await store.selectPendingHistoryMove({
    gameId: baseGame.id,
    clientCommandId: historyView.pendingMoves[0].clientCommandId,
  });
  assert.equal(pendingView.inHistoryMode, true);
  assert.equal(pendingView.selectedPendingClientCommandId, historyView.pendingMoves[0].clientCommandId);
  assert.deepEqual(pendingView.currentSnapshot, historyView.pendingMoves[0].selectionSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);

  changes.length = 0;
  const liveView = await store.returnToLive({ gameId: baseGame.id });
  assert.equal(liveView.inHistoryMode, false);
  assert.equal(liveView.pendingMoves.length, 1);
  assert.notDeepEqual(liveView.currentSnapshot, baseGame.currentSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);
});
