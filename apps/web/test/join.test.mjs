import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

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
