import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("playground mode binds both player seats to same identity", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: true, offlineLocal: false });
  const vm = store.getGameViewModel(game.id);

  assert.ok(vm.player1);
  assert.ok(vm.player2);
  assert.equal(vm.player1.identityId, vm.player2.identityId);
});

test("playground mode rejects external player joins", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: true, offlineLocal: false });
  const result = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "playground_player_join_disabled");
});
