import test from "node:test";
import assert from "node:assert/strict";
import { createStoreWithPersistedGames, createTestStore } from "./support.mjs";

test("presence toggles connected/disconnected for participants", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.player1.connected, true);
  assert.equal(vm.player2.connected, true);

  store.setParticipantConnected({ gameId: game.id, role: "Player 2", connected: false });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.player2.connected, false);

  store.setParticipantConnected({ gameId: game.id, role: "Player 2", connected: true });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.player2.connected, true);
});

test("presence transitions do not change the restored player role", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();
  store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  const persistedGame = store.getGameViewModel(game.id);
  persistedGame.player2 = {
    ...persistedGame.player2,
    identityId: "id-player-two",
  };

  const { store: playerTwoStore } = createStoreWithPersistedGames({
    identityId: "id-player-two",
    games: [persistedGame],
  });

  let vm = playerTwoStore.getGameViewModel(game.id);
  assert.equal(vm.myRole, "Player 2");

  playerTwoStore.setParticipantConnected({ gameId: game.id, role: "Player 2", connected: false });
  vm = playerTwoStore.getGameViewModel(game.id);
  assert.equal(vm.myRole, "Player 2");
  assert.equal(vm.player2.connected, false);

  playerTwoStore.setParticipantConnected({ gameId: game.id, role: "Player 2", connected: true });
  vm = playerTwoStore.getGameViewModel(game.id);
  assert.equal(vm.myRole, "Player 2");
  assert.equal(vm.player2.connected, true);
});
