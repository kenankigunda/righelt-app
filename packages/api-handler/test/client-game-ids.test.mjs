import test from "node:test";
import assert from "node:assert/strict";

import { handleApiRequest } from "./support/v2-test-adapter.mjs";
import { buildHistoryBranchSeedFromGame } from "../../../apps/web/shell/scenarios.js";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const createEnv = () => {
  const env = {
    DB: createFakeD1(),
    GAME_ROOMS: null,
  };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  return env;
};

test("shell-live create honors a caller-provided game id", async () => {
  const env = createEnv();
  const requestedGameId = "game-client-create-001";

  const response = await handleApiRequest(
    new Request("https://example.test/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-create", selfPlayMode: false, gameId: requestedGameId }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.game.id, requestedGameId);

  const loaded = await handleApiRequest(
    new Request(`https://example.test/api/shell/games/${requestedGameId}?identityId=id-create`),
    env,
  );
  assert.equal(loaded.status, 200);
});

test("shell-live history branch honors a caller-provided game id", async () => {
  const env = createEnv();

  const create = await handleApiRequest(
    new Request("https://example.test/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-branch-owner", selfPlayMode: false }),
    }),
    env,
  );
  const createBody = await create.json();

  const move = await handleApiRequest(
    new Request(`https://example.test/api/shell/games/${createBody.game.id}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-branch-owner", notation: "P1-M1" }),
    }),
    env,
  );
  assert.equal(move.status, 200);

  const source = await handleApiRequest(
    new Request(`https://example.test/api/shell/games/${createBody.game.id}?identityId=id-branch-owner`),
    env,
  );
  const sourceBody = await source.json();
  const branchSeed = buildHistoryBranchSeedFromGame(sourceBody.game, 0);
  const requestedBranchGameId = "game-client-branch-001";

  const response = await handleApiRequest(
    new Request("https://example.test/api/shell/history/branch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId: "id-branch-owner",
        gameId: requestedBranchGameId,
        sourceGameId: createBody.game.id,
        sourceMoveIndex: 0,
        scenario: branchSeed.scenario,
        initialSelectionAction: branchSeed.initialSelectionAction,
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.game.id, requestedBranchGameId);

  const loaded = await handleApiRequest(
    new Request(`https://example.test/api/shell/games/${requestedBranchGameId}?identityId=id-branch-owner`),
    env,
  );
  assert.equal(loaded.status, 200);
});
