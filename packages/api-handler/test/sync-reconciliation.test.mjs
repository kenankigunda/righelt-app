import assert from "node:assert/strict";
import test from "node:test";
import { GameRoomDO } from "../src/game-room-do.ts";
import { handleApiRequest } from "../src/index.ts";
import { loadGameProjection } from "../src/shell-live-db.ts";
import { commandFingerprint } from "../../shared-types/src/sync-protocol.ts";
import { applyServerMove } from "../src/shell-live-core.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";
const harness = async () => {
  const DB = createFakeD1(); const env = { DB }; const state = { id: { name: "g" } };
  let room = new GameRoomDO(state, env);
  const call = async (route, body = {}) => {
    const response = await room.fetch(new Request(`https://test/${route}`, { method: "POST", headers: { "x-game-id": "g" }, body: JSON.stringify({ identityId: "actor", protocolVersion: 2, ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  await call("create", { gameId: "g", selfPlayMode: true });
  const command = async (patch = {}) => {
    const game = DB.getGameState("g");
    const next = { protocolVersion: 2, gameId: "g", identityId: "actor", clientCommandId: `v2:${crypto.randomUUID()}`, kind: "move", payload: {}, expectedState: game.board.state, expectedGameplayRevision: game.gameplayRevision, ...patch };
    return { ...next, fingerprint: await commandFingerprint(next) };
  };
  const reconcile = (commands, knownSnapshotEventSeq = 0) => call("reconcile", { commands, knownSnapshotEventSeq });
  return { DB, env, call, command, reconcile, restart: () => { room = new GameRoomDO(state, env); } };
};
test("I-05 receipts survive undo, conflict reuse, uncertain response and restart", async () => {
  const h = await harness(); const a = await h.command();
  h.DB.loseNextBatchResponse(); await assert.rejects(h.call("moves", a), /Lost batch/);
  h.restart();
  const retried = await h.call("moves", a);
  assert.equal(retried.commandOutcomes[0].outcome, "accepted");
  assert.equal(retried.duplicate, true);
  const undone = await h.call("revert-request", { targetMoveId: retried.move.moveId });
  assert.equal(undone.status, 200); assert.equal(undone.autoApproved, true);
  assert.equal(undone.game.moves.find((move) => move.moveId === retried.move.moveId).undone, true);
  assert.ok(undone.game.gameplayRevision > retried.game.gameplayRevision);
  const afterUndo = h.DB.getGameState("g");
  const old = await h.call("moves", a);
  assert.equal(old.commandOutcomes[0].outcome, "accepted");
  assert.deepEqual(h.DB.getGameState("g"), afterUndo);
  const conflicting = await h.command({ clientCommandId: a.clientCommandId, payload: { notation: "changed" } });
  assert.equal((await h.call("moves", conflicting)).commandOutcomes[0].reason, "command_id_conflict");
  assert.equal(h.DB.getReceipt("g", a.clientCommandId).fingerprint, a.fingerprint);
});
test("I-06 descendants stay unknown until accepted predecessor, then use original intent", async () => {
  const h = await harness(); const a = await h.command();
  const predicted = structuredClone(h.DB.getGameState("g")); applyServerMove(predicted, undefined, a.clientCommandId);
  const b = await h.command({ expectedState: predicted.board.state, expectedGameplayRevision: 1, predecessor: { clientCommandId: a.clientCommandId, fingerprint: a.fingerprint } });
  assert.equal((await h.call("moves", b)).commandOutcomes[0].reason, "dependency_pending");
  assert.equal(h.DB.getReceipt("g", b.clientCommandId), null);
  assert.deepEqual((await h.reconcile([b, a])).commandOutcomes.map((o) => o.outcome), ["unknown", "unknown"]);
  await h.call("moves", a);
  assert.equal((await h.call("moves", b)).commandOutcomes[0].outcome, "accepted");
  assert.equal(h.DB.getGameState("g").moves.length, 2);
});
test("I-06 rejected predecessor durably cancels descendant; accepted then undone rejects stale descendant", async () => {
  for (const rejected of [false, true]) {
    const h = await harness();
    const a = await h.command(rejected ? { kind: "action", payload: { action: { type: "not-real" } } } : {});
    const predicted = structuredClone(h.DB.getGameState("g")); applyServerMove(predicted, undefined, a.clientCommandId);
    const b = await h.command({ expectedState: predicted.board.state, expectedGameplayRevision: 1, predecessor: { clientCommandId: a.clientCommandId, fingerprint: a.fingerprint } });
    const sent = await h.call(rejected ? "apply" : "moves", a);
    if (!rejected) {
      const undone = await h.call("revert-request", { targetMoveId: sent.move.moveId });
      assert.equal(undone.status, 200); assert.equal(undone.autoApproved, true);
      assert.equal(undone.game.moves.find((move) => move.moveId === sent.move.moveId).undone, true);
      assert.ok(undone.game.gameplayRevision > sent.game.gameplayRevision);
    }
    const expected = rejected ? "predecessor_rejected" : "stale_state";
    assert.equal((await h.reconcile([b])).commandOutcomes[0].reason, expected);
    h.restart(); assert.equal((await h.call("moves", b)).commandOutcomes[0].reason, expected);
    assert.equal(h.DB.getReceipt("g", a.clientCommandId).outcome, rejected ? "rejected" : "accepted");
  }
});
test("I-09 unknown is not rejection; unchanged snapshots omitted while old receipts settle", async () => {
  const h = await harness(); const a = await h.command();
  const initial = await h.reconcile([a], 1);
  assert.equal(initial.commandOutcomes[0].outcome, "unknown"); assert.equal(initial.game, undefined);
  const accepted = await h.call("moves", a);
  await h.call("join", { identityId: "viewer", mode: "viewer" });
  const current = await h.reconcile([a]);
  assert.ok(current.eventSeq > accepted.commandOutcomes[0].eventSeq);
  assert.equal(current.commandOutcomes[0].outcome, "accepted");
  assert.equal((await h.reconcile([a], current.eventSeq)).game, undefined);
});
test("I-05 presence does not stale intent; delayed end-turn and conflicting actors are rejected", async () => {
  const h = await harness(); const a = await h.command();
  const end = await h.command({ kind: "end_turn", expectedTurnIndex: 0 });
  await h.call("join", { identityId: "viewer", mode: "viewer" });
  assert.equal((await h.call("moves", a)).commandOutcomes[0].outcome, "accepted");
  assert.equal((await h.call("end-turn", end)).commandOutcomes[0].reason, "stale_state");
  const other = await h.command({ ...a, identityId: "viewer" });
  assert.equal((await h.call("moves", other)).commandOutcomes[0].reason, "command_id_conflict");
});
test("I-04 SQL gameplay revision overrides corrupt or missing JSON revision", async () => {
  const h = await harness(); await h.call("moves", await h.command());
  for (const value of [undefined, 0, 999]) {
    h.DB.overwriteGameState("g", (game) => ({ ...game, gameplayRevision: value }));
    assert.equal((await loadGameProjection(h.env, "g")).game.gameplayRevision, 1);
  }
});
test("U-03 rejects legacy, corrupted fingerprints, oversized chunked bodies and dependency cycles", async () => {
  const h = await harness(); const a = await h.command();
  assert.equal((await h.call("moves", { protocolVersion: 1 })).status, 426);
  assert.equal((await h.call("moves", { ...a, fingerprint: "f".repeat(64) })).status, 400);
  assert.equal((await h.reconcile(Array(17).fill(a))).status, 400);
  const cycle = { ...a, predecessor: { clientCommandId: a.clientCommandId, fingerprint: a.fingerprint } };
  assert.equal((await h.reconcile([cycle])).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  const response = await handleApiRequest(new Request("https://test/api/shell/games/g/reconcile", { method: "POST", body: stream, duplex: "half" }), h.env);
  assert.equal(response.status, 413);
});
test("I-05 receipts remain effective after 205 moves trim the visible history", { timeout: 60000 }, async () => {
  const h = await harness(); const first = await h.command();
  await h.call("moves", first);
  for (let index = 1; index < 205; index++) {
    const result = await h.call("moves", await h.command());
    assert.equal(result.commandOutcomes[0].outcome, "accepted", JSON.stringify(result.commandOutcomes));
  }
  assert.equal(h.DB.getGameState("g").moves.length, 200);
  h.restart(); const before = h.DB.getGameState("g");
  const retried = await h.call("moves", first);
  assert.equal(retried.commandOutcomes[0].outcome, "accepted");
  assert.deepEqual(h.DB.getGameState("g"), before);
});

test("I-01 receipt statement failure rolls back the move and its event", async () => {
  const h = await harness(); const a = await h.command(); const before = h.DB.getGameState("g");
  h.DB.failNextBatchAt(5);
  await assert.rejects(h.call("moves", a), /Injected/);
  assert.deepEqual(h.DB.getGameState("g"), before);
  assert.equal(h.DB.getReceipt("g", a.clientCommandId), null);
  assert.equal(h.DB.getEvents("g").length, 1);
  assert.equal((await h.call("moves", a)).commandOutcomes[0].outcome, "accepted");
});

test("I-04 legacy evidence blocks replay without fabricating rejection", async () => {
  const h = await harness(); const a = await h.command();
  await h.DB.prepare("INSERT INTO live_legacy_command_tombstones").bind("g", a.clientCommandId, '{"source":"event"}').run();
  assert.equal((await h.call("moves", a)).commandOutcomes[0].reason, "legacy_evidence");
  assert.equal((await h.reconcile([a])).commandOutcomes[0].outcome, "unknown");
  assert.equal(h.DB.getReceipt("g", a.clientCommandId), null);
  assert.equal(h.DB.getGameState("g").moves.length, 0);
});

test("end-turn preserves turn-owner authority when continuation control differs", async () => {
  const { resolveToStability } = await import("../../game-engine/src/resolve");
  const { applyServerAction } = await import("../src/shell-live-core.ts");
  const h = await harness();
  h.DB.overwriteGameState("g", (game) => {
    game.player2.identityId = "defender";
    game.selfPlayMode = false;
    game.board.state = resolveToStability({ ...game.board.state, pieces: [...game.board.state.pieces,
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 1 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 1 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
    ] }, { artifactMode: "full" });
    assert.equal(applyServerAction(game, { type: "push", actorId: "A1", from: { row: 4, col: 1 }, to: { row: 4, col: 2 } }).ok, true);
    assert.equal(game.board.state.continuation.phase, "retreat");
    assert.equal(game.board.state.sideToMove, "P2");
    return game;
  });
  h.restart();
  const owner = await h.command({ kind: "end_turn", expectedTurnIndex: 0 });
  const defender = await h.command({ identityId: "defender", kind: "end_turn", expectedTurnIndex: 0 });
  assert.equal((await h.call("end-turn", defender)).commandOutcomes[0].reason, "not_your_turn");
  const accepted = await h.call("end-turn", owner);
  assert.equal(accepted.commandOutcomes[0].outcome, "accepted");
  assert.equal(accepted.turn.playerSeat, "Player 2");
  const duplicate = await h.call("end-turn", owner);
  assert.deepEqual(duplicate.turn, accepted.turn);
  assert.equal(duplicate.duplicate, true);
});
