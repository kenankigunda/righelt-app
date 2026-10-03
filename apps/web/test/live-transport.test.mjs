import test, { beforeEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import assert from "node:assert/strict";
import { createLiveTransportStore as createActualTransportStore } from "../shell/live-transport.js";
import { IDENTITY_KEY } from "../shell/persistence.js";
import {
  applyAction,
  createInitialState,
  listLegalActions,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";
import {
  finalizeResolvedTurn,
  getControlSeatForTurn,
} from "../generated/packages/shared-types/src/shell-live-turn.js";

let sentCommands = new Map();
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); sentCommands = new Map(); });
const createLiveTransportStore = (options) => createActualTransportStore({ ...options, fetcher: (url, init) => {
  if (init?.body) { const body = JSON.parse(init.body); if (body.fingerprint) sentCommands.set(body.clientCommandId, body); }
  return options.fetcher(url, init);
} });
const receipt = (id, accepted = true, eventSeq = 2) => {
  const command = sentCommands.get(id) ?? [...sentCommands.values()].at(-1);
  assert.ok(command, "fixture must receive the real command before acknowledging it");
  return { gameId: command.gameId, identityId: command.identityId, clientCommandId: command.clientCommandId, fingerprint: command.fingerprint,
    outcome: accepted ? "accepted" : "rejected", reason: accepted ? null : "stale_state", eventSeq,
    gameplayRevision: command.expectedGameplayRevision + (accepted ? 1 : 0) };
};
const commandResponse = (body) => { const outcome = receipt(body.clientCommandId, body.accepted !== false, body.eventSeq);
  return Response.json({ ...body, game: { ...body.game, gameplayRevision: outcome.gameplayRevision }, protocolVersion: 2, gameId: outcome.gameId, gameplayRevision: outcome.gameplayRevision, commandOutcomes: [outcome] }); };

const IMPORT_SCENARIO_UUID = "e5e48740-f8e2-4b32-bfbf-c46ec98b5962";
const HISTORY_BRANCH_UUID = "32bfe814-d353-4492-af25-4cb9f9a9dd75";

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
    gameplayRevision: 0,
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: "2026-02-26T00:00:01.000Z",
    updatedAt: "2026-02-26T00:00:01.000Z",
    selfPlayMode: false,
    player1: { identityId: "id-a", connected: true },
    player2: { identityId: "id-b", connected: true },
    viewers: [],
    pendingJoinRequests: [],
    turns: [clone(currentTurn)],
    moves: [
      {
        index: 0,
        moveId: "move-1",
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
    turnOwnerSeat: "Player 1",
    controlSeat: "Player 1",
    control: "turn-owner",
    legalActions: listLegalActions(currentState),
    canRecordMove: true,
    canEndTurn: true,
    showJoinActions: true,
    canInvite: true,
  };
};

const buildAcknowledgedGame = (baseGame, action) => {
  const stable = resolveToStability(baseGame.board.state, { artifactMode: "full" });
  const applied = applyAction(stable, action);
  const nextState = resolveToStability(applied.state, { artifactMode: "full" });
  const turnSettled = nextState.continuation == null;
  const nextMoveIndex = baseGame.moves.length;
  const finalizedTurn = turnSettled
    ? finalizeResolvedTurn({
        state: nextState,
        activeTurn: baseGame.currentTurn,
        endedAt: "2026-02-26T00:00:02.000Z",
        resolveToStability,
      })
    : null;
  if (turnSettled) {
    nextState.sideToMove = finalizedTurn.nextState.sideToMove;
    nextState.turnIndex = finalizedTurn.nextState.turnIndex;
    nextState.continuation = finalizedTurn.nextState.continuation;
    nextState.pieces = finalizedTurn.nextState.pieces;
  } else {
    nextState.sideToMove =
      (getControlSeatForTurn(nextState, baseGame.currentTurn.playerSeat) === "Player 1" ? "P1" : "P2");
    nextState.turnIndex = baseGame.currentTurn.index;
  }

  return {
    ...clone(baseGame),
    gameplayRevision: (baseGame.gameplayRevision ?? 0) + 1,
    lastMoveAt: "2026-02-26T00:00:02.000Z",
    updatedAt: "2026-02-26T00:00:02.000Z",
    moves: [
      ...clone(baseGame.moves),
      {
        index: nextMoveIndex,
        turnIndex: baseGame.currentTurn.index,
        turnMoveIndex: baseGame.currentTurn.moveIndexes.length,
        actorSide: stable.sideToMove,
        at: "2026-02-26T00:00:02.000Z",
        notation: "MOVE 2",
        action: clone(action),
        selectionSnapshot: clone(stable),
        snapshot: clone(nextState),
      },
    ],
    turns: [
      turnSettled
        ? {
            ...clone(baseGame.currentTurn),
            endedAt: "2026-02-26T00:00:02.000Z",
            status: "complete",
            moveIndexes: [...clone(baseGame.currentTurn.moveIndexes), nextMoveIndex],
            lastMoveAt: "2026-02-26T00:00:02.000Z",
          }
        : {
            ...clone(baseGame.currentTurn),
            moveIndexes: [...clone(baseGame.currentTurn.moveIndexes), nextMoveIndex],
            lastMoveAt: "2026-02-26T00:00:02.000Z",
          },
      ...(turnSettled
        ? [clone(finalizedTurn.nextTurn)]
        : []),
    ],
    currentTurn: turnSettled
      ? clone(finalizedTurn.nextTurn)
      : {
          ...clone(baseGame.currentTurn),
          moveIndexes: [...clone(baseGame.currentTurn.moveIndexes), nextMoveIndex],
          lastMoveAt: "2026-02-26T00:00:02.000Z",
        },
    currentSnapshot: clone(nextState),
    board: { state: clone(nextState) },
    turnOwnerSeat: turnSettled ? "Player 2" : baseGame.currentTurn.playerSeat,
    controlSeat: getControlSeatForTurn(nextState, turnSettled ? "Player 2" : baseGame.currentTurn.playerSeat),
    control: getControlSeatForTurn(nextState, turnSettled ? "Player 2" : baseGame.currentTurn.playerSeat) === (turnSettled ? "Player 2" : baseGame.currentTurn.playerSeat) ? "turn-owner" : "opponent",
    legalActions: listLegalActions(nextState),
    canRecordMove: !turnSettled,
    canEndTurn: !turnSettled,
  };
};

const assertOptimisticParity = ({ optimisticView, authoritativeGame }) => {
  assert.deepEqual(optimisticView.currentSnapshot, authoritativeGame.currentSnapshot);
  assert.deepEqual(
    {
      index: optimisticView.currentTurn?.index ?? null,
      playerSeat: optimisticView.currentTurn?.playerSeat ?? null,
      status: optimisticView.currentTurn?.status ?? null,
      moveIndexes: optimisticView.currentTurn?.moveIndexes ?? null,
    },
    {
      index: authoritativeGame.currentTurn?.index ?? null,
      playerSeat: authoritativeGame.currentTurn?.playerSeat ?? null,
      status: authoritativeGame.currentTurn?.status ?? null,
      moveIndexes: authoritativeGame.currentTurn?.moveIndexes ?? null,
    },
  );
  assert.deepEqual(optimisticView.legalActions, authoritativeGame.legalActions);
  assert.equal(optimisticView.controlSeat, authoritativeGame.controlSeat);
  assert.equal(optimisticView.control, authoritativeGame.control);
  assert.equal(optimisticView.canRecordMove, authoritativeGame.canRecordMove);
  assert.equal(optimisticView.canEndTurn, authoritativeGame.canEndTurn);
};

const buildOptimisticParityFetcher = ({ baseGame, acknowledgedGame }) => {
  let resolveApply = null;
  return {
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      }
      return Response.json({ ok: true, games: [] });
    },
    acknowledge: (clientCommandId) =>
      resolveApply?.(
        commandResponse({
          ok: true,
          accepted: true,
          clientCommandId,
          eventSeq: 2,
          game: acknowledgedGame,
        }),
      ),
  };
};

const buildBranchParityVariant = (variant) => {
  const game = buildLiveGame();
  game.id = `game-branch-${variant}`;
  game.currentSnapshot.turnIndex = 4;
  game.board.state.turnIndex = 4;
  game.currentTurn.index = 4;
  game.currentTurn.moveIndexes = [4];
  game.turns = [
    { index: 0, startedAt: "2026-02-26T00:00:00.000Z", endedAt: "2026-02-26T00:00:01.000Z", playerSeat: "Player 1", status: "complete", moveIndexes: [0], lastMoveAt: "2026-02-26T00:00:01.000Z" },
    { index: 1, startedAt: "2026-02-26T00:00:01.000Z", endedAt: "2026-02-26T00:00:02.000Z", playerSeat: "Player 2", status: "complete", moveIndexes: [1], lastMoveAt: "2026-02-26T00:00:02.000Z" },
    { index: 2, startedAt: "2026-02-26T00:00:02.000Z", endedAt: "2026-02-26T00:00:03.000Z", playerSeat: "Player 1", status: "complete", moveIndexes: [2], lastMoveAt: "2026-02-26T00:00:03.000Z" },
    { index: 3, startedAt: "2026-02-26T00:00:03.000Z", endedAt: "2026-02-26T00:00:04.000Z", playerSeat: "Player 2", status: "complete", moveIndexes: [3], lastMoveAt: "2026-02-26T00:00:04.000Z" },
    clone(game.currentTurn),
  ];
  game.moves = [
    { ...clone(game.moves[0]), index: 0, turnIndex: 0, turnMoveIndex: 0, notation: "P1-M1" },
    { ...clone(game.moves[0]), index: 1, turnIndex: 1, turnMoveIndex: 0, actorSide: "P2", notation: "P2-M1" },
    { ...clone(game.moves[0]), index: 2, turnIndex: 2, turnMoveIndex: 0, notation: "P1-M2" },
    { ...clone(game.moves[0]), index: 3, turnIndex: 3, turnMoveIndex: 0, actorSide: "P2", notation: "P2-M2" },
    { ...clone(game.moves[0]), index: 4, turnIndex: 4, turnMoveIndex: 0, notation: "BRANCH READY", snapshot: clone(game.currentSnapshot) },
  ];
  if (variant === "tail-undos") {
    game.moves.push(
      { ...clone(game.moves[4]), index: 5, turnIndex: 4, turnMoveIndex: 1, notation: "UNDONE TAIL 1", undone: true },
      { ...clone(game.moves[4]), index: 6, turnIndex: 5, turnMoveIndex: 0, notation: "UNDONE TAIL 2", undone: true },
    );
  }
  if (variant === "divergent-history") {
    game.moves.push(
      { ...clone(game.moves[4]), index: 5, turnIndex: 4, turnMoveIndex: 1, notation: "ALT CONTINUE", actorSide: "P1", undone: true },
      { ...clone(game.moves[4]), index: 6, turnIndex: 5, turnMoveIndex: 0, notation: "ALT REPLY", actorSide: "P2", undone: true },
    );
  }
  return game;
};

const buildPushRetreatScenario = () => {
  const base = createInitialState();
  const initial = resolveToStability(
    {
      ...base,
      pieces: [
        ...base.pieces,
        { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
        { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
        { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
      ],
    },
    { artifactMode: "full" },
  );
  const pushAction = {
    type: "push",
    actorId: "A1",
    from: { row: 4, col: 1 },
    to: { row: 4, col: 2 },
  };
  const pushed = resolveToStability(applyAction(initial, pushAction).state, { artifactMode: "full" });
  pushed.sideToMove = "P2";
  pushed.turnIndex = 0;
  return { initial, pushAction, pushed };
};

const buildGameForIdentity = ({ gameId, identityId, myRole, state, currentTurn, moves = [] }) => {
  const turnOwnerSeat = currentTurn.playerSeat;
  const controlSeat = getControlSeatForTurn(state, turnOwnerSeat);
  const controlIdentity = controlSeat === "Player 1" ? "id-a" : "id-b";
  const turnOwnerIdentity = turnOwnerSeat === "Player 1" ? "id-a" : "id-b";
  const legalActions = listLegalActions(state);

  return {
    id: gameId,
    gameplayRevision: 0,
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: moves.at(-1)?.at ?? "2026-02-26T00:00:01.000Z",
    updatedAt: moves.at(-1)?.at ?? "2026-02-26T00:00:01.000Z",
    selfPlayMode: false,
    player1: { identityId: "id-a", connected: true },
    player2: { identityId: "id-b", connected: true },
    viewers: [],
    pendingJoinRequests: [],
    turns: [clone(currentTurn)],
    moves: clone(moves),
    notifications: ["Move recorded in turn 1"],
    myRole,
    inHistoryMode: false,
    historyIndex: null,
    currentSnapshot: clone(state),
    board: { state: clone(state) },
    currentTurn: clone(currentTurn),
    controlSeat,
    control: controlSeat === turnOwnerSeat ? "turn-owner" : "opponent",
    legalActions,
    canRecordMove:
      (myRole === "Player 1" || myRole === "Player 2") &&
      controlIdentity === identityId &&
      legalActions.length > 0,
    canEndTurn:
      (myRole === "Player 1" || myRole === "Player 2") &&
      controlSeat === turnOwnerSeat &&
      turnOwnerIdentity === identityId &&
      Boolean(currentTurn.moveIndexes.length),
    showJoinActions: true,
    canInvite: true,
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
    gameplayRevision: 0,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
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
        },
      });
    }

    if (String(url).startsWith("/api/shell/games") && init.method === "POST") {
      return Response.json({
        ok: true,
        game: {
          id: "game-000001",
    gameplayRevision: 0,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
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
        },
      });
    }

    return Response.json({ protocolVersion: 2, ok: true, game: null });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  const created = await store.createGame();
  assert.equal(created.id, "game-000001");

  const joined = await store.joinGame({ gameId: "game-000001", mode: "player", inviteFromRole: null });
  assert.equal(joined.pendingApproval, true);

  assert.equal(calls.some((entry) => String(entry.url).includes("/api/shell/games")), true);
  assert.equal(calls.some((entry) => String(entry.url).includes("/join")), true);
});

test("live transport store posts scenario imports through the shell scenarios endpoint", async () => {
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-scenario");
  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/scenarios/import") {
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
          selfPlayMode: false,
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
  assert.equal(store.getHomeGameCard("game-apply-here")?.id, "game-apply-here");
  assert.equal(store.getHomeGameCard("game-apply-here")?.previewSnapshot?.sideToMove, "P1");
});

test("live transport store posts history branch launches through the shell history endpoint", async () => {
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-branch");
  const fetcher = async (url, init = {}) => {
    if (String(url) === "/api/shell/history/branch") {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.identityId, "id-branch");
      assert.equal(body.sourceGameId, "game-source");
      assert.equal(body.sourceMoveIndex, 2);
      assert.equal(body.participantCopyMode, "viewer_as_side_to_move");
      assert.equal(body.scenario.id, HISTORY_BRANCH_UUID);
      assert.equal(body.scenario.moves.length, 2);
      assert.deepEqual(body.initialSelectionAction.from, { row: 1, col: 1 });
      return Response.json({
        ok: true,
        game: {
          id: "game-branch",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          selfPlayMode: false,
          player1: null,
          player2: { identityId: "id-branch", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          moves: [],
          notifications: ["History branch launched"],
          myRole: "Player 2",
          inHistoryMode: false,
          initialSelectionAction: {
            type: "move",
            actorId: "U1",
            from: { row: 1, col: 1 },
            to: { row: 2, col: 1 },
          },
          currentSnapshot: { sideToMove: "P2", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
          board: { state: { sideToMove: "P2", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } } },
          showJoinActions: true,
          canInvite: true,
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
      id: HISTORY_BRANCH_UUID,
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
    participantCopyMode: "viewer_as_side_to_move",
  });

  assert.equal(result.game.id, "game-branch");
  assert.equal(store.getGameViewModel("game-branch").initialSelectionAction.to.row, 2);
});

test("live transport store loads paged home sections through section-aware query params", async () => {
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-page");
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

  assert.equal(calls[0], "/api/shell/games?identityId=id-page&section=my&page=1&pageSize=6&debug=1");
  assert.equal(page.totalPages, 2);
  assert.equal(page.games.length, 1);
  assert.equal(page.games[0].id, "game-000006");
  assert.equal(page.games[0].moveCount, 1);
  assert.equal(store.getHomeGameCard("game-000006")?.id, "game-000006");
  assert.equal(store.getGameViewModel("game-000006"), null);
});

test("live transport store can promote player 1 to both seats when player 2 is open", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });

    if (String(url).startsWith("/api/shell/games/game-000001/play-as-both") && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 1,
        game: {
          id: "game-000001",
    gameplayRevision: 0,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          selfPlayMode: true,
          player1: { identityId: "id-a", connected: true },
          player2: { identityId: "id-a", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          turns: [],
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          moves: [],
          notifications: ["Play as both players enabled"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          canPlayAsBothPlayers: false,
          showJoinActions: true,
          canInvite: true,
        },
      });
    }

    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  const result = await store.playAsBothPlayers({ gameId: "game-000001" });

  assert.equal(result.game.selfPlayMode, true);
  assert.equal(result.game.player2?.identityId, "id-a");
  assert.equal(calls.some((entry) => entry.url.startsWith("/api/shell/games/game-000001/play-as-both")), true);
});

test("live transport store can promote player 2 to both seats when player 1 is open", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });

    if (String(url).startsWith("/api/shell/games/game-000001/play-as-both") && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 1,
        game: {
          id: "game-000001",
    gameplayRevision: 0,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          selfPlayMode: true,
          player1: { identityId: "id-a", connected: true },
          player2: { identityId: "id-a", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          turns: [],
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          moves: [],
          notifications: ["Play as both players enabled"],
          myRole: "Player 2",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P2", turnIndex: 0, pieces: [] },
          canPlayAsBothPlayers: false,
          showJoinActions: true,
          canInvite: true,
        },
      });
    }

    return Response.json({ ok: true, games: [] });
  };

  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-a");
  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.12345 });
  const result = await store.playAsBothPlayers({ gameId: "game-000001" });

  assert.equal(result.game.selfPlayMode, true);
  assert.equal(result.game.player1?.identityId, "id-a");
  assert.equal(calls.some((entry) => entry.url.startsWith("/api/shell/games/game-000001/play-as-both")), true);
});

test("live transport store ignores stale game snapshots once a newer eventSeq is cached", async () => {
  const gameId = "game-seq-1";
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-a");

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
    gameplayRevision: 0,
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:10.000Z",
          updatedAt: "2026-02-26T00:00:10.000Z",
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
    gameplayRevision: 0,
      createdAt: "2026-02-26T00:00:00.000Z",
      lastMoveAt: "2026-02-26T00:00:11.000Z",
      updatedAt: "2026-02-26T00:00:11.000Z",
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
      board: { state: { sideToMove: "P2", turnIndex: 1, pieces: [] } },
      currentTurn: { index: 1, playerSeat: "Player 2", status: "active", moveIndexes: [], lastMoveAt: null },
      canRecordMove: false,
      canEndTurn: false,
      showJoinActions: true,
      canInvite: true,
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
      return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
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
  assert.match(pending.clientCommandId, /^v2:/);
  assert.ok(pending.clientCommandId.length <= 128);

  const optimisticView = store.getGameViewModel(baseGame.id);
  assert.equal(optimisticView.pendingMoves.length, 1);
  assert.equal(optimisticView.pendingCommandCount, 1);
  assert.equal(optimisticView.moves.length, 1);
  assert.notDeepEqual(optimisticView.currentSnapshot, baseGame.currentSnapshot);
  const optimisticHomeCard = store.getHomeGameCard(baseGame.id);
  assert.equal(optimisticHomeCard.syncStatus, "applying-update");
  assert.equal(optimisticHomeCard.moveCount, 1);
  assert.notDeepEqual(optimisticHomeCard.previewSnapshot, baseGame.currentSnapshot);

  resolveApply?.(
    commandResponse({
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
  const settledHomeCard = store.getHomeGameCard(baseGame.id);
  assert.equal(settledHomeCard.syncStatus, "ready");
  assert.equal(settledHomeCard.moveCount, 2);
});

test("live transport store refreshes a home card from an authoritative remote update without reopening the game", async () => {
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-a");
  const baseGame = buildLiveGame();
  const initialCard = {
    id: baseGame.id,
    createdAt: baseGame.createdAt,
    lastMoveAt: baseGame.lastMoveAt,
    updatedAt: baseGame.updatedAt,
    moveCount: 1,
    previewSnapshot: clone(baseGame.currentSnapshot),
    myRole: "Player 1",
    canJoinAsPlayer: false,
    player1: clone(baseGame.player1),
    player2: clone(baseGame.player2),
  };
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const acknowledgedGame = buildAcknowledgedGame(baseGame, nextAction);

  const store = createLiveTransportStore({
    storage,
    fetcher: async (url) => {
      if (String(url).startsWith("/api/shell/games?")) {
        return Response.json({
          ok: true,
          section: "my",
          page: 0,
          pageSize: 4,
          totalGames: 1,
          totalPages: 1,
          games: [initialCard],
        });
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.12345,
  });

  await store.loadGamesPage({ section: "my", page: 0, pageSize: 4 });
  assert.equal(store.getGameViewModel(baseGame.id), null);
  assert.equal(store.getHomeGameCard(baseGame.id)?.moveCount, 1);
  assert.equal(store.getHomeGameCard(baseGame.id)?.previewSnapshot?.sideToMove, "P1");

  store.applyLiveGameUpdate({
    game: acknowledgedGame,
    eventSeq: 2,
  });

  const updatedHomeCard = store.getHomeGameCard(baseGame.id);
  assert.equal(updatedHomeCard?.moveCount, 2);
  assert.equal(updatedHomeCard?.previewSnapshot?.sideToMove, acknowledgedGame.currentSnapshot.sideToMove);
  assert.equal(updatedHomeCard?.previewSnapshot?.turnIndex, acknowledgedGame.currentSnapshot.turnIndex);
});

test("live transport store can defer command sends until a caller flushes them", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const calls = [];
  let resolveApply = null;
  let deferred = true;

  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
      return new Promise((resolve) => {
        resolveApply = resolve;
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher,
    random: () => 0.12345,
    shouldDeferCommandSend: () => deferred,
  });
  await store.loadGame(baseGame.id);
  calls.length = 0;

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  assert.equal(pending.accepted, true);
  assert.equal(calls.some((entry) => entry.url.endsWith("/apply")), false);
  assert.equal(store.getGameViewModel(baseGame.id)?.pendingCommandCount, 1);

  deferred = false;
  store.flushPendingCommands(baseGame.id);
  await tick();
  assert.equal(calls.some((entry) => entry.url.endsWith("/apply")), true);

  resolveApply?.(
    commandResponse({
      ok: true,
      accepted: true,
      clientCommandId: pending.clientCommandId,
      eventSeq: 2,
      game: buildAcknowledgedGame(baseGame, nextAction),
    }),
  );
  await tick();

  assert.equal(store.getGameViewModel(baseGame.id)?.pendingCommandCount, 0);
});

test("live transport store hands off to the next turn immediately for optimistic turn-ending actions", async () => {
  const baseGame = buildLiveGame();
  const nextAction =
    baseGame.legalActions.find((action) => buildAcknowledgedGame(baseGame, action).currentSnapshot.turnIndex === 1) ??
    baseGame.legalActions[0];
  const acknowledgedGame = buildAcknowledgedGame(baseGame, nextAction);
  const { fetcher, acknowledge } = buildOptimisticParityFetcher({ baseGame, acknowledgedGame });

  const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.31415 });
  await store.loadGame(baseGame.id);

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  assert.equal(pending.accepted, true);

  const optimisticView = store.getGameViewModel(baseGame.id);
  assert.equal(optimisticView.pendingMoves.length, 1);
  assertOptimisticParity({ optimisticView, authoritativeGame: acknowledgedGame });

  acknowledge(pending.clientCommandId);
  await tick();

  const settledView = store.getGameViewModel(baseGame.id);
  assert.equal(settledView.pendingMoves.length, 0);
  assertOptimisticParity({ optimisticView: settledView, authoritativeGame: acknowledgedGame });
});

for (const variant of ["no-undos", "tail-undos", "divergent-history"]) {
  test(`live transport store keeps optimistic turn-ending parity for history branch variant: ${variant}`, async () => {
    const baseGame = buildBranchParityVariant(variant);
    const nextAction =
      baseGame.legalActions.find((action) => buildAcknowledgedGame(baseGame, action).currentSnapshot.turnIndex === 5) ??
      baseGame.legalActions[0];
    const acknowledgedGame = buildAcknowledgedGame(baseGame, nextAction);
    const { fetcher, acknowledge } = buildOptimisticParityFetcher({ baseGame, acknowledgedGame });

    const store = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.2718 });
    await store.loadGame(baseGame.id);

    const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
    assert.equal(pending.accepted, true);

    const optimisticView = store.getGameViewModel(baseGame.id);
    assert.equal(optimisticView.pendingMoves.length, 1);
    assertOptimisticParity({ optimisticView, authoritativeGame: acknowledgedGame });

    acknowledge(pending.clientCommandId);
    await tick();

    const settledView = store.getGameViewModel(baseGame.id);
    assert.equal(settledView.pendingMoves.length, 0);
    assertOptimisticParity({ optimisticView: settledView, authoritativeGame: acknowledgedGame });
  });
}

test("live transport store hands retreat control to the defending player", async () => {
  const scenario = buildPushRetreatScenario();
  const gameId = "game-retreat-control";
  const currentTurn = {
    index: 0,
    startedAt: "2026-02-26T00:00:00.000Z",
    endedAt: null,
    playerSeat: "Player 1",
    status: "active",
    moveIndexes: [0],
    lastMoveAt: "2026-02-26T00:00:01.000Z",
  };
  const moves = [
    {
      index: 0,
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P1",
      at: "2026-02-26T00:00:01.000Z",
      notation: "SETUP MOVE",
      action: { type: "move", actorId: "U1-1", from: { row: 6, col: 5 }, to: { row: 6, col: 4 } },
      selectionSnapshot: clone(scenario.initial),
      snapshot: clone(scenario.initial),
    },
  ];
  const ownerGame = buildGameForIdentity({
    gameId,
    identityId: "id-a",
    myRole: "Player 1",
    state: scenario.initial,
    currentTurn,
    moves,
  });
  const defenderGame = buildGameForIdentity({
    gameId,
    identityId: "id-b",
    myRole: "Player 2",
    state: scenario.pushed,
    currentTurn,
    moves,
  });
  const attackerRetreatView = buildGameForIdentity({
    gameId,
    identityId: "id-a",
    myRole: "Player 1",
    state: scenario.pushed,
    currentTurn,
    moves,
  });
  let resolveApply = null;

  const ownerStore = createLiveTransportStore({
    storage: (() => {
      const storage = createMemoryStorage();
      storage.setItem(IDENTITY_KEY, "id-a");
      return storage;
    })(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${gameId}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: ownerGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${gameId}/apply` && init.method === "POST") {
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.12345,
  });
  await ownerStore.loadGame(gameId);

  const pending = await ownerStore.applyGameAction({
    gameId,
    state: ownerGame.currentSnapshot,
    action: scenario.pushAction,
  });
  assert.equal(pending.accepted, true);

  const optimisticOwner = ownerStore.getGameViewModel(gameId);
  assert.equal(optimisticOwner.controlSeat, "Player 2");
  assert.equal(optimisticOwner.canRecordMove, false);
  assert.equal(optimisticOwner.canEndTurn, false);

  resolveApply?.(
    commandResponse({
      ok: true,
      accepted: true,
      clientCommandId: pending.clientCommandId,
      eventSeq: 2,
      game: attackerRetreatView,
    }),
  );
  await tick();

  const defenderStore = createLiveTransportStore({
    storage: (() => {
      const storage = createMemoryStorage();
      storage.setItem(IDENTITY_KEY, "id-b");
      return storage;
    })(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${gameId}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: defenderGame, eventSeq: 2 });
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.12345,
  });
  await defenderStore.loadGame(gameId);

  const defenderView = defenderStore.getGameViewModel(gameId);
  assert.equal(defenderView.controlSeat, "Player 2");
  assert.equal(defenderView.canRecordMove, true);
  assert.equal(defenderView.canEndTurn, false);
});

test("live transport store notifies subscribers for optimistic enqueue and authoritative ack", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const changes = [];
  let resolveApply = null;

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
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
    commandResponse({
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

test("live transport store notifies subscribers when optimistic sync rolls back or enters confirming", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];

  {
    const rollbackChanges = [];
    let resolveApply = null;
    const fetcher = async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
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
      commandResponse({
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
    const confirmingChanges = [];
    const desyncStore = createLiveTransportStore({
      storage: createMemoryStorage(),
      fetcher: async (url, init = {}) => {
        if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
          return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
        }
        if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
          throw new Error("network_failed");
        }
        return Response.json({ ok: true, games: [] });
      },
      random: () => 0.12345,
    });
    desyncStore.subscribe((change) => {
      confirmingChanges.push(change);
    });
    await desyncStore.loadGame(baseGame.id);
    confirmingChanges.length = 0;

    const pending = await desyncStore.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
    await tick();

    assert.equal(confirmingChanges.some((change) => change.type === "optimistic_confirming" && change.gameId === baseGame.id), true);
    assert.equal(desyncStore.getGameViewModel(baseGame.id)?.syncStatus, "confirming");
    assert.equal(desyncStore.getSyncMetrics().httpConfirmFailed > 0, true);
    desyncStore.applyLiveGameUpdate({
      game: buildAcknowledgedGame(baseGame, nextAction),
      eventSeq: 2,
      clientCommandId: pending.clientCommandId,
      commandOutcome: receipt(pending.clientCommandId),
    });
  }
});

test("live transport store clears pending command when ws confirms after transport failure", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  let applyAttempts = 0;

  const store = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
        applyAttempts += 1;
        throw new Error("network_failed");
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.12345,
  });
  await store.loadGame(baseGame.id);

  const pending = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  await tick();
  assert.equal(store.getGameViewModel(baseGame.id)?.syncStatus, "confirming");

  store.applyLiveGameUpdate({
    game: buildAcknowledgedGame(baseGame, nextAction),
    eventSeq: 2,
    clientCommandId: pending.clientCommandId,
    commandOutcome: receipt(pending.clientCommandId),
  });
  await tick();

  const settled = store.getGameViewModel(baseGame.id);
  assert.equal(settled.pendingCommandCount, 0);
  assert.equal(settled.syncStatus, "ready");
  assert.equal(store.getSyncMetrics().wsConfirmedAfterHttpFail, 1);
  assert.equal(applyAttempts >= 1, true);
});

test("live transport store does not infer end-turn confirmation from move history command ids", async () => {
  const baseGame = buildLiveGame();
  const store = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/end-turn` && init.method === "POST") {
        return new Promise(() => {});
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.12345,
  });
  await store.loadGame(baseGame.id);

  const pendingEnd = await store.endTurn({ gameId: baseGame.id });
  await tick();
  assert.equal(store.getGameViewModel(baseGame.id)?.pendingCommandCount, 1);

  const collidedAuthoritative = clone(baseGame);
  collidedAuthoritative.moves = [
    ...clone(baseGame.moves),
    {
      ...clone(baseGame.moves[0]),
      index: 1,
      clientCommandId: pendingEnd.clientCommandId,
    },
  ];
  store.applyLiveGameUpdate({
    game: collidedAuthoritative,
    eventSeq: 2,
    clientCommandId: null,
  });
  await tick();

  assert.equal(store.getGameViewModel(baseGame.id)?.pendingCommandCount, 1);
});

test("live transport store keeps authoritative history selectable while pending moves exist", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const changes = [];

  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
      return new Promise(() => {});
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/history` && init.method === "POST") {
      return Response.json({
        ok: true,
        eventSeq: 2,
        game: {
          ...clone(baseGame),
          inHistoryMode: true,
          historyIndex: 0,
          historySelectionAction: clone(baseGame.moves[0].action),
          currentSnapshot: clone(baseGame.moves[0].snapshot),
        },
      });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/live` && init.method === "POST") {
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
  assert.deepEqual(historyView.currentSnapshot, baseGame.moves[0].snapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);

  changes.length = 0;
  const liveView = await store.returnToLive({ gameId: baseGame.id });
  assert.equal(liveView.inHistoryMode, false);
  assert.equal(liveView.pendingMoves.length, 1);
  assert.notDeepEqual(liveView.currentSnapshot, baseGame.currentSnapshot);
  assert.equal(changes.some((change) => change.type === "history_mode_changed" && change.gameId === baseGame.id), true);
});

test("live transport store generates unique command ids across store instances", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((action) => action.type !== "pass") ?? baseGame.legalActions[0];
  const fetcher = async (url, init = {}) => {
    if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
      return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
    }
    if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
      return new Promise(() => {});
    }
    return Response.json({ ok: true, games: [] });
  };

  const storeOne = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  const storeTwo = createLiveTransportStore({ storage: createMemoryStorage(), fetcher, random: () => 0.12345 });
  await storeOne.loadGame(baseGame.id);
  await storeTwo.loadGame(baseGame.id);

  const first = await storeOne.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });
  const second = await storeTwo.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });

  assert.equal(typeof first.clientCommandId, "string");
  assert.equal(typeof second.clientCommandId, "string");
  assert.notEqual(first.clientCommandId, second.clientCommandId);
});

test("live transport store posts revert lifecycle endpoints", async () => {
  const storage = createMemoryStorage();
  storage.setItem(IDENTITY_KEY, "id-revert");
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === "/api/shell/games/game-revert/revert-request") {
      return Response.json({
        ok: true,
        eventSeq: 8,
        game: {
          id: "game-revert",
          gameplayRevision: 0,
          turns: [],
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:01.000Z",
          updatedAt: "2026-02-26T00:00:01.000Z",
          player1: { identityId: "id-revert", connected: true },
          player2: { identityId: "id-peer", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          pendingRevertRequest: { requestId: "req-1", requesterIdentityId: "id-revert", targetMoveId: "move-1", targetMoveIndex: 0, status: "pending" },
          moves: [{ index: 0, moveId: "move-1", displayMoveNumber: 1, turnIndex: 0, turnMoveIndex: 0, actorSide: "P1", notation: "M1", at: "2026-02-26T00:00:01.000Z" }],
          notifications: ["Move revert request pending approval"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          showJoinActions: true,
          canInvite: true,
        },
      });
    }
    if (String(url) === "/api/shell/games/game-revert/revert-approve") {
      return Response.json({
        ok: true,
        eventSeq: 9,
        game: {
          id: "game-revert",
          gameplayRevision: 0,
          turns: [],
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:02.000Z",
          player1: { identityId: "id-revert", connected: true },
          player2: { identityId: "id-peer", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          pendingRevertRequest: null,
          moves: [{ index: 0, moveId: "move-1", displayMoveNumber: 1, undone: true, turnIndex: 0, turnMoveIndex: 0, actorSide: "P1", notation: "M1", at: "2026-02-26T00:00:01.000Z" }],
          notifications: ["Move history reverted"],
          myRole: "Player 2",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          showJoinActions: true,
          canInvite: true,
        },
      });
    }
    if (String(url) === "/api/shell/games/game-revert/revert-reject") {
      return Response.json({
        ok: true,
        eventSeq: 10,
        game: {
          id: "game-revert",
          gameplayRevision: 0,
          turns: [],
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:02.000Z",
          updatedAt: "2026-02-26T00:00:02.000Z",
          player1: { identityId: "id-revert", connected: true },
          player2: { identityId: "id-peer", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          pendingRevertRequest: null,
          moves: [{ index: 0, moveId: "move-1", displayMoveNumber: 1, turnIndex: 0, turnMoveIndex: 0, actorSide: "P1", notation: "M1", at: "2026-02-26T00:00:01.000Z" }],
          notifications: ["Move revert request rejected"],
          myRole: "Player 2",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          showJoinActions: true,
          canInvite: true,
        },
      });
    }
    if (String(url) === "/api/shell/games/game-revert/revert-rescind") {
      return Response.json({
        ok: true,
        eventSeq: 11,
        game: {
          id: "game-revert",
          gameplayRevision: 0,
          turns: [],
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: "2026-02-26T00:00:02.000Z",
          updatedAt: "2026-02-26T00:00:02.000Z",
          player1: { identityId: "id-revert", connected: true },
          player2: { identityId: "id-peer", connected: true },
          viewers: [],
          pendingJoinRequests: [],
          pendingRevertRequest: null,
          moves: [{ index: 0, moveId: "move-1", displayMoveNumber: 1, turnIndex: 0, turnMoveIndex: 0, actorSide: "P1", notation: "M1", at: "2026-02-26T00:00:01.000Z" }],
          notifications: ["Move revert request rescinded"],
          myRole: "Player 1",
          inHistoryMode: false,
          currentSnapshot: { sideToMove: "P1", turnIndex: 0, pieces: [] },
          board: { state: { sideToMove: "P1", turnIndex: 0, pieces: [] } },
          showJoinActions: true,
          canInvite: true,
        },
      });
    }
    return Response.json({ ok: true, games: [] });
  };

  const store = createLiveTransportStore({ storage, fetcher, random: () => 0.1 });
  await store.requestRevertToMove({ gameId: "game-revert", targetMoveId: "move-1", requestId: "req-client-1" });
  await store.approveRevertRequest({ gameId: "game-revert", requestId: "req-1" });
  const approvedHomeCard = store.getHomeGameCard("game-revert");
  assert.equal(approvedHomeCard?.moveCount, 1);
  assert.equal(approvedHomeCard?.previewSnapshot?.sideToMove, "P1");
  await store.rejectRevertRequest({ gameId: "game-revert", requestId: "req-1" });
  await store.rescindRevertRequest({ gameId: "game-revert", requestId: "req-1" });

  assert.equal(calls.some((entry) => entry.url === "/api/shell/games/game-revert/revert-request"), true);
  assert.equal(calls.some((entry) => entry.url === "/api/shell/games/game-revert/revert-approve"), true);
  assert.equal(calls.some((entry) => entry.url === "/api/shell/games/game-revert/revert-reject"), true);
  assert.equal(calls.some((entry) => entry.url === "/api/shell/games/game-revert/revert-rescind"), true);
  const requestCall = calls.find((entry) => entry.url === "/api/shell/games/game-revert/revert-request");
  const approveCall = calls.find((entry) => entry.url === "/api/shell/games/game-revert/revert-approve");
  const rejectCall = calls.find((entry) => entry.url === "/api/shell/games/game-revert/revert-reject");
  const rescindCall = calls.find((entry) => entry.url === "/api/shell/games/game-revert/revert-rescind");
  assert.equal(requestCall.body.identityId, "id-revert");
  assert.equal(requestCall.body.targetMoveId, "move-1");
  assert.equal(requestCall.body.requestId, "req-client-1");
  assert.equal(approveCall.body.identityId, "id-revert");
  assert.equal(approveCall.body.requestId, "req-1");
  assert.equal(rejectCall.body.identityId, "id-revert");
  assert.equal(rejectCall.body.requestId, "req-1");
  assert.equal(rescindCall.body.identityId, "id-revert");
  assert.equal(rescindCall.body.requestId, "req-1");
});

// ---------------------------------------------------------------------------
// I-11 — Optimistic move response includes destroyedPieces
// ---------------------------------------------------------------------------
// The optimistic path (applyGameAction before the authoritative response
// returns) must surface destroyedPieces on the returned result so that
// the shell can render DESTROYED sub-bullets immediately without waiting
// for the server ack.
test("I-11: applyGameAction optimistic result carries destroyedPieces array", async () => {
  const baseGame = buildLiveGame();
  const nextAction = baseGame.legalActions.find((a) => a.type !== "pass") ?? baseGame.legalActions[0];

  // Fetcher keeps the apply response pending so we can inspect the optimistic state
  const store = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      if (String(url) === `/api/shell/games/${baseGame.id}/apply` && init.method === "POST") {
        // Never resolves — keeps command pending so we observe the optimistic state
        return new Promise(() => {});
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.77777,
  });

  await store.loadGame(baseGame.id);
  const result = await store.applyGameAction({ gameId: baseGame.id, state: baseGame.currentSnapshot, action: nextAction });

  // The transport return value must carry destroyedPieces (may be empty for a
  // move that doesn't remove pieces, but the field must exist and be an array).
  assert.equal(result.accepted, true, "action was optimistically accepted");
  assert.ok(
    Object.prototype.hasOwnProperty.call(result, "destroyedPieces"),
    "I-11: optimistic result must carry destroyedPieces field",
  );
  assert.ok(Array.isArray(result.destroyedPieces), "I-11: destroyedPieces must be an array");
});

// ---------------------------------------------------------------------------
// I-12 — Multi-client: P2 receives identical destroyedPieces in game snapshot
// ---------------------------------------------------------------------------
// When P1 records a destructive move and the server broadcasts the result,
// the P2 store (loaded as a separate identity) must receive the same
// destroyedPieces on the affected move as P1 sees.
test("I-12: two client stores receive identical destroyedPieces on the same move via applyLiveGameUpdate", async () => {
  const baseGame = buildLiveGame();
  const acknowledgedGame = buildAcknowledgedGame(baseGame, baseGame.legalActions[0]);

  // Inject a synthetic destroyedPieces array onto the acknowledged game's new move
  // to simulate a destructive move coming back from the server.
  const destroyedPieces = [
    { position: { row: 3, col: 4 }, ownerSeat: "p2", reason: "no_retreat" },
  ];
  const lastMoveIndex = acknowledgedGame.moves.length - 1;
  acknowledgedGame.moves[lastMoveIndex] = {
    ...acknowledgedGame.moves[lastMoveIndex],
    destroyedPieces,
  };

  // Store A (P1 — the actor)
  const storeA = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher: async (url) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`)) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 });
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.11111,
  });

  // Store B (P2 — the observer; different identity via separate MemoryStorage)
  const storageB = createMemoryStorage();
  const storeB = createLiveTransportStore({
    storage: storageB,
    fetcher: async (url) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`)) {
        // P2's initial load returns the base game
        return Response.json({ protocolVersion: 2, ok: true, game: { ...clone(baseGame), myRole: "Player 2" }, eventSeq: 1 });
      }
      return Response.json({ ok: true, games: [] });
    },
    random: () => 0.22222,
  });

  await storeA.loadGame(baseGame.id);
  await storeB.loadGame(baseGame.id);

  // Simulate the server broadcasting the authoritative move to both stores
  storeA.applyLiveGameUpdate({ game: acknowledgedGame, eventSeq: 2 });
  storeB.applyLiveGameUpdate({ game: { ...clone(acknowledgedGame), myRole: "Player 2" }, eventSeq: 2 });

  const viewA = storeA.getGameViewModel(baseGame.id);
  const viewB = storeB.getGameViewModel(baseGame.id);

  const moveA = viewA?.moves?.find((m) => m.index === lastMoveIndex);
  const moveB = viewB?.moves?.find((m) => m.index === lastMoveIndex);

  assert.ok(moveA, "I-12: store A must have the new move");
  assert.ok(moveB, "I-12: store B must have the new move");
  assert.ok(Array.isArray(moveA.destroyedPieces), "I-12: P1 store move must carry destroyedPieces");
  assert.ok(Array.isArray(moveB.destroyedPieces), "I-12: P2 store move must carry destroyedPieces");
  assert.deepEqual(
    moveA.destroyedPieces,
    moveB.destroyedPieces,
    "I-12: both stores must have identical destroyedPieces on the same move",
  );
});

test("discard preserves unknown submitted commands, their retry ownership, journal and eventual outcome", async () => {
 const game=buildLiveGame();let removed=0;let reconciles=0;
 const journal={admit:async()=>{},list:async()=>[],remove:async()=>{removed++;}};
 const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:journal,
  timing:{requestTimeoutMs:100,confirmationBudgetMs:500,retryDelaysMs:[30],retryJitter:0},
  fetcher:async(url,init)=>{
   if(String(url).includes("?"))return Response.json({protocolVersion:2,ok:true,game,eventSeq:1});
   if(String(url).endsWith("apply"))throw Error("unknown delivery");
   if(String(url).endsWith("reconcile")){reconciles++;const command=JSON.parse(init.body).commands[0];return Response.json({protocolVersion:2,ok:true,gameId:game.id,gameplayRevision:0,eventSeq:1,
    commandOutcomes:[{gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:"rejected",reason:"stale_state",gameplayRevision:0,eventSeq:1}]});}
  }});
 await store.loadGame(game.id);
 const action=listLegalActions(game.board.state).find(a=>a.type==="move");
 const response=await store.applyGameAction({gameId:game.id,state:game.board.state,action});
 await tick();store.discardPendingCommands(game.id);
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,1);assert.equal(removed,0);
 await new Promise(resolve=>setTimeout(resolve,70));
 assert.ok(reconciles>0);assert.equal(removed,1);assert.equal(store.getCommandOutcome(game.id,response.clientCommandId).outcome,"rejected");
});

test('home list reads abort at the shared request deadline without retrying', async () => {
  let signal, calls = 0;
  const store = createLiveTransportStore({ storage: createMemoryStorage(), timing: { requestTimeoutMs: 20 }, fetcher: (_url, init) => {
    calls++;
    signal = init.signal;
    return new Promise(() => {});
  } });
  const outcome = await Promise.race([store.loadGamesPage({ section: 'my' }).then(() => 'resolved', error => error.code), new Promise(resolve => setTimeout(() => resolve('unbounded'), 100))]);
  assert.equal(outcome, 'request_timeout');
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  store.retire();
});

test('invite reads bound response-body completion and never retry automatically', async () => {
  let signal, calls = 0;
  const store = createLiveTransportStore({ storage: createMemoryStorage(), timing: { requestTimeoutMs: 20 }, fetcher: async (_url, init) => {
    calls++;
    signal = init.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  } });
  await assert.rejects(store.resolveInvite('held-invite'), { code: 'request_timeout' });
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  store.retire();
});
