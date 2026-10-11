import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, normalizeState } from "../../src/index.ts";
import { canonicalCommandJson, commandFingerprint } from "../../../shared-types/src/sync-protocol.ts";

for (const continuation of [
  { type: "rush", owner: "P1", rushedPieceIds: ["B", "A"], rushChainPieceIds: ["B", "A"], chainLength: 2 },
  { type: "push", owner: "P1", phase: "retreat", pushedPieceId: "B", pushPoint: { row: 5, col: 5 } },
  { type: "push", owner: "P1", phase: "follow", pushedPieceId: undefined, followPoint: { row: 5, col: 5 }, followGroupPieceIds: ["B", "A"], frozenPieceStatesById: {} },
]) test(`${continuation.type} ${continuation.phase ?? "chain"} normalized continuation remains valid command JSON`, async () => {
  const state = normalizeState({ ...createInitialState(), artifacts: undefined, continuation });
  const wireState = JSON.parse(JSON.stringify(state));
  assert.equal(canonicalCommandJson(state), canonicalCommandJson(wireState));
  const command = { protocolVersion: 2, gameId: "game-test", identityId: "identity-test", clientCommandId: "command-test", kind: "action", payload: { action: { type: "pass" } }, expectedGameplayRevision: 1, expectedState: state };
  assert.equal(await commandFingerprint(command), await commandFingerprint({ ...command, expectedState: wireState }));
  assert.deepEqual(state.continuation, normalizeState(state).continuation);
});
