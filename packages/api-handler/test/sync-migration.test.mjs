import { buildReportSql } from "../../../scripts/db-retention-cleanup-shared.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const folder = new URL("../../../db/migrations/", import.meta.url);
const migration = (file) => readFileSync(new URL(file, folder), "utf8");
// SQLite exercises the actual SQL here; Workers/D1 proof remains a separate required gate.
for (const existing of [false, true]) test(`I-04 durability schema preserves ${existing ? "existing" : "fresh"} database`, () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(folder).filter((file) => file.endsWith(".sql") && file < "0009").sort()) db.exec(migration(file));
    if (existing) db.exec("INSERT INTO live_games (game_id,created_at,updated_at,latest_activity_at,state_json,event_seq) VALUES ('g','d','d','d','{}',3)");
    db.exec(migration("0009_sync_command_durability.sql"));
    if (existing) assert.deepEqual({ ...db.prepare("SELECT state_json,event_seq,gameplay_revision,commit_base_event_seq FROM live_games WHERE game_id='g'").get() }, { state_json: "{}", event_seq: 3, gameplay_revision: 0, commit_base_event_seq: null });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_command_receipts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_legacy_command_tombstones").get().n, 0);
  } finally { db.close(); }
});
test("I-01 actual SQL guard aborts stale writes and permits forward revision", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(folder).filter((file) => file.endsWith(".sql")).sort()) db.exec(migration(file));
    db.exec("INSERT INTO live_games (game_id,created_at,updated_at,latest_activity_at,state_json,event_seq) VALUES ('g','d','d','d','{}',3)");
    for (const [event, base, gameplay] of [[4,2,1], [3,3,0], [2,3,0]]) {
      db.exec("BEGIN");
      db.exec("INSERT INTO live_events VALUES ('g',4,'{}')");
      assert.throws(() => db.prepare("UPDATE live_games SET event_seq=?,commit_base_event_seq=?,gameplay_revision=? WHERE game_id='g'").run(event,base,gameplay), /stale_game_revision/);
      db.exec("ROLLBACK");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_events").get().n, 0);
      assert.equal(db.prepare("SELECT event_seq FROM live_games").get().event_seq, 3);
    }
    db.exec("UPDATE live_games SET event_seq=4,commit_base_event_seq=3,gameplay_revision=1 WHERE game_id='g'");
    assert.throws(() => db.exec("UPDATE live_games SET event_seq=5,commit_base_event_seq=4,gameplay_revision=0 WHERE game_id='g'"), /stale_game_revision/);
    db.exec("INSERT INTO live_command_receipts VALUES ('g','v2:c','actor','fp','accepted',NULL,4,1,NULL)");
    assert.throws(() => db.exec("INSERT INTO live_command_receipts VALUES ('g','v2:c','other','fp','rejected','bad',4,1,NULL)"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO live_command_receipts VALUES ('g','v2:unknown','actor','fp','unknown',NULL,4,1,NULL)"), /CHECK/);
  } finally { db.close(); }
});

test("I-04 backfill uses complete evidence, quarantines legacy IDs, skips corrupt JSON and repeats safely", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(folder).filter((file) => file.endsWith(".sql") && file < "0010").sort()) db.exec(migration(file));
    const insert = db.prepare("INSERT INTO live_games (game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,gameplay_revision) VALUES (?,'d','d','d',?,4,2)");
    insert.run("g", JSON.stringify({ moves: [{ clientCommandId: "undone", undone: true }, "bad", 1, null] }));
    insert.run("corrupt", "{");
    const event = db.prepare("INSERT INTO live_events VALUES ('g',?,?)");
    event.run(1, JSON.stringify({ clientCommandId: "trimmed", game: { moves: [{ clientCommandId: "snapshot-only" }, "bad", null] } }));
    event.run(2, "{");
    event.run(3, JSON.stringify({ commandOutcome: { gameId: "g", identityId: "actor", clientCommandId: "v2:proven", fingerprint: "a".repeat(64), outcome: "accepted", reason: null, eventSeq: 3, gameplayRevision: 1 } }));
    event.run(4, JSON.stringify({ commandOutcome: { gameId: "g", identityId: "actor", clientCommandId: "v2:invalid", fingerprint: "a".repeat(64), outcome: "rejected", reason: 42, eventSeq: 4, gameplayRevision: 1 } }));
    for (let repeat = 0; repeat < 2; repeat++) db.exec(migration("0010_sync_command_backfill.sql"));
    assert.deepEqual(db.prepare("SELECT client_command_id FROM live_command_receipts").all().map((row) => row.client_command_id), ["v2:proven"]);
    assert.deepEqual(db.prepare("SELECT client_command_id FROM live_legacy_command_tombstones ORDER BY client_command_id").all().map((row) => row.client_command_id), ["snapshot-only", "trimmed", "undone", "v2:invalid"]);
    const counts = new Map(db.prepare(buildReportSql("0")).all().map((row) => [row.table_name, row.stale_row_count]));
    assert.equal(counts.get("live_command_receipts"), 1);
    assert.equal(counts.get("live_legacy_command_tombstones"), 4);
    assert.equal(db.prepare("SELECT state_json FROM live_games WHERE game_id='corrupt'").get().state_json, "{");
    db.exec("UPDATE live_games SET latest_activity_at='active' WHERE game_id='g'");
    // A game becoming active is not selected for deletion; evidence must remain.
    db.exec("DELETE FROM live_games WHERE latest_activity_at='stale'");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_command_receipts").get().n, 1);
    db.exec("DELETE FROM live_games WHERE game_id='g'");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_command_receipts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM live_legacy_command_tombstones").get().n, 0);
  } finally { db.close(); }
});
