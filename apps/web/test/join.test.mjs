import test from "node:test";
import assert from "node:assert/strict";
import { SHELL_STATE_KEY } from "../shell/persistence.js";
import { createShellStore, createStoreWithPersistedGames, createTestStore } from "./support.mjs";

test("home list open is viewer-only and does not auto-assign player seat", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();
  const opened = store.openAsViewer(game.id);
  assert.ok(opened);

  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.player2, null);
  assert.equal(vm.myRole, "Player 1");
});

test("player join from viewer/home source requires approval and becomes pending request", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  const result = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: null });
  assert.equal(result.ok, true);
  assert.equal(result.pendingApproval, true);

  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.pendingJoinRequests.length, 1);
  assert.equal(vm.player2, null);
});

test("player-shared invite can fill open player seat immediately", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  const result = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  assert.equal(result.ok, true);
  assert.equal(result.pendingApproval, undefined);

  const vm = store.getGameViewModel(game.id);
  assert.ok(vm.player2);
});

test("player 1 can convert an open-seat game to play-as-both-players mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  const result = store.playAsBothPlayers({ gameId: game.id });
  assert.equal(result.ok, true);

  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.player2?.identityId, vm.player1?.identityId);
  assert.equal(vm.selfPlayMode, true);
  assert.equal(vm.canPlayAsBothPlayers, false);
});

test("player 2 can convert an open-seat game to play-as-both-players mode", async () => {
  const { store, storage } = createTestStore();
  const game = await store.createGame();
  storage.setItem(
    SHELL_STATE_KEY,
    JSON.stringify({
      games: [
        {
          ...game,
          player1: null,
          player2: game.player1,
          selfPlayMode: false,
          pendingJoinRequests: [{ identityId: "id-other", requestedSeat: "Player 1", requestedAt: "2026-02-26T00:00:00.000Z" }],
        },
      ],
    }),
  );

  const reloadedStore = createShellStore({
    storage,
    random: () => 0.333333,
    now: () => "2026-02-26T00:00:00.000Z",
    loadBoardState: async () => structuredClone(game.board),
  });

  const vmBefore = reloadedStore.getGameViewModel(game.id);
  assert.equal(vmBefore.myRole, "Player 2");
  assert.equal(vmBefore.canPlayAsBothPlayers, true);

  const result = reloadedStore.playAsBothPlayers({ gameId: game.id });
  assert.equal(result.ok, true);

  const vm = reloadedStore.getGameViewModel(game.id);
  assert.equal(vm.player1?.identityId, vm.player2?.identityId);
  assert.equal(vm.selfPlayMode, true);
  assert.equal(vm.pendingJoinRequests.length, 0);
  assert.equal(vm.canPlayAsBothPlayers, false);
});

test("guest view model exposes viewer-only fallback when both player seats are already occupied", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();
  store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });

  const { store: guestStore } = createStoreWithPersistedGames({
    identityId: "id-guest-fallback",
    games: [store.getGameViewModel(game.id)],
  });

  const vm = guestStore.getGameViewModel(game.id);
  assert.equal(vm.myRole, "Guest");
  assert.equal(vm.canJoinAsPlayer, false);
  const joined = guestStore.joinGame({ gameId: game.id, mode: "viewer" });
  assert.equal(joined.ok, true);
  assert.equal(guestStore.getGameViewModel(game.id).myRole, "Viewer");
});

test("guest player-join stays disabled when self-play has already claimed both seats", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();
  store.playAsBothPlayers({ gameId: game.id });

  const { store: guestStore } = createStoreWithPersistedGames({
    identityId: "id-guest-self-play",
    games: [store.getGameViewModel(game.id)],
  });

  const vm = guestStore.getGameViewModel(game.id);
  assert.equal(vm.myRole, "Guest");
  assert.equal(vm.selfPlayMode, true);
  assert.equal(vm.canJoinAsPlayer, false);
  const joined = guestStore.joinGame({ gameId: game.id, mode: "viewer" });
  assert.equal(joined.ok, true);
  assert.equal(guestStore.getGameViewModel(game.id).myRole, "Viewer");
});
