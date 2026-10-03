import test from "node:test";
import assert from "node:assert/strict";
import { createContextualHelp, canRestoreGameView, gamePlayRevision } from "../shell/play-view.js";
import { createInitialState } from "../generated/packages/game-engine/src/state.js";

test("view restoration uses actual game state and account, not cosmetic timestamps", () => {
  const game = { board: { state: createInitialState() }, updatedAt: "before" };
  const saved = { identity: "a", revision: gamePlayRevision(game), historyIndex: 0, panel: "history" };
  assert.equal(canRestoreGameView(saved, { ...game, updatedAt: "later" }, "a"), true);
  assert.equal(canRestoreGameView(saved, game, "b"), false);
  game.board.state.pieces[0].position.row -= 1;
  assert.equal(canRestoreGameView(saved, game, "a"), false);
});

test("automatic help suppresses a dismissed reason per game, while manual help survives a move", () => {
  const help = createContextualHelp();
  help.explain("supply", "Needs supply");
  assert.equal(help.getState().expanded, true);
  help.dismiss();
  help.explain("supply", "Needs supply again");
  assert.equal(help.getState().expanded, false);
  help.explain("strength", "Needs strength");
  assert.equal(help.getState().expanded, true);
  help.select("Preview. Activate this destination again to play.");
  help.commit();
  assert.doesNotMatch(help.getState().text, /Activate/);
  assert.equal(help.getState().reason, "");
  assert.equal(help.getState().expanded, false);
  help.toggleManual();
  help.select("Preview. Activate this destination again to play.");
  help.commit("Choose the next retreat decision.");
  assert.equal(help.getState().text, "Choose the next retreat decision.");
  assert.equal(help.getState().manual, true);
  assert.equal(help.getState().expanded, true);
  const anotherGame = createContextualHelp();
  anotherGame.explain("supply", "Needs supply");
  assert.equal(anotherGame.getState().expanded, true);
});

test("dismissed rule help survives reload and preference hydration within its account/game only", () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = createContextualHelp({ storage, key: "account-a:game-1" });
  first.explain("supply", "A supply rule"); first.dismiss();
  const reload = createContextualHelp({ storage, key: "account-a:game-1" });
  reload.setManual(false); reload.explain("supply", "A supply rule"); assert.equal(reload.getState().expanded, false);
  reload.setManual(true); reload.explain("supply", "A supply rule"); assert.equal(reload.getState().expanded, true);
  for (const key of ["account-b:game-1", "account-a:game-2"]) {
    const other = createContextualHelp({ storage, key }); other.explain("supply", "A supply rule"); assert.equal(other.getState().expanded, true);
  }
  const blocked = createContextualHelp({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } }, key: "x" });
  assert.doesNotThrow(() => { blocked.explain("supply", "Rule"); blocked.dismiss(); });
});
