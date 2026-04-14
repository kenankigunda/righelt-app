import test from "node:test";
import assert from "node:assert/strict";
import { createSyncStore } from "../shell/sync-store.js";
import {
  buildComputerPlayerDerivedTurnKey,
  buildComputerPlayerSeed,
  buildComputerPlayerTurnKey,
} from "../shell/computer-player-runtime.js";
import { LIVE_TRANSPORT_STATE_KEY } from "../shell/persistence.js";

const clone = (value) => structuredClone(value);

const stampComputerPlayerRuntime = (game, runtimeState = null) => {
  if (!game || game?.computerPlayer?.mode !== "computer-player") {
    return clone(game);
  }
  const nextGame = clone(game);
  nextGame.computerPlayer = { ...nextGame.computerPlayer };
  if (!runtimeState) {
    nextGame.computerPlayer.activeTurnKey = null;
    if (Object.hasOwn(nextGame.computerPlayer, "runtime")) {
      delete nextGame.computerPlayer.runtime;
    }
    return nextGame;
  }
  const activeTurnKey = runtimeState.activeTurnKey ?? nextGame.computerPlayer.activeTurnKey ?? null;
  nextGame.computerPlayer.activeTurnKey = activeTurnKey;
  nextGame.computerPlayer.runtime = {
    ...clone(runtimeState),
    activeTurnKey,
  };
  return nextGame;
};

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
  const runtimeOverlayByGameId = new Map();
  const getDecoratedGame = (gameId) => {
    const authoritativeGame = games.get(gameId) ?? null;
    if (!authoritativeGame) {
      return null;
    }
    return stampComputerPlayerRuntime(authoritativeGame, runtimeOverlayByGameId.get(gameId) ?? null);
  };
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
      getGameViewModel: (gameId) => getDecoratedGame(gameId),
      getAuthoritativeGame: (gameId) => clone(games.get(gameId) ?? null),
      setComputerPlayerRuntimeOverlay: (gameId, runtimeState = null) => {
        runtimeOverlayByGameId.set(gameId, runtimeState ? clone(runtimeState) : null);
        return getDecoratedGame(gameId);
      },
      applyLiveGameUpdate: ({ game }) => {
        games.set(game.id, clone(game));
      },
    },
  };
};

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

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
    flush: async () => {
      await flushMicrotasks();
      await runDueTimers();
    },
  };
};

const buildComputerPlayerGame = ({
  gameId = "game-bot",
  humanSeat = "Player 2",
  botSeat = "Player 1",
  botId = "tau",
  activeTurnKey = null,
  myRole = humanSeat,
} = {}) => {
  const sideToMove = botSeat === "Player 1" ? "P1" : "P2";
  const openingAction = {
    type: "project",
    actorId: sideToMove === "P1" ? "C1" : "C2",
    from: sideToMove === "P1" ? { row: 3, col: 6 } : { row: 6, col: 3 },
    to: sideToMove === "P1" ? { row: 5, col: 6 } : { row: 4, col: 3 },
  };
  const snapshot = {
    boardSize: 10,
    sideToMove,
    turnIndex: 0,
    pieces: [],
    continuation: null,
    outcome: { status: "ongoing" },
  };
  const currentTurn = {
    index: 0,
    startedAt: "2026-04-03T00:00:00.000Z",
    endedAt: null,
    playerSeat: botSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  const computerPlayer = {
    mode: "computer-player",
    botId,
    botSchemaVersion: 1,
    displayName: botId === "tau" ? "Tau the Tenacious" : "Babs the Beginner",
    animal: botId === "tau" ? "tortoise" : "bunny",
    skillLabel: botId === "tau" ? "Medium" : "Beginner",
    styleLabel: botId === "tau" ? "Defensive" : "Balanced",
    humanSeat,
    botSeat,
    activeTurnKey,
  };
  return {
    id: gameId,
    createdAt: "2026-04-03T00:00:00.000Z",
    lastMoveAt: null,
    updatedAt: "2026-04-03T00:00:00.000Z",
    selfPlayMode: false,
    computerPlayer,
    board: { state: clone(snapshot) },
    player1: humanSeat === "Player 1" ? { identityId: "id-human-test", connected: true } : null,
    player2: humanSeat === "Player 2" ? { identityId: "id-human-test", connected: true } : null,
    viewers: [],
    pendingJoinRequests: [],
    pendingRevertRequest: null,
    turns: [clone(currentTurn)],
    moves: [],
    notifications: ["Computer player ready"],
    myRole,
    inHistoryMode: false,
    historyIndex: null,
    currentSnapshot: clone(snapshot),
    currentTurn: clone(currentTurn),
    turnOwnerSeat: botSeat,
    controlSeat: botSeat,
    control: "turn-owner",
    legalActions: [openingAction, { type: "pass" }],
    canRecordMove: true,
    canEndTurn: false,
    canJoinAsPlayer: false,
    canJoinAsViewer: false,
    showJoinActions: false,
    canInvite: true,
  };
};

const buildComputerPlayerRushClosureGame = ({
  gameId = "game-bot-rush",
  humanSeat = "Player 2",
  botSeat = "Player 1",
  botId = "tau",
} = {}) => {
  const game = buildComputerPlayerGame({ gameId, humanSeat, botSeat, botId });
  return {
    ...game,
    updatedAt: "2026-04-03T00:00:01.000Z",
    lastMoveAt: "2026-04-03T00:00:01.000Z",
    currentSnapshot: {
      ...game.currentSnapshot,
      continuation: {
        type: "rush",
        owner: botSeat === "Player 1" ? "P1" : "P2",
        frozenOwner: botSeat === "Player 1" ? "P1" : "P2",
        frozenPieceStatesById: {},
        rushedPieceIds: [botSeat === "Player 1" ? "C1" : "C2"],
        rushChainPieceIds: [botSeat === "Player 1" ? "C1" : "C2"],
        chainLength: 1,
      },
    },
    board: {
      state: {
        ...game.currentSnapshot,
        continuation: {
          type: "rush",
          owner: botSeat === "Player 1" ? "P1" : "P2",
          frozenOwner: botSeat === "Player 1" ? "P1" : "P2",
          frozenPieceStatesById: {},
          rushedPieceIds: [botSeat === "Player 1" ? "C1" : "C2"],
          rushChainPieceIds: [botSeat === "Player 1" ? "C1" : "C2"],
          chainLength: 1,
        },
      },
    },
    currentTurn: {
      ...game.currentTurn,
      moveIndexes: [0],
      lastMoveAt: "2026-04-03T00:00:01.000Z",
    },
    turns: [
      {
        ...game.currentTurn,
        moveIndexes: [0],
        lastMoveAt: "2026-04-03T00:00:01.000Z",
      },
    ],
    moves: [
      {
        index: 0,
        moveId: "move-0",
        displayMoveNumber: 1,
        turnIndex: 0,
        turnMoveIndex: 0,
        actorSide: botSeat === "Player 1" ? "P1" : "P2",
        clientCommandId: "human-rush-seed",
        notation: "RUSH (3,6) -> (4,6)",
        at: "2026-04-03T00:00:01.000Z",
        action: {
          type: "rush",
          actorId: botSeat === "Player 1" ? "C1" : "C2",
          from: botSeat === "Player 1" ? { row: 3, col: 6 } : { row: 6, col: 3 },
          to: botSeat === "Player 1" ? { row: 4, col: 6 } : { row: 5, col: 3 },
        },
      },
    ],
    legalActions: [{ type: "pass" }],
    canRecordMove: false,
    canEndTurn: true,
  };
};

const createComputerPlayerTransportHarness = (initialGame) => {
  const listeners = new Set();
  const appliedCommandIds = [];
  const endedTurnCommandIds = [];
  let currentGame = clone(initialGame);
  let runtimeOverlay = null;
  const getDecoratedGame = () => stampComputerPlayerRuntime(currentGame, runtimeOverlay);
  const emit = (change) => {
    for (const listener of listeners) {
      listener(change);
    }
  };
  const advanceToHumanTurn = (sourceGame, clientCommandId, action = null) => {
    const nextGame = clone(sourceGame);
    const recordedAction = action ?? sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? { type: "pass" };
    nextGame.moves = [
      {
        index: 0,
        moveId: "move-0",
        turnIndex: 0,
        at: "2026-04-03T00:00:01.000Z",
        actorSide: nextGame.computerPlayer.botSeat === "Player 1" ? "P1" : "P2",
        clientCommandId,
        action: clone(recordedAction),
      },
    ];
    nextGame.lastMoveAt = "2026-04-03T00:00:01.000Z";
    nextGame.updatedAt = "2026-04-03T00:00:01.000Z";
    nextGame.computerPlayer = {
      ...nextGame.computerPlayer,
      activeTurnKey: null,
    };
    nextGame.currentSnapshot = {
      ...nextGame.currentSnapshot,
      sideToMove: nextGame.computerPlayer.botSeat === "Player 1" ? "P2" : "P1",
      turnIndex: 1,
    };
    nextGame.board = { state: clone(nextGame.currentSnapshot) };
    nextGame.currentTurn = {
      ...nextGame.currentTurn,
      playerSeat: nextGame.computerPlayer.humanSeat,
      moveIndexes: [0],
      lastMoveAt: "2026-04-03T00:00:01.000Z",
    };
    nextGame.turns = [
      {
        ...clone(sourceGame.currentTurn),
        status: "complete",
        endedAt: "2026-04-03T00:00:01.000Z",
        moveIndexes: [0],
        lastMoveAt: "2026-04-03T00:00:01.000Z",
      },
      {
        ...clone(sourceGame.currentTurn),
        index: 1,
        playerSeat: nextGame.computerPlayer.humanSeat,
        startedAt: "2026-04-03T00:00:01.000Z",
        endedAt: null,
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      },
    ];
    nextGame.turnOwnerSeat = nextGame.computerPlayer.humanSeat;
    nextGame.controlSeat = nextGame.computerPlayer.humanSeat;
    nextGame.control = "turn-owner";
    nextGame.legalActions = [{ type: "pass" }];
    nextGame.canRecordMove = true;
    nextGame.canEndTurn = false;
    currentGame = nextGame;
    queueMicrotask(() => emit({ type: "authoritative_update", gameId: currentGame.id, clientCommandId }));
    return nextGame;
  };
  const advanceAfterEndTurn = (sourceGame, clientCommandId) => {
    const nextGame = clone(sourceGame);
    const lastMoveAt = nextGame.currentTurn?.lastMoveAt ?? nextGame.moves[nextGame.moves.length - 1]?.at ?? nextGame.updatedAt;
    nextGame.updatedAt = lastMoveAt;
    nextGame.computerPlayer = {
      ...nextGame.computerPlayer,
      activeTurnKey: null,
    };
    nextGame.currentSnapshot = {
      ...nextGame.currentSnapshot,
      sideToMove: nextGame.computerPlayer.botSeat === "Player 1" ? "P2" : "P1",
      turnIndex: Number(nextGame.currentSnapshot?.turnIndex ?? 0) + 1,
      continuation: null,
    };
    nextGame.board = { state: clone(nextGame.currentSnapshot) };
    nextGame.turns = [
      ...nextGame.turns.slice(0, -1),
      {
        ...clone(sourceGame.currentTurn),
        status: "complete",
        endedAt: lastMoveAt,
      },
      {
        ...clone(sourceGame.currentTurn),
        index: Number(sourceGame.currentTurn?.index ?? 0) + 1,
        playerSeat: nextGame.computerPlayer.humanSeat,
        startedAt: lastMoveAt,
        endedAt: null,
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      },
    ];
    nextGame.currentTurn = nextGame.turns[nextGame.turns.length - 1];
    nextGame.turnOwnerSeat = nextGame.computerPlayer.humanSeat;
    nextGame.controlSeat = nextGame.computerPlayer.humanSeat;
    nextGame.control = "turn-owner";
    nextGame.canEndTurn = false;
    nextGame.canRecordMove = true;
    currentGame = nextGame;
    queueMicrotask(() => emit({ type: "authoritative_update", gameId: currentGame.id, clientCommandId }));
    return nextGame;
  };
  return {
    listeners,
    transport: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getIdentityId: () => "id-human-test",
      getLastEventSeq: () => 0,
      getGameViewModel: () => getDecoratedGame(),
      getAuthoritativeGame: () => clone(currentGame),
      setComputerPlayerRuntimeOverlay: (_gameId, runtimeState = null) => {
        runtimeOverlay = runtimeState ? clone(runtimeState) : null;
        return getDecoratedGame();
      },
      applyLiveGameUpdate: ({ game }) => {
        currentGame = clone(game);
        return getDecoratedGame();
      },
      applyGameAction: async ({ clientCommandId, action }) => {
        appliedCommandIds.push(clientCommandId);
        return {
          ok: true,
          accepted: true,
          clientCommandId,
          game: advanceToHumanTurn(currentGame, clientCommandId, action),
          state: currentGame.currentSnapshot,
          legalActions: currentGame.legalActions,
        };
      },
      endTurn: async ({ clientCommandId }) => {
        endedTurnCommandIds.push(clientCommandId);
        return {
          ok: true,
          accepted: true,
          clientCommandId,
          turn: currentGame.currentTurn,
          game: advanceAfterEndTurn(currentGame, clientCommandId),
        };
      },
    },
    getGame: () => getDecoratedGame(),
    getAppliedCommandIds: () => [...appliedCommandIds],
    getEndedTurnCommandIds: () => [...endedTurnCommandIds],
  };
};

const createDelayedComputerPlayerTransportHarness = (initialGame, { rejectImmediateAttempts = 0 } = {}) => {
  const listeners = new Set();
  const appliedCommandIds = [];
  const submittedStates = [];
  let currentGame = clone(initialGame);
  let runtimeOverlay = null;
  let pendingClientCommandId = null;
  let pendingAction = null;
  let remainingImmediateRejects = rejectImmediateAttempts;
  const getDecoratedGame = () => stampComputerPlayerRuntime(currentGame, runtimeOverlay);
  const emit = (change) => {
    for (const listener of listeners) {
      listener(change);
    }
  };
  const advanceToHumanTurn = (sourceGame, clientCommandId, action = null) => {
    const nextGame = clone(sourceGame);
    const recordedAction = action ?? sourceGame.legalActions.find((entry) => entry.type !== "pass") ?? { type: "pass" };
    nextGame.moves = [
      {
        index: 0,
        moveId: "move-0",
        turnIndex: 0,
        at: "2026-04-03T00:00:01.000Z",
        actorSide: nextGame.computerPlayer.botSeat === "Player 1" ? "P1" : "P2",
        clientCommandId,
        action: clone(recordedAction),
      },
    ];
    nextGame.lastMoveAt = "2026-04-03T00:00:01.000Z";
    nextGame.updatedAt = "2026-04-03T00:00:01.000Z";
    nextGame.computerPlayer = {
      ...nextGame.computerPlayer,
      activeTurnKey: null,
    };
    nextGame.currentSnapshot = {
      ...nextGame.currentSnapshot,
      sideToMove: nextGame.computerPlayer.botSeat === "Player 1" ? "P2" : "P1",
      turnIndex: 1,
    };
    nextGame.board = { state: clone(nextGame.currentSnapshot) };
    nextGame.currentTurn = {
      ...nextGame.currentTurn,
      playerSeat: nextGame.computerPlayer.humanSeat,
      moveIndexes: [0],
      lastMoveAt: "2026-04-03T00:00:01.000Z",
    };
    nextGame.turns = [
      {
        ...clone(sourceGame.currentTurn),
        status: "complete",
        endedAt: "2026-04-03T00:00:01.000Z",
        moveIndexes: [0],
        lastMoveAt: "2026-04-03T00:00:01.000Z",
      },
      {
        ...clone(sourceGame.currentTurn),
        index: 1,
        playerSeat: nextGame.computerPlayer.humanSeat,
        startedAt: "2026-04-03T00:00:01.000Z",
        endedAt: null,
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      },
    ];
    nextGame.turnOwnerSeat = nextGame.computerPlayer.humanSeat;
    nextGame.controlSeat = nextGame.computerPlayer.humanSeat;
    nextGame.control = "turn-owner";
    nextGame.legalActions = [{ type: "pass" }];
    nextGame.canRecordMove = true;
    nextGame.canEndTurn = false;
    currentGame = nextGame;
    queueMicrotask(() => emit({ type: "authoritative_update", gameId: currentGame.id, clientCommandId }));
  };
  return {
    transport: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getIdentityId: () => "id-human-test",
      getLastEventSeq: () => 0,
      getGameViewModel: () => getDecoratedGame(),
      getAuthoritativeGame: () => clone(currentGame),
      setComputerPlayerRuntimeOverlay: (_gameId, runtimeState = null) => {
        runtimeOverlay = runtimeState ? clone(runtimeState) : null;
        return getDecoratedGame();
      },
      applyLiveGameUpdate: ({ game }) => {
        currentGame = clone(game);
        return getDecoratedGame();
      },
      applyGameAction: async ({ clientCommandId, action, state }) => {
        appliedCommandIds.push(clientCommandId);
        submittedStates.push({
          clientCommandId,
          action: clone(action),
          state: clone(state),
        });
        if (remainingImmediateRejects > 0) {
          remainingImmediateRejects -= 1;
          return {
            ok: true,
            accepted: false,
            clientCommandId,
            game: currentGame,
            state: currentGame.currentSnapshot,
            legalActions: currentGame.legalActions,
          };
        }
        pendingClientCommandId = clientCommandId;
        pendingAction = clone(action);
        return {
          ok: true,
          accepted: true,
          clientCommandId,
          game: currentGame,
          state: currentGame.currentSnapshot,
          legalActions: currentGame.legalActions,
        };
      },
      endTurn: async ({ clientCommandId }) => ({
        ok: true,
        clientCommandId,
        turn: currentGame.currentTurn,
        game: currentGame,
      }),
    },
    commitPendingMove: () => {
      if (!pendingClientCommandId) {
        return;
      }
      const clientCommandId = pendingClientCommandId;
      pendingClientCommandId = null;
      const action = pendingAction;
      pendingAction = null;
      advanceToHumanTurn(currentGame, clientCommandId, action);
    },
    rejectPendingMove: ({
      changeType = "optimistic_rollback",
      failureNotice = "Predicted move was rejected by the authoritative game state.",
      clearedClientCommandIds = null,
    } = {}) => {
      if (!pendingClientCommandId) {
        return;
      }
      const clientCommandId = pendingClientCommandId;
      pendingClientCommandId = null;
      pendingAction = null;
      queueMicrotask(() =>
        emit({
          type: changeType,
          gameId: currentGame.id,
          clientCommandId,
          clearedClientCommandIds,
          failureNotice,
        }),
      );
    },
    emitChange: emit,
    getGame: () => getDecoratedGame(),
    getAppliedCommandIds: () => [...appliedCommandIds],
    getSubmittedStates: () => submittedStates.map((entry) => clone(entry)),
  };
};

const createRevertReadyGame = () => ({
  id: "game-revert",
  createdAt: "2026-04-03T00:00:00.000Z",
  updatedAt: "2026-04-03T00:00:02.000Z",
  lastMoveAt: "2026-04-03T00:00:02.000Z",
  player1: { identityId: "id-test", connected: true },
  player2: { identityId: "id-peer", connected: true },
  viewers: [],
  pendingJoinRequests: [],
  pendingRevertRequest: null,
  myPendingRevertRequest: null,
  approvableRevertRequest: null,
  notifications: ["Ready"],
  myRole: "Player 1",
  inHistoryMode: false,
  historyIndex: null,
  currentSnapshot: { boardSize: 10, sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } },
  board: { state: { boardSize: 10, sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } } },
  turns: [
    {
      index: 0,
      startedAt: "2026-04-03T00:00:00.000Z",
      endedAt: null,
      playerSeat: "Player 1",
      status: "active",
      moveIndexes: [0],
      lastMoveAt: "2026-04-03T00:00:02.000Z",
    },
  ],
  currentTurn: {
    index: 0,
    startedAt: "2026-04-03T00:00:00.000Z",
    endedAt: null,
    playerSeat: "Player 1",
    status: "active",
    moveIndexes: [0],
    lastMoveAt: "2026-04-03T00:00:02.000Z",
  },
  turnOwnerSeat: "Player 1",
  controlSeat: "Player 1",
  control: "turn-owner",
  legalActions: [{ type: "pass" }],
  canRecordMove: false,
  canEndTurn: true,
  canJoinAsPlayer: false,
  canJoinAsViewer: false,
  showJoinActions: true,
  canInvite: true,
  latestActiveMoveId: "move-1",
  canUndoLastMove: true,
  moves: [
    {
      index: 0,
      moveId: "move-1",
      displayMoveNumber: 1,
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P1",
      notation: "M1",
      at: "2026-04-03T00:00:02.000Z",
      action: { type: "project", from: { row: 3, col: 6 }, to: { row: 5, col: 6 } },
      selectionSnapshot: { boardSize: 10, sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
  ],
});

const createHistoryReadyGame = () => ({
  ...createRevertReadyGame(),
  id: "game-history",
  currentSnapshot: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 1,
    pieces: [{ id: "U1", owner: "P1", row: 4, col: 4 }],
    continuation: null,
    outcome: { status: "ongoing" },
  },
  board: {
    state: {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 1,
      pieces: [{ id: "U1", owner: "P1", row: 4, col: 4 }],
      continuation: null,
      outcome: { status: "ongoing" },
    },
  },
  turns: [
    {
      index: 0,
      startedAt: "2026-04-03T00:00:00.000Z",
      endedAt: "2026-04-03T00:00:02.000Z",
      playerSeat: "Player 1",
      status: "complete",
      moveIndexes: [0],
      lastMoveAt: "2026-04-03T00:00:02.000Z",
    },
    {
      index: 1,
      startedAt: "2026-04-03T00:00:03.000Z",
      endedAt: null,
      playerSeat: "Player 2",
      status: "active",
      moveIndexes: [1],
      lastMoveAt: "2026-04-03T00:00:04.000Z",
    },
  ],
  currentTurn: {
    index: 1,
    startedAt: "2026-04-03T00:00:03.000Z",
    endedAt: null,
    playerSeat: "Player 2",
    status: "active",
    moveIndexes: [1],
    lastMoveAt: "2026-04-03T00:00:04.000Z",
  },
  turnOwnerSeat: "Player 2",
  controlSeat: "Player 2",
  control: "turn-owner",
  legalActions: [{ type: "pass" }],
  canRecordMove: true,
  canEndTurn: true,
  latestActiveMoveId: "move-2",
  moves: [
    {
      ...createRevertReadyGame().moves[0],
      index: 0,
      moveId: "move-1",
      displayMoveNumber: 1,
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P1",
      notation: "M1",
      at: "2026-04-03T00:00:02.000Z",
      action: { type: "project", from: { row: 3, col: 6 }, to: { row: 5, col: 6 } },
      selectionSnapshot: {
        boardSize: 10,
        sideToMove: "P2",
        turnIndex: 0,
        pieces: [{ id: "U1", owner: "P1", row: 3, col: 6 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
      snapshot: {
        boardSize: 10,
        sideToMove: "P2",
        turnIndex: 0,
        pieces: [{ id: "U1", owner: "P1", row: 5, col: 6 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
    },
    {
      ...createRevertReadyGame().moves[0],
      index: 1,
      moveId: "move-2",
      displayMoveNumber: 2,
      turnIndex: 1,
      turnMoveIndex: 0,
      actorSide: "P2",
      notation: "M2",
      at: "2026-04-03T00:00:04.000Z",
      action: { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } },
      selectionSnapshot: {
        boardSize: 10,
        sideToMove: "P1",
        turnIndex: 1,
        pieces: [{ id: "U1", owner: "P1", row: 4, col: 4 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
      snapshot: {
        boardSize: 10,
        sideToMove: "P1",
        turnIndex: 1,
        pieces: [{ id: "U1", owner: "P1", row: 5, col: 4 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
    },
  ],
  pendingMoves: [
    {
      index: 2,
      displayMoveNumber: 3,
      turnIndex: 1,
      turnMoveIndex: 1,
      actorSide: "P2",
      notation: "M3",
      at: "2026-04-03T00:00:05.000Z",
      action: { type: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 } },
      selectionSnapshot: {
        boardSize: 10,
        sideToMove: "P1",
        turnIndex: 1,
        pieces: [{ id: "U1", owner: "P1", row: 5, col: 4 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
      snapshot: {
        boardSize: 10,
        sideToMove: "P1",
        turnIndex: 1,
        pieces: [{ id: "U1", owner: "P1", row: 4, col: 4 }],
        continuation: null,
        outcome: { status: "ongoing" },
      },
    },
  ],
  pendingCommandCount: 1,
});

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

test("sync store auto-runs computer-player turns for the active human-controlled seat", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const { transport, commitPendingMove, getGame, getAppliedCommandIds } = createDelayedComputerPlayerTransportHarness(initialGame);
  const requests = [];
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove(request) {
        requests.push(request);
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);

  assert.equal(requests.length, 1);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  assert.equal(getGame().moves.length, 0);
  assert.equal(getAppliedCommandIds().length, 0);

  await clock.advanceBy(799);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  assert.equal(getGame().moves.length, 0);
  assert.equal(getAppliedCommandIds().length, 0);

  await clock.advanceBy(1);

  assert.equal(requests[0].personaId, "tau");
  assert.equal(requests[0].seed, buildComputerPlayerSeed(buildComputerPlayerTurnKey(initialGame), "tau"));
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  assert.equal(getAppliedCommandIds().length, 1);
  assert.equal(getGame().moves.length, 0);

  commitPendingMove();
  await clock.flush();

  assert.equal(getGame().currentTurn.playerSeat, "Player 2");
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
  assert.match(getAppliedCommandIds()[0], /^bot:game-bot:/);
});

test("sync store keeps computer-player runtime in a client-only overlay instead of mutating the authoritative game", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const { transport, games } = createTransportHarness();
  games.set(initialGame.id, clone(initialGame));
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return new Promise(() => {});
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);

  const authoritativeGame = transport.getAuthoritativeGame(initialGame.id);
  const renderedGame = store.getGameViewModel(initialGame.id);
  assert.equal(authoritativeGame?.computerPlayer?.runtime ?? null, null);
  assert.equal(authoritativeGame?.computerPlayer?.activeTurnKey ?? null, null);
  assert.equal(renderedGame?.computerPlayer?.runtime?.status, "thinking");
  assert.equal(renderedGame?.computerPlayer?.activeTurnKey?.length > 0, true);
});

test("sync store still auto-runs computer-player turns while earlier optimistic work is pending", async () => {
  const initialGame = {
    ...buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" }),
    syncStatus: "confirming",
    pendingCommandCount: 1,
  };
  const clock = createFakeClock();
  const { transport, games } = createTransportHarness();
  games.set(initialGame.id, clone(initialGame));
  const runtimeRequests = [];
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove(request) {
        runtimeRequests.push(request);
        return new Promise(() => {});
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);

  assert.equal(runtimeRequests.length, 1);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
});

test("sync store clears terminal computer-player runtime and does not ask the bot to move after game over", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  initialGame.currentSnapshot = {
    ...initialGame.currentSnapshot,
    outcome: { status: "p2_win", reason: "p1_commander_captured" },
  };
  initialGame.board = { state: clone(initialGame.currentSnapshot) };
  initialGame.notifications = ["Player 2 won the game"];
  const clock = createFakeClock();
  const storage = createMemoryStorage();
  storage.setItem(
    LIVE_TRANSPORT_STATE_KEY,
    JSON.stringify({
      games: [],
      warningCode: null,
      pendingMutationsByGameId: {},
      computerPlayerRuntimeByGameId: {
        [initialGame.id]: {
          activeTurnKey: buildComputerPlayerDerivedTurnKey(initialGame),
          status: "failed",
          error: {
            code: "computer_player_failed",
            message: "No legal actions available for Tau the Tenacious",
          },
          retryCount: 1,
          updatedAt: "2026-04-03T00:00:00.000Z",
          thinkingStartedAt: null,
          minimumVisibleUntil: null,
        },
      },
    }),
  );
  const { transport, games } = createTransportHarness();
  games.set(initialGame.id, clone(initialGame));
  let runtimeRequests = 0;
  const store = createSyncStore({
    storage,
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        runtimeRequests += 1;
        return {
          action: { type: "pass" },
          diagnostics: {
            selectedAction: { key: "pass" },
            exploredNodes: 0,
            legalActionCount: 0,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);

  assert.equal(runtimeRequests, 0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
  assert.equal(store.getGameViewModel(initialGame.id)?.computerPlayer?.runtime ?? null, null);
  assert.equal(store.getFailedOperations(initialGame.id).some((operation) => String(operation.id).startsWith("bot:")), false);
});

test("sync store closes computer-player rush continuations with endTurn instead of logging pass", async () => {
  const initialGame = buildComputerPlayerRushClosureGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const { transport, getGame, getAppliedCommandIds, getEndedTurnCommandIds } = createComputerPlayerTransportHarness(initialGame);
  const clock = createFakeClock();
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return {
          action: { type: "pass" },
          diagnostics: {
            selectedAction: { key: "pass" },
            exploredNodes: 120,
            legalActionCount: 1,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  await clock.advanceBy(799);
  assert.equal(getAppliedCommandIds().length, 0);
  assert.equal(getEndedTurnCommandIds().length, 0);

  await clock.advanceBy(1);
  await waitFor(() => getGame().currentTurn.playerSeat === "Player 2");

  assert.equal(getAppliedCommandIds().length, 0);
  assert.equal(getEndedTurnCommandIds().length, 1);
  assert.match(getEndedTurnCommandIds()[0], /^bot:game-bot-rush:.*:end-turn:attempt-0$/);
  assert.equal(getGame().moves.length, 1);
  assert.equal(getGame().moves[0].action.type, "rush");
  assert.equal(getGame().moves.some((move) => move.action?.type === "pass"), false);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
});

test("sync store exposes a recoverable computer-player failure and retries inline", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "babs" });
  const { transport, getGame, getAppliedCommandIds } = createComputerPlayerTransportHarness(initialGame);
  const clock = createFakeClock();
  let attempts = 0;
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("Worker exploded");
          error.code = "computer_player_worker_error";
          throw error;
        }
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  assert.equal(getAppliedCommandIds().length, 0);

  await clock.advanceBy(599);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  assert.equal(getAppliedCommandIds().length, 0);

  await clock.advanceBy(1);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "failed");

  const failedState = store.getComputerPlayerRuntimeState(initialGame.id);
  assert.equal(failedState?.error?.message, "Worker exploded");
  assert.equal(getAppliedCommandIds().length, 0);

  store.retryComputerPlayerTurn({ gameId: initialGame.id });
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");
  await clock.advanceBy(599);
  assert.equal(getGame().currentTurn.playerSeat, "Player 1");
  await clock.advanceBy(1);
  await waitFor(() => getGame().currentTurn.playerSeat === "Player 2");

  assert.equal(attempts, 2);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
  assert.equal(getAppliedCommandIds().length, 1);
});

test("sync store keeps computer-player thinking visible until the move becomes visible", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "babs" });
  const clock = createFakeClock();
  const { transport, commitPendingMove, getGame } = createDelayedComputerPlayerTransportHarness(initialGame);
  const runtimeSnapshots = [];
  const moveSnapshots = [];
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  runtimeSnapshots.push(store.getComputerPlayerRuntimeState(initialGame.id)?.status ?? null);
  moveSnapshots.push(getGame().moves.length);

  await clock.advanceBy(599);
  runtimeSnapshots.push(store.getComputerPlayerRuntimeState(initialGame.id)?.status ?? null);
  moveSnapshots.push(getGame().moves.length);

  await clock.advanceBy(1);
  runtimeSnapshots.push(store.getComputerPlayerRuntimeState(initialGame.id)?.status ?? null);
  moveSnapshots.push(getGame().moves.length);

  commitPendingMove();
  await clock.flush();
  runtimeSnapshots.push(store.getComputerPlayerRuntimeState(initialGame.id)?.status ?? null);
  moveSnapshots.push(getGame().moves.length);

  assert.deepEqual(runtimeSnapshots, ["thinking", "thinking", "thinking", null]);
  assert.deepEqual(moveSnapshots, [0, 0, 0, 1]);
  assert.equal(store.getGameViewModel(initialGame.id)?.moves.length, 1);
});

test("sync store resumes an existing computer-player think deadline from persisted runtime state", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "babs" });
  const clock = createFakeClock({ startMs: Date.parse("2026-04-03T00:00:00.200Z") });
  const storage = createMemoryStorage();
  const thinkingStartedAt = "2026-04-03T00:00:00.000Z";
  const minimumVisibleUntil = "2026-04-03T00:00:00.600Z";
  storage.setItem(
    LIVE_TRANSPORT_STATE_KEY,
    JSON.stringify({
      games: [],
      warningCode: null,
      pendingMutationsByGameId: {},
      computerPlayerRuntimeByGameId: {
        [initialGame.id]: {
          activeTurnKey: buildComputerPlayerDerivedTurnKey(initialGame),
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
  const { transport, getAppliedCommandIds } = createDelayedComputerPlayerTransportHarness(initialGame);
  const store = createSyncStore({
    storage,
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  transport.applyLiveGameUpdate({ game: initialGame });
  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.minimumVisibleUntil, minimumVisibleUntil);

  await clock.advanceBy(399);
  assert.equal(getAppliedCommandIds().length, 0);
  await clock.advanceBy(1);
  assert.equal(getAppliedCommandIds().length, 1);
});

test("sync store keeps a persisted retryable computer-player failure paused until the rollback notice is dismissed", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const storage = createMemoryStorage();
  storage.setItem(
    LIVE_TRANSPORT_STATE_KEY,
    JSON.stringify({
      games: [],
      warningCode: null,
      pendingMutationsByGameId: {},
      computerPlayerRuntimeByGameId: {
        [initialGame.id]: {
          activeTurnKey: buildComputerPlayerDerivedTurnKey(initialGame),
          status: "failed",
          error: {
            code: "computer_player_rejected",
            message: "Predicted move was rejected by the authoritative game state.",
          },
          retryCount: 1,
          updatedAt: "2026-04-03T00:00:00.000Z",
          thinkingStartedAt: null,
          minimumVisibleUntil: null,
        },
      },
    }),
  );
  const { transport, getAppliedCommandIds } = createDelayedComputerPlayerTransportHarness(initialGame);
  const store = createSyncStore({
    storage,
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  transport.applyLiveGameUpdate({ game: initialGame });
  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "failed");
  assert.equal(getAppliedCommandIds().length, 0);
});

test("sync store submits the computer-player move against the original selection snapshot", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const { transport, getGame, getSubmittedStates } = createDelayedComputerPlayerTransportHarness(initialGame);
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  const originalSnapshot = clone(initialGame.currentSnapshot);
  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);

  transport.applyLiveGameUpdate({
    game: {
      ...clone(getGame()),
      currentSnapshot: {
        ...clone(getGame().currentSnapshot),
        pieces: [{ id: "mutated-piece", owner: "P1", kind: "unit", supplied: true, commanded: true, position: { row: 4, col: 4 } }],
      },
      board: {
        state: {
          ...clone(getGame().currentSnapshot),
          pieces: [{ id: "mutated-piece", owner: "P1", kind: "unit", supplied: true, commanded: true, position: { row: 4, col: 4 } }],
        },
      },
    },
  });

  await clock.advanceBy(800);

  assert.equal(getSubmittedStates().length, 1);
  assert.deepEqual(getSubmittedStates()[0].state, originalSnapshot);
});

test("sync store retries retryable computer-player rollbacks after the rollback notice is dismissed", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const { transport, rejectPendingMove, commitPendingMove, getAppliedCommandIds, getGame } =
    createDelayedComputerPlayerTransportHarness(initialGame);
  let attempts = 0;
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        attempts += 1;
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  await clock.advanceBy(800);
  assert.equal(getAppliedCommandIds().length, 1);
  assert.match(getAppliedCommandIds()[0], /:attempt-0$/);

  rejectPendingMove();
  await clock.flush();
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "failed");
  assert.equal(store.getFailedOperations(initialGame.id).some((operation) => operation.id === `rollback:${initialGame.id}`), true);

  store.dismissFailedOperation(`rollback:${initialGame.id}`);
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");

  await clock.advanceBy(800);
  assert.equal(getAppliedCommandIds().length, 2);

  commitPendingMove();
  await clock.flush();

  assert.equal(attempts, 2);
  assert.equal(getGame().currentTurn.playerSeat, "Player 2");
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
});

test("sync store retries immediately rejected computer-player moves from the explicit retry action", async () => {
  const initialGame = buildComputerPlayerGame({ humanSeat: "Player 2", botSeat: "Player 1", botId: "tau" });
  const clock = createFakeClock();
  const { transport, commitPendingMove, getAppliedCommandIds, getGame } =
    createDelayedComputerPlayerTransportHarness(initialGame, { rejectImmediateAttempts: 1 });
  let attempts = 0;
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
    createComputerPlayerRuntime: () => ({
      async selectMove() {
        attempts += 1;
        return {
          action: {
            type: "project",
            actorId: "C1",
            from: { row: 3, col: 6 },
            to: { row: 5, col: 6 },
          },
          diagnostics: {
            selectedAction: { key: "project:C1:3,6->5,6" },
            exploredNodes: 120,
            legalActionCount: 4,
          },
        };
      },
      destroy() {},
    }),
  });

  store.setActiveGameId(initialGame.id);
  await clock.advanceBy(0);
  await clock.advanceBy(800);
  assert.equal(getAppliedCommandIds().length, 1);
  assert.match(getAppliedCommandIds()[0], /:attempt-0$/);

  await clock.flush();
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "failed");
  assert.equal(store.getFailedOperations(initialGame.id).some((operation) => String(operation.id).startsWith("bot:")), true);

  store.retryComputerPlayerTurn({ gameId: initialGame.id });
  await clock.advanceBy(0);
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id)?.status, "thinking");

  await clock.advanceBy(800);
  assert.equal(getAppliedCommandIds().length, 2);

  commitPendingMove();
  await clock.flush();

  assert.equal(attempts, 2);
  assert.equal(getGame().currentTurn.playerSeat, "Player 2");
  assert.equal(store.getComputerPlayerRuntimeState(initialGame.id), null);
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

test("sync store exposes the active game handle for pending and committed games", async () => {
  const { transport, games } = createTransportHarness();
  let releaseCreate;
  const createReady = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      createGame: async (payload) => {
        await createReady;
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
  assert.equal(store.getGameHandle(handle.result.id), handle);

  releaseCreate();
  const committed = await handle.committed;
  const committedHandle = store.getGameHandle(committed.id);
  assert.equal(committedHandle?.status, "committed");
  assert.equal(committedHandle?.result?.id, committed.id);
});

test("sync store keeps a failed create-game stub mounted with a rollback banner", async () => {
  const { transport } = createTransportHarness();
  const desiredGameIds = [];
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      createGame: async () => {
        throw new Error("server_rejected_create");
      },
    }),
    createSyncClient: () => ({
      connectGame: (gameId) => {
        desiredGameIds.push(gameId);
      },
      disconnectGame: (gameId) => {
        const index = desiredGameIds.indexOf(gameId);
        if (index >= 0) {
          desiredGameIds.splice(index, 1);
        }
      },
      disconnectAll: () => {
        desiredGameIds.length = 0;
      },
      getDesiredGameIds: () => [...desiredGameIds],
    }),
  });

  const handle = store.createGame({ selfPlayMode: false });
  store.setActiveGameId(handle.result.id);
  await assert.rejects(handle.committed, /server_rejected_create/);

  const failedGame = store.getGameViewModel(handle.result.id);
  assert.equal(handle.status, "failed");
  assert.equal(
    store.getFailedOperations(handle.result.id)[0]?.error?.message,
    "Game creation failed. The server could not create this game. Return home and try again.",
  );
  assert.equal(failedGame.notifications[0], "Game creation failed");
  assert.equal(failedGame.id, handle.result.id);
  assert.equal((await store.loadGame(handle.result.id)).id, handle.result.id);
  assert.deepEqual(desiredGameIds, []);
});

test("sync store dismisses failed operations and clears the visible rollback notice", async () => {
  const { transport } = createTransportHarness();
  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      createGame: async () => {
        throw new Error("server_rejected_create");
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
  await assert.rejects(handle.committed, /server_rejected_create/);
  const failureId = `rollback:${handle.result.id}`;
  assert.equal(store.getFailedOperations(handle.result.id)[0]?.id, failureId);
  assert.equal(store.getFailedOperations(handle.result.id)[0]?.error?.message?.length > 0, true);

  store.dismissFailedOperation(failureId);

  assert.deepEqual(store.getFailedOperations(handle.result.id), []);
});

test("sync store exposes rollback notices through the shared failed-operation API", () => {
  const { transport, games, listeners } = createTransportHarness();
  games.set("game-rollback", {
    ...createRevertReadyGame(),
    id: "game-rollback",
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  for (const listener of listeners) {
    listener({
      type: "optimistic_desynced",
      gameId: "game-rollback",
      clientCommandId: "game-rollback:id-test:cmd",
      failureNotice: "Move sync failed before confirmation. The board was restored to the last authoritative state.",
    });
  }

  const failedOperations = store.getFailedOperations("game-rollback");
  assert.equal(failedOperations.length, 1);
  assert.equal(failedOperations[0]?.id, "rollback:game-rollback");
  assert.equal(
    failedOperations[0]?.error?.message,
    "Move sync failed before confirmation. The board was restored to the last authoritative state.",
  );

  store.dismissFailedOperation("rollback:game-rollback");

  assert.deepEqual(store.getFailedOperations("game-rollback"), []);
});

test("sync store fails every cleared optimistic handle when a rollback drops the whole suffix", async () => {
  const { transport, games, listeners } = createTransportHarness();
  games.set("game-suffix", {
    ...createRevertReadyGame(),
    id: "game-suffix",
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      applyGameAction: async () => ({
        ok: true,
        accepted: true,
        clientCommandId: "cmd-apply",
        state: { sideToMove: "P2" },
        legalActions: [{ type: "pass" }],
        game: transport.getGameViewModel("game-suffix"),
      }),
      endTurn: async () => ({
        ok: true,
        clientCommandId: "cmd-end-turn",
        turn: { index: 0 },
        game: transport.getGameViewModel("game-suffix"),
      }),
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const actionHandle = await store.applyGameAction({ gameId: "game-suffix", state: {}, action: { type: "pass" } });
  const endTurnHandle = await store.endTurn({ gameId: "game-suffix" });

  for (const listener of listeners) {
    listener({
      type: "optimistic_rollback",
      gameId: "game-suffix",
      clientCommandId: "cmd-apply",
      clearedClientCommandIds: ["cmd-apply", "cmd-end-turn"],
      failureNotice: "Predicted move was rejected by the authoritative game state.",
    });
  }

  await assert.rejects(actionHandle.committed, /Predicted move was rejected/);
  await assert.rejects(endTurnHandle.committed, /Predicted move was rejected/);
  assert.equal(actionHandle.status, "failed");
  assert.equal(endTurnHandle.status, "failed");
});

test("sync store requests reverts optimistically with a stable client request id", async () => {
  const { transport, games } = createTransportHarness();
  games.set("game-revert", createRevertReadyGame());
  let requestPayload = null;
  let resolveRequest;
  const requestCommitted = new Promise((resolve) => {
    resolveRequest = resolve;
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      requestRevertToMove: async (payload) => {
        requestPayload = payload;
        await requestCommitted;
        return {
          ...createRevertReadyGame(),
          pendingRevertRequest: {
            requestId: payload.requestId,
            requesterIdentityId: "id-test",
            targetMoveId: payload.targetMoveId,
            targetMoveIndex: 0,
            requestedAt: "2026-04-03T00:00:03.000Z",
            status: "pending",
          },
          myPendingRevertRequest: {
            requestId: payload.requestId,
            requesterIdentityId: "id-test",
            targetMoveId: payload.targetMoveId,
            targetMoveIndex: 0,
            requestedAt: "2026-04-03T00:00:03.000Z",
            status: "pending",
          },
          notifications: ["Undo request pending approval"],
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

  const handle = store.requestRevertToMove({ gameId: "game-revert", targetMoveId: "move-1" });
  assert.equal(handle.status, "pending");
  assert.match(handle.result.pendingRevertRequest.requestId, /^revert-/);
  assert.equal(store.getGameViewModel("game-revert").pendingRevertRequest.requestId, handle.result.pendingRevertRequest.requestId);

  resolveRequest();
  const committed = await handle.committed;
  assert.equal(requestPayload.requestId, handle.result.pendingRevertRequest.requestId);
  assert.equal(committed.pendingRevertRequest.requestId, handle.result.pendingRevertRequest.requestId);
});

test("sync store rolls back an optimistic revert approval when the server rejects it", async () => {
  const { transport, games } = createTransportHarness();
  const game = createRevertReadyGame();
  game.pendingRevertRequest = {
    requestId: "req-1",
    requesterIdentityId: "id-test",
    targetMoveId: "move-1",
    targetMoveIndex: 0,
    requestedAt: "2026-04-03T00:00:03.000Z",
    status: "pending",
  };
  game.approvableRevertRequest = structuredClone(game.pendingRevertRequest);
  games.set("game-revert", game);

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      approveRevertRequest: async () => {
        throw new Error("revert_approval_rejected");
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.approveRevertRequest({ gameId: "game-revert", requestId: "req-1" });
  assert.equal(handle.status, "pending");
  assert.equal(store.getGameViewModel("game-revert").pendingRevertRequest, null);
  assert.equal(store.getGameViewModel("game-revert").moves[0].undone, true);

  await assert.rejects(handle.committed, /revert_approval_rejected/);
  assert.equal(handle.status, "failed");
  assert.equal(store.getGameViewModel("game-revert").pendingRevertRequest.requestId, "req-1");
  assert.notEqual(store.getGameViewModel("game-revert").moves[0].undone, true);
});

test("sync store computes undo ownership for optimistic revert approval from the current identity", () => {
  const { transport, games } = createTransportHarness();
  const game = {
    ...createRevertReadyGame(),
    player1: { identityId: "id-peer", connected: true },
    player2: { identityId: "id-test", connected: true },
    myRole: "Player 2",
    currentSnapshot: { boardSize: 10, sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    board: { state: { boardSize: 10, sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } } },
    turns: [
      {
        index: 0,
        startedAt: "2026-04-03T00:00:00.000Z",
        endedAt: null,
        playerSeat: "Player 1",
        status: "active",
        moveIndexes: [0, 1],
        lastMoveAt: "2026-04-03T00:00:03.000Z",
      },
    ],
    currentTurn: {
      index: 0,
      startedAt: "2026-04-03T00:00:00.000Z",
      endedAt: null,
      playerSeat: "Player 1",
      status: "active",
      moveIndexes: [0, 1],
      lastMoveAt: "2026-04-03T00:00:03.000Z",
    },
    latestActiveMoveId: "move-2",
    canUndoLastMove: false,
    moves: [
      {
        ...createRevertReadyGame().moves[0],
        moveId: "move-1",
        at: "2026-04-03T00:00:02.000Z",
        selectionSnapshot: {
          boardSize: 10,
          sideToMove: "P2",
          turnIndex: 0,
          pieces: [],
          continuation: null,
          outcome: { status: "ongoing" },
        },
      },
      {
        ...createRevertReadyGame().moves[0],
        index: 1,
        moveId: "move-2",
        displayMoveNumber: 2,
        turnMoveIndex: 1,
        at: "2026-04-03T00:00:03.000Z",
        selectionSnapshot: {
          boardSize: 10,
          sideToMove: "P2",
          turnIndex: 1,
          pieces: [],
          continuation: null,
          outcome: { status: "ongoing" },
        },
      },
    ],
    pendingRevertRequest: {
      requestId: "req-2",
      requesterIdentityId: "id-peer",
      targetMoveId: "move-2",
      targetMoveIndex: 1,
      requestedAt: "2026-04-03T00:00:04.000Z",
      status: "pending",
    },
    approvableRevertRequest: {
      requestId: "req-2",
      requesterIdentityId: "id-peer",
      targetMoveId: "move-2",
      targetMoveIndex: 1,
      requestedAt: "2026-04-03T00:00:04.000Z",
      status: "pending",
    },
  };
  games.set("game-revert", game);

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      approveRevertRequest: async () => ({
        ...game,
        pendingRevertRequest: null,
        approvableRevertRequest: null,
      }),
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.approveRevertRequest({ gameId: "game-revert", requestId: "req-2" });
  assert.equal(handle.result.canUndoLastMove, false);
  assert.equal(store.getGameViewModel("game-revert").canUndoLastMove, false);
});

test("sync store clears a latched history selection when undo approval returns the game to live view", async () => {
  const listeners = new Set();
  const games = new Map();
  const game = {
    ...createRevertReadyGame(),
    pendingRevertRequest: {
      requestId: "req-history-live",
      requesterIdentityId: "id-peer",
      targetMoveId: "move-1",
      targetMoveIndex: 0,
      requestedAt: "2026-04-03T00:00:03.000Z",
      status: "pending",
    },
    approvableRevertRequest: {
      requestId: "req-history-live",
      requesterIdentityId: "id-peer",
      targetMoveId: "move-1",
      targetMoveIndex: 0,
      requestedAt: "2026-04-03T00:00:03.000Z",
      status: "pending",
    },
  };
  games.set(game.id, game);

  const transport = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIdentityId: () => "id-test",
    getLastEventSeq: () => 0,
    getGameViewModel: (gameId) => games.get(gameId) ?? null,
    applyLiveGameUpdate: ({ game: nextGame, clientCommandId = null }) => {
      games.set(nextGame.id, nextGame);
      const changeType = clientCommandId ? "authoritative_update" : "history_mode_changed";
      for (const listener of listeners) {
        listener({ type: changeType, gameId: nextGame.id, clientCommandId });
      }
    },
    selectHistoryMove: async () => {},
    approveRevertRequest: async () => ({
      ...clone(game),
      pendingRevertRequest: null,
      approvableRevertRequest: null,
      myPendingRevertRequest: null,
      inHistoryMode: false,
      historyIndex: null,
    }),
  };

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => transport,
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, true);

  const handle = store.approveRevertRequest({ gameId: game.id, requestId: "req-history-live" });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, false);

  await handle.committed;
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, false);
  assert.equal(store.getGameViewModel(game.id).historyIndex, null);
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

test("sync store selects history locally and keeps the selection latched while live updates append", async () => {
  const { transport, games, listeners } = createTransportHarness();
  const game = createHistoryReadyGame();
  games.set(game.id, game);
  let releaseHistorySync = null;
  const historySyncReady = new Promise((resolve) => {
    releaseHistorySync = resolve;
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      selectHistoryMove: async () => {
        await historySyncReady;
        return games.get(game.id);
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.selectHistoryMove({ gameId: game.id, moveIndex: 2 });
  assert.equal(handle.status, "committed");
  assert.equal(handle.result.inHistoryMode, true);
  assert.equal(handle.result.historyIndex, 2);
  assert.deepEqual(handle.result.currentSnapshot, game.pendingMoves[0].snapshot);

  const liveAppend = {
    ...createHistoryReadyGame(),
    inHistoryMode: true,
    historyIndex: 2,
    pendingMoves: [],
    pendingCommandCount: 0,
    moves: [
      ...createHistoryReadyGame().moves,
      {
        index: 2,
        moveId: "move-3",
        displayMoveNumber: 3,
        turnIndex: 1,
        turnMoveIndex: 1,
        actorSide: "P2",
        notation: "M3",
        at: "2026-04-03T00:00:05.000Z",
        action: { type: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 } },
        selectionSnapshot: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 1,
          pieces: [{ id: "U1", owner: "P1", row: 5, col: 4 }],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        snapshot: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 1,
          pieces: [{ id: "U1", owner: "P1", row: 4, col: 4 }],
          continuation: null,
          outcome: { status: "ongoing" },
        },
      },
    ],
  };
  transport.applyLiveGameUpdate({ game: liveAppend });
  for (const listener of listeners) {
    listener({ type: "authoritative_update", gameId: game.id, clientCommandId: null });
  }

  const latchedView = store.getGameViewModel(game.id);
  assert.equal(latchedView.inHistoryMode, true);
  assert.equal(latchedView.historyIndex, 2);
  assert.equal(latchedView.moves.length, 3);
  assert.deepEqual(latchedView.currentSnapshot, game.pendingMoves[0].snapshot);

  releaseHistorySync?.();
});

test("sync store local history projection prefers the selected move snapshot over selectionSnapshot", () => {
  const { transport, games } = createTransportHarness();
  const game = createHistoryReadyGame();
  games.set(game.id, game);

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      selectHistoryMove: async () => games.get(game.id),
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  assert.equal(handle.result.inHistoryMode, true);
  assert.deepEqual(handle.result.currentSnapshot, game.moves[0].snapshot);
  assert.notDeepEqual(handle.result.currentSnapshot, game.moves[0].selectionSnapshot);
});

test("sync store only preserves a local history latch while the authoritative game remains in history mode", () => {
  const makeStore = () => {
    const { transport, games, listeners } = createTransportHarness();
    const game = createHistoryReadyGame();
    games.set(game.id, game);
    const store = createSyncStore({
      storage: createMemoryStorage(),
      createTransportStore: () => ({
        ...transport,
        selectHistoryMove: async () => games.get(game.id),
      }),
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });
    store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
    return { game, games, listeners, store, transport };
  };

  {
    const { game, listeners, store, transport } = makeStore();
    transport.applyLiveGameUpdate({
      game: {
        ...createHistoryReadyGame(),
        inHistoryMode: true,
        historyIndex: 0,
      },
    });
    for (const listener of listeners) {
      listener({ type: "authoritative_update", gameId: game.id, clientCommandId: null });
    }
    assert.equal(store.getGameViewModel(game.id)?.inHistoryMode, true);
    assert.equal(store.getGameViewModel(game.id)?.historyIndex, 0);
  }

  for (const changeType of ["authoritative_update", "history_mode_changed"]) {
    const { game, listeners, store, transport } = makeStore();
    transport.applyLiveGameUpdate({
      game: {
        ...createHistoryReadyGame(),
        inHistoryMode: false,
        historyIndex: null,
      },
    });
    for (const listener of listeners) {
      listener({ type: changeType, gameId: game.id, clientCommandId: null });
    }
    assert.equal(store.getGameViewModel(game.id)?.inHistoryMode, false);
    assert.equal(store.getGameViewModel(game.id)?.historyIndex, null);
  }
});

test("sync store returns to live immediately without waiting for server history sync", async () => {
  const { transport, games } = createTransportHarness();
  const game = createHistoryReadyGame();
  games.set(game.id, {
    ...game,
    inHistoryMode: true,
    historyIndex: 0,
    historySelectionAction: clone(game.moves[0].action),
    currentSnapshot: clone(game.moves[0].selectionSnapshot),
    canRecordMove: false,
    canEndTurn: false,
  });
  let releaseLiveSync = null;
  const liveSyncReady = new Promise((resolve) => {
    releaseLiveSync = resolve;
  });

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: () => ({
      ...transport,
      returnToLive: async () => {
        await liveSyncReady;
        return games.get(game.id);
      },
    }),
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const handle = store.returnToLive({ gameId: game.id });
  assert.equal(handle.status, "committed");
  assert.equal(handle.result.inHistoryMode, false);
  assert.equal(handle.result.historyIndex, null);
  assert.deepEqual(handle.result.currentSnapshot, game.board.state);
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, false);

  releaseLiveSync?.();
});

test("sync store falls back to a shared-storage branch stub when a second store loads before commit", async () => {
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const createBranchStore = () => {
    const { transport, games } = createTransportHarness();
    games.set("game-source", {
      id: "game-source",
      myRole: "Player 1",
      player1: { identityId: "id-test", connected: true },
      player2: null,
      viewers: [],
    });
    return createSyncStore({
      storage,
      createTransportStore: () => ({
        ...transport,
        loadGame: async () => {
          throw Object.assign(new Error("HTTP_404"), { code: "HTTP_404" });
        },
        launchHistoryBranch: async ({ gameId }) => {
          await branchReady;
          return {
            game: {
              ...(games.get(gameId) ?? {}),
              id: gameId,
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
  };

  const sourceStore = createBranchStore();
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      resultingState: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
    initialSelectionAction: { type: "move", actorId: "U1", from: { row: 1, col: 1 }, to: { row: 2, col: 1 } },
    participantCopyMode: "copy_source_participants",
  });

  const popupStore = createBranchStore();
  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);
  assert.equal(pendingBranch.notifications[0], "History branch pending sync");
  assert.equal(pendingBranch.initialSelectionAction?.actorId, "U1");

  releaseBranch?.();
  const committed = await branchHandle.committed;
  assert.equal(committed.game.id, branchHandle.result.game.id);
});

test("sync store lets an already-created second store discover a pending branch from shared storage", async () => {
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const createBranchStore = () => {
    const { transport, games } = createTransportHarness();
    games.set("game-source", {
      id: "game-source",
      myRole: "Player 1",
      player1: { identityId: "id-test", connected: true },
      player2: null,
      viewers: [],
    });
    return createSyncStore({
      storage,
      createTransportStore: () => ({
        ...transport,
        loadGame: async () => {
          throw Object.assign(new Error("HTTP_404"), { code: "HTTP_404" });
        },
        launchHistoryBranch: async ({ gameId }) => {
          await branchReady;
          return {
            game: {
              ...(games.get(gameId) ?? {}),
              id: gameId,
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
  };

  const popupStore = createBranchStore();
  const sourceStore = createBranchStore();
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      resultingState: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
    initialSelectionAction: { type: "move", actorId: "U1", from: { row: 1, col: 1 }, to: { row: 2, col: 1 } },
    participantCopyMode: "copy_source_participants",
  });

  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);
  assert.equal(pendingBranch.notifications[0], "History branch pending sync");

  releaseBranch?.();
  const committed = await branchHandle.committed;
  assert.equal(committed.game.id, branchHandle.result.game.id);
});

test("sync store keeps a failed shared-storage branch stub hydratable with a failure banner", async () => {
  const storage = createMemoryStorage();
  let releaseBranch = null;
  const branchReady = new Promise((resolve) => {
    releaseBranch = resolve;
  });

  const createBranchStore = () => {
    const { transport, games } = createTransportHarness();
    games.set("game-source", {
      id: "game-source",
      myRole: "Player 1",
      player1: { identityId: "id-test", connected: true },
      player2: null,
      viewers: [],
    });
    return createSyncStore({
      storage,
      createTransportStore: () => ({
        ...transport,
        loadGame: async () => {
          throw Object.assign(new Error("HTTP_404"), { code: "HTTP_404" });
        },
        launchHistoryBranch: async () => {
          await branchReady;
          throw new Error("branch_failed");
        },
      }),
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds: () => [],
      }),
    });
  };

  const sourceStore = createBranchStore();
  const branchHandle = sourceStore.launchHistoryBranch({
    sourceGameId: "game-source",
    sourceMoveIndex: 2,
    scenario: {
      resultingState: { sideToMove: "P1", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    },
    initialSelectionAction: { type: "move", actorId: "U1", from: { row: 1, col: 1 }, to: { row: 2, col: 1 } },
    participantCopyMode: "copy_source_participants",
  });

  const popupStore = createBranchStore();
  const pendingBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(pendingBranch.id, branchHandle.result.game.id);

  releaseBranch?.();
  await assert.rejects(branchHandle.committed, /branch_failed/);
  const failedBranch = await popupStore.loadGame(branchHandle.result.game.id, { openAsViewer: false });
  assert.equal(failedBranch.id, branchHandle.result.game.id);
  assert.equal(failedBranch.notifications[0], "History branch creation failed");
  assert.equal(popupStore.getFailedOperations(branchHandle.result.game.id)[0]?.error?.message, "branch_failed");
});

test("sync store defers move confirmation until optimistic game creation commits", async () => {
  const { transport, games, listeners } = createTransportHarness();
  let resolveCreate = null;
  let sendDeferredApply = null;
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
          sendDeferredApply = () => {
            const committedGame = {
              ...(games.get(gameId) ?? {}),
              pendingMoves: [],
              pendingCommandCount: 0,
              notifications: ["Move committed"],
            };
            transport.applyLiveGameUpdate({ game: committedGame });
            for (const listener of listeners) {
              listener({
                type: "authoritative_update",
                clientCommandId: "cmd-move",
              });
            }
          };
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
        throw new Error("apply should remain deferred until create commits");
      },
      flushPendingCommands: (gameId) => {
        calls.push(`flush:${gameId}`);
        sendDeferredApply?.();
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
  let resolveCreate = null;
  const calls = [];

  const store = createSyncStore({
    storage: createMemoryStorage(),
    createTransportStore: ({ shouldDeferCommandSend }) => ({
      ...transport,
      createGame: async ({ gameId }) => {
        calls.push(`create:${gameId}`);
        return new Promise((resolve) => {
          resolveCreate = () =>
            resolve({
              ...(games.get(`server-${gameId}`) ?? {}),
              id: `server-${gameId}`,
              notifications: ["Game created on wrong id"],
            });
        });
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

  resolveCreate?.();
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
  let resolveBranch = null;
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
        return new Promise((resolve) => {
          resolveBranch = () =>
            resolve({
              game: {
                ...(games.get(`server-${gameId}`) ?? {}),
                id: `server-${gameId}`,
                notifications: ["Branch created on wrong id"],
              },
            });
        });
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

  resolveBranch?.();
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

test("sync store auto-runs a bot turn once and stamps the persisted runtime turn key", async () => {
  const originalSelectMove = globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__;
  const requests = [];
  let releaseSelectMove = null;
  const selectMoveGate = new Promise((resolve) => {
    releaseSelectMove = resolve;
  });
  globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = async (request) => {
    requests.push(request);
    await selectMoveGate;
    return {
      action: request.legalActions[0],
      diagnostics: {
        selectedAction: { key: "pass" },
      },
    };
  };

  try {
    const game = buildComputerPlayerGame();
    const { transport } = createComputerPlayerTransportHarness(game);
    const store = createSyncStore({
      storage: createMemoryStorage(),
      createTransportStore: () => transport,
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds() {
          return [];
        },
      }),
    });

    store.setActiveGameId(game.id);
    await waitFor(() => requests.length === 1);

    const thinkingGame = store.getGameViewModel(game.id);
    assert.equal(thinkingGame?.computerPlayer?.runtime?.status, "thinking");
    assert.equal(thinkingGame?.computerPlayer?.runtime?.activeTurnKey, buildComputerPlayerTurnKey(game));
    assert.equal(requests[0].personaId, "tau");

    releaseSelectMove?.();
    await waitFor(() => store.getGameViewModel(game.id)?.currentTurn?.playerSeat === "Player 2");

    const committedGame = store.getGameViewModel(game.id);
    assert.equal(committedGame?.computerPlayer?.runtime, undefined);
    assert.equal(store.getFailedOperations(game.id).filter((entry) => String(entry.id).startsWith("bot:")).length, 0);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = originalSelectMove;
  }
});

test("sync store keeps a failed bot turn recoverable across reload and requires retry to resume", async () => {
  const originalSelectMove = globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__;
  const storage = createMemoryStorage();
  const failureGame = buildComputerPlayerGame({ gameId: "game-bot-failure" });
  const firstHarness = createComputerPlayerTransportHarness(failureGame);
  const firstCalls = [];
  globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = (request) => {
    firstCalls.push(request);
    throw Object.assign(new Error("computer_player_timeout"), { code: "computer_player_timeout" });
  };

  try {
    const firstStore = createSyncStore({
      storage,
      createTransportStore: () => firstHarness.transport,
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds() {
          return [];
        },
      }),
    });

    firstStore.setActiveGameId(failureGame.id);
    await waitFor(() => firstStore.getGameViewModel(failureGame.id)?.computerPlayer?.runtime?.status === "failed");

    const failedGame = firstStore.getGameViewModel(failureGame.id);
    const failedOperation = firstStore.getFailedOperations(failureGame.id).find((entry) => String(entry.id).startsWith("bot:"));
    assert.ok(failedOperation);
    assert.equal(failedGame?.computerPlayer?.runtime?.status, "failed");
    assert.equal(failedGame?.computerPlayer?.runtime?.error?.code, "computer_player_timeout");
    assert.equal(firstCalls.length, 1);

    const secondGame = buildComputerPlayerGame({ gameId: "game-bot-failure" });
    const secondHarness = createComputerPlayerTransportHarness(secondGame);
    const secondCalls = [];
    let releaseRetry = null;
    const retryGate = new Promise((resolve) => {
      releaseRetry = resolve;
    });
    globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = async (request) => {
      secondCalls.push(request);
      await retryGate;
      return {
        action: request.legalActions[0],
        diagnostics: {
          selectedAction: { key: "pass" },
        },
      };
    };

    const secondStore = createSyncStore({
      storage,
      createTransportStore: () => secondHarness.transport,
      createSyncClient: () => ({
        connectGame() {},
        disconnectGame() {},
        disconnectAll() {},
        getDesiredGameIds() {
          return [];
        },
      }),
    });

    secondStore.setActiveGameId(secondGame.id);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(secondCalls.length, 0);
    assert.equal(secondStore.getGameViewModel(secondGame.id)?.computerPlayer?.runtime?.status, "failed");

    secondStore.retryComputerPlayerTurn({ gameId: secondGame.id });
    await waitFor(() => secondCalls.length === 1);
    releaseRetry?.();
    await waitFor(() => secondStore.getGameViewModel(secondGame.id)?.currentTurn?.playerSeat === "Player 2");

    assert.equal(secondStore.getGameViewModel(secondGame.id)?.computerPlayer?.runtime, undefined);
    assert.equal(secondStore.getFailedOperations(secondGame.id).filter((entry) => String(entry.id).startsWith("bot:")).length, 0);
    assert.equal(secondCalls.length, 1);
  } finally {
    globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ = originalSelectMove;
  }
});
