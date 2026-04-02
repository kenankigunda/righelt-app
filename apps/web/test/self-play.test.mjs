import test from "node:test";
import assert from "node:assert/strict";
import { createShellStore } from "../shell/store.js";
import { SHELL_STATE_KEY } from "../shell/persistence.js";
import { createMemoryStorage, createTestStore } from "./support.mjs";

test("self-play mode binds both player seats to same identity", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ selfPlayMode: true });
  const vm = store.getGameViewModel(game.id);

  assert.ok(vm.player1);
  assert.ok(vm.player2);
  assert.equal(vm.player1.identityId, vm.player2.identityId);
});

test("self-play mode rejects external player joins", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ selfPlayMode: true });
  const result = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "self_play_player_join_disabled");
});

test("legacy playgroundMode shell state normalizes to selfPlayMode and rewrites persisted state", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    SHELL_STATE_KEY,
    JSON.stringify({
      games: [
        {
          id: "game-legacy",
          createdAt: "2026-02-26T00:00:00.000Z",
          lastMoveAt: null,
          updatedAt: "2026-02-26T00:00:00.000Z",
          playgroundMode: true,
          board: {
            state: {
              pieces: [
                {
                  id: "P1-C",
                  owner: "P1",
                  kind: "commander",
                  position: { row: 0, col: 0 },
                  supplied: true,
                  commanded: true,
                },
                {
                  id: "P2-C",
                  owner: "P2",
                  kind: "commander",
                  position: { row: 9, col: 9 },
                  supplied: true,
                  commanded: true,
                },
              ],
              sideToMove: "P1",
              turnIndex: 0,
            },
            legalActions: [],
          },
          player1: { identityId: "id-legacy", connected: true, joinedAt: "2026-02-26T00:00:00.000Z" },
          player2: { identityId: "id-legacy", connected: true, joinedAt: "2026-02-26T00:00:00.000Z" },
          viewers: [],
          pendingJoinRequests: [],
          turns: [
            {
              index: 0,
              startedAt: "2026-02-26T00:00:00.000Z",
              endedAt: null,
              playerSeat: "Player 1",
              status: "active",
              moveIndexes: [],
              lastMoveAt: null,
            },
          ],
          moves: [],
          historyIndex: null,
          notifications: ["Legacy self-play game"],
        },
      ],
    }),
  );

  let tick = 0;
  const deterministicRandom = () => {
    tick += 1;
    const seed = 0.123456 + tick * 0.0001;
    return seed % 1;
  };
  const board = {
    state: {
      pieces: [
        { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
        { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
      ],
      sideToMove: "P1",
      turnIndex: 0,
    },
    legalActions: [],
  };
  const normalizedStore = createShellStore({
    storage,
    random: deterministicRandom,
    now: () => "2026-02-26T00:00:00.000Z",
    loadBoardState: async () => structuredClone(board),
  });
  const game = normalizedStore.getGameViewModel("game-legacy");

  assert.equal(game.selfPlayMode, true);
  assert.equal("playgroundMode" in game, false);

  await normalizedStore.createGame({ selfPlayMode: false });
  const persisted = JSON.parse(storage.getItem(SHELL_STATE_KEY));
  const legacyPersisted = persisted.games.find((entry) => entry.id === "game-legacy");
  assert.equal(legacyPersisted.selfPlayMode, true);
  assert.equal("playgroundMode" in legacyPersisted, false);
});
