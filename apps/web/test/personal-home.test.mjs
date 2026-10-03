import test from "node:test";
import assert from "node:assert/strict";
import { selectResumeGames, getComputerReadiness } from "../shell/personal-home.js";
import { safeAccountIntent } from "../shell/account-controller.js";
const card = (id, updatedAt, ownTurn = true, status = "ongoing") => ({
  id, updatedAt, player1: { identityId: "me" }, player2: { identityId: "them" },
  previewSnapshot: { outcome: { status }, sideToMove: ownTurn ? "P1" : "P2", continuation: null },
});
test("resume orders your decisions before recency and deterministic ID ties", () => {
  const games = [card("z", "2026-02-02", false), card("b", "2026-01-01"), card("a", "2026-01-01"), card("won", "2026-03-01", true, "p1_win")];
  assert.deepEqual(selectResumeGames(games, "me").map(game => game.id), ["a", "b", "z"]);
  assert.equal(games.length, 4);
  games[0].previewSnapshot.continuation = { type: "push", phase: "retreat" };
  assert.equal(selectResumeGames(games, "me")[0].id, "z");
});
test("account play intent preserves typed opponent and side and rejects unknown values", () => {
  const intent = { hash: "#/", action: "start-opponent", opponent: "tau", side: "p2" };
  assert.deepEqual(safeAccountIntent(intent), intent);
  assert.equal(safeAccountIntent({ ...intent, opponent: "legacy-bot" }), null);
  assert.equal(safeAccountIntent({ ...intent, side: "P2" }), null);
  assert.equal(safeAccountIntent({ ...intent, hash: "https://evil.example" }), null);
});
test("computer readiness is honestly unavailable without production runtime", () => {
  assert.equal(getComputerReadiness("babs").state, "unavailable");
});
