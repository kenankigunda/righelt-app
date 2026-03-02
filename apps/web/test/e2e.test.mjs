import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("e2e shell flow: create, invite-join request, approve, history", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ playgroundMode: false, offlineLocal: false });

  const pending = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: null });
  assert.equal(pending.pendingApproval, true);

  const requester = store.getGameViewModel(game.id).pendingJoinRequests[0].identityId;
  const approved = store.approvePendingRequest({ gameId: game.id, requesterIdentityId: requester });
  assert.equal(approved.ok, true);

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  assert.equal(store.getGameViewModel(game.id).currentTurn.moveIndexes.length, 2);
  assert.equal(store.endTurn({ gameId: game.id }).ok !== false, true);
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, true);
  store.returnToLive({ gameId: game.id });
  assert.equal(store.getGameViewModel(game.id).inHistoryMode, false);
});
