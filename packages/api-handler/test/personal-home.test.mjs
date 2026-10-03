import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createInitialGame, withViewModel } from "../src/shell-live-core.ts";
import { countHomeSectionGames, listHomeSectionGameProjectionPage } from "../src/shell-live-db.ts";

test("selected blue creator owns Player 2 while the initial red turn remains unchanged", () => {
  const game = createInitialGame({ gameId: "blue", identityId: "me", selfPlayMode: false, creatorSide: "p2" });
  assert.equal(game.player1, null);
  assert.equal(game.player2.identityId, "me");
  assert.equal(game.board.state.sideToMove, "P1");
  assert.equal(withViewModel(game, "me").myRole, "Player 2");
  assert.equal(withViewModel(game, "me").canRecordMove, false);
});

test("real SQLite resume query filters finished games and orders before pagination", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE live_games (game_id TEXT, created_at TEXT, updated_at TEXT, latest_activity_at TEXT,
    player1_identity_id TEXT, player2_identity_id TEXT, has_smoke_identity INTEGER, state_json TEXT, event_seq INTEGER, gameplay_revision INTEGER, ownership_mode TEXT)`);
  const add = (id, at, { side = "P1", done = false, retreat = false } = {}) => {
    const game = createInitialGame({ gameId: id, identityId: "me", selfPlayMode: false });
    game.createdAt = game.updatedAt = at;
    game.board.state.sideToMove = side;
    game.turns[0].playerSeat = side === "P1" ? "Player 1" : "Player 2";
    if (done) game.board.state.outcome = { status: "p1_win", reason: "commander_unsupplied" };
    if (retreat) game.board.state.continuation = { type: "push", phase: "retreat" };
    sql.prepare("INSERT INTO live_games VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 'legacy_guest')").run(id, at, at, at, "me", "them", JSON.stringify(game));
  };
  add("opponent", "2026-03-01", { side: "P2" });
  add("b", "2026-01-01"); add("a", "2026-01-01");
  add("finished", "2026-04-01", { done: true });
  add("retreat", "2026-02-01", { side: "P2", retreat: true });
  const env = { DB: { prepare: query => ({ bind: (...args) => ({
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args),
  }) }) } };
  try {
    const params = { identityId: "me", section: "my", debug: false, unfinished: true, page: 0, pageSize: 1 };
    assert.equal(await countHomeSectionGames(env, params), 4);
    const ordered = [];
    for (let page = 0; page < 4; page++) ordered.push((await listHomeSectionGameProjectionPage(env, { ...params, page }))[0].id);
    assert.deepEqual(ordered, ["retreat", "a", "b", "opponent"]);
    assert.equal(await countHomeSectionGames(env, { ...params, unfinished: false, finished: true }), 1);
  } finally { sql.close(); }
});
