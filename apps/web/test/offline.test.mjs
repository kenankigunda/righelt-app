import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("offline blocks remote player joins for non-local games", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: false, offlineLocal: false });
  store.setOffline(true);

  const result = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: "Player 1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "offline_join_blocked");
});

test("offline local playground hidden from home list until explicit go-online confirmation", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: true, offlineLocal: true });

  assert.equal(store.listGames().length, 0);
  assert.equal(store.goOnlineGame({ gameId: game.id, confirmed: false }).error, "confirmation_required");
  assert.equal(store.listGames().length, 0);

  const goOnline = store.goOnlineGame({ gameId: game.id, confirmed: true });
  assert.equal(goOnline.ok, true);
  assert.equal(store.listGames().length, 1);
});

test("go-online restores normal live affordances for a previously offline-local game", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: true, offlineLocal: true });

  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.showOfflineState, true);
  assert.equal(vm.showJoinActions, false);
  assert.equal(vm.canInvite, false);

  store.goOnlineGame({ gameId: game.id, confirmed: true });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.offlineLocal, false);
  assert.equal(vm.showOfflineState, false);
  assert.equal(vm.showJoinActions, true);
  assert.equal(vm.canInvite, true);
});
