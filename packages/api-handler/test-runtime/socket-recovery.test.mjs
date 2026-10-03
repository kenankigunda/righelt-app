import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixture } from "./fixture.mjs";
import { commandFingerprint } from "../../../apps/web/generated/packages/shared-types/src/sync-protocol.js";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const root = path.resolve(import.meta.dirname, "../../..");
const eventually = async (predicate) => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail("runtime socket event deadline");
};

test("R-01–03 production batch faults, real sockets, silent receive loss and restart", { timeout: 120000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "righelt-t114-sockets-"));
  const bundle = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "runtime-fixture.ts" }, bundle: true, format: "esm", platform: "browser", write: false });
  const options = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-03-12", d1Databases: ["DB"], durableObjects: { GAME_ROOMS: { className: "GameRoomDO", useSQLite: true } }, d1Persist: path.join(directory, "d1"), durableObjectsPersist: path.join(directory, "do") };
  let runtime = new Miniflare(options), sockets = [];
  try {
    let db = await runtime.getD1Database("DB");
    for (const name of (await readdir(path.join(root, "db/migrations"))).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec((await readFile(path.join(root, "db/migrations", name), "utf8")).replace(/--[^\n]*/g, "").replace(/\s+/g, " "));
    }
    const call = async (route, body = {}, headers = {}) => {
      const response = await runtime.dispatchFetch(`https://test/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-game-id": "g", ...headers }, body: JSON.stringify({ protocolVersion: 2, identityId: "actor", ...body }) });
      return { status: response.status, text: await response.text() };
    };
    const json = async (...args) => JSON.parse((await call(...args)).text);
    await json("create", { gameId: "g", selfPlayMode: true });
    const state = async () => db.prepare("SELECT * FROM live_games WHERE game_id='g'").first();
    const durable = async () => ({
      game: await state(),
      events: (await db.prepare("SELECT * FROM live_events WHERE game_id='g' ORDER BY event_seq").all()).results,
      receipts: (await db.prepare("SELECT * FROM live_command_receipts WHERE game_id='g' ORDER BY client_command_id").all()).results,
      invites: (await db.prepare("SELECT * FROM live_invites WHERE game_id='g' ORDER BY token").all()).results,
    });
    const makeCommand = async (id, patch = {}) => {
      const row = await state();
      const value = { protocolVersion: 2, gameId: "g", identityId: "actor", clientCommandId: `v2:${id}`, kind: "move", payload: {}, expectedState: JSON.parse(row.state_json).board.state, expectedGameplayRevision: row.gameplay_revision, ...patch };
      return { ...value, fingerprint: await commandFingerprint(value) };
    };
    const connect = async (identityId, cursor = 0) => {
      const sessionId = String(sockets.length);
      const response = await runtime.dispatchFetch(`https://test/ws?identityId=${identityId}&sessionId=${sessionId}&lastEventSeq=${cursor}`, { headers: { upgrade: "websocket", "x-game-id": "g" } });
      assert.equal(response.status, 101);
      const socket = response.webSocket; const messages = []; const delivered = []; let drop = false;
      socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); messages.push(message); if (!drop) delivered.push(message); });
      socket.accept(); sockets.push(socket);
      await eventually(() => messages.length > 0);
      return { socket, messages, delivered, sessionId, setDrop: (value) => { drop = value; } };
    };
    const player = await connect("actor");
    assert.equal(player.messages.filter((m) => m.game).length, 1, "one initial snapshot, no presence double-send");
    const before = await durable();
    // The real production move batch contains projection, three invite upserts, event, receipt.
    // Replace each statement with invalid SQL inside actual D1, never fake rollback or a debug endpoint.
    const command = await makeCommand("faulted");
    for (let stage = 0; stage < 6; stage++) {
      const response = await call("moves", command, { "x-harness-fail-at": String(stage) });
      assert.equal(response.status, 500, `stage ${stage}: ${response.text}`);
      assert.ok(!response.text.includes("harness_stage_out_of_range"));
      assert.deepEqual(await durable(), before, `stage ${stage} must roll back all production writes`);
      assert.equal(player.messages.filter((m) => m.commandOutcome).length, 0, "no uncommitted broadcast");
    }
    await runtime.dispose(); runtime = new Miniflare(options); db = await runtime.getD1Database("DB");
    assert.equal((await json("moves", command)).commandOutcomes[0].outcome, "accepted", "restart before commit retains retry intent");
    const rejected = await makeCommand("rejected", { expectedGameplayRevision: 0 });
    assert.equal((await json("moves", rejected)).commandOutcomes[0].outcome, "rejected");
    const receiver = await connect("actor");
    await json("join", { identityId: "observer", mode: "viewer" });
    const viewer = await connect("observer");
    assert.equal(viewer.messages[0].game.myRole, "Viewer");
    receiver.socket.send(JSON.stringify({ type: "heartbeat", identityId: "actor", sessionId: receiver.sessionId, lastEventSeq: 0 }));
    await eventually(() => receiver.messages.some((m) => m.type === "heartbeat_ack"));
    const ack = receiver.messages.find((m) => m.type === "heartbeat_ack");
    assert.equal(ack.protocolVersion, 2); assert.equal(ack.gameId, "g");
    const known = receiver.delivered.filter((m) => m.game).at(-1).eventSeq;
    receiver.setDrop(true); // Real socket remains open; inbound frames are lost at the receiving boundary.
    const next = await makeCommand("silent");
    await json("moves", next);
    await eventually(() => receiver.messages.some((m) => m.commandOutcome?.clientCommandId === next.clientCommandId));
    assert.ok(!receiver.delivered.some((m) => m.commandOutcome?.clientCommandId === next.clientCommandId));
    receiver.socket.send(JSON.stringify({ type: "heartbeat", identityId: "actor", sessionId: receiver.sessionId, lastEventSeq: known }));
    await eventually(() => receiver.messages.filter((m) => m.type === "heartbeat_ack").length >= 2);
    receiver.setDrop(false);
    const recovered = await json("reconcile", { commands: [next, rejected], knownSnapshotEventSeq: known });
    assert.deepEqual(recovered.commandOutcomes.map((o) => o.outcome), ["accepted", "rejected"]);
    assert.equal(recovered.game.myRole, "Player 1");
    assert.equal(recovered.game.moves.length, 2);
    const unchanged = await json("reconcile", { commands: [next], knownSnapshotEventSeq: recovered.eventSeq });
    assert.equal(unchanged.game, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(unchanged)) < 1024);
    t.diagnostic(`real-socket recovery snapshot=${Buffer.byteLength(JSON.stringify(recovered))}B metadata=${Buffer.byteLength(JSON.stringify(unchanged))}B`);
    const seq = recovered.eventSeq;
    await runtime.dispose(); runtime = new Miniflare(options); db = await runtime.getD1Database("DB");
    const restored = await json("reconcile", { commands: [next, rejected], knownSnapshotEventSeq: 0 });
    assert.deepEqual(restored.commandOutcomes.map((o) => o.outcome), ["accepted", "rejected"]);
    assert.ok(restored.eventSeq >= seq);
    assert.equal(restored.game.moves.length, 2);
    assert.equal(restored.game.myRole, "Player 1");
    const last = await connect("actor");
    assert.equal(last.messages.filter((m) => m.game).length, 1);
    assert.equal(last.messages[0].game.myRole, "Player 1");
    const base = await state();
    const racing = await Promise.all(Array.from({ length: 12 }, (_, index) => makeCommand(`race-${index}`)));
    const raced = await Promise.all([
      ...racing.map((command) => json("moves", command)),
      json("join", { identityId: "concurrent-viewer", mode: "viewer" }),
      json("history", { moveIndex: 0 }),
    ]);
    assert.equal(raced.slice(0, 12).filter((result) => result.commandOutcomes[0].outcome === "accepted").length, 1);
    assert.equal(raced.slice(0, 12).filter((result) => result.commandOutcomes[0].outcome === "rejected").length, 11);
    const finalRow = await state();
    assert.equal(finalRow.gameplay_revision, base.gameplay_revision + 1);
    const finalEvents = (await db.prepare("SELECT event_seq FROM live_events WHERE game_id='g' ORDER BY event_seq").all()).results;
    assert.deepEqual(finalEvents.map((row) => row.event_seq), Array.from({ length: finalRow.event_seq }, (_, index) => index + 1));
    for (const command of racing) {
      const receipt = await db.prepare("SELECT * FROM live_command_receipts WHERE game_id='g' AND client_command_id=?").bind(command.clientCommandId).first();
      assert.ok(receipt); assert.ok(receipt.event_seq <= finalRow.event_seq);
    }

  } finally {
    for (const socket of sockets) { try { socket.close(); } catch {} }
    await runtime.dispose(); await rm(directory, { recursive: true, force: true });
  }
});
