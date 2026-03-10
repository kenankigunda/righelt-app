import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { __resetShellLiveStateForTests } from "../src/shell-live.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";

const env = {
  DB: createFakeD1(),
};

const req = (path, method = "GET", body = null) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

test.beforeEach(() => {
  __resetShellLiveStateForTests();
  env.DB.reset();
});

test("live transport: create/list/get game lifecycle is server-backed", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  assert.equal(create.status, 200);
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const list = await handleApiRequest(req("/api/shell/games?identityId=id-a"), env);
  const listBody = await list.json();
  assert.equal(listBody.games.length >= 1, true);
  assert.equal(listBody.games.some((entry) => entry.id === gameId), true);

  const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-b&openAsViewer=1`), env);
  const openBody = await open.json();
  assert.equal(openBody.game.viewers.some((viewer) => viewer.identityId === "id-b"), true);

  const inviteToken = createBody.game.inviteToken;
  assert.equal(typeof inviteToken, "string");
  assert.equal(inviteToken.length > 20, true);

  const inviteResolve = await handleApiRequest(req(`/api/shell/invites/${inviteToken}`), env);
  const inviteBody = await inviteResolve.json();
  assert.equal(inviteBody.gameId, gameId);
  assert.equal(inviteBody.inviteFromRole, "Player 1");

  const directOpen = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-direct`), env);
  const directBody = await directOpen.json();
  assert.equal(directBody.game.myRole, "Guest");
  assert.equal(directBody.game.viewers.some((viewer) => viewer.identityId === "id-direct"), false);
  assert.equal(directBody.game.canJoinAsViewer, true);
  assert.equal(directBody.game.canJoinAsPlayer, true);
});

test("live transport: invite and game resolution survive process-local cache reset", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;
  const inviteToken = createBody.game.inviteToken;

  __resetShellLiveStateForTests();

  const inviteResolve = await handleApiRequest(req(`/api/shell/invites/${inviteToken}`), env);
  const inviteBody = await inviteResolve.json();
  assert.equal(inviteResolve.status, 200);
  assert.equal(inviteBody.gameId, gameId);

  __resetShellLiveStateForTests();

  const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-b&openAsViewer=1`), env);
  const openBody = await open.json();
  assert.equal(open.status, 200);
  assert.equal(openBody.game.id, gameId);
});

test("live transport: join approval flow and presence/history/move transitions", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const joinPending = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-joiner",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );
  const pendingBody = await joinPending.json();
  assert.equal(pendingBody.pendingApproval, true);

  const secondPending = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-other",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );
  const secondPendingBody = await secondPending.json();
  assert.equal(secondPendingBody.pendingApproval, true);

  const approve = await handleApiRequest(
    req(`/api/shell/games/${gameId}/approve`, "POST", {
      identityId: "id-owner",
      requesterIdentityId: "id-joiner",
    }),
    env,
  );
  const approveBody = await approve.json();
  assert.equal(Boolean(approveBody.game.player2), true);
  assert.equal(approveBody.game.player2.identityId, "id-joiner");
  assert.equal(approveBody.game.viewers.some((viewer) => viewer.identityId === "id-joiner"), false);
  assert.equal(approveBody.game.pendingJoinRequests.length, 0);

  const move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const moveBody = await move.json();
  assert.equal(moveBody.game.moves.length, 1);
  assert.equal(moveBody.game.currentTurn.playerSeat, "Player 1");
  assert.equal(moveBody.game.currentTurn.moveIndexes.length, 1);
  assert.equal(moveBody.game.currentSnapshot.sideToMove, "P1");

  const secondMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const secondMoveBody = await secondMove.json();
  assert.equal(secondMoveBody.game.moves.length, 2);
  assert.equal(secondMoveBody.game.currentTurn.moveIndexes.length, 2);
  assert.equal(secondMoveBody.game.currentSnapshot.sideToMove, "P1");

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }),
    env,
  );
  const endTurnBody = await endTurn.json();
  assert.equal(endTurnBody.game.currentTurn.playerSeat, "Player 2");
  assert.equal(endTurnBody.game.currentTurn.moveIndexes.length, 0);
  assert.equal(endTurnBody.game.currentSnapshot.sideToMove, "P2");
  assert.equal(endTurnBody.game.currentSnapshot.continuation, null);

  const history = await handleApiRequest(
    req(`/api/shell/games/${gameId}/history`, "POST", { identityId: "id-owner", moveIndex: 1 }),
    env,
  );
  const historyBody = await history.json();
  assert.equal(historyBody.game.inHistoryMode, true);
  assert.equal(historyBody.game.historyIndex, 1);

  const joinerViewDuringHistory = await handleApiRequest(
    req(`/api/shell/games/${gameId}?identityId=id-joiner`, "GET"),
    env,
  );
  const joinerHistoryBody = await joinerViewDuringHistory.json();
  assert.equal(joinerHistoryBody.game.inHistoryMode, false);
  assert.equal(joinerHistoryBody.game.historyIndex, null);

  const live = await handleApiRequest(req(`/api/shell/games/${gameId}/live`, "POST", { identityId: "id-owner" }), env);
  const liveBody = await live.json();
  assert.equal(liveBody.game.inHistoryMode, false);
  assert.equal(liveBody.game.historyIndex, null);

  const presence = await handleApiRequest(
    req(`/api/shell/games/${gameId}/presence`, "POST", {
      identityId: "id-owner",
      role: "Player 2",
      connected: false,
    }),
    env,
  );
  const presenceBody = await presence.json();
  assert.equal(presenceBody.game.player2.connected, false);

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );

  const viewerPresence = await handleApiRequest(
    req(`/api/shell/games/${gameId}/presence`, "POST", {
      identityId: "id-viewer",
      role: "Viewer",
      connected: false,
    }),
    env,
  );
  const viewerPresenceBody = await viewerPresence.json();
  assert.equal(viewerPresenceBody.game.viewers.find((viewer) => viewer.identityId === "id-viewer")?.connected, false);
});

test("live transport: player invite token enables immediate player join without guessable game role query", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await create.json();
  const gameId = createdBody.game.id;
  const inviteToken = createdBody.game.inviteToken;

  const join = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteToken,
    }),
    env,
  );
  const joinBody = await join.json();
  assert.equal(join.status, 200);
  assert.equal(joinBody.pendingApproval, false);
  assert.equal(joinBody.game.player2.identityId, "id-player2");
  assert.equal(joinBody.game.pendingJoinRequests.length, 0);
});

test("live transport: non-player invite token requires approval for player join and joins viewer immediately", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await create.json();
  const gameId = createdBody.game.id;

  const viewerJoin = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );
  assert.equal(viewerJoin.status, 200);

  const viewerOpen = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-viewer`), env);
  const viewerBody = await viewerOpen.json();
  const viewerInviteToken = viewerBody.game.inviteToken;

  const join = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-requester",
      mode: "player",
      inviteToken: viewerInviteToken,
    }),
    env,
  );
  const joinBody = await join.json();
  assert.equal(join.status, 200);
  assert.equal(joinBody.pendingApproval, true);
  assert.equal(joinBody.game.myRole, "Viewer");
  assert.equal(joinBody.game.pendingPlayerRequestSeat, "Player 2");
  assert.equal(joinBody.game.viewers.some((viewer) => viewer.identityId === "id-requester"), true);
});

test("live transport: offline-local game hidden until go-online confirmation", async () => {
  const createOffline = await handleApiRequest(
    req("/api/shell/games?offline=1", "POST", {
      identityId: "id-local",
      playgroundMode: true,
      offlineLocal: true,
    }),
    env,
  );
  const createBody = await createOffline.json();
  const gameId = createBody.game.id;

  const listBefore = await handleApiRequest(req("/api/shell/games?identityId=id-local&offline=1"), env);
  const listBeforeBody = await listBefore.json();
  assert.equal(listBeforeBody.games.some((entry) => entry.id === gameId), false);

  const denied = await handleApiRequest(
    req(`/api/shell/games/${gameId}/go-online?offline=1`, "POST", { identityId: "id-local", confirmed: false }),
    env,
  );
  assert.equal(denied.status, 409);

  const allow = await handleApiRequest(
    req(`/api/shell/games/${gameId}/go-online?offline=1`, "POST", { identityId: "id-local", confirmed: true }),
    env,
  );
  assert.equal(allow.status, 200);

  const listAfter = await handleApiRequest(req("/api/shell/games?identityId=id-local&offline=1"), env);
  const listAfterBody = await listAfter.json();
  assert.equal(listAfterBody.games.some((entry) => entry.id === gameId), true);
});

test("live transport: offline view does not reconnect participant and offline moves are local only", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/presence`, "POST", {
      identityId: "id-player2",
      role: "Player 2",
      connected: false,
    }),
    env,
  );

  const offlineView = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-player2&offline=1`), env);
  const offlineBody = await offlineView.json();
  assert.equal(offlineBody.game.player2.connected, false);

  const offlineMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves?offline=1`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(offlineMove.status, 409);
  assert.equal((await offlineMove.json()).error, "offline_move_local_only");
});

test("live transport: offline playground exposes end-turn when one identity controls both seats", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games?offline=1", "POST", { identityId: "id-local", playgroundMode: true, offlineLocal: true }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const moved = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves?offline=1`, "POST", { identityId: "id-local" }),
    env,
  );
  assert.equal(moved.status, 200);

  const view = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-local&offline=1`), env);
  const body = await view.json();
  assert.equal(body.game.canEndTurn, true);

  const ended = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn?offline=1`, "POST", { identityId: "id-local" }),
    env,
  );
  assert.equal(ended.status, 200);
});

test("live transport: move endpoint rejects non-player and wrong-turn players", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const nonPlayerMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-viewer" }),
    env,
  );
  assert.equal(nonPlayerMove.status, 403);
  assert.equal((await nonPlayerMove.json()).error, "role_not_allowed");

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );

  const wrongTurnMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-player2" }),
    env,
  );
  assert.equal(wrongTurnMove.status, 409);
  assert.equal((await wrongTurnMove.json()).error, "not_your_turn");

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(endTurn.status, 200);

  await handleApiRequest(req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }), env);

  const nowPlayer2Move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-player2" }),
    env,
  );
  assert.equal(nowPlayer2Move.status, 200);
});

test("live transport: end-turn rejects empty turns", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(endTurn.status, 409);
  assert.equal((await endTurn.json()).error, "turn_has_no_moves");
});

test("live transport: approve rejects unauthorized approver", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-joiner",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );

  const unauthorizedApprove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/approve`, "POST", {
      identityId: "id-random",
      requesterIdentityId: "id-joiner",
    }),
    env,
  );
  assert.equal(unauthorizedApprove.status, 403);
  assert.equal((await unauthorizedApprove.json()).error, "approval_not_allowed");
});

test("live transport: stale participants load as disconnected until they become active again", async () => {
  const realNow = Date.now;
  let fakeNow = new Date("2026-02-26T00:00:00.000Z").getTime();
  Date.now = () => fakeNow;

  try {
    const create = await handleApiRequest(
      req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
      env,
    );
    const gameId = (await create.json()).game.id;

    await handleApiRequest(
      req(`/api/shell/games/${gameId}/join`, "POST", {
        identityId: "id-player2",
        mode: "player",
        inviteFromRole: "Player 1",
      }),
      env,
    );

    fakeNow += 31_000;

    const ownerView = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
    const ownerBody = await ownerView.json();
    assert.equal(ownerBody.game.player1.connected, true);
    assert.equal(ownerBody.game.player2.connected, false);

    const player2View = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-player2`), env);
    const player2Body = await player2View.json();
    assert.equal(player2Body.game.player2.connected, true);
  } finally {
    Date.now = realNow;
  }
});
