import test from "node:test";
import assert from "node:assert/strict";
import { GameRoomDO } from "../src/game-room-do.ts";
import { readAttempt } from "../src/decision-archive.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";

const fixture = async () => {
  const DB = createFakeD1(), env = { DB, STORAGE_COMPRESSION: "true", STORAGE_METADATA_WRITES_ENABLED: "true" };
  const room = new GameRoomDO({ id: { name: "records" } }, env);
  const call = async (route, body) => {
    const response = await room.fetch(new Request(`https://test/${route}`, { method: "POST", headers: { "x-game-id": "records", "content-type": "application/json" }, body: JSON.stringify({ protocolVersion: 2, identityId: "owner", ...body }) }));
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call("create", { gameId: "records", computer: { p1: null, p2: "babs" } })).status, 200);
  const snapshot = async () => ({ row: DB.getGameRow("records"), payload: await DB.prepare("SELECT format_version,state_blob,state_sha256 FROM game_payloads WHERE game_id=?1").bind("records").first(), events: DB.getEvents("records") });
  const write = (attemptId, attempt = { outcome: "ready", detail: "retained evidence" }) => call("decision-attempt", { operation: "write", kind: "computer", attemptId, attempt });
  return { DB, env, call, write, snapshot };
};

test("saving evidence preserves projection, payload, events and gameplay receipts", async () => {
  const f = await fixture(), before = await f.snapshot(), offset = f.DB.getWrites().length;
  assert.equal((await f.write("one")).status, 200);
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await readAttempt(f.env, "records", "owner", "one", "computer"), { outcome: "ready", detail: "retained evidence" });
  const writes = f.DB.getWrites().slice(offset);
  assert.equal(writes.length, 4, "revision guard, existing trigger enforcement, one record, and guard cleanup");
  assert.ok(writes.every(write => !/^(INSERT INTO live_games|INSERT INTO game_payloads|UPDATE game_payloads|INSERT INTO live_command_receipts)/.test(write.query)));
  assert.ok(writes.filter(write => write.query.startsWith("UPDATE live_games")).every(write => !write.query.includes("state_json") && !write.query.includes("latest_activity_at")));
});

test("duplicate and conflicting evidence retain their existing immutable attempt identity", async () => {
  const f = await fixture();
  assert.equal((await f.write("one")).status, 200);
  const before = await f.snapshot(), count = f.DB.getWrites().length;
  assert.equal((await f.write("one")).status, 200);
  assert.equal((await f.write("one", { outcome: "different" })).status, 409);
  assert.equal(f.DB.getWrites().length, count);
  assert.deepEqual(await f.snapshot(), before);
});

test("every failed record batch stage rolls back, while lost committed responses remain retryable", async () => {
  for (let stage = 0; stage < 4; stage++) {
    const f = await fixture(), before = await f.snapshot();
    f.DB.failNextBatchAt(stage);
    await assert.rejects(f.write("fault"), /Injected batch failure/);
    assert.equal(await readAttempt(f.env, "records", "owner", "fault", "computer"), null);
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.write("fault")).status, 200);
  }
  const f = await fixture(), before = await f.snapshot();
  f.DB.loseNextBatchResponse();
  await assert.rejects(f.write("uncertain"), /Lost batch response/);
  assert.notEqual(await readAttempt(f.env, "records", "owner", "uncertain", "computer"), null);
  assert.equal((await f.write("uncertain")).status, 200);
  assert.deepEqual(await f.snapshot(), before);
});

test("another actor cannot write the owner's evidence", async () => {
  const f = await fixture(), before = await f.snapshot();
  const result = await f.call("decision-attempt", { identityId: "viewer", operation: "write", kind: "computer", attemptId: "spoof", attempt: { outcome: "ready" } });
  assert.equal(result.status, 403);
  assert.equal(await readAttempt(f.env, "records", "owner", "spoof", "computer"), null);
  assert.deepEqual(await f.snapshot(), before);
});

test("a stale cached revision or deleted game cannot admit evidence", async () => {
  const stale = await fixture();
  stale.DB.overwriteGameState("records", game => ({ ...game, eventSeq: 100 }));
  await assert.rejects(stale.write("stale"), /CHECK constraint/);
  assert.equal(await readAttempt(stale.env, "records", "owner", "stale", "computer"), null);
  const missing = await fixture();
  missing.DB.reset();
  await assert.rejects(missing.write("missing"), /CHECK constraint/);
  assert.equal(await readAttempt(missing.env, "records", "owner", "missing", "computer"), null);
});
