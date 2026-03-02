import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";

const env = {
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
    },
  },
};

const req = (path, method = "GET", body = null) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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

  const approve = await handleApiRequest(
    req(`/api/shell/games/${gameId}/approve`, "POST", {
      identityId: "id-owner",
      requesterIdentityId: "id-joiner",
    }),
    env,
  );
  const approveBody = await approve.json();
  assert.equal(Boolean(approveBody.game.player2), true);

  const move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const moveBody = await move.json();
  assert.equal(moveBody.game.moves.length, 1);

  const history = await handleApiRequest(
    req(`/api/shell/games/${gameId}/history`, "POST", { identityId: "id-owner", moveIndex: 0 }),
    env,
  );
  const historyBody = await history.json();
  assert.equal(historyBody.game.inHistoryMode, true);

  const live = await handleApiRequest(req(`/api/shell/games/${gameId}/live`, "POST", { identityId: "id-owner" }), env);
  const liveBody = await live.json();
  assert.equal(liveBody.game.inHistoryMode, false);

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
