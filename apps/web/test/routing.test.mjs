import test from "node:test";
import assert from "node:assert/strict";
import { buildGameHash, buildHomeHash, buildTutorialHash, parseRouteFromHash } from "../shell/routes.js";

test("routing resolves home hash variants", () => {
  assert.deepEqual(parseRouteFromHash(""), { name: "home" });
  assert.deepEqual(parseRouteFromHash("#/"), { name: "home" });
  assert.equal(buildHomeHash(), "#/");
});

test("routing resolves game path with inviter role", () => {
  const parsed = parseRouteFromHash("#/game/game-1?from=Player%201");
  assert.equal(parsed.name, "game");
  assert.equal(parsed.gameId, "game-1");
  assert.equal(parsed.inviteFromRole, "Player 1");

  assert.equal(buildGameHash("game-1", "Player 2"), "#/game/game-1?from=Player%202");
});

test("routing resolves tutorial path and unknown routes", () => {
  assert.deepEqual(parseRouteFromHash("#/tutorial"), { name: "tutorial", gameId: null });
  assert.equal(buildTutorialHash("abc"), "#/tutorial/abc");
  assert.deepEqual(parseRouteFromHash("#/nope"), { name: "not-found" });
});
