import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { assertStorageGeneration, storageRoomName } from "../src/storage-generation.ts";
import { STORAGE_GENERATION_HEADER } from "../../shared-types/src/storage-policy.js";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

test("reset fencing rejects old HTTP and socket generations before writes", async () => {
  const env = { STORAGE_GENERATION: "reset-20261014", DB: createFakeD1() };
  env.GAME_ROOMS = createFakeGameRooms(() => env);
  const bootstrap = await handleApiRequest(new Request("https://test/api/shell/bootstrap"), env);
  assert.equal((await bootstrap.json()).storageGeneration, env.STORAGE_GENERATION);
  assert.equal(bootstrap.headers.get(STORAGE_GENERATION_HEADER), env.STORAGE_GENERATION);
  for (const generation of [null, "previous"]) {
    const response = await handleApiRequest(new Request("https://test/api/shell/games", {
      method: "POST", headers: generation ? { [STORAGE_GENERATION_HEADER]: generation } : {},
      body: JSON.stringify({ gameId: "g", identityId: "actor" }),
    }), env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "storage_reset");
    assert.equal(env.DB.getGameState("g"), null);
  }
  assert.throws(() => assertStorageGeneration(new Request("https://test/ws?storageGeneration=previous", {headers:{upgrade:"websocket"}}), env), /storage_reset/);
  assert.doesNotThrow(() => assertStorageGeneration(new Request(`https://test/ws?storageGeneration=${env.STORAGE_GENERATION}`, {headers:{upgrade:"websocket"}}), env));
  const created = await handleApiRequest(new Request("https://test/api/shell/games", {method:"POST",headers:{[STORAGE_GENERATION_HEADER]:env.STORAGE_GENERATION,"content-type":"application/json"},body:JSON.stringify({gameId:"g",identityId:"actor",selfPlayMode:true})}),env);
  assert.equal(created.status,200);
  assert.equal((await created.json()).game.id,"g");
  assert.equal(storageRoomName(env,"g"),"reset-20261014:g");
  assert.equal(env.DB.getEvents("g").length,0);
});
