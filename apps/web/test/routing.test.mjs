import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGameHash,
  buildHomeHash,
  buildInviteHash,
  buildTutorialHash,
  isShellRouteHash,
  parseRouteFromHash,
  shouldLiveSyncRoute,
  shouldPassiveRefreshRoute,
} from "../shell/routes.js";

test("routing resolves home hash variants", () => {
  assert.deepEqual(parseRouteFromHash(""), { name: "home" });
  assert.deepEqual(parseRouteFromHash("#/"), { name: "home" });
  assert.deepEqual(parseRouteFromHash("#/home"), { name: "home" });
  assert.equal(buildHomeHash(), "#/home");
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

test("routing resolves opaque invite path", () => {
  assert.deepEqual(parseRouteFromHash("#/invite/token-123"), {
    name: "invite",
    inviteToken: "token-123",
  });
  assert.equal(buildInviteHash("abc123"), "#/invite/abc123");
});

test("routing distinguishes live sync routes from passive refresh routes", () => {
  assert.equal(shouldLiveSyncRoute({ name: "home" }), true);
  assert.equal(shouldLiveSyncRoute({ name: "game", gameId: "game-1" }), true);
  assert.equal(shouldLiveSyncRoute({ name: "invite", inviteToken: "token-123" }), false);
  assert.equal(shouldLiveSyncRoute({ name: "tutorial" }), false);

  assert.equal(shouldPassiveRefreshRoute({ name: "home" }), true);
  assert.equal(shouldPassiveRefreshRoute({ name: "game", gameId: "game-1" }), true);
  assert.equal(shouldPassiveRefreshRoute({ name: "invite", inviteToken: "token-123" }), true);
  assert.equal(shouldPassiveRefreshRoute({ name: "not-found" }), false);
});

test("routing identifies shell hashes distinctly from playground default", () => {
  assert.equal(isShellRouteHash(""), false);
  assert.equal(isShellRouteHash("#/"), false);
  assert.equal(isShellRouteHash("#/home"), true);
  assert.equal(isShellRouteHash("#/game/game-1"), true);
  assert.equal(isShellRouteHash("#/invite/token-1"), true);
  assert.equal(isShellRouteHash("#/tutorial"), true);
});
