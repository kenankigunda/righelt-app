import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createInitialGame } from "../src/shell-live-core.ts";
import { loadGameProjection, persistGameState } from "../src/shell-live-db.ts";
import { handleLiveGameRequest } from "../src/shell-live.ts";
import { getGameResult } from "../../../apps/web/shell/game-result.js";
import { createFakeD1 } from "./support/fake-d1.mjs";

for (const side of ["p1", "p2", undefined, null, "P2", "invalid", 2]) {
  test(`persisted self-play side normalization: ${String(side)}`, async () => {
    const env = { DB: createFakeD1() };
    const game = createInitialGame({ gameId: "side", identityId: "me", selfPlayMode: true });
    if (side === undefined) delete game.selfPlayStartSide;
    else game.selfPlayStartSide = side;
    await persistGameState(env, game, 1);
    const projection = await loadGameProjection(env, game.id);
    assert.equal(projection.kind, "ok");
    if (side === "p1" || side === "p2") assert.equal(projection.game.selfPlayStartSide, side);
    else assert.equal(Object.hasOwn(projection.game, "selfPlayStartSide"), false);
    projection.game.board.state.outcome = { status: "p1_win" };
    assert.equal(getGameResult(projection.game, "me").side, side === "p2" ? "p2" : "p1");
  });
}

// Real SQLite executes the production migrations and persistence SQL. This is
// a D1-interface integration test; Workers/browser verification is separate.
test("SQLite persistence and the game HTTP projection retain blue self-play result and swapped rematch", async () => {
  const sql = new DatabaseSync(":memory:");
  const migrations = new URL("../../../db/migrations/", import.meta.url);
  const statement = (query, args = []) => ({
    bind: (...values) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { sql.prepare(query).run(...args); return { success: true }; },
  });
  const env = { DB: { prepare: statement, batch: async statements => {
    sql.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); sql.exec("COMMIT"); return results; }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
  } } };
  try {
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(name, migrations), "utf8"));
    const game = createInitialGame({ gameId: "self-blue", identityId: "me", selfPlayMode: true, creatorSide: "p2" });
    game.board.state.outcome = { status: "p1_win", reason: "p2_commander_unsupplied" };
    await persistGameState(env, game, 1);
    const raw = JSON.parse(sql.prepare("SELECT state_json FROM live_games WHERE game_id = ?").get(game.id).state_json);
    assert.equal(raw.selfPlayStartSide, "p2", "persistence writes the selected side");
    const projection = await loadGameProjection(env, game.id);
    assert.equal(projection.kind, "ok");
    assert.equal(projection.game.selfPlayStartSide, "p2", "normalization must retain the selected side");
    for (const revision of [1, 2]) {
      const response = await handleLiveGameRequest(new Request(`https://example.test/api/shell/games/${game.id}?identityId=me`), env);
      assert.equal(response.status, 200);
      assert.equal(response.body.eventSeq, revision);
      assert.equal(response.body.game.selfPlayStartSide, "p2");
      const result = getGameResult(response.body.game, "me");
      assert.equal(result.title, "Loss");
      assert.equal(result.rematchSide, "p1");
      if (revision === 1) await persistGameState(env, projection.game, 2);
    }
  } finally { sql.close(); }
});
