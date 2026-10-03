import assert from "node:assert/strict";
import test from "node:test";
import { commandFingerprint, isSyncCommand, isReconcileRequest, isReconcileResponse, SYNC_TIMING, SYNC_LIMITS } from "../../shared-types/src/sync-protocol.ts";
const makeCommand = async (overrides = {}) => {
  const command = { protocolVersion: 2, gameId: "game", identityId: "actor", clientCommandId: "v2:command", kind: "move", payload: { notation: "test" }, expectedState: { board: [] }, expectedGameplayRevision: 0, ...overrides };
  return { ...command, fingerprint: await commandFingerprint(command) };
};
test("v2 public timing and admission contract", () => {
  assert.deepEqual(SYNC_TIMING.retryDelaysMs, [500, 1000, 2000, 4000, 5000]);
  assert.equal(SYNC_TIMING.requestTimeoutMs, 5000);
  assert.equal(SYNC_TIMING.confirmationBudgetMs, 15000);
  assert.equal(SYNC_TIMING.heartbeatIntervalMs, 5000);
  assert.equal(SYNC_TIMING.inboundTimeoutMs, 15000);
  assert.equal(SYNC_LIMITS.outstandingPerGame, 16);
  assert.equal(SYNC_LIMITS.outstandingPerIdentity, 128);
});
test("fingerprints canonicalize order, preserve prerequisites and exclude attempts", async () => {
  const command = await makeCommand({ payload: { b: 1, a: 2 } });
  assert.equal(await commandFingerprint({ ...command, payload: { a: 2, b: 1 }, attempt: 100 }), command.fingerprint);
  for (const patch of [{ expectedGameplayRevision: 1 }, { expectedState: {} }, { identityId: "other" }, { predecessor: { clientCommandId: "v2:parent", fingerprint: "a".repeat(64) } }]) {
    assert.notEqual(await commandFingerprint({ ...command, ...patch }), command.fingerprint);
  }
  await assert.rejects(commandFingerprint({ ...command, payload: { invalid: undefined } }));
});
test("U-03 rejects malformed and oversized command/request boundaries", async () => {
  const command = await makeCommand();
  assert.ok(isSyncCommand(command));
  for (const patch of [{ protocolVersion: 1 }, { clientCommandId: "a".repeat(129) }, { expectedGameplayRevision: -1 }, { expectedGameplayRevision: 0.1 }, { kind: "end_turn" }, { fingerprint: "bad" }, { predecessor: { clientCommandId: command.clientCommandId, fingerprint: command.fingerprint } }, { payload: { text: "🌍".repeat(17000) } }]) assert.equal(isSyncCommand({ ...command, ...patch }), false);
  const request = { protocolVersion: 2, identityId: "actor", knownSnapshotEventSeq: 0, commands: [command] };
  assert.ok(isReconcileRequest(request, "game"));
  for (const patch of [{ identityId: "other" }, { commands: [command, command] }, { commands: Array(17).fill(command) }, { knownSnapshotEventSeq: NaN }]) assert.equal(isReconcileRequest({ ...request, ...patch }, "game"), false);
});
test("U-03 receipt validation rejects false success but permits older outcomes", async () => {
  const command = await makeCommand();
  const outcome = { gameId: "game", identityId: "actor", clientCommandId: command.clientCommandId, fingerprint: command.fingerprint, outcome: "accepted", reason: null, eventSeq: 1, gameplayRevision: 1 };
  const response = { protocolVersion: 2, gameId: "game", eventSeq: 10, gameplayRevision: 4, commandOutcomes: [outcome] };
  assert.ok(isReconcileResponse(response, "game", [command]));
  assert.ok(isReconcileResponse({ ...response, commandOutcomes: [] }, "game", [command])); // missing remains unknown
  for (const patch of [{ identityId: "other" }, { gameId: "other" }, { fingerprint: "bad" }, { clientCommandId: "v2:other" }, { eventSeq: undefined }, { eventSeq: 11 }, { gameplayRevision: -1 }, { gameplayRevision: 0 }, { gameplayRevision: 2 }, { eventSeq: 0 }, { outcome: "ok" }]) assert.equal(isReconcileResponse({ ...response, commandOutcomes: [{ ...outcome, ...patch }] }, "game", [command]), false);
  for (const value of [null, {}, "", { ...response, protocolVersion: 1 }, { ...response, commandOutcomes: [outcome, outcome] }]) assert.equal(isReconcileResponse(value, "game", [command]), false);
});

test("request validation rejects cyclic and conflicting in-batch dependencies", async () => {
  const a = await makeCommand({ clientCommandId: "v2:a" });
  const b = await makeCommand({ clientCommandId: "v2:b" });
  a.predecessor = { clientCommandId: b.clientCommandId, fingerprint: b.fingerprint };
  b.predecessor = { clientCommandId: a.clientCommandId, fingerprint: a.fingerprint };
  const request = { protocolVersion: 2, identityId: "actor", knownSnapshotEventSeq: 0, commands: [a, b] };
  assert.equal(isReconcileRequest(request, "game"), false);
  delete a.predecessor;
  assert.equal(isReconcileRequest(request, "game"), true);
  b.predecessor.fingerprint = "f".repeat(64);
  assert.equal(isReconcileRequest(request, "game"), false);
});
