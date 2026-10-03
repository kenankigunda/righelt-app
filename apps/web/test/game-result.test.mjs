import test from "node:test";
import assert from "node:assert/strict";
import { getGameResult, createResultTransitions } from "../shell/game-result.js";
const game = (status = "ongoing") => ({ id: "g", player1: { identityId: "red" }, player2: { identityId: "blue" }, board: { state: { outcome: { status, reason: "p2_commander_unsupplied" } } } });
test("results use authoritative outcome and selected self-play side, with swapped rematch side", () => {
  assert.equal(getGameResult(game(), "red"), null);
  assert.equal(getGameResult(game("p1_win"), "red").title, "Win");
  assert.equal(getGameResult(game("p1_win"), "blue").title, "Loss");
  assert.equal(getGameResult(game("p1_win"), "viewer").title, "Player 1 wins");
  assert.equal(getGameResult(game("draw"), "blue").title, "Draw");
  const self = { ...game("p1_win"), selfPlayMode: true, selfPlayStartSide: "p2", currentSnapshot: { outcome: { status: "ongoing" } } };
  assert.deepEqual(getGameResult(self, "red"), { title: "Loss", side: "p2", reason: "Player 2’s commander lost its supply.", opponent: "self", rematchSide: "p1" });
});
test("result automatic entry happens once on an observed live finish, never hydration/history/hidden/story", () => {
  const tracker = createResultTransitions();
  assert.equal(tracker.observe(game("p1_win")), false);
  tracker.clear(); assert.equal(tracker.observe(game()), false);
  assert.equal(tracker.observe(game("p1_win")), true);
  assert.equal(tracker.observe(game("p1_win")), false);
  for (const option of ["inHistory", "hidden", "storyOpen"]) {
    tracker.clear(); tracker.observe(game());
    assert.equal(tracker.observe(game("draw"), { [option]: true }), false);
    assert.equal(tracker.observe(game("draw")), false);
  }
});
