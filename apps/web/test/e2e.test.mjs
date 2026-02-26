import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("e2e shell flow: create, invite-join request, approve, history, offline-local go-online", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: false, offlineLocal: false });

  const pending = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: null });
  assert.equal(pending.pendingApproval, true);

  const requester = store.getGameViewModel(game.id).pendingJoinRequests[0].identityId;
  const approved = store.approvePendingRequest({ gameId: game.id, requesterIdentityId: requester });
  assert.equal(approved.ok, true);

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 1 } });
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, true);
  store.returnToLive({ gameId: game.id });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, false);

  const offlineGame = await store.createGame({ playgroundMode: true, offlineLocal: true });
  assert.equal(store.listGames().some((entry) => entry.id === offlineGame.id), false);
  assert.equal(store.goOnlineGame({ gameId: offlineGame.id, confirmed: true }).ok, true);
  assert.equal(store.listGames().some((entry) => entry.id === offlineGame.id), true);
});
