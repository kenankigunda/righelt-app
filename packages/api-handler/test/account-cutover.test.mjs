import assert from "node:assert/strict";
import test from "node:test";
import {
  cutoverPolicy,
  withCutoverPolicy,
  cutoverWritePermit,
  maintenanceAllowed,
} from "../src/account-cutover.ts";
const policy = { activated_at: null, maintenance: 0, canary_account_id: null };
const env = (row = policy) => ({
  DB: {
    prepare() {
      return { first: async () => row };
    },
  },
});
test("missing, unavailable and malformed policy never select guest authority", async () => {
  for (const DB of [
    {
      prepare() {
        throw Error("no such table: account_cutover");
      },
    },
    env(null).DB,
    env({}).DB,
  ]) {
    await assert.rejects(
      withCutoverPolicy({ DB }),
      (e) => e.code === "temporarily_unavailable",
    );
  }
});
test("durable activation keeps accounts required when service availability is disabled", async () => {
  assert.equal((await withCutoverPolicy(env())).AUTH_REQUIRED, "false");
  assert.equal(
    (await withCutoverPolicy({ ...env(), AUTH_ENABLED: "true" })).AUTH_REQUIRED,
    "true",
  );
  const active = await withCutoverPolicy({
    ...env({ ...policy, activated_at: 1, canary_account_id: "canary" }),
    AUTH_ENABLED: "false",
  });
  assert.equal(active.AUTH_REQUIRED, "true");
  assert.equal(active.AUTH_ENABLED, "false");
});
test("maintenance actor permission never creates a credential bypass", () => {
  const current = {
    ...env(),
    ACCOUNT_POLICY: {
      activated_at: 1,
      maintenance: 1,
      canary_account_id: "canary",
    },
  };
  assert.equal(maintenanceAllowed(current), false);
  assert.equal(maintenanceAllowed(current, "ordinary"), false);
  assert.equal(maintenanceAllowed(current, "canary"), true);
  const statements = [];
  current.DB.prepare = (sql) => ({
    bind(...args) {
      statements.push({ sql, args });
      return this;
    },
  });
  const result = cutoverWritePermit(current, "game", {
    accountId: "canary",
    contextId: "context",
    tokenHash: "hash",
  });
  assert.equal(result.before.length, 1);
  assert.equal(result.after.length, 1);
  assert.match(statements[0].sql, /s\.expires_at>CAST\(unixepoch\('subsec'\)/);
  assert.doesNotMatch(statements[0].sql, /recovery/);
  assert.deepEqual(statements[0].args.slice(1), [
    "game",
    "canary",
    "hash",
    "context",
    "canary",
  ]);
});
