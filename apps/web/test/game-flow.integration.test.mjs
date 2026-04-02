import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("integration shell flow: create, invite-join request, approve, and history", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ selfPlayMode: false });

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

test("integration shell flow keeps a pending player request active until approval resolves it", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ selfPlayMode: false });

  const pending = store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: null });
  assert.equal(pending.pendingApproval, true);

  const vmWhilePending = store.getGameViewModel(game.id);
  assert.equal(vmWhilePending.pendingJoinRequests.length, 1);
  const requester = vmWhilePending.pendingJoinRequests[0].identityId;

  const approved = store.approvePendingRequest({ gameId: game.id, requesterIdentityId: requester });
  assert.equal(approved.ok, true);
  assert.equal(store.getGameViewModel(game.id).pendingJoinRequests.length, 0);
  assert.equal(store.getGameViewModel(game.id).player2?.identityId, requester);
});

test("integration shell flow allows the creator to move before a second player joins", async () => {
  const { store } = createTestStore();
  const game = await store.createGame({ selfPlayMode: false });

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  assert.equal(store.getGameViewModel(game.id).moves.length, 1);
  assert.equal(store.getGameViewModel(game.id).player2, null);

  const viewerJoin = store.joinGame({ gameId: game.id, mode: "viewer", inviteFromRole: null });
  assert.notEqual(viewerJoin.pendingApproval, true);
  assert.equal(store.getGameViewModel(game.id).viewers.length, 1);
});
