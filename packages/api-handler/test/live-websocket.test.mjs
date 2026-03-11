import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const env = {
  DB: createFakeD1(),
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

test("/api/shell/games/:id/ws returns 426 when runtime has no WebSocketPair support", async () => {
  const create = await handleApiRequest(
    new Request("https://example.test/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId: "id-a" }),
    }),
    env,
  );
  const createBody = await create.json();
  const response = await handleApiRequest(new Request(`https://example.test/api/shell/games/${createBody.game.id}/ws?identityId=id-a&lastEventSeq=0`), env);

  assert.equal(response.status, 426);
});
