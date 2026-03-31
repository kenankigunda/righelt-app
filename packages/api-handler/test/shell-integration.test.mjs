import test from "node:test";
import assert from "node:assert/strict";
import { createShellIntegrationHarness } from "./support/shell-integration-harness.mjs";
import { parseRouteFromHash } from "../../../apps/web/shell/routes.js";
import { createInitialState, resolveToStability } from "../../../apps/web/generated/packages/game-engine/src/index.js";

test("shell integration: opaque invite token resolves and joins into canonical game route", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-1");
  const guest = harness.createClient("id-guest-shell-int-1");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  const inviteHash = harness.buildPlayerInviteHash(created);

  assert.match(inviteHash, /^#\/invite\//);
  assert.equal(inviteHash.includes(created.id), false);

  const accepted = await harness.acceptInviteAsPlayer(guest, inviteHash);

  assert.equal(accepted.resolved.gameId, created.id);
  assert.equal(accepted.joined.pendingApproval, false);
  assert.equal(accepted.routeInfo.name, "game");
  assert.equal(accepted.routeInfo.gameId, created.id);
  assert.equal(accepted.game.player2.identityId, guest.identityId);
  assert.equal(accepted.game.myRole, "Player 2");
});

test("shell integration: each ordinary move settles the turn to the next player", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-2");
  const guest = harness.createClient("id-guest-shell-int-2");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "M1" });

  const ownerView = await harness.refreshGame(owner, created.id);
  const guestView = await harness.refreshGame(guest, created.id);

  assert.equal(ownerView.currentTurn.playerSeat, "Player 2");
  assert.equal(ownerView.currentTurn.moveIndexes.length, 0);
  assert.equal(ownerView.currentSnapshot.sideToMove, "P2");
  assert.equal(guestView.currentTurn.playerSeat, "Player 2");
  assert.equal(guestView.currentTurn.moveIndexes.length, 0);

  const move = await guest.store.addMove({ gameId: created.id, notation: "P2-M1" });
  assert.equal(move.move.turnIndex, 1);
  assert.equal(move.move.turnMoveIndex, 0);
});

test("shell integration: explicit end-turn after an auto-settled move is rejected for the prior player", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-3");
  const guest = harness.createClient("id-guest-shell-int-3");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "M1" });
  await assert.rejects(() => owner.store.endTurn({ gameId: created.id }), (error) => {
    assert.equal(error.code, "turn_has_no_moves");
    return true;
  });

  const ownerView = await harness.waitForGame(
    owner,
    created.id,
    (game) => game.currentTurn?.index === 1 && game.currentTurn?.playerSeat === "Player 2" && game.pendingCommandCount === 0,
  );
  const guestView = await harness.refreshGame(guest, created.id);

  assert.equal(ownerView.canRecordMove, false);
  assert.equal(ownerView.canEndTurn, false);
  assert.equal(guestView.canRecordMove, true);
  assert.equal(guestView.currentTurn.playerSeat, "Player 2");
  assert.equal(guestView.currentTurn.index, 1);
  assert.equal(guestView.currentSnapshot.sideToMove, "P2");
});

test("shell integration: push retreat hands control to the defending player", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-retreat-1");
  const guest = harness.createClient("id-guest-shell-int-retreat-1");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const base = createInitialState();
  const retreatScenario = {
    formatVersion: 2,
    id: "0f3d7108-3da3-43e7-aa54-406a5689fcfd",
    title: "Retreat control handoff",
    description: "Push enters retreat and hands control to the defender.",
    incorrect: false,
    initialState: resolveToStability(
      {
        ...base,
        pieces: [
          ...base.pieces,
          { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
          { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
          { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
        ],
      },
      { artifactMode: "full" },
    ),
    moves: [],
    resultingState: resolveToStability(
      {
        ...base,
        pieces: [
          ...base.pieces,
          { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
          { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
          { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
        ],
      },
      { artifactMode: "full" },
    ),
    expectedFinalStateHash: "hash-placeholder",
    expectedOutcome: "ongoing",
  };

  await owner.store.importScenario({ scenario: retreatScenario, targetGameId: created.id });

  const pushed = await owner.store.applyGameAction({
    gameId: created.id,
    state: retreatScenario.resultingState,
    action: {
      type: "push",
      actorId: "A1",
      from: { row: 4, col: 1 },
      to: { row: 4, col: 2 },
    },
  });
  assert.equal(pushed.accepted, true);

  const ownerView = await harness.waitForGame(
    owner,
    created.id,
    (game) =>
      game.controlSeat === "Player 2" &&
      game.currentSnapshot?.continuation?.type === "push" &&
      game.currentSnapshot?.continuation?.phase === "retreat" &&
      game.pendingCommandCount === 0,
  );
  const guestView = await harness.waitForGame(
    guest,
    created.id,
    (game) =>
      game.controlSeat === "Player 2" &&
      game.currentSnapshot?.continuation?.type === "push" &&
      game.currentSnapshot?.continuation?.phase === "retreat" &&
      game.pendingCommandCount === 0,
  );

  assert.equal(ownerView.canRecordMove, false);
  assert.equal(ownerView.canEndTurn, false);
  assert.equal(ownerView.control, "opponent");
  assert.equal(guestView.canRecordMove, true);
  assert.equal(guestView.canEndTurn, false);
  assert.equal(guestView.control, "opponent");
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

test("shell integration: direct game route on a new device behaves like a non-player invite", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-5");
  const guest = harness.createClient("id-guest-shell-int-5");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  const guestView = await harness.refreshGame(guest, created.id);

  assert.equal(guestView.myRole, "Guest");
  assert.equal(guestView.viewers.some((viewer) => viewer.identityId === guest.identityId), false);
  assert.equal(guestView.canJoinAsViewer, true);
  assert.equal(guestView.canJoinAsPlayer, true);

  const result = await guest.store.joinGame({ gameId: created.id, mode: "player" });
  assert.equal(result.pendingApproval, true);
  assert.equal(result.game.myRole, "Viewer");
  assert.equal(result.game.pendingPlayerRequestSeat, "Player 2");
});

test("shell integration: non-player join request upgrades to player after approval and clears pending state", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-6");
  const guest = harness.createClient("id-guest-shell-int-6");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  const guestLanding = await guest.store.loadGame(created.id, { openAsViewer: false });

  assert.equal(guestLanding.myRole, "Guest");
  assert.equal(guestLanding.canJoinAsPlayer, true);
  assert.equal(guestLanding.canJoinAsViewer, true);

  const requested = await guest.store.joinGame({ gameId: created.id, mode: "player" });
  assert.equal(requested.pendingApproval, true);
  assert.equal(requested.game.myRole, "Viewer");

  const ownerView = await harness.waitForGame(
    owner,
    created.id,
    (game) => game.pendingJoinRequests?.length === 1 && game.pendingJoinRequests[0]?.identityId === guest.identityId,
  );
  assert.equal(ownerView.pendingJoinRequests[0].requestedSeat, "Player 2");

  const approved = await owner.store.approvePendingRequest({ gameId: created.id, requesterIdentityId: guest.identityId });
  assert.equal(approved.ok, true);

  const guestView = await harness.waitForGame(
    guest,
    created.id,
    (game) => game.myRole === "Player 2" && game.pendingJoinRequests?.length === 0,
  );

  assert.equal(guestView.player2?.identityId, guest.identityId);
  assert.equal(guestView.canJoinAsPlayer, false);
  assert.equal(guestView.canJoinAsViewer, false);
});

test("shell integration: history mode stays pinned while remote live updates append and return-to-live catches up", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-7");
  const guest = harness.createClient("id-guest-shell-int-7");

  const created = await owner.store.createGame({ playgroundMode: false, offlineLocal: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });
  const historyView = await owner.store.selectHistoryMove({ gameId: created.id, moveIndex: 0 });
  assert.equal(historyView.inHistoryMode, true);
  assert.equal(historyView.historyIndex, 0);

  await guest.store.addMove({ gameId: created.id, notation: "P2-M1" });

  const ownerHistoryAfterRemoteMove = await harness.waitForGame(
    owner,
    created.id,
    (game) => game.inHistoryMode === true && game.historyIndex === 0 && game.moves?.length === 2,
  );
  assert.equal(ownerHistoryAfterRemoteMove.currentTurn.index, 2);
  assert.equal(ownerHistoryAfterRemoteMove.currentSnapshot.turnIndex, 0);

  const liveView = await owner.store.returnToLive({ gameId: created.id });
  assert.equal(liveView.inHistoryMode, false);
  assert.equal(liveView.currentTurn.index, 2);
  assert.equal(liveView.currentTurn.playerSeat, "Player 1");
  assert.equal(liveView.currentSnapshot.sideToMove, "P1");
});

test("shell integration: offline-local game stays hidden until go-online, then reloads through canonical live listing", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-8");

  const created = await owner.store.createGame({ playgroundMode: true, offlineLocal: true });

  assert.equal(owner.store.listGames().some((entry) => entry.id === created.id), false);

  const promoted = await owner.store.goOnlineGame({ gameId: created.id, confirmed: true });
  assert.equal(promoted.id, created.id);
  assert.equal(promoted.offlineLocal, false);

  const listed = owner.store.listGames();
  assert.equal(listed.some((entry) => entry.id === created.id), true);

  const reloaded = await owner.store.loadGame(created.id, { openAsViewer: false });
  assert.equal(reloaded.offlineLocal, false);
  assert.equal(reloaded.canInvite, true);
  assert.equal(reloaded.showOfflineState, false);
});
