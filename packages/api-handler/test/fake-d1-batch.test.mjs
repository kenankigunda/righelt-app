import assert from "node:assert/strict";
import test from "node:test";
import { createFakeD1 } from "./support/fake-d1.mjs";
const statements = (db, seq = 1, base = null) => [
  db.prepare("INSERT INTO live_games").bind("g", "date", "date", "date", "a", "b", 0, JSON.stringify({ id: "g", seq }), seq, seq, base),
  db.prepare("INSERT INTO live_events").bind("g", seq, "{}"),
  db.prepare("INSERT INTO live_command_receipts").bind("g", `v2:${seq}`, "a", "fingerprint", "accepted", null, seq, seq),
  db.prepare("INSERT INTO live_invites").bind(`token${seq}`, "g", "Player 1"),
  db.prepare("INSERT INTO live_legacy_command_tombstones").bind("g", `legacy${seq}`, "{}"),
];
for (let stage = 0; stage < 5; stage++) test(`I-01 fake transaction rolls back statement ${stage}`, async () => {
  const db = createFakeD1();
  await db.batch(statements(db));
  db.failNextBatchAt(stage);
  await assert.rejects(db.batch(statements(db, 2, 1)), /Injected/);
  assert.equal(db.getGameState("g").seq, 1);
  assert.equal(db.getEvents("g").length, 1);
  assert.equal(db.getReceipt("g", "v2:2"), null);
  assert.equal(db.getInvite("token2"), null);
  assert.equal(db.getTombstone("g", "legacy2"), null);
});
test("I-01 stale guard rolls back preceding transaction writes", async () => {
  const db = createFakeD1(); await db.batch(statements(db));
  const next = statements(db, 2, 0);
  await assert.rejects(db.batch([next[1], next[2], next[0]]), /stale_game_revision/);
  assert.equal(db.getEvents("g").length, 1);
  assert.equal(db.getReceipt("g", "v2:2"), null);
});
test("fake can distinguish lost response after commit from rollback", async () => {
  const db = createFakeD1(); db.loseNextBatchResponse();
  await assert.rejects(db.batch(statements(db)), /Lost batch response/);
  assert.equal(db.getReceipt("g", "v2:1").outcome, "accepted");
  assert.equal(db.getGameState("g").seq, 1);
  await assert.rejects(db.batch([db.prepare("INSERT INTO live_command_receipts").bind("g", "v2:1", "other", "other", "rejected", "bad", 2, 2)]), /UNIQUE/);
  assert.equal(db.getReceipt("g", "v2:1").outcome, "accepted");
});
