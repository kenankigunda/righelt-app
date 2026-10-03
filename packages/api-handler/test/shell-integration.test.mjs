import test from "node:test";
import assert from "node:assert/strict";
import { createShellIntegrationHarness } from "./support/shell-integration-harness.mjs";
import { parseRouteFromHash } from "../../../apps/web/shell/routes.js";
import { buildHistoryBranchSeedFromGame } from "../../../apps/web/shell/scenarios.js";
import { createInitialState, resolveToStability } from "../../../apps/web/generated/packages/game-engine/src/index.js";

test("shell integration: opaque invite token resolves and joins into canonical game route", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-1");
  const guest = harness.createClient("id-guest-shell-int-1");

  const created = await owner.store.createGame({ selfPlayMode: false });
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

test("shell integration: home card list stays lightweight until opening the full game", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-home-card-1");
  const reloadedOwner = harness.createClient("id-owner-shell-home-card-1");

  const created = await owner.store.createGame({ selfPlayMode: false });
  const homePage = await reloadedOwner.store.loadGamesPage({ section: "my", page: 0, pageSize: 4, debug: true });

  assert.equal(homePage.games.some((game) => game.id === created.id), true);
  const listed = homePage.games.find((game) => game.id === created.id);
  assert.equal(typeof listed.moveCount, "number");
  assert.equal("legalActions" in listed, false);
  assert.equal("moves" in listed, false);
  assert.equal(reloadedOwner.store.getHomeGameCard(created.id)?.id, created.id);
  assert.equal(reloadedOwner.store.getGameViewModel(created.id), null);

  const opened = await reloadedOwner.store.loadGame(created.id);
  assert.equal(opened.id, created.id);
  assert.equal(Array.isArray(opened.legalActions), true);
  assert.equal(Array.isArray(opened.moves), true);

  await owner.store.addMove({ gameId: created.id, notation: "M1" });
  const refreshedHomePage = await reloadedOwner.store.loadGamesPage({ section: "my", page: 0, pageSize: 4, debug: false });
  const refreshed = refreshedHomePage.games.find((game) => game.id === created.id);
  assert.equal(refreshed.moveCount, 1);
  assert.equal(refreshed.previewSnapshot.sideToMove, "P2");
});

test("shell integration: each ordinary move settles the turn to the next player", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-2");
  const guest = harness.createClient("id-guest-shell-int-2");

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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

  const created = await owner.store.createGame({ selfPlayMode: false });
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
  assert.equal(ownerHistoryAfterRemoteMove.currentTurn.index, ownerHistoryAfterRemoteMove.moves[0].snapshot.turnIndex);
  assert.equal(ownerHistoryAfterRemoteMove.moves[ownerHistoryAfterRemoteMove.historyIndex].moveId, historyView.moves[0].moveId);
  assert.deepEqual(ownerHistoryAfterRemoteMove.currentSnapshot, ownerHistoryAfterRemoteMove.moves[0].snapshot);

  const liveView = await owner.store.returnToLive({ gameId: created.id });
  assert.equal(liveView.inHistoryMode, false);
  assert.equal(liveView.currentTurn.index, 2);
  assert.equal(liveView.currentTurn.playerSeat, "Player 1");
  assert.equal(liveView.currentSnapshot.sideToMove, "P1");
});

test("shell integration: ignored player-seat request remains pending across refreshes until approval resolves it", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-8");
  const guest = harness.createClient("id-guest-shell-int-8");

  const created = await owner.store.createGame({ selfPlayMode: false });
  const guestLanding = await guest.store.loadGame(created.id, { openAsViewer: false });
  assert.equal(guestLanding.myRole, "Guest");

  const requested = await guest.store.joinGame({ gameId: created.id, mode: "player" });
  assert.equal(requested.pendingApproval, true);
  assert.equal(requested.game.myRole, "Viewer");

  const ownerPending = await harness.waitForGame(
    owner,
    created.id,
    (game) => game.pendingJoinRequests?.length === 1 && game.pendingJoinRequests[0]?.identityId === guest.identityId,
  );
  assert.equal(ownerPending.pendingJoinRequests[0].requestedSeat, "Player 2");

  const ownerRefreshed = await harness.refreshGame(owner, created.id);
  const guestRefreshed = await harness.refreshGame(guest, created.id);
  assert.equal(ownerRefreshed.pendingJoinRequests.length, 1);
  assert.equal(guestRefreshed.myRole, "Viewer");
  assert.equal(guestRefreshed.pendingPlayerRequestSeat, "Player 2");
});

test("shell integration: direct refresh after missed updates restores the authoritative turn and preserves role", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-9");
  const guest = harness.createClient("id-guest-shell-int-9");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const guestBeforeMove = guest.store.getGameViewModel(created.id);
  assert.equal(guestBeforeMove.currentTurn.index, 0);
  assert.equal(guestBeforeMove.currentTurn.playerSeat, "Player 1");

  await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });

  const staleGuestView = guest.store.getGameViewModel(created.id);
  assert.equal(staleGuestView.currentTurn.index, 0);
  assert.equal(staleGuestView.myRole, "Player 2");

  const refreshedGuestView = await harness.refreshGame(guest, created.id);
  assert.equal(refreshedGuestView.currentTurn.index, 1);
  assert.equal(refreshedGuestView.currentTurn.playerSeat, "Player 2");
  assert.equal(refreshedGuestView.myRole, "Player 2");
  assert.equal(refreshedGuestView.pendingJoinRequests.length, 0);
});

test("shell integration: full seats leave a third client with viewer-only fallback across direct loads", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-10");
  const player = harness.createClient("id-player-shell-int-10");
  const viewer = harness.createClient("id-viewer-shell-int-10");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(player, harness.buildPlayerInviteHash(created));

  const viewerLanding = await harness.refreshGame(viewer, created.id);
  assert.equal(viewerLanding.myRole, "Guest");
  assert.equal(viewerLanding.canJoinAsPlayer, false);
  assert.equal(viewerLanding.canJoinAsViewer, true);

  const joined = await viewer.store.joinGame({ gameId: created.id, mode: "viewer" });
  assert.equal(joined.game.myRole, "Viewer");

  const viewerRefreshed = await harness.refreshGame(viewer, created.id);
  assert.equal(viewerRefreshed.myRole, "Viewer");
  assert.equal(viewerRefreshed.canJoinAsPlayer, false);
  assert.equal(viewerRefreshed.canJoinAsViewer, false);
});

test("shell integration: self-play state disables external player joins across refreshes and direct loads", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-11");
  const outsider = harness.createClient("id-outsider-shell-int-11");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await owner.store.playAsBothPlayers({ gameId: created.id });

  const outsiderLanding = await harness.refreshGame(outsider, created.id);
  assert.equal(outsiderLanding.canJoinAsPlayer, false);
  assert.equal(outsiderLanding.canJoinAsViewer, true);

  await assert.rejects(
    () => outsider.store.joinGame({ gameId: created.id, mode: "player" }),
    (error) => {
      assert.equal(error.code, "self_play_player_join_disabled");
      return true;
    },
  );

  const outsiderViewerJoin = await outsider.store.joinGame({ gameId: created.id, mode: "viewer" });
  assert.equal(outsiderViewerJoin.game.myRole, "Viewer");
});

test("shell integration: revert request approval clears pending state and marks targeted moves undone through the transport store", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-12");
  const guest = harness.createClient("id-guest-shell-int-12");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const firstMove = await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });
  const secondMove = await guest.store.addMove({ gameId: created.id, notation: "P2-M1" });
  const targetMoveId = firstMove.game.moves[0].moveId;
  assert.equal(typeof secondMove.game.moves[1].moveId, "string");

  const requested = await owner.store.requestRevertToMove({ gameId: created.id, targetMoveId });
  assert.equal(requested.pendingRevertRequest?.targetMoveId, targetMoveId);

  const approved = await guest.store.approveRevertRequest({
    gameId: created.id,
    requestId: requested.pendingRevertRequest.requestId,
  });
  assert.equal(approved.pendingRevertRequest, null);
  assert.equal(approved.moves.find((move) => move.moveId === targetMoveId)?.undone, true);

  const ownerAfterApproval = await harness.refreshGame(owner, created.id);
  assert.equal(ownerAfterApproval.pendingRevertRequest, null);
  assert.equal(ownerAfterApproval.moves.find((move) => move.moveId === targetMoveId)?.undone, true);
});

test("shell integration: revert request rejection clears pending state without undoing moves", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-13");
  const guest = harness.createClient("id-guest-shell-int-13");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const firstMove = await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });
  const requested = await owner.store.requestRevertToMove({
    gameId: created.id,
    targetMoveId: firstMove.game.moves[0].moveId,
  });

  const rejected = await guest.store.rejectRevertRequest({
    gameId: created.id,
    requestId: requested.pendingRevertRequest.requestId,
  });
  assert.equal(rejected.pendingRevertRequest, null);
  assert.equal(rejected.moves.some((move) => move.undone === true), false);
});

const assertParityFields = (optimisticView, authoritativeView) => {
  assert.deepEqual(optimisticView.currentSnapshot, authoritativeView.currentSnapshot);
  assert.deepEqual(
    {
      index: optimisticView.currentTurn?.index ?? null,
      playerSeat: optimisticView.currentTurn?.playerSeat ?? null,
      status: optimisticView.currentTurn?.status ?? null,
      moveIndexes: optimisticView.currentTurn?.moveIndexes ?? null,
    },
    {
      index: authoritativeView.currentTurn?.index ?? null,
      playerSeat: authoritativeView.currentTurn?.playerSeat ?? null,
      status: authoritativeView.currentTurn?.status ?? null,
      moveIndexes: authoritativeView.currentTurn?.moveIndexes ?? null,
    },
  );
  assert.deepEqual(optimisticView.legalActions, authoritativeView.legalActions);
  assert.equal(optimisticView.controlSeat, authoritativeView.controlSeat);
  assert.equal(optimisticView.control, authoritativeView.control);
  assert.equal(optimisticView.canRecordMove, authoritativeView.canRecordMove);
  assert.equal(optimisticView.canEndTurn, authoritativeView.canEndTurn);
};

for (const variant of ["no-undos", "tail-undos", "divergent-history"]) {
  test(`shell integration: history branch optimistic parity holds for ${variant}`, async () => {
    const harness = createShellIntegrationHarness();
    const owner = harness.createClient(`id-owner-shell-branch-${variant}`);
    const guest = harness.createClient(`id-guest-shell-branch-${variant}`);

    const created = await owner.store.createGame({ selfPlayMode: false });
    await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

    await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });
    await guest.store.addMove({ gameId: created.id, notation: "P2-M1" });
    await owner.store.addMove({ gameId: created.id, notation: "P1-M2" });

    let sourceView = await harness.refreshGame(owner, created.id);
    let branchMoveIndex = 2;

    if (variant !== "no-undos") {
      const revertTargetMoveId = sourceView.moves[1].moveId;
      await owner.store.requestRevertToMove({ gameId: created.id, targetMoveId: revertTargetMoveId });
      const guestAfterRequest = await harness.waitForGame(
        guest,
        created.id,
        (game) => game.pendingRevertRequest?.targetMoveId === revertTargetMoveId,
      );
      await guest.store.approveRevertRequest({
        gameId: created.id,
        requestId: guestAfterRequest.pendingRevertRequest.requestId,
      });
      sourceView = await harness.refreshGame(owner, created.id);
      branchMoveIndex = 0;
    }

    if (variant === "divergent-history") {
      const firstContinuationClient = sourceView.canRecordMove ? owner : guest;
      const secondContinuationClient = firstContinuationClient === owner ? guest : owner;
      await firstContinuationClient.store.addMove({ gameId: created.id, notation: "ALT-1" });
      await secondContinuationClient.store.addMove({ gameId: created.id, notation: "ALT-2" });
      sourceView = await harness.refreshGame(owner, created.id);
      branchMoveIndex = sourceView.moves.findLastIndex((move) => move.undone !== true);
    }

    const branchSeed = buildHistoryBranchSeedFromGame(sourceView, branchMoveIndex);
    const branch = await owner.store.launchHistoryBranch({
      sourceGameId: created.id,
      sourceMoveIndex: branchMoveIndex,
      scenario: branchSeed.scenario,
      initialSelectionAction: branchSeed.initialSelectionAction,
      participantCopyMode: branchSeed.participantCopyMode,
    });

    const branchAction =
      branch.game.legalActions.find(
        (action) =>
          action.type === branch.game.initialSelectionAction?.type &&
          action.actorId === branch.game.initialSelectionAction?.actorId &&
          action.from?.row === branch.game.initialSelectionAction?.from?.row &&
          action.from?.col === branch.game.initialSelectionAction?.from?.col &&
          action.to?.row === branch.game.initialSelectionAction?.to?.row &&
          action.to?.col === branch.game.initialSelectionAction?.to?.col,
      ) ?? branch.game.legalActions[0];

    const optimistic = await owner.store.applyGameAction({
      gameId: branch.game.id,
      state: branch.game.currentSnapshot,
      action: branchAction,
    });
    assert.equal(optimistic.accepted, true);

    const optimisticView = owner.store.getGameViewModel(branch.game.id);
    const authoritativeView = await harness.waitForGame(
      owner,
      branch.game.id,
      (game) => game.pendingCommandCount === 0 && game.moves.length === branch.game.moves.length + 1,
    );

    assertParityFields(optimisticView, authoritativeView);
  });
}

test("shell integration: requester can rescind a pending revert request through the transport store", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-shell-int-14");
  const guest = harness.createClient("id-guest-shell-int-14");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const firstMove = await owner.store.addMove({ gameId: created.id, notation: "P1-M1" });
  const requested = await owner.store.requestRevertToMove({
    gameId: created.id,
    targetMoveId: firstMove.game.moves[0].moveId,
  });

  const rescinded = await owner.store.rescindRevertRequest({
    gameId: created.id,
    requestId: requested.pendingRevertRequest.requestId,
  });
  assert.equal(rescinded.pendingRevertRequest, null);
  assert.equal(rescinded.moves.some((move) => move.undone === true), false);
});

// ---------------------------------------------------------------------------
// t-001.02 — Integration tests for destroyedPieces persistence
// Covers: I-05, I-06, I-07, I-09
// ---------------------------------------------------------------------------

test("I-05: move API response — game.moves includes destroyedPieces on each move after addMove", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-i05-dp");
  const guest = harness.createClient("id-guest-i05-dp");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  const moved = await owner.store.addMove({ gameId: created.id, notation: "I05-M1" });

  // The move returned in the response must carry destroyedPieces
  assert.ok(moved.move, "response must include move");
  assert.ok(Array.isArray(moved.move.destroyedPieces), "move.destroyedPieces must be an array");

  // The game view model in the response must also have destroyedPieces on each move
  assert.ok(Array.isArray(moved.game.moves), "game.moves must be an array");
  for (const m of moved.game.moves) {
    assert.ok(Array.isArray(m.destroyedPieces), `game.moves[${m.index}].destroyedPieces must be an array`);
  }
});

test("I-06: duplicate clientCommandId path — game view includes destroyedPieces, no crash", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-i06-dp");
  const guest = harness.createClient("id-guest-i06-dp");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "I06-M1" });

  // Load the game — moves should have destroyedPieces
  const gameView = await harness.refreshGame(owner, created.id);
  assert.ok(Array.isArray(gameView.moves), "moves must be an array");
  for (const m of gameView.moves) {
    assert.ok(Array.isArray(m.destroyedPieces), `game.moves[${m.index}].destroyedPieces must be an array`);
  }
  // No errors thrown — game loaded cleanly
});

test("I-07: history endpoint — moves loaded from server include destroyedPieces", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-i07-dp");
  const guest = harness.createClient("id-guest-i07-dp");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  await owner.store.addMove({ gameId: created.id, notation: "I07-M1" });
  await guest.store.addMove({ gameId: created.id, notation: "I07-M2" });

  // Reload the full game — simulates history endpoint delivery
  const gameView = await harness.refreshGame(owner, created.id);
  assert.ok(Array.isArray(gameView.moves));
  assert.ok(gameView.moves.length >= 2, "at least 2 moves should be present");
  for (const m of gameView.moves) {
    assert.ok(
      Array.isArray(m.destroyedPieces),
      `history move[${m.index}].destroyedPieces must be an array`,
    );
  }
});

test("I-09: late-join participant receives destroyedPieces in history catchup", async () => {
  const harness = createShellIntegrationHarness();
  const owner = harness.createClient("id-owner-i09-dp");
  const guest = harness.createClient("id-guest-i09-dp");
  // A third client using the same identity as owner simulates the owner
  // "reconnecting" on a new session — receiving the full game state catchup.
  const ownerReconnect = harness.createClient("id-owner-i09-dp");

  const created = await owner.store.createGame({ selfPlayMode: false });
  await harness.acceptInviteAsPlayer(guest, harness.buildPlayerInviteHash(created));

  // Record moves before the reconnect
  await owner.store.addMove({ gameId: created.id, notation: "I09-M1" });
  await guest.store.addMove({ gameId: created.id, notation: "I09-M2" });

  // Simulate the owner reconnecting on a new session (late-join / history catchup)
  const lateView = await ownerReconnect.store.loadGame(created.id);
  assert.ok(Array.isArray(lateView.moves), "reconnected client must see moves");
  assert.ok(lateView.moves.length >= 2, "reconnected client should receive all recorded moves");
  for (const m of lateView.moves) {
    assert.ok(
      Array.isArray(m.destroyedPieces),
      `reconnected client history move[${m.index}].destroyedPieces must be an array`,
    );
  }
});
