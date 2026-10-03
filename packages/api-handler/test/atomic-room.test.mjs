import { upgradeTestRequest } from "./support/v2-test-adapter.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { persistGameState } from "../src/shell-live-db.ts";
import { GameRoomDO } from "../src/game-room-do.ts";
import { listLegalActions } from "../../game-engine/src/legal";
import { createFakeD1 } from "./support/fake-d1.mjs";
const harness = async () => {
  const DB = createFakeD1();
  const state = { id: { name: "g" }, storage: { setAlarm() {}, deleteAlarm() {} } };
  const room = new GameRoomDO(state, { DB });
  const call = async (route, body = {}) => room.fetch(await upgradeTestRequest(new Request(`https://test/${route}`, { method: "POST", headers: { "x-game-id": "g" }, body: JSON.stringify({ identityId: "actor", ...body }) }), { DB }));
  await call("create", { gameId: "g", selfPlayMode: true });
  const move = () => {
    const game = DB.getGameState("g");
    return { state: game.board.state, action: listLegalActions(game.board.state)[0], clientCommandId: "command" };
  };
  return { DB, room, call, move, state };
};
for (let stage = 0; stage < 5; stage++) test(`I-01/I-02 failed candidate statement ${stage} never publishes or falsely deduplicates`, async () => {
  const { DB, room, call, move } = await harness();
  const before = DB.getGameState("g");
  const messages = [];
  const socket = { send: (message) => messages.push(JSON.parse(message)) };
  room.sessions.set(socket, { socket, identityId: "actor" });
  DB.failNextBatchAt(stage);
  const command = move();
  await assert.rejects(call("apply", command), /Injected/);
  assert.deepEqual(DB.getGameState("g"), before);
  assert.equal(messages.length, 0);
  assert.equal(DB.getEvents("g").length, 1);
  const retried = await (await call("apply", command)).json();
  assert.equal(retried.accepted, true);
  assert.notEqual(retried.duplicate, true);
  assert.equal(DB.getGameState("g").moves.length, 1);
  assert.equal(DB.getGameState("g").gameplayRevision, 1);
  assert.equal(messages.length, 1);
});
test("I-02 lost commit response reloads durable state before retry and restart", async () => {
  const { DB, call, move, state } = await harness();
  const command = move(); DB.loseNextBatchResponse();
  await assert.rejects(call("apply", command), /Lost batch/);
  const retried = await (await call("apply", command)).json();
  assert.equal(retried.duplicate, true);
  assert.equal(retried.game.moves.length, 1);
  const restarted = new GameRoomDO(state, { DB });
  const response = await restarted.fetch(await upgradeTestRequest(new Request("https://test/apply", { method: "POST", headers: { "x-game-id": "g" }, body: JSON.stringify({ identityId: "actor", ...command }) }), { DB }));
  assert.equal((await response.json()).duplicate, true);
  assert.equal(DB.getEvents("g").length, 2);
});
test("I-03 overlapping requests serialize and do not expose a candidate before persistence", async () => {
  const { DB, call, room } = await harness();
  const originalBatch = DB.batch;
  let release; const held = new Promise((resolve) => { release = resolve; });
  let entered; const firstEntered = new Promise((resolve) => { entered = resolve; });
  let batchCount = 0;
  DB.batch = async (statements) => { batchCount++; if (batchCount === 1) { entered(); await held; } return originalBatch(statements); };
  const first = call("join", { identityId: "viewer-a", mode: "viewer" });
  await firstEntered;
  const second = call("join", { identityId: "viewer-b", mode: "viewer" });
  const alarm = room.alarm();
  const id = room.setGameId("g");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(batchCount, 1);
  assert.equal(DB.getGameState("g").viewers.length, 0);
  assert.equal(room.game.viewers.length, 0);
  release();
  await Promise.all([first, second, alarm, id]);
  assert.deepEqual(DB.getGameState("g").viewers.map((viewer) => viewer.identityId), ["viewer-a", "viewer-b"]);
  assert.deepEqual(DB.getEvents("g").map((event) => event.event_seq), [1, 2, 3]);
});
test("I-03 presence, history and send-failure cleanup use ordered revisions without changing gameplay", async () => {
  const { DB, call, room, move } = await harness();
  await call("apply", move());
  const revision = DB.getGameState("g").gameplayRevision;
  const first = (await (await call("history", { moveIndex: 0 })).json()).eventSeq;
  const second = (await (await call("live")).json()).eventSeq;
  assert.equal(second, first + 1);
  const socket = { serializeAttachment() {}, send() { throw new Error("closed"); } };
  room.sessions.set(socket, { socket, gameId: "g", identityId: "actor", sessionId: "session", status: "active", lastSeenAt: Date.now(), lastEventSeq: second });
  await room.webSocketMessage(socket, JSON.stringify({ type: "heartbeat", identityId: "actor", sessionId: "session", lastEventSeq: second }));
  // The failed broadcast queues cleanup after the current mutation, without deadlock.
  await room.alarm();
  await room.webSocketClose(socket);
  const final = DB.getGameState("g");
  assert.equal(final.gameplayRevision, revision);
  assert.equal(final.player1.connected, false);
  const events = DB.getEvents("g");
  assert.deepEqual(events.map((event) => event.event_seq), Array.from({ length: events.length }, (_, index) => index + 1));
});
test("I-01 creation rollback leaves neither projection nor invites", async () => {
  for (let stage = 0; stage < 5; stage++) {
    const DB = createFakeD1(); const room = new GameRoomDO({ id: { name: "g" } }, { DB });
    DB.failNextBatchAt(stage);
    await assert.rejects(room.fetch(new Request("https://test/create", { method: "POST", body: JSON.stringify({ gameId: "g", identityId: "actor" }) })));
    assert.equal(DB.getGameState("g"), null);
    assert.equal(DB.getEvents("g").length, 0);
    for (const write of DB.getWrites().filter((write) => write.query.includes("INSERT INTO live_invites"))) assert.equal(DB.getInvite(write.params[0]), null);
  }
});

test("I-03 concurrent duplicate creation cannot overwrite an existing game", async () => {
  const { DB, call, move } = await harness();
  await call("apply", move());
  const before = DB.getGameState("g");
  const duplicate = await call("create", { gameId: "g", selfPlayMode: true });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(DB.getGameState("g"), before);
});

test("I-03 stale room cannot resurrect a deleted game", async () => {
  const { DB } = await harness();
  const stale = DB.getGameState("g");
  DB.reset();
  await assert.rejects(persistGameState({ DB }, stale, 2, null, { baseEventSeq: 1 }), /missing_game_revision/);
  assert.equal(DB.getGameState("g"), null);
});
