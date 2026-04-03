import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import { createSyncStore } from "../shell/sync-store.js";

const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const buildAcknowledgedGame = (baseGame, action, clientCommandId) => {
  const nextState = resolveToStability(applyAction(baseGame.currentSnapshot, action).state, { artifactMode: "full" });
  const currentTurn = {
    ...(baseGame.currentTurn ?? {
      index: 0,
      startedAt: baseGame.createdAt,
      endedAt: null,
      playerSeat: "Player 1",
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    }),
    moveIndexes: [0],
    lastMoveAt: baseGame.createdAt,
  };

  return {
    ...baseGame,
    updatedAt: baseGame.createdAt,
    lastMoveAt: baseGame.createdAt,
    currentSnapshot: nextState,
    board: { state: nextState },
    currentTurn,
    turns: [currentTurn],
    legalActions: listLegalActions(nextState),
    canEndTurn: true,
    moves: [
      {
        index: 0,
        moveId: "move-1",
        turnIndex: 0,
        turnMoveIndex: 0,
        displayMoveNumber: 1,
        actorSide: baseGame.currentSnapshot.sideToMove,
        at: baseGame.createdAt,
        notation: "MOVE 1",
        action,
        clientCommandId,
        selectionSnapshot: baseGame.currentSnapshot,
        snapshot: nextState,
      },
    ],
    notifications: ["Move recorded"],
  };
};

test("integration sync store defers live move requests until optimistic game creation commits", async () => {
  const storage = createMemoryStorage();
  const calls = [];
  let resolveCreate = null;
  let applyBodies = [];
  let createdAuthoritativeGame = null;
  let initialCreatedGame = null;

  const store = createSyncStore({
    storage,
    fetcher: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET" });
      if (String(url) === "/api/shell/games" && init.method === "POST") {
        return new Promise((resolve) => {
          resolveCreate = () => {
            createdAuthoritativeGame = structuredClone(initialCreatedGame);
            resolve(Response.json({ ok: true, game: initialCreatedGame }));
          };
        });
      }
      if (String(url).endsWith("/apply") && init.method === "POST") {
        const body = JSON.parse(String(init.body || "{}"));
        applyBodies.push(body);
        const gameIdMatch = String(url).match(/\/games\/([^/]+)\/apply$/);
        const gameId = gameIdMatch ? decodeURIComponent(gameIdMatch[1]) : null;
        const baseGame = gameId ? createdAuthoritativeGame : null;
        return Response.json({
          ok: true,
          accepted: true,
          clientCommandId: body.clientCommandId,
          eventSeq: 1,
          game: buildAcknowledgedGame(baseGame, body.action, body.clientCommandId),
        });
      }
      if (String(url).includes("/api/shell/games/") && (!init.method || init.method === "GET")) {
        const gameIdMatch = String(url).match(/\/games\/([^?]+)/);
        const gameId = gameIdMatch ? decodeURIComponent(gameIdMatch[1]) : null;
        const game = gameId ? store.getGameViewModel(gameId) : null;
        return Response.json({ ok: true, game, eventSeq: 1 });
      }
      return Response.json({ ok: true, games: [] });
    },
    createSyncClient: () => ({
      connectGame() {},
      disconnectGame() {},
      disconnectAll() {},
      getDesiredGameIds: () => [],
    }),
  });

  const createHandle = store.createGame({ selfPlayMode: false });
  initialCreatedGame = structuredClone(createHandle.result);
  const action = createHandle.result.legalActions.find((entry) => entry.type !== "pass") ?? createHandle.result.legalActions[0];
  const moveHandle = await store.applyGameAction({
    gameId: createHandle.result.id,
    state: createHandle.result.currentSnapshot,
    action,
  });

  assert.equal(createHandle.status, "pending");
  assert.equal(moveHandle.status, "pending");
  assert.equal(calls.some((entry) => entry.url.endsWith("/apply")), false);

  resolveCreate?.();
  await tick();
  await Promise.race([
    createHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("create commit timed out")), 2_000)),
  ]);
  const committedMove = await Promise.race([
    moveHandle.committed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("move commit timed out")), 2_000)),
  ]);

  assert.equal(calls.some((entry) => entry.url.endsWith("/apply")), true);
  assert.equal(applyBodies.length, 1);
  assert.equal(applyBodies[0].action.type, action.type);
  assert.equal(committedMove.accepted, true);
  assert.equal(store.getGameViewModel(createHandle.result.id)?.moves.length, 1);
});
