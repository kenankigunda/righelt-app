import test from "node:test";
import assert from "node:assert/strict";
import { createShellIntegrationHarness } from "./support/shell-integration-harness.mjs";
import { parseRouteFromHash } from "../../../apps/web/shell/routes.js";

test("shell integration: opaque invite token resolves and joins into canonical game route", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-1");
  const guest = harness.createClient("id-guest-shell-int-1");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  const inviteHash = harness.buildPlayerInviteHash(created);

  assert.match(inviteHash, /^#\/shell\/invite\//);
  assert.equal(inviteHash.includes(created.id), false);

  const accepted = await harness.acceptInviteAsPlayer(guest, inviteHash);

  assert.equal(accepted.resolved.gameId, created.id);
  assert.equal(accepted.joined.pendingApproval, false);
  assert.equal(accepted.routeInfo.name, "game");
  assert.equal(accepted.routeInfo.gameId, created.id);
  assert.equal(accepted.game.player2.identityId, guest.identityId);
  assert.equal(accepted.game.myRole, "Player 2");
});

test("shell integration: multiple moves stay in the active turn until end-turn", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-2");
  const guest = harness.createClient("id-guest-shell-int-2");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "M1" });
  await owner.store.addMove({ gameId: created.id, notation: "M2" });

  const ownerView = await harness.refreshGame(owner, created.id);
  const guestView = await harness.refreshGame(guest, created.id);

  assert.equal(ownerView.currentTurn.playerSeat, "Player 1");
  assert.equal(ownerView.currentTurn.moveIndexes.length, 2);
  assert.equal(ownerView.currentSnapshot.sideToMove, "P1");
  assert.equal(guestView.currentTurn.playerSeat, "Player 1");
  assert.equal(guestView.currentTurn.moveIndexes.length, 2);

  await assert.rejects(() => guest.store.addMove({ gameId: created.id, notation: "M3" }), (error) => {
    assert.equal(error.code, "not_your_turn");
    return true;
  });
});

test("shell integration: ending a turn hands control to the next player after refresh", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-3");
  const guest = harness.createClient("id-guest-shell-int-3");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "M1" });
  await owner.store.endTurn({ gameId: created.id });

  const ownerView = await harness.refreshGame(owner, created.id);
  const guestView = await harness.refreshGame(guest, created.id);

  assert.equal(ownerView.canRecordMove, false);
  assert.equal(ownerView.canEndTurn, false);
  assert.equal(guestView.canRecordMove, true);
  assert.equal(guestView.currentTurn.playerSeat, "Player 2");
  assert.equal(guestView.currentTurn.index, 1);
  assert.equal(guestView.currentSnapshot.sideToMove, "P2");

  const move = await guest.store.addMove({ gameId: created.id, notation: "P2-M1" });
  assert.equal(move.move.turnIndex, 1);
  assert.equal(move.move.turnMoveIndex, 0);
});

test("shell integration: invite availability reflects backend-driven remaining join options", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-4");
  const guest = harness.createClient("id-guest-shell-int-4");
  const viewer = harness.createClient("id-viewer-shell-int-4");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  const inviteHash = harness.buildPlayerInviteHash(created);

  await harness.acceptInviteAsPlayer(guest, inviteHash);

  const inviteRoute = parseRouteFromHash(inviteHash);
  const resolved = await viewer.store.resolveInvite(inviteRoute.inviteToken);
  assert.equal(resolved.gameId, created.id);

  const viewerLanding = await harness.refreshGame(viewer, created.id);
  assert.equal(viewerLanding.canJoinAsPlayer, false);
  assert.equal(viewerLanding.canJoinAsViewer, true);

  const accepted = await harness.acceptInviteAsViewer(viewer, inviteHash);
  assert.equal(accepted.game.myRole, "Viewer");
});
