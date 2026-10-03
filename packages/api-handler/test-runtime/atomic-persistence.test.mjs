import { commandFingerprint } from "../../../apps/web/generated/packages/shared-types/src/sync-protocol.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const root = path.resolve(import.meta.dirname, "../../..");
const fixture = `import { GameRoomDO as ActualGameRoom } from './packages/api-handler/src/game-room-do.ts';
export class GameRoomDO extends ActualGameRoom {
 constructor(state, env) {
  let lose = false;
  super(state, { ...env, DB: { prepare: (...args) => env.DB.prepare(...args), batch: async (...args) => {
   const result = await env.DB.batch(...args);
   if (lose) { lose = false; throw new Error('harness_lost_commit_response'); }
   return result;
  } } });
  this.lose = () => { lose = true; };
 }
 fetch(request) { if (request.headers.get('x-harness-lose-response')) this.lose(); return super.fetch(request); }
}
export default { async fetch(request, env) {
 const gameId = request.headers.get('x-game-id');
 return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId)).fetch(request);
}};`;

test("R-01/R-02 actual Workers/D1 rollback, ordering, receipt restart and migration", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "righelt-t114-runtime-"));
  const bundle = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "t114-runtime-fixture.ts" }, bundle: true, format: "esm", platform: "browser", write: false });
  const options = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-03-12", d1Databases: ["DB"], durableObjects: { GAME_ROOMS: { className: "GameRoomDO", useSQLite: true } }, d1Persist: path.join(directory, "d1"), durableObjectsPersist: path.join(directory, "do") };
  let runtime = new Miniflare(options);
  try {
    let db = await runtime.getD1Database("DB");
    for (const name of (await readdir(path.join(root, "db/migrations"))).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = (await readFile(path.join(root, "db/migrations", name), "utf8")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
      await db.exec(sql);
    }
    const call = (route, body) => runtime.dispatchFetch(`https://test/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-game-id": "runtime-game" }, body: JSON.stringify({ identityId: "actor", protocolVersion: 2, ...body }) });
    const created = await (await call("create", { gameId: "runtime-game", selfPlayMode: true })).json();
    assert.equal(created.ok, true);
    const before = await db.prepare("SELECT * FROM live_games WHERE game_id=?").bind("runtime-game").first();
    const seq = before.event_seq;
    const mutations = () => [
      db.prepare("UPDATE live_games SET event_seq=?,commit_base_event_seq=? WHERE game_id=?").bind(seq + 1, seq, "runtime-game"),
      db.prepare("INSERT INTO live_events VALUES (?,?,?)").bind("runtime-game", seq + 1, "{}"),
      db.prepare("INSERT INTO live_command_receipts VALUES (?,?,?,?,?,?,?,?,?)").bind("runtime-game", "v2:atomic", "actor", "fingerprint", "accepted", null, seq + 1, 1, null),
      db.prepare("INSERT INTO live_invites VALUES (?,?,?)").bind("fault-invite", "runtime-game", "Viewer"),
    ];
    for (let index = 0; index < 4; index++) {
      const statements = mutations();
      statements.splice(index, 0, db.prepare("INSERT INTO live_events VALUES (?,?,?)").bind("runtime-game", seq, "duplicate"));
      await assert.rejects(db.batch(statements));
      assert.equal((await db.prepare("SELECT event_seq FROM live_games WHERE game_id=?").bind("runtime-game").first()).event_seq, seq);
      assert.equal(await db.prepare("SELECT * FROM live_command_receipts WHERE client_command_id='v2:atomic'").first(), null);
      assert.equal(await db.prepare("SELECT * FROM live_invites WHERE token='fault-invite'").first(), null);
    }
    const statements = mutations();
    statements[0] = db.prepare("UPDATE live_games SET event_seq=?,commit_base_event_seq=? WHERE game_id=?").bind(seq + 1, seq - 1, "runtime-game");
    await assert.rejects(db.batch([statements[1], statements[2], statements[3], statements[0]]), /stale_game_revision/);
    assert.equal(await db.prepare("SELECT * FROM live_command_receipts WHERE client_command_id='v2:atomic'").first(), null);
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO live_games (game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,commit_base_event_seq) VALUES ('missing','d','d','d','{}',2,1)")
    ]), /missing_game_revision/);
    assert.equal(await db.prepare("SELECT * FROM live_games WHERE game_id='missing'").first(), null);
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => call("join", { identityId: `viewer-${index}`, mode: "viewer" }).then((response) => response.json())));
    assert.ok(concurrent.every((response) => response.ok));
    const after = await db.prepare("SELECT * FROM live_games WHERE game_id=?").bind("runtime-game").first();
    assert.equal(after.event_seq, seq + 12);
    assert.equal(after.gameplay_revision, 0);
    assert.equal(JSON.parse(after.state_json).viewers.length, 12);
    const eventRows = (await db.prepare("SELECT event_seq FROM live_events WHERE game_id=? ORDER BY event_seq").bind("runtime-game").all()).results;
    assert.deepEqual(eventRows.map((row) => row.event_seq), Array.from({ length: after.event_seq }, (_, index) => index + 1));
    const initialState = JSON.parse(after.state_json);
    const command = { protocolVersion: 2, gameId: "runtime-game", identityId: "actor", clientCommandId: "v2:runtime-move", kind: "move", payload: {}, expectedState: initialState.board.state, expectedGameplayRevision: 0 };
    command.fingerprint = await commandFingerprint(command);
    const lost = await runtime.dispatchFetch("https://test/moves", { method: "POST", headers: { "content-type": "application/json", "x-game-id": "runtime-game", "x-harness-lose-response": "1" }, body: JSON.stringify(command) });
    assert.equal(lost.status, 500);
    assert.equal((await db.prepare("SELECT outcome FROM live_command_receipts WHERE client_command_id=?").bind(command.clientCommandId).first()).outcome, "accepted");
    await runtime.dispose();
    runtime = new Miniflare(options);
    db = await runtime.getD1Database("DB");
    const retry = await (await call("moves", command)).json();
    assert.equal(retry.commandOutcomes[0].outcome, "accepted");
    assert.equal(retry.duplicate, true);
    assert.equal(retry.game.moves.length, 1);
    const recovered = await (await call("reconcile", { commands: [command], knownSnapshotEventSeq: retry.eventSeq })).json();
    assert.equal(recovered.game, undefined);
    assert.equal(recovered.commandOutcomes[0].outcome, "accepted");
    const restarted = await (await call("live", {})).json();
    assert.equal(restarted.ok, true);
    assert.equal(restarted.eventSeq, after.event_seq + 2);
    assert.equal(restarted.game.viewers.length, 12);
    assert.equal((await db.prepare("SELECT event_seq FROM live_games WHERE game_id=?").bind("runtime-game").first()).event_seq, restarted.eventSeq);
    // Reconstruct only complete event evidence, retaining legacy IDs as non-terminal markers.
    await db.prepare("DELETE FROM live_command_receipts WHERE client_command_id=?").bind(command.clientCommandId).run();
    await db.prepare("INSERT INTO live_events VALUES ('runtime-game',999,?)").bind(JSON.stringify({ clientCommandId: "legacy-trimmed" })).run();
    await db.prepare("INSERT INTO live_events VALUES ('runtime-game',1000,'{')").run();
    const backfill = (await readFile(path.join(root, "db/migrations/0010_sync_command_backfill.sql"), "utf8")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
    const backfillBatch = () => backfill.split(";").filter((sql) => sql.trim()).map((sql) => db.prepare(sql));
    await db.batch(backfillBatch()); await db.batch(backfillBatch());
    assert.equal((await db.prepare("SELECT outcome FROM live_command_receipts WHERE client_command_id=?").bind(command.clientCommandId).first()).outcome, "accepted");
    assert.ok(await db.prepare("SELECT * FROM live_legacy_command_tombstones WHERE client_command_id='legacy-trimmed'").first());
    await db.prepare("DELETE FROM live_games WHERE game_id='runtime-game'").run();
    assert.equal(await db.prepare("SELECT * FROM live_command_receipts WHERE client_command_id=?").bind(command.clientCommandId).first(), null);
    assert.equal(await db.prepare("SELECT * FROM live_legacy_command_tombstones WHERE client_command_id='legacy-trimmed'").first(), null);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
