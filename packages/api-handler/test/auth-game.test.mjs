import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeGameView, sanitizeGameResponse } from "../src/auth-game.ts";
import {
  createInitialGame,
  withFullViewModel,
} from "../src/shell-live-core.ts";
import { commandFingerprint } from "../../shared-types/src/sync-protocol.ts";
const authority = {
  accountId: "alice",
  tokenHash: "a".repeat(64),
  contextId: "b".repeat(64),
  acknowledged: true,
  renew: false,
};
const game = () => ({
  ...createInitialGame({
    gameId: "g",
    identityId: "alice",
    selfPlayMode: true,
  }),
  ownershipMode: "account_v1",
});
test("public, restricted and legacy projections expose no seat credentials or analysis", () => {
  for (const [value, actor] of [
    [game(), null],
    [game(), { ...authority, acknowledged: false }],
    [{ ...game(), ownershipMode: "legacy_guest" }, authority],
  ]) {
    const view = sanitizeGameView(value, actor);
    assert.equal(view.inviteTokens, undefined);
    assert.equal(view.inviteToken, null);
    assert.equal(view.canRecordMove, false);
    if (!actor?.acknowledged) assert.deepEqual(view.legalActions, []);
  }
});
test("repeated account projection preserves selected history and actor invitation only", () => {
  const value = game();
  value.historyIndexByIdentity.alice = 0;
  const projected = withFullViewModel(value, "alice"),
    once = sanitizeGameView(projected, authority),
    twice = sanitizeGameView(once, authority);
  assert.equal(twice.historyIndex, 0);
  assert.equal(twice.inviteToken, projected.inviteToken);
  assert.equal(twice.inviteTokens, undefined);
  assert.deepEqual(twice.currentSnapshot, projected.currentSnapshot);
});
test("another account command receipts never enter personal or public responses", () => {
  const own = { identityId: "alice", clientCommandId: "one" },
    other = { identityId: "bobby", clientCommandId: "two" };
  assert.deepEqual(
    sanitizeGameResponse({ commandOutcomes: [own, other] }, authority)
      .commandOutcomes,
    [own],
  );
  assert.equal(
    sanitizeGameResponse(
      { commandOutcome: other, clientCommandId: "two" },
      authority,
    ).commandOutcome,
    undefined,
  );
  assert.deepEqual(
    sanitizeGameResponse({ commandOutcomes: [own, other] }, null)
      .commandOutcomes,
    [],
  );
});
test("immutable command fingerprint binds the authentication generation", async () => {
  const command = {
    protocolVersion: 2,
    gameId: "g",
    identityId: "alice",
    clientCommandId: "v2:x",
    kind: "move",
    payload: {},
    expectedState: {},
    expectedGameplayRevision: 0,
  };
  assert.notEqual(
    await commandFingerprint({ ...command, authContextId: "a".repeat(64) }),
    await commandFingerprint({ ...command, authContextId: "b".repeat(64) }),
  );
});

import { authErrorResponse } from "../src/auth-game.ts";
import { SyncBodyError } from "../src/sync-body.ts";
test("auth boundary preserves bounded transport body error status", async () => {
  for (const status of [408, 413]) {
    const response = authErrorResponse(
      new SyncBodyError(status, "bounded_body_failure"),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
