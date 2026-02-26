import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

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
