import test, { beforeEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import assert from "node:assert/strict";
import { writeSync as writeCleanupFailure } from "node:fs";
import { createLiveTransportStore as createActualTransportStore } from "../shell/live-transport.js";
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { createCommandJournal } from '../shell/command-journal.js';
import { issueDiagnostics } from '../shell/issue-diagnostics.js';
import { STORAGE_GENERATION_HEADER } from '../generated/packages/shared-types/src/storage-policy.js';
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
import { ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION, commandFingerprint, isCommandOutcome } from '../generated/packages/shared-types/src/sync-protocol.js';

test('initial shared capability timeout preserves intent and never submits it', async t => {
 const game = buildLiveGame(), storage = createMemoryStorage(); storage.setItem(IDENTITY_KEY, 'id-a');
 const envelope = { protocolVersion: 2, gameId: game.id, identityId: 'id-a', clientCommandId: 'v2:unknown-capability',
  kind: 'shared', payload: { operation: 'computer-control', values: { action: 'pause' } },
  expectedState: game.board.state, expectedGameplayRevision: game.gameplayRevision };
 envelope.fingerprint = await commandFingerprint(envelope);
 let removed = 0; const reads = [];
 const store = createLiveTransportStore({ storage, commandJournal: { list: async () => [envelope], remove: async () => { removed++; } },
  timing: { requestTimeoutMs: 20, recoveryPassMs: 80, retryDelaysMs: [1000], retryJitter: 0 },
  fetcher: (url, init) => { reads.push({ url, init }); return new Promise(() => {}); } });
 t.after(() => store.retire());
 await store.reconcileGame(game.id);
 assert.ok(reads.length > 0);
 for (const { init } of reads) {
  assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
  assert.equal(init.headers['X-Righelt-Projection'], 'history-v1');
  assert.equal(init.signal.aborted, true);
 }
 assert.equal(store.getGameViewModel(game.id), null);
 assert.equal(store.getCommandOutcome(game.id, envelope.clientCommandId), null);
 assert.equal(store.isUpgradeRequired(game.id), false); assert.equal(removed, 0);
});

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

for(const computer of [false,true])for(const reason of ['computer_control_changed','stale_state','state_capacity_exceeded'])test(`computer rollback notices remain quiet only for transient computer outcomes computer=${computer} reason=${reason}`,async t=>{
 const game=buildLiveGame(),storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
 let resolveRollback;const rollback=new Promise(resolve=>resolveRollback=resolve);let sent;
 const store=createLiveTransportStore({storage,fetcher:async(url,init={})=>{
  if(init.method==='GET')return Response.json({ok:true,protocolVersion:2,game,eventSeq:1});
  if(String(url).endsWith('/apply')){
   sent=JSON.parse(init.body);const outcome={...receipt(sent.clientCommandId,false,2),reason};
   return Response.json({ok:true,accepted:false,protocolVersion:2,gameId:game.id,game,eventSeq:2,gameplayRevision:game.gameplayRevision,commandOutcomes:[outcome]});
  }
  return Response.json({ok:true,games:[]});
 }});t.after(()=>store.retire());
 t.after(store.subscribe(change=>{if(change.type==='optimistic_rollback')resolveRollback(change);}));
 await store.loadGame(game.id);
 const proof={deviceId:crypto.randomUUID(),generation:1,modelId:'initial-1554',profile:'babs',profileVersion:'experimental-v1',seed:1,attemptId:crypto.randomUUID()};
 await store.applyGameAction({gameId:game.id,state:game.board.state,action:game.legalActions[0],...(computer?{computer:proof}:{})});
 const change=await rollback;
 assert.equal(change.computer,computer);
 assert.equal(Boolean(change.failureNotice),!(computer&&['computer_control_changed','stale_state'].includes(reason)));
 assert.equal(store.getCommandOutcome(game.id,sent.clientCommandId).reason,reason);
 assert.deepEqual(store.getGameViewModel(game.id).currentSnapshot,game.board.state);
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
  const initial = createInitialState();
  initial.pieces.push(...[['L',3,3],['A',4,4],['B',5,3]].map(([id,row,col])=>({id,owner:'P1',kind:'unit',position:{row,col},supplied:true,commanded:true})),
    {id:'E',owner:'P2',kind:'unit',position:{row:4,col:2},supplied:true,commanded:true});
  const state=resolveToStability(applyAction(resolveToStability(initial),{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}}).state);
  baseGame.board.state=state; baseGame.currentSnapshot=state; baseGame.legalActions=listLegalActions(state);
  const store = createLiveTransportStore({
    storage: createMemoryStorage(),
    fetcher: async (url, init = {}) => {
      if (String(url).startsWith(`/api/shell/games/${baseGame.id}?`) && (!init.method || init.method === "GET")) {
        return Response.json({ protocolVersion: 2, ok: true, game: baseGame, eventSeq: 1 }, {headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)}});
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

// Regression: receipt recovery is independent of replacement socket readiness.
test("HTTP recovery resumes mutations without waiting for an unavailable socket", async () => {
  const game = buildLiveGame();
  const store = createLiveTransportStore({ storage: createMemoryStorage(), beforeReconcile: () => new Promise(() => {}),
    commandJournal: { list: async () => [], remove: async () => {}, admit: async () => {} },
    timing: { requestTimeoutMs: 20, recoveryPassMs: 60, confirmationBudgetMs: 100, retryDelaysMs: [10], retryJitter: 0 },
    fetcher: async () => Response.json({ protocolVersion: 2, gameId: game.id, eventSeq: 2, gameplayRevision: 0, game, commandOutcomes: [] }) });
  store.applyLiveGameUpdate({ game, eventSeq: 1 });
  store.setConnectionRecovering(game.id, true);
  await Promise.race([store.reconcileGame(game.id), new Promise((_, reject) => setTimeout(() => reject(Error("recovery held by socket")), 150))]);
  assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked, false);
  store.retire();
});
test("stalled hydration releases recovery ownership and allows another pass", async () => {
  const game = buildLiveGame(); let stalled = true;
  const store = createLiveTransportStore({ storage: createMemoryStorage(),
    commandJournal: { list: () => stalled ? new Promise(() => {}) : Promise.resolve([]), remove: async () => {}, admit: async () => {} },
    timing: { requestTimeoutMs: 10, recoveryPassMs: 25, confirmationBudgetMs: 100, retryDelaysMs: [10], retryJitter: 0 },
    fetcher: async () => Response.json({ protocolVersion: 2, gameId: game.id, eventSeq: 2, gameplayRevision: 0, game, commandOutcomes: [] }) });
  store.applyLiveGameUpdate({ game, eventSeq: 1 }); store.setConnectionRecovering(game.id, true);
  await assert.rejects(store.reconcileGame(game.id), /recovery_timeout/);
  stalled = false; await store.reconcileGame(game.id);
  assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked, false); store.retire();
});

test("timed-out recovery retries HTTP even without another socket ready event", async () => {
  const game=buildLiveGame();let reads=0;
  const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:()=>++reads===1?new Promise(()=>{}):Promise.resolve([]),remove:async()=>{}},
   timing:{requestTimeoutMs:10,recoveryPassMs:20,confirmationBudgetMs:100,retryDelaysMs:[5],retryJitter:0},
   fetcher:async()=>Response.json({protocolVersion:2,gameId:game.id,eventSeq:2,gameplayRevision:0,game,commandOutcomes:[]})});
  store.applyLiveGameUpdate({game,eventSeq:1});store.setConnectionRecovering(game.id,true);
  await assert.rejects(store.reconcileGame(game.id),/recovery_timeout/);
  for(let i=0;i<30&&store.getGameViewModel(game.id).recovering;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(store.getGameViewModel(game.id).recovering,false);assert.ok(reads>=2);store.retire();
});
test("retirement settles an in-progress recovery and ignores late hydration",async()=>{
 const game=buildLiveGame();let release;const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:()=>new Promise(r=>{release=r}),close:async()=>{}},fetcher:async()=>{throw Error("retired fetch");}});
 store.applyLiveGameUpdate({game,eventSeq:1});const recovery=store.reconcileGame(game.id);await tick();store.retire();
 await assert.rejects(recovery,/session_changed/);release([]);await tick();
});

test("recovery deadline preserves a pending command and retries its accepted receipt",async()=>{
 const game=buildLiveGame(), storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,"id-a");let envelope, recovered=false;
 const action=game.legalActions[0], acknowledged=buildAcknowledgedGame(game,action);
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[],admit:async()=>{},remove:async()=>{}},
  timing:{requestTimeoutMs:200,recoveryPassMs:20,confirmationBudgetMs:100,retryDelaysMs:[5],retryJitter:0},
  fetcher:async(url,init)=>{if(url.endsWith("apply")){envelope=JSON.parse(init.body);return new Promise(()=>{});}recovered=true;return commandResponse({ok:true,game:acknowledged,eventSeq:2,clientCommandId:envelope.clientCommandId});}});
 store.applyLiveGameUpdate({game,eventSeq:1});await store.applyGameAction({gameId:game.id,state:game.board.state,action});
 const original=structuredClone(envelope);store.setConnectionRecovering(game.id,true);await assert.rejects(store.reconcileGame(game.id),/recovery_timeout/);
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,1);
 for(let i=0;i<30&&store.getGameViewModel(game.id).pendingCommandCount;i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(recovered);assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked,false);assert.deepEqual(envelope,original);store.retire();
});

test("manual reconnect supersedes an old snapshot wait and requests a fresh snapshot",async()=>{
 const game=buildLiveGame();let release;const requests=[];
 const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:async()=>[],close:async()=>{}},fetcher:async(_url,init)=>{
  requests.push(JSON.parse(init.body));if(requests.length===1)return new Promise(resolve=>release=resolve);
  return Response.json({protocolVersion:2,gameId:game.id,eventSeq:2,gameplayRevision:game.gameplayRevision??0,game,commandOutcomes:[]});
 }});
 store.applyLiveGameUpdate({game,eventSeq:1});store.setConnectionRecovering(game.id,true);
 const old=store.reconcileGame(game.id);const retired=assert.rejects(old,/recovery_superseded/);await tick();
 store.prepareSafeReconnect(game.id);const fresh=store.reconcileGame(game.id);
 release(Response.json({protocolVersion:2,gameId:game.id,eventSeq:1,gameplayRevision:game.gameplayRevision??0,commandOutcomes:[]}));
 await retired;await fresh;assert.equal(requests[1].knownSnapshotEventSeq,0);assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked,false);store.retire();
});

for(const lateCommit of [false,true])test(`uncertain admission ${lateCommit?"committed late":"was not committed"} recovers the original command exactly once`,async()=>{
 const game=buildLiveGame(),storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,"id-a");let saved=[],admissions=0,applies=0,original;
 const journal={list:async(_identity,gameId)=>saved.filter(e=>!gameId||e.gameId===gameId),admit:async envelope=>{
  admissions++;original??=structuredClone(envelope);
  if(admissions===1){if(lateCommit)saved=[structuredClone(envelope)];throw Object.assign(Error("journal_timeout"),{code:"journal_timeout"});}
  if(!saved.some(e=>e.clientCommandId===envelope.clientCommandId))saved.push(structuredClone(envelope));
 },remove:async envelope=>{saved=saved.filter(e=>e.clientCommandId!==envelope.clientCommandId);},close:async()=>{}};
 const store=createLiveTransportStore({storage,commandJournal:journal,fetcher:async(url,init)=>{
  const body=JSON.parse(init.body);if(String(url).endsWith("/reconcile"))return Response.json({protocolVersion:2,gameId:game.id,eventSeq:1,gameplayRevision:0,game,commandOutcomes:body.commands.map(e=>({gameId:game.id,identityId:e.identityId,clientCommandId:e.clientCommandId,fingerprint:e.fingerprint,outcome:"unknown",reason:null,eventSeq:1,gameplayRevision:0}))});
  applies++;assert.deepEqual(body,original);return commandResponse({game:buildAcknowledgedGame(game,body.payload.action,body.clientCommandId),clientCommandId:body.clientCommandId,eventSeq:2});
 }});
 store.applyLiveGameUpdate({game,eventSeq:1});await assert.rejects(store.applyGameAction({gameId:game.id,state:game.board.state,action:game.legalActions[0]}),/journal_timeout/);
 assert.equal(applies,0);assert.equal(store.getGameViewModel(game.id).storageBlocked,true);
 await store.retrySaving(game.id);await tick();assert.equal(applies,1);assert.equal(admissions,lateCommit?1:2);
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);assert.equal(store.getGameViewModel(game.id).storageBlocked,false);assert.deepEqual(saved,[]);store.retire();
});

test('Retry-After delays command and lifecycle reconciliation through the same recovery owner',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-25T00:00:00Z')});
 const game=buildLiveGame(),storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
 const action=game.legalActions[0],acknowledged=buildAcknowledgedGame(game,action);const requests=[];
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[],admit:async()=>{},remove:async()=>{}},
 timing:{requestTimeoutMs:5000,recoveryPassMs:10000,confirmationBudgetMs:15000,retryDelaysMs:[10],retryJitter:0},fetcher:async()=>{
   requests.push(Date.now());
   if(requests.length===1)return Response.json({ok:false,error:'temporarily_unavailable'},{status:503,headers:{'Retry-After':'2'}});
   return commandResponse({ok:true,game:acknowledged,eventSeq:2});
 }});
 t.after(()=>{store.retire();t.mock.timers.reset();});
 store.applyLiveGameUpdate({game,eventSeq:1});await store.applyGameAction({gameId:game.id,state:game.board.state,action});
 for(let i=0;i<30;i++)await Promise.resolve();
 await assert.rejects(store.reconcileGame(game.id),/retry_delayed/);
 assert.equal(requests.length,1);
 t.mock.timers.tick(1999);for(let i=0;i<20;i++)await Promise.resolve();assert.equal(requests.length,1);
 t.mock.timers.tick(1);for(let i=0;i<50;i++)await Promise.resolve();
 assert.equal(requests.length,2);assert.ok(requests[1]-requests[0]>=2000);
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);
});

for(const status of [404,405]) test(`missing reconciliation endpoint ${status} establishes legacy version with one bounded read`,async(t)=>{
 const baseGame=buildLiveGame();let reads=0,reconciles=0;
 const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:async()=>[]},beforeReconcile:async()=>true,
   fetcher:async(url,init)=>{
    if(url.endsWith('/reconcile')){reconciles++;return Response.json({error:'not_found'},{status});}
    reads++;assert.equal(init.method,'GET');return Response.json({protocolVersion:1,ok:true,game:baseGame,eventSeq:1});
   }});
 t.after(()=>store.retire());
 await assert.rejects(store.loadGame(baseGame.id),error=>error.code==='upgrade_required');
 assert.equal(reconciles,1);assert.equal(reads,1);
 assert.equal(store.isUpgradeRequired(baseGame.id),true);
 assert.equal(store.getGameViewModel(baseGame.id),null,'unsupported snapshots cannot populate the board');
});

for(const status of [404,405]) test(`known incompatibility during reconciliation ${status} stops the legacy discovery read`,async t=>{
 const game=buildLiveGame();let finish,reads=0,reconciles=0;
 const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:async()=>[]},beforeReconcile:async()=>true,
  fetcher:async(url,init)=>{
   if(url.endsWith('/reconcile')){reconciles++;return new Promise(resolve=>{finish=resolve;});}
   reads++;assert.equal(init.method,'GET');return Response.json({protocolVersion:2,ok:true,game,eventSeq:1});
  }});
 t.after(()=>store.retire());const loading=store.loadGame(game.id);
 while(!finish)await Promise.resolve();
 store.markUpgradeRequired(game.id);finish(Response.json({error:'not_found'},{status}));
 await assert.rejects(loading,error=>error.code==='upgrade_required');
 assert.equal(reconciles,1);assert.equal(reads,0);assert.equal(store.getGameViewModel(game.id),null);
});

for (const accepted of [true,false]) test(`validated unknown receipts stay pending through the original budget and settle ${accepted?'accepted':'rejected'} once`,async t=>{
 const game=buildLiveGame(),storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
 const action=game.legalActions[0],saved=new Map(),removed=[],envelopes=[];
 let settle=false,unknownReplies=0;
 const store=createLiveTransportStore({storage,
  commandJournal:{list:async()=>[...saved.values()],admit:async e=>saved.set(e.clientCommandId,clone(e)),remove:async e=>{removed.push(e.clientCommandId);saved.delete(e.clientCommandId);},close:async()=>{}},
  timing:{requestTimeoutMs:500,confirmationBudgetMs:120,retryDelaysMs:[10],retryJitter:0},
  fetcher:async(url,init)=>{
   const payload=JSON.parse(init.body),commands=payload.commands??[payload];
   for(const command of commands)envelopes.push(clone(command));
   if(settle){const command=commands[0];return commandResponse({ok:true,accepted,game:accepted?buildAcknowledgedGame(game,action):game,eventSeq:2,clientCommandId:command.clientCommandId});}
   unknownReplies++;
   return Response.json({protocolVersion:2,gameId:game.id,eventSeq:1,gameplayRevision:0,game,
    commandOutcomes:commands.map(e=>({gameId:game.id,identityId:e.identityId,clientCommandId:e.clientCommandId,fingerprint:e.fingerprint,outcome:'unknown',reason:null,eventSeq:1,gameplayRevision:0}))});
  }});
 t.after(()=>store.retire());store.applyLiveGameUpdate({game,eventSeq:1});
 await store.applyGameAction({gameId:game.id,state:game.board.state,action});
 for(let i=0;i<20&&unknownReplies<3;i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(unknownReplies>=3,'multiple validated replies exercise retry ownership');
 const original=clone(envelopes[0]),pending=store.getGameViewModel(game.id);
 assert.equal(pending.pendingCommandCount,1);assert.equal(pending.sharedMutationsBlocked,true);assert.equal(pending.recoveryIssue,null);
 assert.equal(pending.pendingActorSide,'P1');assert.equal(pending.incidentId,null,'unresolved receipts are not unavailable incidents');
 assert.equal(saved.size,1);assert.equal(removed.length,0);
 for(let i=0;i<40&&!store.getGameViewModel(game.id).confirmationOverdue;i++)await new Promise(r=>setTimeout(r,5));
 const overdue=store.getGameViewModel(game.id);assert.equal(overdue.confirmationOverdue,true,'retries do not reset original deadline');
 assert.equal(overdue.recoveryIssue,null);assert.equal(overdue.pendingCommandCount,1);assert.equal(overdue.sharedMutationsBlocked,true);
 assert.ok(envelopes.every(e=>JSON.stringify(e)===JSON.stringify(original)),'only original immutable envelope is retried');
 settle=true;
 for(let i=0;i<40&&store.getGameViewModel(game.id).pendingCommandCount;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);assert.equal(saved.size,0);assert.deepEqual(removed,[original.clientCommandId]);
 assert.equal(store.getAuthoritativeGame(game.id).moves.length,game.moves.length+(accepted?1:0));
});

test('external errors cannot impersonate the private unresolved receipt signal',async t=>{
 const game=buildLiveGame(),storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[],admit:async()=>{},remove:async()=>{},close:async()=>{}},
  timing:{retryDelaysMs:[1000],retryJitter:0},fetcher:async()=>{throw Error('outcome_unknown');}});
 t.after(()=>store.retire());store.applyLiveGameUpdate({game,eventSeq:1});
 await store.applyGameAction({gameId:game.id,state:game.board.state,action:game.legalActions[0]});
 for(let i=0;i<20&&!store.getGameViewModel(game.id).recoveryIssue;i++)await tick();
 const pending=store.getGameViewModel(game.id);
 assert.equal(pending.recoveryIssue,'unavailable');assert.ok(pending.incidentId);assert.equal(pending.pendingCommandCount,1);assert.equal(pending.sharedMutationsBlocked,true);
});

test('a held computer control fences human submission without changing its board or journal identity',async t=>{
 const storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
 const game=buildLiveGame();game.sharedReceipts=true;
 const saved=new Map(),requests=[],projections=[];let envelope,release;
 const store=createLiveTransportStore({storage,
  rulesExecutor:{asynchronous:true,project(scope,input){projections.push({scope,queueLength:input.queue.length});return Promise.resolve(projectOptimisticGame(input));},cancel(){},cancelAll(){}},
  commandJournal:{list:async()=>[...saved.values()],admit:async value=>saved.set(value.clientCommandId,clone(value)),remove:async value=>saved.delete(value.clientCommandId),close:async()=>{}},
  fetcher:(url,init)=>{requests.push({url,body:JSON.parse(init.body)});envelope=JSON.parse(init.body);return new Promise(resolve=>{release=resolve;});},
 });
 store.setRulesActiveGame(game.id,true);store.applyLiveGameUpdate({game,eventSeq:1});
 const before=clone(store.getAuthoritativeGame(game.id));
 const completion=store.computerControl(game.id,{action:'renew',deviceId:'device',generation:1}).then(value=>({ok:true,value}),error=>({ok:false,error}));
 try{
 for(let i=0;i<50&&!envelope;i++)await tick();assert.ok(envelope);
 const original=clone(envelope),pending=store.getGameViewModel(game.id);
 assert.deepEqual(projections,[],"shared-only control must not start a gameplay worker");assert.equal(pending.rulesChecking,false);
 assert.equal(pending.pendingComputerControl,true);assert.equal(pending.sharedMutationsBlocked,true);assert.equal(pending.canRecordMove,false);
 assert.deepEqual(saved.get(original.clientCommandId),original);assert.deepEqual(original.expectedState,before.board.state);assert.equal(original.expectedGameplayRevision,before.gameplayRevision);
 await assert.rejects(store.applyGameAction({gameId:game.id,state:before.board.state,action:game.legalActions[0]}),{code:'sync_recovering'});
 assert.equal(requests.length,1,'the blocked action must not become a second request');
 assert.deepEqual(store.getAuthoritativeGame(game.id),before);assert.deepEqual(saved.get(original.clientCommandId),original);
 const outcome={gameId:game.id,identityId:original.identityId,clientCommandId:original.clientCommandId,fingerprint:original.fingerprint,outcome:'accepted',reason:null,eventSeq:2,gameplayRevision:before.gameplayRevision};
 release(Response.json({ok:true,accepted:true,protocolVersion:2,gameId:game.id,game:before,eventSeq:2,gameplayRevision:before.gameplayRevision,commandOutcomes:[outcome]}));
 const settled=await completion;assert.equal(settled.ok,true,'the original held control must actually fulfill after release');
 assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked,false);assert.equal(store.getGameViewModel(game.id).pendingComputerControl,false);
 assert.equal(saved.size,0);assert.deepEqual(store.getAuthoritativeGame(game.id),before);assert.deepEqual(envelope,original);
 await tick();assert.equal(requests.length,1,'settling the fence must not automatically resubmit the rejected human intent');
 }finally{store.retire();await completion;}
});

for (const operation of ["computer-control", "revert-request"]) for(const accepted of [true,false]) for(const repair of [null,"connection","snapshot"]) test(`socket ${accepted ? "acceptance" : "rejection"} completes ${operation} while preserving ${repair ?? "no newer"} recovery`,async()=>{
 const storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,"id-live");
 let envelope,signal;
 const store=createLiveTransportStore({storage,fetcher:(url,init)=>{
  envelope=JSON.parse(init.body);signal=init.signal;
  return new Promise(()=>{});
 }});
 const game=buildLiveGame();game.sharedReceipts=true;
 store.applyLiveGameUpdate({game,eventSeq:1});
 const completion=operation==="computer-control"?store.computerControl(game.id,{action:"acquire",deviceId:"device",tabId:"tab"}):store.requestRevertToMove({gameId:game.id,targetMoveId:game.moves[0].moveId});
 const settled=completion.then(()=>({ok:true}),error=>({ok:false,error}));
 for(let i=0;i<50&&!envelope;i++)await tick();
 assert.ok(envelope);
 assert.equal(store.getGameViewModel(game.id).pendingComputerControl,operation==="computer-control");
 assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked,true);
 if(repair==="connection")store.setConnectionRecovering(game.id,true);
 if(repair==="snapshot")store.prepareSafeReconnect(game.id);
 const outcome={gameId:game.id,identityId:envelope.identityId,clientCommandId:envelope.clientCommandId,fingerprint:envelope.fingerprint,outcome:accepted?"accepted":"rejected",reason:accepted?null:"stale_state",eventSeq:2,gameplayRevision:game.gameplayRevision};
 store.applyLiveGameUpdate({game,eventSeq:2,commandOutcome:outcome});
 assert.equal((await settled).ok,accepted);
 assert.equal(signal.aborted,true,"socket confirmation retires the HTTP request");
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);
 assert.equal(store.getGameViewModel(game.id).pendingComputerControl,false);
 assert.equal(store.getGameViewModel(game.id).recovering,Boolean(repair));
 assert.equal(store.getGameViewModel(game.id).sharedMutationsBlocked,Boolean(repair));
 if(repair)store.setConnectionRecovering(game.id,false);
 if(repair!=="snapshot") {
  assert.equal(store.getGameViewModel(game.id).canRecordMove,game.canRecordMove);
  assert.equal(store.getAuthoritativeGame(game.id).canRecordMove,game.canRecordMove);
 }
 store.retire();
});


test("invalid socket snapshot followed by empty authoritative reconciliation releases recovery",async()=>{
 const game=buildLiveGame();
 const store=createLiveTransportStore({storage:createMemoryStorage(),fetcher:async()=>Response.json({ok:true,protocolVersion:2,gameId:game.id,gameplayRevision:game.gameplayRevision,eventSeq:2,game,commandOutcomes:[]})});
 store.applyLiveGameUpdate({game,eventSeq:1});
 store.applyLiveGameUpdate({game,eventSeq:-1});
 await store.reconcileGame(game.id);
 assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);
 assert.equal(store.getGameViewModel(game.id).syncStatus,"ready");
 assert.equal(store.getGameViewModel(game.id).recovering,false);
 assert.equal(store.getGameViewModel(game.id).canRecordMove,game.canRecordMove);
 store.retire();
});


for(const accepted of [true,false]) for(const newerRepair of [false,true]) test(`HTTP shared ${accepted?"acceptance":"rejection"} preserves newer repair=${newerRepair}`,async()=>{
 const storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,"id-live");let envelope,reply;
 const game=buildLiveGame();game.sharedReceipts=true;
 const store=createLiveTransportStore({storage,fetcher:(url,init)=>{
  envelope=JSON.parse(init.body);return new Promise(resolve=>{reply=resolve;});
 }});
 store.applyLiveGameUpdate({game,eventSeq:1});
 const completion=store.computerControl(game.id,{action:"acquire",deviceId:"device",tabId:"tab"}).then(()=>true,()=>false);
 for(let i=0;i<50&&!envelope;i++)await tick();
 assert.ok(envelope);
 if(newerRepair)store.setConnectionRecovering(game.id,true);
 reply(Response.json({ok:true,protocolVersion:2,gameId:game.id,eventSeq:2,gameplayRevision:game.gameplayRevision,game,commandOutcomes:[{gameId:game.id,identityId:envelope.identityId,clientCommandId:envelope.clientCommandId,fingerprint:envelope.fingerprint,outcome:accepted?"accepted":"rejected",reason:accepted?null:"stale_state",eventSeq:2,gameplayRevision:game.gameplayRevision}]}));
 assert.equal(await completion,accepted);
 assert.equal(store.getGameViewModel(game.id).recovering,newerRepair);
 store.setConnectionRecovering(game.id,false);
 assert.equal(store.getGameViewModel(game.id).canRecordMove,game.canRecordMove);
 store.retire();
});

for(const status of [404,405])for(const protocolVersion of [1,2]) test(`missing reconciliation endpoint ${status} retains bounded protocol ${protocolVersion} discovery without a command submission`,async(t)=>{
 const baseGame=buildLiveGame();let reads=0,reconciles=0;
 const store=createLiveTransportStore({storage:createMemoryStorage(),commandJournal:{list:async()=>[]},beforeReconcile:async()=>true,
   fetcher:async(url,init)=>{
    if(url.endsWith('/reconcile')){reconciles++;return Response.json({error:'not_found'},{status});}
    assert.equal(init.method,'GET','Only a read may follow missing-route discovery');
    assert.match(url,new RegExp(`/api/shell/games/${baseGame.id}\\?`));
    reads++;return Response.json({protocolVersion,ok:true,game:baseGame,eventSeq:1});
   }});
 t.after(()=>store.retire());
 if(protocolVersion===1)await assert.rejects(store.loadGame(baseGame.id),error=>error.code==='upgrade_required');
 else await store.loadGame(baseGame.id);
 assert.equal(reconciles,1);assert.equal(reads,1);
 if(protocolVersion===1)assert.equal(store.getGameViewModel(baseGame.id),null);
 else assert.equal(store.getGameViewModel(baseGame.id).id,baseGame.id);
});

// These tests reproduce the transport's observed cleanup failure boundary, not
// the unobserved cause of WebKit's IndexedDB delay. All durable rows and later
// successful operations use the real journal and its committed transactions.
const cleanupTimeout = () => Object.assign(new Error('journal_timeout'), {code:'journal_timeout'});
// Record actual fixture operations and public transport events. A fixed number
// of event-loop turns cannot establish IndexedDB or async fingerprint completion.
const cleanupRealSetTimeout=globalThis.setTimeout,cleanupRealClearTimeout=globalThis.clearTimeout;
const cleanupGatesByTest=new WeakMap();
const stopIncompleteCleanupWorker = error => {
  // Only this node:test file worker exits: pending old mock-clock callbacks must
  // never survive into another fixture after a failed owned cleanup.
  try{writeCleanupFailure(2,`Cleanup fixture did not settle; stopping its test worker: ${error?.stack??error}\n`);}
  finally{process.exit(1);}
};
const cleanupPhaseLog = t => {
  const entries=[],listeners=new Set(),deadlines=new Set();
  t.after(()=>{for(const timer of deadlines)cleanupRealClearTimeout(timer);deadlines.clear();listeners.clear();});
  return {
    record(type,detail){const entry={type,...detail};entries.push(entry);for(const check of [...listeners])check();},
    wait(type,ordinal=1,match=()=>true){
      return new Promise((resolve,reject)=>{
        const timer=cleanupRealSetTimeout(()=>{deadlines.delete(timer);listeners.delete(check);reject(new Error(`Missing cleanup phase ${type} #${ordinal}`));},5000);
        deadlines.add(timer);
        const check=()=>{const entry=entries.filter(value=>value.type===type&&match(value))[ordinal-1];if(entry){listeners.delete(check);cleanupRealClearTimeout(timer);deadlines.delete(timer);resolve(entry);}};
        listeners.add(check);check();
      });
    },
  };
};
const terminalCleanupStore = async (t,label,{auth=null,accepted=true}={}) => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  const storage=createMemoryStorage();storage.setItem(IDENTITY_KEY,'id-a');
  let game=buildLiveGame();game.id=`game-cleanup-${label}`;game.sharedReceipts=true;
  if(auth?.enabled)game.ownershipMode='account_v1';
  const indexedDB=new IDBFactory(),durable=createCommandJournal({indexedDB});
  const calls={admit:[],list:[],remove:[],network:[]},completions=[],journalSettlements=[],ownedGates=new Set(),phases=cleanupPhaseLog(t);let eventSeq=1;
  cleanupGatesByTest.set(t,ownedGates);
  const operation=(kind,detail,run)=>{
    const completion=(async()=>run())();
    // Keep an always-settled observation separate from the real rejection path.
    const settled=completion.then(value=>({ok:true,value}),error=>({ok:false,error}));
    journalSettlements.push(settled);
    phases.record(kind,{...detail,settled});return completion;
  };
  const hooks={remove:async(_envelope,remove,count)=>{if(count===1)throw cleanupTimeout();return remove();}};
  const journal={
    admit:envelope=>{calls.admit.push(clone(envelope));const count=calls.admit.length;return operation('admit',{envelope:clone(envelope),count},()=>hooks.admit?hooks.admit(envelope,()=>durable.admit(envelope),count):durable.admit(envelope));},
    list:(...args)=>{calls.list.push(clone(args));const count=calls.list.length;return operation('list',{args:clone(args),count},()=>hooks.list?hooks.list(args,()=>durable.list(...args),count):durable.list(...args));},
    remove:envelope=>{
      calls.remove.push(clone(envelope));const count=calls.remove.length;
      return operation('remove',{envelope:clone(envelope),count},()=>hooks.remove?hooks.remove(envelope,()=>durable.remove(envelope),count):durable.remove(envelope));
    },
    close:()=>durable.close(),
  };
  const store=createActualTransportStore({storage,commandJournal:journal,auth,
    timing:{requestTimeoutMs:5000,recoveryPassMs:10000,confirmationBudgetMs:15000,retryDelaysMs:[500,1000],retryJitter:0},
    fetcher:async(url,init)=>{
      if(init.method==='GET'&&String(url).startsWith('/api/shell/games?')){
        calls.network.push({url,body:null});
        return Response.json({ok:true,games:[game],page:0,pageSize:6,total:1});
      }
      const body=JSON.parse(init.body);calls.network.push({url,body:clone(body)});
      const shared=String(url).endsWith('/shared'),apply=String(url).endsWith('/apply');
      if(String(url).endsWith('/reconcile')){
        phases.record('reconcile-request',{body:clone(body)});
        if(hooks.reconcileResponse)await hooks.reconcileResponse(body);
      }
      if(shared)phases.record('shared-request',{envelope:clone(body)});
      if(shared&&hooks.sharedResponse)await hooks.sharedResponse(body);
      if(apply)game=buildAcknowledgedGame(game,body.payload.action);
      if(apply)game.gameplayRevision=body.expectedGameplayRevision+1;
      const commandOutcomes=shared||apply?[{
        gameId:game.id,identityId:body.identityId,clientCommandId:body.clientCommandId,fingerprint:body.fingerprint,
        outcome:accepted?'accepted':'rejected',reason:accepted?null:'stale_state',eventSeq:++eventSeq,gameplayRevision:game.gameplayRevision,
      }]:(body.commands??[]).map(command=>{
        // The authoritative resolver reports an unrecorded command as unknown;
        // only that exact receipt permits the transport's idempotent replay.
        const outcome={gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,
          outcome:'unknown',reason:'not_recorded',eventSeq,gameplayRevision:game.gameplayRevision};
        assert.ok(isCommandOutcome(outcome,command));return outcome;
      });
      if(hooks.receipt&&commandOutcomes.length)hooks.receipt(commandOutcomes[0],body);
      assert.ok(shared||apply||String(url).endsWith('/reconcile'),'unexpected fixture request');
      return Response.json({ok:true,accepted:true,protocolVersion:2,gameId:game.id,game,
        eventSeq,gameplayRevision:game.gameplayRevision,commandOutcomes},{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION),...(auth?.storageGeneration?{[STORAGE_GENERATION_HEADER]:auth.storageGeneration}:{})}});
    },
  });
  t.after(store.subscribe(change=>{if(change.gameId===game.id)phases.record('change',{change});}));
  t.after(async()=>{
    const deadline=cleanupRealSetTimeout(()=>stopIncompleteCleanupWorker(new Error('Cleanup fixture journal settlement timed out')),5000);
    try{
      store.retire();
      // Cancel only fixture-owned holds, never invent a successful transaction.
      for(const gate of ownedGates)gate.reject(Object.assign(new Error('fixture_retired'),{code:'session_changed'}));
      await Promise.allSettled([...completions,...journalSettlements]);
      await durable.close();
    }catch(error){stopIncompleteCleanupWorker(error);}
    cleanupRealClearTimeout(deadline);ownedGates.clear();cleanupGatesByTest.delete(t);
    // Reached only after real settlement and close, never on cleanup timeout.
    t.mock.timers.reset();
  });
  store.applyLiveGameUpdate({game,eventSeq});
  // Complete genuine initial journal hydration so later network catch-up cannot
  // itself retry storage cleanup as a side effect of initial hydration.
  await store.reconcileGame(game.id);
  return {store,durable,indexedDB,game,calls,hooks,view:()=>store.getGameViewModel(game.id),
    control:()=>{const completion=store.computerControl(game.id,{action:'renew',deviceId:'cleanup-device',generation:1}).then(value=>({ok:true,value}),error=>({ok:false,error}));completions.push(completion);return completion;},
    replaceGame:next=>{game=next;store.applyLiveGameUpdate({game,eventSeq:++eventSeq});},
    phase:phases.wait,
    change:(type,ordinal=1,code=null)=>phases.wait('change',ordinal,entry=>entry.change.type===type&&(!code||entry.change.error?.code===code)),
    settled:async(kind,ordinal)=>{const entry=await phases.wait(kind,ordinal);return entry.settled;},
    advance:async ms=>{t.mock.timers.tick(ms);}};
};
const terminalCleanupFixture = async (t,label,options) => {
  const h=await terminalCleanupStore(t,label,options),{store,durable,game,calls}=h;
  const result=await h.control();assert.equal(result.ok,options?.accepted!==false);
  await h.change('journal_blocked',1,'journal_timeout');
  const command=calls.network.find(entry=>String(entry.url).endsWith('/shared')).body;
  assert.equal(command.payload.operation,'computer-control');
  assert.equal(store.getCommandOutcome(game.id,command.clientCommandId).outcome,options?.accepted===false?'rejected':'accepted');
  assert.equal(store.getGameViewModel(game.id).pendingCommandCount,0);
  assert.equal(store.getGameViewModel(game.id).storageBlocked,true,'the observed cleanup timeout must fence the real transport');
  assert.deepEqual(await durable.list('id-a',game.id),[command],'the acknowledged original envelope remains durable');
  assert.deepEqual(calls.remove,[command]);
  return {...h,command};
};

test('terminal receipt cleanup recovers after a timeout using only its original durable envelope',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'recovers');
  const before=clone(h.store.getAuthoritativeGame(h.game.id)),networkBefore=clone(h.calls.network),listCallsBefore=h.calls.list.length;
  await h.advance(499);assert.equal(h.calls.remove.length,1,'no retry before the existing first delay');
  await h.advance(1);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false,'verified local cleanup should release its own storage fence');
  assert.equal(h.view().sharedMutationsBlocked,false);
  assert.deepEqual(h.calls.remove,[h.command,h.command],'cleanup retries the exact original envelope once');
  assert.ok(h.calls.list.length>listCallsBefore,'release requires an actual journal readback');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  assert.deepEqual(h.calls.network,networkBefore,'local cleanup must not reconcile, resubmit control, or submit gameplay');
  assert.deepEqual(h.store.getAuthoritativeGame(h.game.id),before);
  assert.deepEqual(h.calls.admit,[h.command],'cleanup must not create or admit a new command');
});

test('terminal receipt cleanup diagnostic remains open until storage is verified despite network recovery',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'diagnostic');
  const incidentId=h.view().incidentId;assert.ok(incidentId);
  assert.equal(issueDiagnostics.get(incidentId).initial.stage,'journal_cleanup');
  assert.equal(issueDiagnostics.get(incidentId).initial.code,'journal_timeout');
  h.store.setConnectionRecovering(h.game.id,true);
  await h.store.reconcileGame(h.game.id);
  assert.equal(h.view().recovering,false,'network catch-up really completed');
  assert.equal(h.view().storageBlocked,true,'network success is not successful storage cleanup');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[h.command]);
  const incident=issueDiagnostics.get(incidentId);assert.ok(incident);
  assert.equal(incident.resolvedAt==null,true,'an outstanding storage fence must keep its incident open');
  await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  assert.ok(issueDiagnostics.get(incidentId).resolvedAt,'verified cleanup and completed network recovery may resolve the incident');
});

const cleanupDeferred = t => {
  let resolve,reject,settled=false;
  const promise=new Promise((yes,no)=>{
    resolve=value=>{if(!settled){settled=true;yes(value);}};
    reject=error=>{if(!settled){settled=true;no(error);}};
  });
  // Failure teardown may cancel a hold before its assertion reaches the await.
  void promise.catch(()=>{});
  const gate={promise,resolve,reject};cleanupGatesByTest.get(t)?.add(gate);return gate;
};
const cleanupScope = () => ({enabled:true,storageGeneration:'cleanup-storage',session:{authenticated:true,contextId:'a'.repeat(64),account:{id:'id-a'}}});

test('terminal receipt cleanup also recovers an exact rejected receipt',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'rejected',{accepted:false});
  await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  assert.deepEqual(h.calls.remove,[h.command,h.command]);
  assert.equal(h.calls.network.filter(entry=>String(entry.url).endsWith('/shared')).length,1);
});

test('terminal receipt cleanup remains safe after legitimate role and lease changes',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'role-change');
  h.replaceGame({...h.game,myRole:'Viewer',canRecordMove:false,canEndTurn:false,
    computerControl:{ownerIdentityId:'id-b',ownerDeviceId:'other-device',generation:9,expiresAt:Date.now()+10000}});
  await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false);assert.equal(h.view().myRole,'Viewer');assert.equal(h.view().canRecordMove,false);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);assert.deepEqual(h.calls.remove,[h.command,h.command]);
});

test('terminal receipt cleanup retries readback timeout after removal committed without orphaning its reason',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'readback');let failedRead=false;
  h.hooks.list=async(_args,read)=>{if(!failedRead){failedRead=true;throw cleanupTimeout();}return read();};
  const network=clone(h.calls.network);
  await h.advance(500);await h.change('journal_blocked',2,'journal_timeout');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[],'the removal actually committed before readback failed');
  assert.equal(h.view().storageBlocked,true);assert.equal(h.calls.remove.length,2);
  await h.advance(1000);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false);assert.equal(h.calls.remove.length,3);
  assert.deepEqual(h.calls.remove,[h.command,h.command,h.command]);assert.deepEqual(h.calls.network,network);
});

test('terminal receipt cleanup stops after two local timeout retries and remains manually recoverable',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'permanent');h.hooks.remove=async()=>{throw cleanupTimeout();};
  const network=clone(h.calls.network);
  await h.advance(500);await h.change('journal_blocked',2,'journal_timeout');
  await h.advance(1000);await h.change('journal_blocked',3,'journal_timeout');await h.advance(60000);
  assert.equal(h.calls.remove.length,3);assert.equal(h.view().storageBlocked,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[h.command]);assert.deepEqual(h.calls.network,network);
  h.hooks.remove=null;await h.store.retrySaving(h.game.id);
  assert.equal(h.view().storageBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
});

for(const invalid of ['unknown','unavailable','fingerprint'])test(`terminal receipt cleanup never deletes a command with ${invalid} receipt`,{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,`receipt-${invalid}`);
  h.hooks.receipt=outcome=>{if(invalid==='fingerprint')outcome.fingerprint='f'.repeat(64);else outcome.outcome=invalid;};
  void h.control();await h.change('optimistic_confirming');
  const command=h.calls.network.find(entry=>String(entry.url).endsWith('/shared'))?.body;assert.ok(command);
  assert.equal(h.calls.remove.length,0);assert.equal(h.view().pendingCommandCount,1);assert.equal(h.view().sharedMutationsBlocked,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[command]);
  assert.equal(h.store.getCommandOutcome(h.game.id,command.clientCommandId),null);
});

test('terminal receipt cleanup cannot remove a conflicting replacement record',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'replacement');
  await h.durable.remove(h.command);
  const replacement=clone(h.command);replacement.payload.values.generation=2;replacement.fingerprint=await commandFingerprint(replacement);
  await h.durable.admit(replacement);
  await h.advance(500);await h.change('journal_blocked',1,'command_id_conflict');await h.advance(1000);
  assert.equal(h.calls.remove.length,2,'a conflict is not an eligible timeout retry');assert.equal(h.view().storageBlocked,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[replacement]);
});

test('terminal receipt cleanup keeps two failed cleanup owners independent',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'two-owners'),gates=[cleanupDeferred(t),cleanupDeferred(t)];
  h.hooks.remove=async(_envelope,remove,count)=>count<=2?gates[count-1].promise:remove();
  assert.equal((await h.control()).ok,true);assert.equal((await h.control()).ok,true);
  const [first,second]=h.calls.remove;assert.ok(first&&second);assert.notEqual(first.clientCommandId,second.clientCommandId);
  gates.forEach(gate=>gate.reject(cleanupTimeout()));await h.change('journal_blocked',2,'journal_timeout');
  h.hooks.remove=async(envelope,remove)=>{if(envelope.clientCommandId===second.clientCommandId)throw cleanupTimeout();return remove();};
  await h.advance(500);await h.change('journal_cleanup_recovered');await h.change('journal_blocked',3,'journal_timeout');
  assert.equal(h.view().storageBlocked,true);assert.deepEqual(await h.durable.list('id-a',h.game.id),[second]);
  h.hooks.remove=null;await h.advance(1000);await h.change('journal_cleanup_recovered',2);
  assert.equal(h.view().storageBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  assert.equal(h.calls.network.filter(entry=>String(entry.url).endsWith('/shared')).length,2);
});

test('terminal receipt cleanup preserves an already tracked valid durable pending command',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'tracked-pending'),initial=cleanupDeferred(t),pendingResponse=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
  h.hooks.sharedResponse=()=>pendingResponse.promise;const completion=h.control();await h.phase('shared-request',2);
  const second=h.calls.network.filter(entry=>String(entry.url).endsWith('/shared')).at(-1).body;
  assert.equal(h.view().pendingCommandCount,1);initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false,'a legitimate tracked queue is not an unaccounted storage failure');
  assert.equal(h.view().sharedMutationsBlocked,true);assert.deepEqual(await h.durable.list('id-a',h.game.id),[second]);
  pendingResponse.resolve();assert.equal((await completion).ok,true);assert.equal((await h.settled('remove',3)).ok,true);
  assert.equal(h.view().sharedMutationsBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
});

for(const retired of [false,true])test(`terminal cleanup readback preserves a committed in-flight maintenance admission retired=${retired}`,{timeout:5000},async t=>{
 const h=await terminalCleanupStore(t,'committed-admission'),initial=cleanupDeferred(t),admissionCallback=cleanupDeferred(t),committed=cleanupDeferred(t),readback=cleanupDeferred(t),response=cleanupDeferred(t);
 const errors=[];t.after(h.store.subscribe(change=>{if(change.type==='journal_blocked')errors.push(change.error?.code);}));
 h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();
 await h.control();
 h.hooks.admit=async(_envelope,admit)=>{const result=await admit();committed.resolve();await admissionCallback.promise;return result;};
 h.hooks.sharedResponse=()=>response.promise;
 const pending=h.control();await committed.promise;
 try {
  assert.equal(h.view().pendingCommandCount,0,'the second durable row exists before its admission callback registers it');
  h.hooks.list=async(args,read)=>{const saved=await read();if(args[1]===h.game.id&&saved.some(row=>row.clientCommandId===h.calls.admit.at(-1).clientCommandId))readback.resolve();return saved;};
  initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);
  await readback.promise;
  if(retired)h.store.retire();
  await new Promise(resolve=>cleanupRealSetTimeout(resolve,50));
  assert.equal(errors.includes('untracked_saved_command'),false,'a real current admission cannot become untracked stored intent');
 } finally {admissionCallback.resolve();response.resolve();}
 if(retired)assert.equal((await pending).ok,false,'retired admission cannot resume sending or cleanup');
 else {await h.change('journal_cleanup_recovered');assert.equal(h.view().storageBlocked,false);await pending;}
});

test('terminal cleanup never treats a rejected admission callback as tracked authority',{timeout:5000},async t=>{
 const h=await terminalCleanupStore(t,'rejected-admission'),initial=cleanupDeferred(t),callback=cleanupDeferred(t),committed=cleanupDeferred(t),readback=cleanupDeferred(t);
 h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
 h.hooks.admit=async(_envelope,admit)=>{await admit();committed.resolve();await callback.promise;};
 const pending=h.control();await committed.promise;const uncertain=clone(h.calls.admit.at(-1));
 h.hooks.list=async(args,read)=>{const rows=await read();if(args[1]===h.game.id&&rows.some(row=>row.clientCommandId===uncertain.clientCommandId))readback.resolve();return rows;};
 initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);await readback.promise;
 callback.reject(cleanupTimeout());assert.equal((await pending).ok,false);
 await h.change('journal_blocked',1,'untracked_saved_command');
 assert.equal(h.view().storageBlocked,true,'an uncertain stored row still requires explicit receipt reconciliation');
 assert.equal(h.view().pendingCommandCount,0);assert.deepEqual(await h.durable.list('id-a',h.game.id),[uncertain]);
 assert.equal(h.calls.network.filter(row=>String(row.url).endsWith('/shared')).length,1,'never send an unregistered admission');
});

test('terminal receipt cleanup successful initial commit does not manufacture a bulk hydration failure',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'normal-bulk'),response=cleanupDeferred(t);
  h.hooks.remove=null;h.hooks.sharedResponse=()=>response.promise;
  const completion=h.control();await h.phase('shared-request');
  const original=h.calls.admit[0];assert.ok(original);assert.equal(h.view().pendingCommandCount,1);
  const untracked={...clone(original),clientCommandId:'v2:bulk-pending'};untracked.fingerprint=await commandFingerprint(untracked);
  await h.durable.admit(untracked);
  response.resolve();assert.equal((await completion).ok,true);assert.equal((await h.settled('remove',1)).ok,true);
  assert.equal(h.view().storageBlocked,false,'a normal committed deletion must not create an unrelated recovery failure');
  assert.equal(h.view().pendingCommandCount,0);assert.deepEqual(await h.durable.list('id-a',h.game.id),[untracked]);
  assert.deepEqual(h.calls.remove,[original]);assert.deepEqual(h.calls.admit,[original]);
  assert.equal(h.calls.network.filter(entry=>String(entry.url).endsWith('/shared')).length,1);
});

test('terminal receipt cleanup retry accepts a known terminal row snapshot after its other job retires',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'terminal-snapshot'),first=cleanupDeferred(t),second=cleanupDeferred(t),secondCommitted=cleanupDeferred(t);
  const recovered=cleanupDeferred(t);
  t.after(h.store.subscribe(change=>{if(change.gameId===h.game.id&&change.type==='journal_cleanup_recovered')recovered.resolve();}));
  let secondId,captured=false,snapshot;
  h.hooks.remove=async(envelope,remove,count)=>{
    if(count===1)return first.promise;
    if(count===2){secondId=envelope.clientCommandId;await second.promise;const value=await remove();secondCommitted.resolve();return value;}
    return remove();
  };
  await h.control();await h.control();assert.ok(secondId);
  h.hooks.list=async(args,read)=>{
    const saved=await read();
    if(!captured&&args[1]===h.game.id&&saved.some(envelope=>envelope.clientCommandId===secondId)){
      captured=true;snapshot=clone(saved);second.resolve();await secondCommitted.promise;assert.equal((await h.settled('remove',2)).ok,true);
    }
    return saved;
  };
  first.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);
  await recovered.promise;
  assert.equal(captured,true,'readback captured the second row before its real committed deletion');
  assert.equal(snapshot.length,1);assert.equal(snapshot[0].clientCommandId,secondId);
  assert.equal(h.store.getCommandOutcome(h.game.id,secondId).outcome,'accepted');
  assert.equal(h.view().storageBlocked,false,'exact terminal receipt proof survives retirement of the other private cleanup job');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);assert.equal(h.calls.remove.length,3);
});

test('terminal receipt cleanup preserves a newer admission failure and restores only the original unsaved command manually',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'new-admission'),initial=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();
  await h.control();
  h.hooks.admit=async(_envelope,admit,count)=>{if(count===2)throw Object.assign(new Error('journal_limit'),{code:'journal_limit'});return admit();};
  await assert.rejects(h.store.applyGameAction({gameId:h.game.id,state:h.game.board.state,action:h.game.legalActions[0]}),{code:'journal_limit'});
  const unsaved=clone(h.calls.admit.at(-1));initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,true);assert.equal(h.view().unsavedCommand,true);assert.equal(h.view().storageLimitReached,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  assert.equal(h.calls.network.some(entry=>String(entry.url).endsWith('/apply')),false);
  await h.store.retrySaving(h.game.id);
  assert.equal(h.view().storageBlocked,false);assert.equal(h.view().unsavedCommand,false);
  const applies=h.calls.network.filter(entry=>String(entry.url).endsWith('/apply'));
  assert.equal(applies.length,1);assert.deepEqual(applies[0].body,unsaved);
  assert.deepEqual(h.calls.admit.at(-1),unsaved,'manual recovery admits the existing envelope, not a new ID');
});

test('terminal receipt cleanup preserves a newer home hydration read failure',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'new-hydration'),initial=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
  h.hooks.list=async()=>{throw Object.assign(new Error('journal_open_failed'),{code:'journal_open_failed'});};
  await h.store.loadGamesPage({section:'my'});assert.equal(h.view().storageBlocked,true);
  h.hooks.list=null;initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,true,'an older cleanup cannot clear the hydration failure');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  const incident=issueDiagnostics.get(h.view().incidentId);assert.ok(incident);assert.equal(incident.resolvedAt==null,true);
});

test('terminal receipt cleanup does not clear another game identity-cap admission fence',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'identity-cap'),initial=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
  const original=h.calls.remove[0];
  for(let i=0;i<127;i++){
    const envelope={...clone(original),gameId:`other-cap-${i}`,clientCommandId:`v2:cap-${i}`,expectedState:{}};
    envelope.fingerprint=await commandFingerprint(envelope);await h.durable.admit(envelope);
  }
  assert.equal((await h.durable.list('id-a')).length,128,'the real journal identity cap is full');
  const other={...clone(h.game),id:'other-cap-admission'};h.store.applyLiveGameUpdate({game:other,eventSeq:1});
  await assert.rejects(h.store.applyGameAction({gameId:other.id,state:other.board.state,action:other.legalActions[0]}),{code:'journal_limit'});
  initial.reject(cleanupTimeout());await h.change('journal_blocked',1,'journal_timeout');await h.advance(500);await h.change('journal_cleanup_recovered');
  assert.equal(h.view().storageBlocked,false);
  const blocked=h.store.getGameViewModel(other.id);assert.equal(blocked.storageBlocked,true);assert.equal(blocked.unsavedCommand,true);assert.equal(blocked.storageLimitReached,true);
  assert.equal((await h.durable.list('id-a')).length,127,'only the known terminal row was removed');
});

for(const foreign of [false,true])test(`terminal receipt cleanup preserves untracked stored intent foreign=${foreign}`,{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,`untracked-${foreign}`);
  const unknown={...clone(h.command),clientCommandId:'v2:untracked',...(foreign?{authContextId:'c'.repeat(64)}:{})};
  unknown.fingerprint=await commandFingerprint(unknown);await h.durable.admit(unknown);
  await h.advance(500);await h.change('journal_blocked',1,foreign?'invalid_saved_command':'untracked_saved_command');await h.advance(1000);
  assert.equal(h.view().storageBlocked,true);assert.deepEqual(await h.durable.list('id-a',h.game.id),[unknown]);
  assert.equal(h.calls.remove.some(envelope=>envelope.clientCommandId===unknown.clientCommandId),false);
});

test('terminal receipt cleanup preserves a malformed durable record and keeps a separate fence',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'malformed');
  const malformed={identityId:'id-a',gameId:h.game.id,clientCommandId:'v2:malformed',fingerprint:'bad'};
  await new Promise((resolve,reject)=>{
    const request=h.indexedDB.open('righelt.online-commands.v2',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('commands','readwrite');
      tx.objectStore('commands').add(malformed);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
  });
  await h.advance(500);await h.change('journal_blocked',1,'invalid_saved_command');assert.equal(h.view().storageBlocked,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[malformed]);
  assert.equal(h.calls.remove.some(envelope=>envelope.clientCommandId===malformed.clientCommandId),false);
});

for(const change of ['retire','account','storage-generation'])test(`terminal receipt cleanup stops new work after ${change}`,{timeout:5000},async t=>{
  const auth=cleanupScope(),h=await terminalCleanupFixture(t,`retired-${change}`,{auth});
  if(change==='retire')h.store.retire();else if(change==='account')auth.session.contextId='b'.repeat(64);else auth.storageGeneration='replacement-storage';
  const view=clone(h.view()),calls=h.calls.remove.length;await h.advance(60000);
  assert.equal(h.calls.remove.length,calls);assert.deepEqual(h.view(),view);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[h.command]);
});

test('terminal receipt cleanup retirement ignores late completion of an already committed removal',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'late-retire'),completion=cleanupDeferred(t),committed=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove)=>{await remove();committed.resolve();return completion.promise;};
  await h.advance(500);await committed.promise;assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  h.store.retire();const view=clone(h.view()),calls=h.calls.remove.length;
  completion.resolve();await h.settled('remove',2);await h.advance(60000);
  assert.equal(h.calls.remove.length,calls);assert.deepEqual(h.view(),view,'retirement does not promise rollback of an issued IDB commit');
});

test('terminal receipt cleanup manual success retires the original pending job before its late timeout',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'manual-late-timeout'),initial=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
  const original=clone(h.calls.remove[0]);assert.deepEqual(await h.durable.list('id-a',h.game.id),[original]);
  await h.store.retrySaving(h.game.id);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
  initial.reject(cleanupTimeout());await h.settled('remove',1);await h.advance(60000);
  assert.equal(h.view().storageBlocked,false);assert.equal(h.calls.remove.length,2,'the obsolete first job must not retry or resurrect a reason');
});

test('terminal receipt cleanup late original success cannot clear a newer manual failure for the same key',{timeout:5000},async t=>{
  const h=await terminalCleanupStore(t,'manual-replacement'),initial=cleanupDeferred(t);
  h.hooks.remove=async(_envelope,remove,count)=>count===1?initial.promise:remove();await h.control();
  const original=clone(h.calls.remove[0]);await h.store.retrySaving(h.game.id);
  await h.durable.admit(original);h.hooks.remove=async()=>{throw cleanupTimeout();};
  await assert.rejects(h.store.retrySaving(h.game.id),{code:'journal_timeout'});
  initial.resolve();await h.settled('remove',1);await h.advance(60000);
  assert.equal(h.view().storageBlocked,true);assert.deepEqual(await h.durable.list('id-a',h.game.id),[original]);
  assert.equal(h.calls.remove.length,3,'the old completion cannot acquire the newer manual failure');
});

test('terminal receipt cleanup rehydration cannot delete a concurrent conflicting replacement with a known command ID',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'rehydrate-replacement');
  const replacement=clone(h.command);replacement.payload.values.generation=2;replacement.fingerprint=await commandFingerprint(replacement);
  let verifiedAbsence=false,inserted=false;
  h.hooks.list=async(args,read)=>{
    if(verifiedAbsence&&!inserted&&args[1]===h.game.id){await h.durable.admit(replacement);inserted=true;}
    const saved=await read();
    if(args[1]===h.game.id&&saved.length===0)verifiedAbsence=true;
    return saved;
  };
  await assert.rejects(h.store.retrySaving(h.game.id),{code:'invalid_cleanup_receipt'});
  assert.equal(inserted,true,'the real replacement is committed after manual absence proof and before hydration reads');
  assert.equal(h.view().storageBlocked,true);
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[replacement]);
  assert.deepEqual(h.calls.remove,[h.command,h.command],'a matching command ID alone cannot authorize deleting the replacement');
});

for(const change of ['account','storage-generation'])test(`terminal receipt cleanup manual storage handoff rejects a changed ${change} scope`,{timeout:5000},async t=>{
  const auth=cleanupScope(),h=await terminalCleanupFixture(t,`manual-scope-${change}`,{auth}),handoff=cleanupDeferred(t),capturedRead=cleanupDeferred(t);
  let captured=false;
  h.hooks.list=async(args,read)=>{
    const saved=await read();
    if(args[1]===h.game.id&&!captured){captured=true;capturedRead.resolve();await handoff.promise;}
    return saved;
  };
  const manual=h.store.retrySaving(h.game.id).then(value=>({ok:true,value}),error=>({ok:false,error}));
  await capturedRead.promise;assert.equal(captured,true,'manual recovery is waiting on an actual completed journal read');
  const view=clone(h.view());
  if(change==='account')auth.session.contextId='b'.repeat(64);else auth.storageGeneration='replacement-storage';
  handoff.resolve();const result=await manual;assert.equal(result.ok,false);assert.equal(result.error.code,'session_changed');
  await h.advance(60000);
  assert.equal(h.calls.remove.length,1,'no removal may start after the old-scope read returns');
  assert.deepEqual(await h.durable.list('id-a',h.game.id),[h.command]);assert.deepEqual(h.view(),view);
});

test('terminal receipt cleanup keeps private timers and promises out of projected games',{timeout:5000},async t=>{
  const h=await terminalCleanupFixture(t,'projection'),view=h.view();
  assert.deepEqual(structuredClone(view),view);assert.equal(typeof JSON.stringify(view),'string');
  for(const field of ['jobs','reasons','promise','timer'])assert.equal(Object.hasOwn(view,field),false);
  const readback=cleanupDeferred(t),readStarted=cleanupDeferred(t);h.hooks.list=async(_args,read)=>{await read();readStarted.resolve();await readback.promise;return read();};
  await h.advance(500);await readStarted.promise;assert.deepEqual(structuredClone(h.view()),h.view());
  assert.equal(h.view().storageBlocked,true,'the private readback promise is still pending');
  readback.resolve();await h.change('journal_cleanup_recovered');assert.equal(h.view().storageBlocked,false);
});

for(const lateCommit of [false,true])test(`timed-out shared admission automatically verifies ${lateCommit?'its original durable command':'an empty journal without inventing another command'}`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`automatic-admission-${lateCommit}`);h.hooks.remove=null;
 h.hooks.admit=async(_envelope,admit,count)=>{if(count===1){if(lateCommit)await admit();throw cleanupTimeout();}return admit();};
 const failed=await h.control();assert.equal(failed.ok,false);assert.equal(failed.error.code,'journal_timeout');
 const original=clone(h.calls.admit[0]);assert.equal(h.view().storageBlocked,true);assert.equal(h.calls.network.filter(x=>String(x.url).endsWith('/shared')).length,0);
 await h.advance(499);assert.equal(h.calls.admit.length,1);assert.equal(h.view().storageBlocked,true);
 await h.advance(1);await h.change('journal_recovered');
 if(lateCommit){
  await h.phase('change',1,e=>e.change.type==='authoritative_update'&&e.change.clientCommandId===original.clientCommandId);
  const removal=await h.phase('remove',1);assert.equal((await removal.settled).ok,true);
  const requests=h.calls.network.filter(x=>String(x.url).endsWith('/shared'));assert.equal(requests.length,1);assert.deepEqual(requests[0].body,original);
 }else assert.equal(h.calls.network.filter(x=>String(x.url).endsWith('/shared')).length,0);
 assert.equal(h.calls.admit.length,1,'recovery never invents or readmits a missing shared intent');
 assert.equal(h.view().storageBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
});

for(const lateCommit of [false,true])test(`automatic journal repair preserves an uncertain gameplay envelope (lateCommit=${lateCommit})`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`auto-gameplay-${lateCommit}`);h.hooks.remove=null;
 h.hooks.admit=async(_envelope,admit,count)=>{if(count===1){if(lateCommit)await admit();throw cleanupTimeout();}return admit();};
 await assert.rejects(h.store.applyGameAction({gameId:h.game.id,state:h.game.board.state,action:h.game.legalActions[0]}),{code:'journal_timeout'});
 const original=clone(h.calls.admit[0]);assert.equal(h.view().storageBlocked,true);
 await h.advance(500);await h.change('journal_recovered');
 await h.phase('change',1,e=>e.change.type==='authoritative_update'&&e.change.clientCommandId===original.clientCommandId);
 const removal=await h.phase('remove',1);assert.equal((await removal.settled).ok,true);
 const requests=h.calls.network.filter(x=>String(x.url).endsWith('/apply'));assert.equal(requests.length,1);assert.deepEqual(requests[0].body,original);
 for(const envelope of h.calls.admit)assert.deepEqual(envelope,original);
 assert.equal(h.view().storageBlocked,false);assert.deepEqual(await h.durable.list('id-a',h.game.id),[]);
});

test('automatic journal repair stops after two failed recovery passes and retains the fence',{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,'auto-cap');h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};
 await h.control();h.hooks.list=async()=>{throw cleanupTimeout();};
 await h.advance(500);await h.change('journal_blocked',2);await new Promise(resolve=>setImmediate(resolve));
 await h.advance(1000);await h.change('journal_blocked',3);await new Promise(resolve=>setImmediate(resolve));
 const calls=clone(h.calls);await h.advance(60000);assert.deepEqual(h.calls,calls);assert.equal(h.view().storageBlocked,true);
 h.hooks.list=null;await h.store.retrySaving(h.game.id);assert.equal(h.view().storageBlocked,false);
});

for(const code of ['journal_limit','journal_unavailable','command_id_conflict','invalid_saved_command'])test(`automatic journal repair does not retry ${code}`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`auto-no-${code}`);h.hooks.remove=null;h.hooks.admit=async()=>{throw Object.assign(Error(code),{code});};
 await h.control();const calls=clone(h.calls);await h.advance(60000);assert.deepEqual(h.calls,calls);assert.equal(h.view().storageBlocked,true);
});

for(const change of ['retire','account','storage generation'])test(`automatic journal repair timer is fenced by ${change}`,{timeout:10000},async t=>{
 const scope=cleanupScope(),h=await terminalCleanupStore(t,`auto-fence-${change}`,{auth:scope});h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};
 await h.control();const before=clone(h.calls);
 if(change==='retire')h.store.retire();else if(change==='account')scope.session.contextId='b'.repeat(64);else scope.storageGeneration='replacement-storage';
 await h.advance(60000);assert.deepEqual(h.calls,before);
});

for(const change of ['retire','account','storage generation'])test(`automatic journal repair read cannot act after ${change}`,{timeout:10000},async t=>{
 const scope=cleanupScope(),h=await terminalCleanupStore(t,`auto-read-fence-${change}`,{auth:scope});h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};
 await h.control();const gate=cleanupDeferred(t),next=h.calls.list.length+1;h.hooks.list=async(_args,list)=>{await gate.promise;return list();};
 await h.advance(500);await h.phase('list',next);const network=clone(h.calls.network);
 if(change==='retire')h.store.retire();else if(change==='account')scope.session.contextId='b'.repeat(64);else scope.storageGeneration='replacement-storage';
 gate.resolve();assert.equal((await h.settled('list',next)).ok,true);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.calls.network,network);assert.equal(h.calls.admit.length,1);
});

test('manual and automatic journal repair share one recovery flight',{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,'auto-single');h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};await h.control();
 const gate=cleanupDeferred(t),next=h.calls.list.length+1,base=h.calls.list.filter(args=>args.length===1).length;
 h.hooks.list=async(_args,list,count)=>{if(count===next)await gate.promise;return list();};
 const manual=h.store.retrySaving(h.game.id);await h.phase('list',next);
 await h.advance(500);assert.equal(h.calls.list.length,next);
 gate.resolve();await manual;await h.change('journal_recovered');
 assert.equal(h.calls.list.filter(args=>args.length===1).length-base,1);assert.equal(h.view().storageBlocked,false);
});

for(const code of ['journal_limit','journal_unavailable','command_id_conflict','invalid_saved_command'])test(`a scheduled journal retry is cancelled when ${code} arrives`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`auto-new-failure-${code}`);h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};await h.control();
 h.hooks.list=async()=>{throw Object.assign(Error(code),{code});};await assert.rejects(h.store.retrySaving(h.game.id),{code});
 const before=clone(h.calls);await h.advance(60000);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls,before);assert.equal(h.view().storageBlocked,true);
});

for(const action of ['pause','manual','takeover','release','upgrade'])for(const lateCommit of [false,true])test(`failed ${action} admission requires manual recovery (lateCommit=${lateCommit})`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`manual-intent-${action}-${lateCommit}`);h.hooks.remove=null;
 h.hooks.admit=async(_envelope,admit)=>{if(lateCommit)await admit();throw cleanupTimeout();};
 await assert.rejects(h.store.computerControl(h.game.id,{action,deviceId:'cleanup-device',generation:1}),{code:'journal_timeout'});
 const before=clone(h.calls);await h.advance(60000);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.calls,before);assert.equal(h.view().storageBlocked,true);
 h.hooks.admit=null;await h.store.retrySaving(h.game.id);assert.equal(h.view().storageBlocked,false);
 assert.equal(h.calls.admit.length,1,'manual recovery never invents the missing shared intent');
 if(lateCommit){await h.phase('shared-request');const removal=await h.phase('remove');assert.equal((await removal.settled).ok,true);}
 else assert.equal(h.calls.network.filter(x=>String(x.url).endsWith('/shared')).length,0);
});

test('a validated empty reconciliation drains a shared command admitted while it was in flight',{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,'reconcile-drain');h.hooks.remove=null;
 const gate=cleanupDeferred(t);h.hooks.reconcileResponse=()=>gate.promise;
 const reconcile=h.store.reconcileGame(h.game.id);await h.phase('reconcile-request',2);
 const control=h.control();const admission=await h.phase('admit');assert.equal((await admission.settled).ok,true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.network.filter(x=>String(x.url).endsWith('/shared')).length,0);
 gate.resolve();await reconcile;await h.phase('shared-request');assert.equal((await control).ok,true);
 const requests=h.calls.network.filter(x=>String(x.url).endsWith('/shared'));assert.equal(requests.length,1);assert.deepEqual(requests[0].body,h.calls.admit[0]);
});

for(const stale of [false,true])test(`a ${stale?'retired':'failed'} empty reconciliation cannot drain a newly admitted shared command`,{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,`reconcile-no-drain-${stale}`);h.hooks.remove=null;
 const gate=cleanupDeferred(t);h.hooks.reconcileResponse=async()=>{await gate.promise;if(!stale)throw Object.assign(Error('invalid_response'),{code:'invalid_response'});};
 const reconcile=h.store.reconcileGame(h.game.id).then(value=>({ok:true,value}),error=>({ok:false,error}));await h.phase('reconcile-request',2);
 const control=h.control();const admission=await h.phase('admit');assert.equal((await admission.settled).ok,true);await new Promise(resolve=>setImmediate(resolve));
 if(stale)h.store.retire();gate.resolve();await reconcile;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.network.filter(x=>String(x.url).endsWith('/shared')).length,0);assert.equal(h.calls.admit.length,1);
 h.store.retire();assert.equal((await control).ok,false);
});

test('an in-flight automatic journal read cannot act after a conflicting storage failure',{timeout:10000},async t=>{
 const h=await terminalCleanupStore(t,'auto-read-invalidated');h.hooks.remove=null;h.hooks.admit=async()=>{throw cleanupTimeout();};await h.control();
 const gate=cleanupDeferred(t),held=h.calls.list.length+1;
 h.hooks.list=async(_args,list,count)=>{if(count===held){await gate.promise;return list();}throw Object.assign(Error('command_id_conflict'),{code:'command_id_conflict'});};
 await h.advance(500);await h.phase('list',held);await h.store.loadGamesPage();const network=clone(h.calls.network);
 gate.resolve();assert.equal((await h.settled('list',held)).ok,true);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.calls.network,network);assert.equal(h.calls.admit.length,1);assert.equal(h.view().storageBlocked,true);
});
