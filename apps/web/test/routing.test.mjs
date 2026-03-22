import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGameHash,
  buildHashForRoute,
  buildHomeHash,
  buildInviteHash,
  buildTutorialHash,
  isShellRootHash,
  isShellRouteHash,
  parseRouteFromHash,
  resolveFlyoutState,
  shouldLiveSyncRoute,
  shouldPassiveRefreshRoute,
  toggleScenariosHash,
} from "../shell/routes.js";

test("routing resolves home hash variants with URL-tracked scenarios state only", () => {
  assert.deepEqual(parseRouteFromHash(""), { name: "home", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/"), { name: "home", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/?debug=1"), { name: "home", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/?scenarios=1"), { name: "home", debug: false, scenarios: true });
  assert.equal(buildHomeHash(), "#/");
  assert.equal(buildHomeHash({ debug: true, scenarios: true }), "#/?scenarios=1");
});

test("routing resolves game path with inviter role and URL-tracked scenarios flag", () => {
  const parsed = parseRouteFromHash("#/game/game-1?from=Player%201&debug=1&scenarios=1");
  assert.equal(parsed.name, "game");
  assert.equal(parsed.gameId, "game-1");
  assert.equal(parsed.inviteFromRole, "Player 1");
  assert.equal(parsed.debug, false);
  assert.equal(parsed.scenarios, true);

  assert.equal(buildGameHash("game-1", "Player 2", { debug: true, scenarios: true }), "#/game/game-1?from=Player%202&scenarios=1");
});

test("routing resolves tutorial path and unknown routes", () => {
  assert.deepEqual(parseRouteFromHash("#/tutorial"), { name: "tutorial", gameId: null, debug: false, scenarios: false });
  assert.equal(buildTutorialHash("abc", { debug: true, scenarios: true }), "#/tutorial/abc?scenarios=1");
  assert.deepEqual(parseRouteFromHash("#/nope"), { name: "not-found", debug: false, scenarios: false });
});

test("routing resolves opaque invite path", () => {
  assert.deepEqual(parseRouteFromHash("#/invite/token-123"), {
    name: "invite",
    inviteToken: "token-123",
    debug: false,
    scenarios: false,
  });
  assert.equal(buildInviteHash("abc123", { debug: true, scenarios: true }), "#/invite/abc123?scenarios=1");
});

test("routing distinguishes live sync routes from passive refresh routes", () => {
  assert.equal(shouldLiveSyncRoute({ name: "home" }), false);
  assert.equal(shouldLiveSyncRoute({ name: "game", gameId: "game-1" }), true);
  assert.equal(shouldLiveSyncRoute({ name: "invite", inviteToken: "token-123" }), true);
  assert.equal(shouldLiveSyncRoute({ name: "tutorial" }), false);

  assert.equal(shouldPassiveRefreshRoute({ name: "home" }), true);
  assert.equal(shouldPassiveRefreshRoute({ name: "game", gameId: "game-1" }), false);
  assert.equal(shouldPassiveRefreshRoute({ name: "invite", inviteToken: "token-123" }), false);
  assert.equal(shouldPassiveRefreshRoute({ name: "not-found" }), false);
});

test("routing identifies shell hashes and toggles scenarios state without changing routes", () => {
  assert.equal(isShellRootHash(""), true);
  assert.equal(isShellRootHash("#/"), true);
  assert.equal(isShellRouteHash(""), true);
  assert.equal(isShellRouteHash("#/"), true);
  assert.equal(isShellRouteHash("#/game/game-1"), true);
  assert.equal(isShellRouteHash("#/game/game-1?debug=1"), true);
  assert.equal(isShellRouteHash("#/game/game-1?scenarios=1"), true);
  assert.equal(isShellRouteHash("#/invite/token-1"), true);
  assert.equal(isShellRouteHash("#/tutorial"), true);
  assert.equal(isShellRouteHash("#/home"), false);
  assert.equal(toggleScenariosHash("#/game/game-1"), "#/game/game-1?scenarios=1");
  assert.equal(toggleScenariosHash("#/game/game-1?debug=1"), "#/game/game-1?scenarios=1");
  assert.equal(toggleScenariosHash("#/game/game-1?debug=1&scenarios=1"), "#/game/game-1");
});

test("routing can collapse flyouts when stacking is disabled", () => {
  assert.deepEqual(
    resolveFlyoutState({ debug: true, scenarios: true }, { allowStacking: false }),
    { debug: false, scenarios: true },
  );
  assert.deepEqual(
    resolveFlyoutState({ debug: true, scenarios: true }, { allowStacking: false, preferredKey: "debug" }),
    { debug: true, scenarios: false },
  );
  assert.equal(
    buildHashForRoute({ name: "game", gameId: "game-1", inviteFromRole: null, debug: false, scenarios: true }),
    "#/game/game-1?scenarios=1",
  );
});

test("routing rejects removed legacy aliases", () => {
  assert.deepEqual(parseRouteFromHash("#/home"), { name: "not-found", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/shell/home"), { name: "not-found", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/shell/game/game-1"), { name: "not-found", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/shell/invite/token-1"), { name: "not-found", debug: false, scenarios: false });
  assert.deepEqual(parseRouteFromHash("#/shell/tutorial"), { name: "not-found", debug: false, scenarios: false });
});
